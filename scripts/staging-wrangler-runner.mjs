import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  lstatSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  loadIdentityStagingDevelopmentSecrets,
  loadOperatorWebStagingDevelopmentSecrets,
  loadStagingConfiguration,
  renderIdentityStagingDevelopmentVars,
  renderOperatorWebStagingDevelopmentVars,
  renderStagingWranglerConfig,
  stagingProductConfirmationArguments,
  stagingWranglerArguments,
} from './staging-wrangler-config.mjs';

const defaultRepositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const TASK10_QUERY_FIELDS = Object.freeze({
  'task10-counts': Object.freeze({
    promo_rows: 'integer',
    promo_revision_rows: 'integer',
    redemption_rows: 'integer',
    migration_0006_rows: 'integer',
  }),
  'task10-precheck-promos': Object.freeze({
    invalid_trigger_rows: 'integer',
    unsafe_normalization_rows: 'integer',
    overlapping_claim_pairs: 'integer',
  }),
  'task10-precheck-redemptions': Object.freeze({
    invalid_legacy_redemption_rows: 'integer',
  }),
  'task10-post-migration': Object.freeze({
    migration_0006_rows: 'integer',
    migration_0006_target_tables: 'integer',
  }),
  'task10-write-marker': Object.freeze({
    evaluation_rows: 'integer',
    latest_evaluation_created_at: 'timestamp',
    redemption_rows: 'integer',
    latest_redemption_created_at: 'timestamp',
  }),
});
const CAPTURED_TASK10_ACTIONS = new Set([
  ...Object.keys(TASK10_QUERY_FIELDS),
  'task10-status',
  'task10-export',
  'task10-rollback',
]);

function capturedText(value) {
  return typeof value === 'string'
    ? value
    : Buffer.isBuffer(value)
      ? value.toString('utf8')
      : '';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Wrangler returned an invalid protected response.');
  }
}

function confirmedProductDatabaseId(stdout) {
  const parsed = parseJson(capturedText(stdout));
  if (
    parsed === null
    || Array.isArray(parsed)
    || typeof parsed !== 'object'
    || typeof parsed.uuid !== 'string'
  ) {
    throw new Error('Wrangler returned an invalid protected response.');
  }
  return parsed.uuid.toLowerCase();
}

function safeD1QueryOutput(action, stdout) {
  const fieldTypes = TASK10_QUERY_FIELDS[action];
  const parsed = parseJson(capturedText(stdout));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Wrangler returned an invalid protected response.');
  }
  const rows = parsed.flatMap(statement => {
    if (
      statement === null
      || typeof statement !== 'object'
      || statement.success !== true
      || !Array.isArray(statement.results)
      || statement.results.length !== 1
      || statement.results[0] === null
      || Array.isArray(statement.results[0])
      || typeof statement.results[0] !== 'object'
    ) {
      throw new Error('Wrangler returned an invalid protected response.');
    }
    return statement.results;
  });
  const safe = {};
  for (const [field, type] of Object.entries(fieldTypes)) {
    const matchingRows = rows.filter(row => Object.hasOwn(row, field));
    if (matchingRows.length !== 1) {
      throw new Error('Wrangler returned an invalid protected response.');
    }
    const value = matchingRows[0][field];
    if (type === 'integer' && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error('Wrangler returned an invalid protected response.');
    }
    if (
      type === 'timestamp'
      && value !== null
      && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    ) {
      throw new Error('Wrangler returned an invalid protected response.');
    }
    safe[field] = value;
  }
  return JSON.stringify(safe);
}

function safeDeploymentStatusOutput(stdout) {
  const deployment = parseJson(capturedText(stdout));
  if (
    deployment === null
    || Array.isArray(deployment)
    || typeof deployment !== 'object'
    || typeof deployment.created_on !== 'string'
    || !Number.isFinite(Date.parse(deployment.created_on))
    || !Array.isArray(deployment.versions)
    || deployment.versions.length === 0
  ) {
    throw new Error('Wrangler returned an invalid protected response.');
  }
  const versions = deployment.versions.map(version => {
    if (
      version === null
      || Array.isArray(version)
      || typeof version !== 'object'
      || typeof version.version_id !== 'string'
      || !Number.isFinite(version.percentage)
      || version.percentage < 0
      || version.percentage > 100
    ) {
      throw new Error('Wrangler returned an invalid protected response.');
    }
    return {
      versionId: version.version_id,
      percentage: version.percentage,
    };
  });
  return JSON.stringify({
    createdOn: deployment.created_on,
    versions,
  });
}

function privateExportDestination(outputPath) {
  const parent = path.dirname(outputPath);
  let parentMetadata;
  try {
    parentMetadata = lstatSync(parent);
  } catch {
    throw new Error('Task 10 export directory must already exist.');
  }
  if (
    !parentMetadata.isDirectory()
    || parentMetadata.isSymbolicLink()
    || (parentMetadata.mode & 0o777) !== 0o700
    || (
      typeof process.getuid === 'function'
      && parentMetadata.uid !== process.getuid()
    )
    || realpathSync(parent) !== path.resolve(parent)
  ) {
    throw new Error(
      'Task 10 export directory must be an owner-controlled non-symlink directory with mode 0700.',
    );
  }
  try {
    lstatSync(outputPath);
    throw new Error('Task 10 export destination must not already exist.');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return Object.freeze({
    path: outputPath,
    parent,
    parentDevice: parentMetadata.dev,
    parentInode: parentMetadata.ino,
  });
}

function verifyPrivateExport(destination) {
  const parentMetadata = lstatSync(destination.parent);
  const outputMetadata = lstatSync(destination.path);
  if (
    parentMetadata.dev !== destination.parentDevice
    || parentMetadata.ino !== destination.parentInode
    || parentMetadata.isSymbolicLink()
    || !outputMetadata.isFile()
    || outputMetadata.isSymbolicLink()
  ) {
    throw new Error('Task 10 export destination changed during export.');
  }
}

export function resolveAppWranglerInvocation(repositoryRoot, app) {
  if (!['api', 'identity', 'operator-web'].includes(app)) {
    throw new Error('Unsupported staging Wrangler command.');
  }
  const entrypoint = path.join(
    repositoryRoot,
    'apps',
    app,
    'node_modules',
    'wrangler',
    'bin',
    'wrangler.js',
  );
  try {
    if (!statSync(entrypoint).isFile()) throw new Error('not a regular file');
    accessSync(entrypoint, constants.R_OK);
  } catch {
    throw new Error(
      'Selected app Wrangler entrypoint must be a readable regular file.',
    );
  }
  return Object.freeze({
    command: process.execPath,
    argumentsPrefix: Object.freeze([entrypoint]),
  });
}

export async function runStagingWrangler({
  app,
  action,
  environment = process.env,
  repositoryRoot = defaultRepositoryRoot,
  resolver = resolveAppWranglerInvocation,
  spawn = spawnSync,
  reportError = message => console.error(message),
  reportOutput = message => console.log(message),
  actionArgument,
}) {
  let temporaryDirectory;
  try {
    const appDirectory = path.join(repositoryRoot, 'apps', app ?? 'unsupported');
    const argumentsForWrangler = stagingWranglerArguments(
      app,
      action,
      'CONFIG_PATH',
      actionArgument,
    );
    const configuration = loadStagingConfiguration(environment);
    const exportDestination = action === 'task10-export'
      ? privateExportDestination(actionArgument)
      : null;
    const developmentSecrets = action !== 'dev'
      ? null
      : app === 'identity'
        ? { kind: 'identity', value: loadIdentityStagingDevelopmentSecrets(environment) }
        : app === 'operator-web'
          ? { kind: 'operator-web', value: loadOperatorWebStagingDevelopmentSecrets(environment) }
          : null;
    const rendered = renderStagingWranglerConfig(app, configuration, repositoryRoot);
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'incentives-staging-wrangler-'));
    const configPath = path.join(temporaryDirectory, `${app}.wrangler.toml`);
    await writeFile(configPath, rendered, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(configPath, 0o600);
    if (developmentSecrets) {
      const devVarsPath = path.join(temporaryDirectory, '.dev.vars');
      await writeFile(
        devVarsPath,
        developmentSecrets.kind === 'identity'
          ? renderIdentityStagingDevelopmentVars(developmentSecrets.value)
          : renderOperatorWebStagingDevelopmentVars(developmentSecrets.value),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await chmod(devVarsPath, 0o600);
    }
    const apiConfigPath = app === 'api'
      ? configPath
      : path.join(temporaryDirectory, 'api-target.wrangler.toml');
    if (app !== 'api') {
      await writeFile(
        apiConfigPath,
        renderStagingWranglerConfig('api', configuration, repositoryRoot),
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await chmod(apiConfigPath, 0o600);
    }

    const childEnvironment = { ...environment };
    for (const key of Object.keys(childEnvironment)) {
      if (key.startsWith('STAGING_')) delete childEnvironment[key];
    }
    delete childEnvironment.AUTH_SECRET;
    delete childEnvironment.RESEND_API_KEY;
    delete childEnvironment.RESEND_FROM;
    delete childEnvironment.OPERATOR_SELECTION_SECRET;

    const confirmationInvocation = resolver(repositoryRoot, 'api');
    const confirmation = spawn(
      confirmationInvocation.command,
      [
        ...confirmationInvocation.argumentsPrefix,
        ...stagingProductConfirmationArguments(apiConfigPath),
      ],
      {
        cwd: path.join(repositoryRoot, 'apps/api'),
        env: childEnvironment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
      },
    );
    if (confirmation.error || confirmation.status !== 0) {
      reportError('Unable to confirm the authenticated staging Product D1 target.');
      return 1;
    }
    if (
      confirmedProductDatabaseId(confirmation.stdout)
      !== configuration.productDatabaseId
    ) {
      reportError('Authenticated Product D1 target mismatch.');
      return 1;
    }
    reportOutput('Authenticated staging Product D1 target confirmed.');

    const invocation = resolver(repositoryRoot, app);
    const captureOutput = CAPTURED_TASK10_ACTIONS.has(action);
    const result = spawn(
      invocation.command,
      [
        ...invocation.argumentsPrefix,
        ...argumentsForWrangler.map(value => value === 'CONFIG_PATH' ? configPath : value),
      ],
      {
        cwd: appDirectory,
        env: childEnvironment,
        shell: false,
        stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        ...(captureOutput ? { encoding: 'utf8' } : {}),
      },
    );
    if (result.error || result.status !== 0) {
      reportError('Unable to execute Wrangler.');
      return captureOutput ? 1 : (result.status ?? 1);
    }
    if (TASK10_QUERY_FIELDS[action]) {
      reportOutput(safeD1QueryOutput(action, result.stdout));
    } else if (action === 'task10-status') {
      reportOutput(safeDeploymentStatusOutput(result.stdout));
    } else if (action === 'task10-export') {
      verifyPrivateExport(exportDestination);
      reportOutput('Product D1 export completed.');
    } else if (action === 'task10-rollback') {
      reportOutput('API Worker rollback completed.');
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown validation failure.';
    if (
      message === 'Unsupported staging Wrangler command.'
      || message === 'Authenticated Product D1 target mismatch.'
    ) {
      reportError(message);
    } else if (message === 'Wrangler returned an invalid protected response.') {
      reportError(message);
    } else {
      reportError(`Staging configuration invalid: ${message}`);
    }
    return 1;
  } finally {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export async function main(
  argumentsForRunner = process.argv.slice(2),
  dependencies = {},
) {
  const [app, action, actionArgument, ...extraArguments] = argumentsForRunner;
  if (extraArguments.length > 0) {
    (dependencies.reportError ?? (message => console.error(message)))(
      'Unsupported staging Wrangler command.',
    );
    return 1;
  }
  return runStagingWrangler({
    app,
    action,
    actionArgument,
    ...dependencies,
  });
}

const executedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (executedDirectly) {
  process.exitCode = await main();
}
