import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
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
  stagingWranglerArguments,
} from './staging-wrangler-config.mjs';

const defaultRepositoryRoot = fileURLToPath(new URL('../', import.meta.url));

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
}) {
  let temporaryDirectory;
  try {
    const appDirectory = path.join(repositoryRoot, 'apps', app ?? 'unsupported');
    const argumentsForWrangler = stagingWranglerArguments(app, action, 'CONFIG_PATH');
    const configuration = loadStagingConfiguration(environment);
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

    const childEnvironment = { ...environment };
    for (const key of Object.keys(childEnvironment)) {
      if (key.startsWith('STAGING_')) delete childEnvironment[key];
    }
    delete childEnvironment.AUTH_SECRET;
    delete childEnvironment.RESEND_API_KEY;
    delete childEnvironment.RESEND_FROM;
    delete childEnvironment.OPERATOR_SELECTION_SECRET;

    const invocation = resolver(repositoryRoot, app);
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
        stdio: 'inherit',
      },
    );
    if (result.error) {
      reportError('Unable to execute Wrangler.');
      return 1;
    }
    return result.status ?? 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown validation failure.';
    if (message === 'Unsupported staging Wrangler command.') {
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
  const [app, action, ...extraArguments] = argumentsForRunner;
  if (extraArguments.length > 0) {
    (dependencies.reportError ?? (message => console.error(message)))(
      'Unsupported staging Wrangler command.',
    );
    return 1;
  }
  return runStagingWrangler({ app, action, ...dependencies });
}

const executedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (executedDirectly) {
  process.exitCode = await main();
}
