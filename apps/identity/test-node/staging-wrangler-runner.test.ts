import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test, vi } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const runnerPath = path.join(repositoryRoot, 'scripts/staging-wrangler-runner.mjs');
const runnerUrl = pathToFileURL(runnerPath).href;
const temporaryDirectories: string[] = [];

const productId = 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1';
const authId = '6a65017f-df57-474e-bebb-e676e09377e5';
const origin = 'https://operator.staging.example.com';
const apiOrigin = 'https://api.staging.example.com';

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STAGING_ENVIRONMENT: 'staging',
    STAGING_PRODUCT_D1_ID: productId,
    STAGING_AUTH_D1_ID: authId,
    STAGING_OPERATOR_ORIGIN: origin,
    STAGING_API_ORIGIN: apiOrigin,
    STAGING_PASSKEY_RP_ID: 'operator.staging.example.com',
    STAGING_ALLOWED_RECIPIENTS: '["operator@example.com"]',
    AUTH_SECRET: 'must-not-reach-wrangler-or-output',
    RESEND_API_KEY: 'must-not-reach-wrangler-or-output',
    RESEND_FROM: 'Identity Staging <identity@example.com>',
    OPERATOR_SELECTION_SECRET: 'must-not-reach-wrangler-or-output-operator-selection-secret',
    ...overrides,
  };
}

async function testHarness() {
  const directory = await mkdtemp(path.join(tmpdir(), 'staging-wrangler-test-'));
  temporaryDirectories.push(directory);
  const testRepositoryRoot = path.join(directory, 'repository');
  const capture = path.join(directory, 'capture.json');
  for (const app of ['api', 'identity', 'operator-web']) {
    const wranglerPackage = path.join(
      testRepositoryRoot, 'apps', app, 'node_modules', 'wrangler',
    );
    const bin = path.join(wranglerPackage, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(wranglerPackage, 'package.json'), '{"type":"module"}\n');
    const fakeWrangler = path.join(bin, 'wrangler.js');
    await writeFile(fakeWrangler, `
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const configPath = args[args.indexOf('--config') + 1];
const devVarsPath = path.join(path.dirname(configPath), '.dev.vars');
const hasDevVars = existsSync(devVarsPath);
const devVars = hasDevVars ? readFileSync(devVarsPath, 'utf8') : '';
writeFileSync(process.env.FAKE_WRANGLER_CAPTURE, JSON.stringify({
  args,
  configPath,
  config: readFileSync(configPath, 'utf8'),
  mode: statSync(configPath).mode & 0o777,
  hasAuthSecret: Object.hasOwn(process.env, 'AUTH_SECRET'),
  hasResendApiKey: Object.hasOwn(process.env, 'RESEND_API_KEY'),
  hasResendFrom: Object.hasOwn(process.env, 'RESEND_FROM'),
  hasOperatorSelectionSecret: Object.hasOwn(process.env, 'OPERATOR_SELECTION_SECRET'),
  hasStagingInputs: Object.keys(process.env).some(key => key.startsWith('STAGING_')),
  devVarsPath,
  devVarsMode: hasDevVars ? statSync(devVarsPath).mode & 0o777 : null,
  hasDevAuthSecret: devVars.includes('AUTH_SECRET=') && devVars.includes('must-not-reach'),
  hasDevResendApiKey: devVars.includes('RESEND_API_KEY=') && devVars.includes('must-not-reach'),
  hasDevResendFrom: devVars.includes('RESEND_FROM=') && devVars.includes('identity@example.com'),
  hasDevOperatorSelectionSecret:
    devVars.includes('OPERATOR_SELECTION_SECRET=') && devVars.includes('must-not-reach'),
}));
process.exit(Number(process.env.FAKE_WRANGLER_EXIT ?? '0'));
`);
  }
  return {
    capture,
    repositoryRoot: testRepositoryRoot,
    environment: validEnvironment({
      FAKE_WRANGLER_CAPTURE: capture,
    }),
  };
}

async function executeRunner(
  harness: Awaited<ReturnType<typeof testHarness>>,
  app: string,
  action: string,
  environment: NodeJS.ProcessEnv = harness.environment,
) {
  const invocation = `
    import { main } from ${JSON.stringify(runnerUrl)};
    process.exitCode = await main(${JSON.stringify([app, action])}, {
      repositoryRoot: process.env.TEST_REPOSITORY_ROOT,
      environment: process.env,
    });
  `;
  return execFileAsync(process.execPath, ['--input-type=module', '--eval', invocation], {
    cwd: repositoryRoot,
    env: { ...environment, TEST_REPOSITORY_ROOT: harness.repositoryRoot },
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe('staging Wrangler runner', () => {
  test.each([
    ['api', 'dev', ['dev', '--remote']],
    ['api', 'migrate', ['d1', 'migrations', 'apply', 'incentives-staging', '--remote']],
    ['api', 'deploy', ['deploy']],
    ['identity', 'dev', ['dev', '--remote']],
    [
      'identity', 'migrate',
      ['d1', 'migrations', 'apply', 'incentives-auth-staging', '--remote'],
    ],
    ['identity', 'deploy', ['deploy']],
    ['operator-web', 'dev', ['dev', '--remote']],
    ['operator-web', 'deploy', ['deploy']],
  ] as const)('renders and cleans a protected %s %s config', async (app, action, prefix) => {
    const harness = await testHarness();

    const result = await executeRunner(harness, app, action);
    const capture = JSON.parse(await readFile(harness.capture, 'utf8')) as {
      args: string[];
      configPath: string;
      config: string;
      mode: number;
      hasAuthSecret: boolean;
      hasResendApiKey: boolean;
      hasResendFrom: boolean;
      hasOperatorSelectionSecret: boolean;
      hasStagingInputs: boolean;
      devVarsPath: string;
      devVarsMode: number | null;
      hasDevAuthSecret: boolean;
      hasDevResendApiKey: boolean;
      hasDevResendFrom: boolean;
      hasDevOperatorSelectionSecret: boolean;
    };

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(capture.args.slice(0, prefix.length)).toEqual(prefix);
    expect(capture.args.slice(-2)).toEqual(['--config', capture.configPath]);
    expect(capture.config).toContain(`[observability]
enabled = true
head_sampling_rate = 1`);
    expect(capture.mode).toBe(0o600);
    expect(capture.hasAuthSecret).toBe(false);
    expect(capture.hasResendApiKey).toBe(false);
    expect(capture.hasResendFrom).toBe(false);
    expect(capture.hasOperatorSelectionSecret).toBe(false);
    expect(capture.hasStagingInputs).toBe(false);
    await expect(stat(capture.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(capture.devVarsPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const expectsIdentityDevVars = app === 'identity' && action === 'dev';
    const expectsOperatorDevVars = app === 'operator-web' && action === 'dev';
    const expectsDevVars = expectsIdentityDevVars || expectsOperatorDevVars;
    expect(capture.devVarsMode).toBe(expectsDevVars ? 0o600 : null);
    expect(capture.hasDevAuthSecret).toBe(expectsIdentityDevVars);
    expect(capture.hasDevResendApiKey).toBe(expectsIdentityDevVars);
    expect(capture.hasDevResendFrom).toBe(expectsIdentityDevVars);
    expect(capture.hasDevOperatorSelectionSecret).toBe(expectsOperatorDevVars);
    if (app !== 'operator-web') {
      expect(capture.config).toContain(
        app === 'api' ? `database_id = "${productId}"` : `database_id = "${authId}"`,
      );
      expect(capture.config).not.toContain(app === 'api' ? authId : productId);
    }
    if (app === 'api') {
      expect(capture.config).toContain('name = "incentives-api-staging"');
      expect(capture.config).toContain('database_name = "incentives-staging"');
      expect(capture.config).toContain(
        'routes = [{ pattern = "api.staging.example.com", custom_domain = true }]',
      );
    } else if (app === 'identity') {
      expect(capture.config).toContain('name = "incentives-identity-staging"');
      expect(capture.config).toContain(`PUBLIC_APP_ORIGIN = "${origin}"`);
      expect(capture.config).toContain('PASSKEY_RP_ID = "operator.staging.example.com"');
      expect(capture.config).toContain('service = "incentives-api-staging"');
      expect(capture.config).not.toMatch(/AUTH_SECRET|RESEND_API_KEY|must-not-reach/);
    } else {
      expect(capture.config).toContain('name = "incentives-operator-web-staging"');
      expect(capture.config).toContain('service = "incentives-identity-staging"');
      expect(capture.config).toContain('service = "incentives-api-staging"');
      expect(capture.config).not.toMatch(/d1_databases|database_id|OPERATOR_SELECTION_SECRET/);
    }
  });

  test.each([
    ['missing environment marker', { STAGING_ENVIRONMENT: undefined }],
    ['unsafe environment marker', { STAGING_ENVIRONMENT: 'production' }],
    ['invalid Product UUID', { STAGING_PRODUCT_D1_ID: 'not-a-uuid' }],
    ['zero Product UUID', { STAGING_PRODUCT_D1_ID: '00000000-0000-0000-0000-000000000000' }],
    ['sentinel Product UUID', { STAGING_PRODUCT_D1_ID: '30000000-0000-0000-0000-000000000003' }],
    ['sentinel Auth UUID', { STAGING_AUTH_D1_ID: '20000000-0000-0000-0000-000000000002' }],
    ['equal database IDs', { STAGING_AUTH_D1_ID: productId }],
    ['non-HTTPS origin', { STAGING_OPERATOR_ORIGIN: 'http://operator.staging.example.com' }],
    ['reserved origin', { STAGING_OPERATOR_ORIGIN: 'https://operator.example.invalid' }],
    ['origin path', { STAGING_OPERATOR_ORIGIN: `${origin}/admin` }],
    ['missing API origin', { STAGING_API_ORIGIN: undefined }],
    ['non-HTTPS API origin', { STAGING_API_ORIGIN: 'http://api.staging.example.com' }],
    ['reserved API origin', { STAGING_API_ORIGIN: 'https://api.example.invalid' }],
    ['API origin path', { STAGING_API_ORIGIN: `${apiOrigin}/v1` }],
    ['equal public origins', { STAGING_API_ORIGIN: origin }],
    ['RP mismatch', { STAGING_PASSKEY_RP_ID: 'different.staging.example.com' }],
    ['reserved recipient', { STAGING_ALLOWED_RECIPIENTS: '["user@example.invalid"]' }],
    ['empty recipients', { STAGING_ALLOWED_RECIPIENTS: '[]' }],
  ])('fails closed for %s', async (_label, overrides) => {
    const harness = await testHarness();
    const environment = validEnvironment({
      ...harness.environment,
      ...overrides,
    });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete environment[key];
    }

    await expect(executeRunner(harness, 'api', 'deploy', environment)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^Staging configuration invalid: /),
    });
    await expect(readFile(harness.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    ['AUTH_SECRET', undefined],
    ['AUTH_SECRET', 'short'],
    ['RESEND_API_KEY', undefined],
    ['RESEND_FROM', undefined],
  ])('fails Identity staging dev when %s is unsafe', async (key, value) => {
    const harness = await testHarness();
    const environment = validEnvironment({ ...harness.environment, [key]: value });
    if (value === undefined) delete environment[key];

    await expect(executeRunner(harness, 'identity', 'dev', environment)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^Staging configuration invalid: /),
    });
    await expect(readFile(harness.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each([
    undefined,
    'short',
  ])('fails Operator Web staging dev when its selection secret is %s', async value => {
    const harness = await testHarness();
    const environment = validEnvironment({
      ...harness.environment,
      OPERATOR_SELECTION_SECRET: value,
    });
    if (value === undefined) delete environment.OPERATOR_SELECTION_SECRET;

    await expect(executeRunner(harness, 'operator-web', 'dev', environment))
      .rejects.toMatchObject({
        code: 1,
        stderr: expect.stringMatching(/^Staging configuration invalid: /),
      });
    await expect(readFile(harness.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test.each(['migrate', 'deploy']) (
    'does not require local Identity secrets for %s',
    async action => {
      const harness = await testHarness();
      const environment = validEnvironment({ ...harness.environment });
      delete environment.AUTH_SECRET;
      delete environment.RESEND_API_KEY;
      delete environment.RESEND_FROM;

      await executeRunner(harness, 'identity', action, environment);

      await expect(readFile(harness.capture, 'utf8')).resolves.toBeTypeOf('string');
    },
  );

  test.each([
    ['unknown', 'deploy'],
    ['api', 'unknown'],
  ])('rejects unsupported command %s %s before invoking Wrangler', async (app, action) => {
    const harness = await testHarness();

    await expect(executeRunner(harness, app, action)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/^Unsupported staging Wrangler command\./),
    });
    await expect(readFile(harness.capture, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves Wrangler failure status, cleans config, and redacts all inputs', async () => {
    const harness = await testHarness();
    const environment = validEnvironment({
      ...harness.environment,
      FAKE_WRANGLER_EXIT: '17',
    });

    let failure: unknown;
    try {
      await executeRunner(harness, 'identity', 'deploy', environment);
    } catch (error) {
      failure = error;
    }
    const processFailure = failure as { code: number; stdout: string; stderr: string };
    const capture = JSON.parse(await readFile(harness.capture, 'utf8')) as {
      configPath: string;
    };

    expect(processFailure.code).toBe(17);
    expect(`${processFailure.stdout}${processFailure.stderr}`).not.toMatch(
      /must-not-reach|d918b5cc|6a65017f|operator\.staging/,
    );
    await expect(stat(capture.configPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('local three-Worker topology runner', () => {
  test('builds prerequisites once and starts Wrangler by absolute Node argv without PATH', async () => {
    const runner = await import('../../../scripts/local-workers-runner.mjs').catch(() => null) as
      | null
      | {
        localBuildCommands(root: string, node: string): Array<{
          label: string; command: string; args: string[]; cwd: string;
        }>;
        localWorkerCommands(root: string, node: string): Array<{
          label: string; command: string; args: string[]; cwd: string;
        }>;
      };
    expect(runner?.localBuildCommands).toBeTypeOf('function');
    expect(runner?.localWorkerCommands).toBeTypeOf('function');
    if (!runner) return;

    const fakeRoot = '/repository';
    const fakeNode = '/trusted/node';
    expect(runner.localBuildCommands(fakeRoot, fakeNode)).toEqual([
      {
        label: 'Contracts', command: fakeNode,
        args: ['/repository/packages/contracts/node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
        cwd: '/repository/packages/contracts',
      },
      {
        label: 'Dashboard types', command: fakeNode,
        args: ['/repository/apps/dashboard/node_modules/typescript/bin/tsc', '-b'],
        cwd: '/repository/apps/dashboard',
      },
      {
        label: 'Dashboard assets', command: fakeNode,
        args: ['/repository/apps/dashboard/node_modules/vite/bin/vite.js', 'build'],
        cwd: '/repository/apps/dashboard',
      },
    ]);
    expect(runner.localWorkerCommands(fakeRoot, fakeNode)).toEqual([
      {
        label: 'Core', command: fakeNode,
        args: [
          '/repository/apps/api/node_modules/wrangler/bin/wrangler.js',
          'dev', '--config', '/repository/apps/api/wrangler.toml',
        ],
        cwd: '/repository/apps/api',
      },
      {
        label: 'Identity', command: fakeNode,
        args: [
          '/repository/apps/identity/node_modules/wrangler/bin/wrangler.js',
          'dev', '--config', '/repository/apps/identity/wrangler.toml',
        ],
        cwd: '/repository/apps/identity',
      },
      {
        label: 'Operator Web', command: fakeNode,
        args: [
          '/repository/apps/operator-web/node_modules/wrangler/bin/wrangler.js',
          'dev', '--config', '/repository/apps/operator-web/wrangler.toml',
        ],
        cwd: '/repository/apps/operator-web',
      },
    ]);
    expect(JSON.stringify(runner.localWorkerCommands(fakeRoot, fakeNode)))
      .not.toMatch(/pnpm|dev:local|shell|PATH/u);
  });

  test('bounds fake Worker startup and cleans siblings on failure or an external signal', async () => {
    const runner = await import('../../../scripts/local-workers-runner.mjs') as Record<
      string,
      unknown
    >;
    expect(runner.runLocalWorkers).toBeTypeOf('function');
    if (typeof runner.runLocalWorkers !== 'function') return;

    function harness() {
      const signals = new EventEmitter();
      const children = Array.from({ length: 3 }, () => Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: vi.fn(() => true),
      }));
      const spawnSyncImpl = vi.fn(() => ({ status: 0 }));
      const spawnImpl = vi.fn(() => children[spawnImpl.mock.calls.length - 1]);
      const setExitCode = vi.fn();
      Reflect.apply(runner.runLocalWorkers as (...args: unknown[]) => unknown, undefined, [{
        repositoryRoot: '/repository',
        nodeExecutable: '/trusted/node',
        spawnSyncImpl,
        spawnImpl,
        signalTarget: signals,
        setExitCode,
        environment: { PATH: '/hostile/no-tools' },
      }]);
      return { signals, children, spawnSyncImpl, spawnImpl, setExitCode };
    }

    const failed = harness();
    expect(failed.spawnSyncImpl).toHaveBeenCalledTimes(3);
    expect(failed.spawnImpl).toHaveBeenCalledTimes(3);
    for (const call of [...failed.spawnSyncImpl.mock.calls, ...failed.spawnImpl.mock.calls]) {
      expect(call[0]).toBe('/trusted/node');
      expect(call[2]).toMatchObject({
        env: { PATH: '/hostile/no-tools' }, shell: false,
      });
    }
    failed.children[1]!.exitCode = 17;
    failed.children[1]!.emit('exit', 17);
    expect(failed.setExitCode).toHaveBeenCalledWith(17);
    expect(failed.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');
    expect(failed.children[1]!.kill).not.toHaveBeenCalled();
    expect(failed.children[2]!.kill).toHaveBeenCalledWith('SIGTERM');

    const interrupted = harness();
    interrupted.signals.emit('SIGINT');
    for (const child of interrupted.children) {
      expect(child.kill).toHaveBeenCalledWith('SIGINT');
    }
  });
});
