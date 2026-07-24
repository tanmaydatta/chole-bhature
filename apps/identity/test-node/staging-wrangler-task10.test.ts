import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import {
  stagingProductConfirmationArguments,
  stagingWranglerArguments,
} from '../../../scripts/staging-wrangler-config.mjs';
import { runStagingWrangler } from '../../../scripts/staging-wrangler-runner.mjs';
import {
  LEGACY_REDEMPTION_PRECHECK_SQL,
  TASK10_COUNT_SQL,
} from '../../../scripts/staging-wrangler-task10-queries.mjs';

const productId = 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1';
const authId = '6a65017f-df57-474e-bebb-e676e09377e5';
const apiVersionId = 'de4beb41-e346-481d-a793-3742d91b5861';
const timeTravelBookmark = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: '/reviewed/bin',
    HOME: '/reviewed/home',
    XDG_CONFIG_HOME: '/reviewed/xdg',
    TMPDIR: '/reviewed/tmp',
    LANG: 'en_GB.UTF-8',
    LC_ALL: 'C',
    STAGING_ENVIRONMENT: 'staging',
    STAGING_PRODUCT_D1_ID: productId,
    STAGING_AUTH_D1_ID: authId,
    STAGING_OPERATOR_ORIGIN: 'https://operator.staging.example.com',
    STAGING_API_ORIGIN: 'https://api.staging.example.com',
    STAGING_PASSKEY_RP_ID: 'operator.staging.example.com',
    STAGING_ALLOWED_RECIPIENTS: '["operator@example.com"]',
    AUTH_SECRET: 'must-not-reach-wrangler',
    RESEND_API_KEY: 'must-not-reach-wrangler',
    RESEND_FROM: 'must-not-reach-wrangler',
    OPERATOR_SELECTION_SECRET: 'must-not-reach-wrangler',
    CLOUDFLARE_API_TOKEN: 'cloudflare-auth-token-required-by-wrangler',
    CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account-required-by-wrangler',
    NODE_OPTIONS: '--require=/tmp/hostile-node-options.cjs',
    NODE_PATH: '/tmp/hostile-node-path',
    WRANGLER_LOG: 'debug',
    WRANGLER_API_ENVIRONMENT: 'staging',
    CLOUDFLARE_API_BASE_URL: 'https://hostile-cloudflare-endpoint.invalid',
    HTTP_PROXY: 'https://hostile-proxy.invalid',
    HTTPS_PROXY: 'https://hostile-proxy.invalid',
    ALL_PROXY: 'https://hostile-proxy.invalid',
    NO_PROXY: '*',
    FORCE_COLOR: '3',
    NO_COLOR: '1',
    AWS_ACCESS_KEY_ID: 'unrelated-cloud-credential',
    GITHUB_TOKEN: 'unrelated-service-credential',
  };
}

describe('Task 10 staging Wrangler allowlist', () => {
  test('pins Product D1 confirmation to the generated API config', () => {
    expect(stagingProductConfirmationArguments('/tmp/api.wrangler.toml')).toEqual([
      'd1',
      'info',
      'incentives-staging',
      '--json',
      '--config',
      '/tmp/api.wrangler.toml',
    ]);
  });

  test.each([
    [
      'task10-counts',
      [
        'd1', 'execute', 'incentives-staging', '--remote', '--json',
        '--command', TASK10_COUNT_SQL, '--config', '/tmp/api.wrangler.toml',
      ],
    ],
    [
      'task10-precheck-redemptions',
      [
        'd1', 'execute', 'incentives-staging', '--remote', '--json',
        '--command', LEGACY_REDEMPTION_PRECHECK_SQL,
        '--config', '/tmp/api.wrangler.toml',
      ],
    ],
    [
      'task10-status',
      [
        'deployments', 'status', '--name', 'incentives-api-staging',
        '--json', '--config', '/tmp/api.wrangler.toml',
      ],
    ],
    [
      'task10-bookmark',
      [
        'd1', 'time-travel', 'info', 'incentives-staging',
        '--json', '--config', '/tmp/api.wrangler.toml',
      ],
    ],
  ])('builds exact %s arguments', (action, expected) => {
    expect(stagingWranglerArguments(
      'api',
      action,
      '/tmp/api.wrangler.toml',
    )).toEqual(expected);
  });

  test('does not expose a protected Task 10 rollback action', () => {
    expect(() => stagingWranglerArguments(
      'api',
      'task10-rollback',
      '/tmp/api.wrangler.toml',
      apiVersionId,
    )).toThrow('Unsupported staging Wrangler command.');
  });

  test.each([
    ['identity', 'task10-counts', undefined],
    ['operator-web', 'task10-export', '/tmp/incentives-staging-before-0006.sql'],
    ['api', 'task10-export', '/private/owner-task10/incentives-staging-before-0006.sql'],
    ['api', 'task10-export', undefined],
    ['api', 'task10-export', 'incentives-staging-before-0006.sql'],
    ['api', 'task10-export', '/tmp/arbitrary.sql'],
    ['identity', 'task10-bookmark', undefined],
    ['operator-web', 'task10-bookmark', undefined],
    ['api', 'task10-bookmark', 'unexpected'],
    ['api', 'task10-status', 'unexpected'],
    ['api', 'task10-rollback', 'not-a-version-id'],
    ['operator-web', 'task10-rollback', apiVersionId],
  ])('rejects unsupported or unsafe operands for %s %s', (app, action, operand) => {
    expect(() => stagingWranglerArguments(
      app,
      action,
      '/tmp/config.toml',
      operand,
    )).toThrow('Unsupported staging Wrangler command.');
  });
});

describe('Task 10 protected remote execution', () => {
  test('passes only the reviewed child environment to Wrangler', async () => {
    const childEnvironments: NodeJS.ProcessEnv[] = [];
    const spawn = vi.fn((_command: string, args: string[], options: {
      env: NodeJS.ProcessEnv;
    }) => {
      childEnvironments.push(options.env);
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          created_on: '2026-07-24T08:00:00.000Z',
          versions: [{ version_id: apiVersionId, percentage: 100 }],
        }),
        stderr: '',
      };
    });

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-status',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
    });

    expect(status).toBe(0);
    expect(childEnvironments).toHaveLength(2);
    for (const childEnvironment of childEnvironments) {
      expect(childEnvironment).toEqual({
        PATH: '/reviewed/bin',
        HOME: '/reviewed/home',
        XDG_CONFIG_HOME: '/reviewed/xdg',
        TMPDIR: '/reviewed/tmp',
        LANG: 'en_GB.UTF-8',
        LC_ALL: 'C',
        CLOUDFLARE_API_TOKEN: 'cloudflare-auth-token-required-by-wrangler',
        CLOUDFLARE_ACCOUNT_ID: 'cloudflare-account-required-by-wrangler',
      });
    }
  });

  test('rejects protected Task 10 rollback before invoking Wrangler', async () => {
    const spawn = vi.fn();
    const errors: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-rollback',
      actionArgument: apiVersionId,
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportError: message => errors.push(message),
    });

    expect(status).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(errors).toEqual(['Unsupported staging Wrangler command.']);
  });

  test('reports only allowlisted count fields from Wrangler D1 JSON', async () => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify([{
          success: true,
          results: [{
            promo_rows: 2,
            promo_revision_rows: 3,
            redemption_rows: 4,
            migration_0006_rows: 0,
            sensitive_unexpected_field: 'must not escape',
          }],
          meta: { served_by: 'sensitive-internal-detail' },
        }]),
        stderr: '',
      };
    });
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-counts',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(0);
    expect(output).toEqual([
      'Authenticated staging Product D1 target confirmed.',
      JSON.stringify({
        promo_rows: 2,
        promo_revision_rows: 3,
        redemption_rows: 4,
        migration_0006_rows: 0,
      }),
    ]);
    expect(output.join('\n')).not.toContain('sensitive');
  });

  test('fails closed without echoing malformed protected Wrangler output', async () => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 0,
        stdout: 'malformed output containing private-data.example',
        stderr: 'private-error.example',
      };
    });
    const errors: string[] = [];
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-counts',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportError: message => errors.push(message),
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(1);
    expect(errors).toEqual(['Wrangler returned an invalid protected response.']);
    expect([...errors, ...output].join('\n')).not.toContain('private');
  });

  test('confirms the authenticated Product D1 before a remote operation', async () => {
    const spawn = vi.fn((command: string, args: string[], options: {
      env: NodeJS.ProcessEnv;
      shell: boolean;
      stdio: string | string[];
    }) => {
      expect(command).toBe('/trusted/node');
      expect(options.shell).toBe(false);
      expect(options.env.CLOUDFLARE_API_TOKEN).toBe(
        'cloudflare-auth-token-required-by-wrangler',
      );
      expect(options.env.AUTH_SECRET).toBeUndefined();
      expect(options.env.STAGING_PRODUCT_D1_ID).toBeUndefined();
      const configPath = args.at(-1)!;
      expect(statSync(configPath).mode & 0o777).toBe(0o600);
      const config = readFileSync(configPath, 'utf8');
      if (args[1] === 'd1' && args[2] === 'info') {
        expect(config).toContain(`database_id = "${productId}"`);
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      expect(args.slice(1, 5)).toEqual([
        'deployments', 'status', '--name', 'incentives-operator-web-staging',
      ]);
      return {
        status: 0,
        stdout: JSON.stringify({
          created_on: '2026-07-24T08:00:00.000Z',
          account_id: 'must-not-escape',
          author_email: 'must-not-escape@example.com',
          versions: [{
            version_id: apiVersionId.toUpperCase(),
            percentage: 100,
            author_email: 'must-not-escape@example.com',
            metadata: { account_name: 'must-not-escape' },
          }],
        }),
        stderr: '',
      };
    });
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'operator-web',
      action: 'task10-status',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({ command: '/trusted/node', argumentsPrefix: ['/trusted/wrangler.js'] }),
      spawn,
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(output).toEqual([
      'Authenticated staging Product D1 target confirmed.',
      JSON.stringify({
        createdOn: '2026-07-24T08:00:00.000Z',
        versions: [{ versionId: apiVersionId, percentage: 100 }],
      }),
    ]);
    expect(output.join('\n')).not.toContain('author');
    expect(output.join('\n')).not.toContain('account');
    expect(output.join('\n')).not.toContain('must-not-escape');
  });

  test.each([
    ['empty version id', [{ version_id: '', percentage: 100 }]],
    ['malformed version id', [{ version_id: 'not-a-cloudflare-uuid', percentage: 100 }]],
    [
      'case-insensitive duplicate version ids',
      [
        { version_id: apiVersionId, percentage: 50 },
        { version_id: apiVersionId.toUpperCase(), percentage: 50 },
      ],
    ],
  ])('fails closed on %s without forwarding protected metadata', async (
    _caseName,
    versions,
  ) => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          created_on: '2026-07-24T08:00:00.000Z',
          author_email: 'private-author@example.com',
          account_id: 'private-account',
          versions,
        }),
        stderr: 'private-status-error',
      };
    });
    const errors: string[] = [];
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-status',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportError: message => errors.push(message),
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(['Wrangler returned an invalid protected response.']);
    expect(output).toEqual(['Authenticated staging Product D1 target confirmed.']);
    expect([...errors, ...output].join('\n')).not.toContain('private');
  });

  test('fails a protected status read without forwarding Wrangler output', async () => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 1,
        stdout: JSON.stringify({
          author_email: 'private-author@example.com',
          account_id: 'private-account',
        }),
        stderr: 'private-status-error',
      };
    });
    const errors: string[] = [];
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-status',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportError: message => errors.push(message),
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(['Unable to execute Wrangler.']);
    expect(output).toEqual(['Authenticated staging Product D1 target confirmed.']);
    expect([...errors, ...output].join('\n')).not.toContain('private');
  });

  test('fails closed on a Product D1 identity mismatch without printing either ID', async () => {
    const otherId = 'b403b8cd-d27e-44cc-96d6-afba6a746c54';
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify({ uuid: otherId }),
      stderr: '',
    }));
    const errors: string[] = [];
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-counts',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({ command: '/trusted/node', argumentsPrefix: ['/trusted/wrangler.js'] }),
      spawn,
      reportError: message => errors.push(message),
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(output).toEqual([]);
    expect(errors.join('\n')).toContain('Authenticated Product D1 target mismatch.');
    expect(errors.join('\n')).not.toContain(productId);
    expect(errors.join('\n')).not.toContain(otherId);
  });

  test('reports only the validated D1 Time Travel bookmark', async () => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          bookmark: timeTravelBookmark,
          account_id: 'must-not-escape',
          database_name: 'must-not-escape',
        }),
        stderr: '',
      };
    });
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-bookmark',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(0);
    expect(output).toEqual([
      'Authenticated staging Product D1 target confirmed.',
      JSON.stringify({ bookmark: timeTravelBookmark }),
    ]);
    expect(output.join('\n')).not.toContain('account');
    expect(output.join('\n')).not.toContain('database_name');
  });

  test.each([
    ['missing bookmark', {}],
    ['empty bookmark', { bookmark: '' }],
    ['bookmark containing whitespace', { bookmark: `${timeTravelBookmark}\nprivate` }],
    ['bookmark containing punctuation', { bookmark: `${timeTravelBookmark}/private` }],
  ])('fails closed on %s without forwarding protected metadata', async (
    _caseName,
    protectedResponse,
  ) => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          ...protectedResponse,
          account_id: 'private-account',
        }),
        stderr: 'private-error',
      };
    });
    const errors: string[] = [];
    const output: string[] = [];

    const status = await runStagingWrangler({
      app: 'api',
      action: 'task10-bookmark',
      environment: validEnvironment(),
      repositoryRoot: '/repository',
      resolver: () => ({
        command: '/trusted/node',
        argumentsPrefix: ['/trusted/wrangler.js'],
      }),
      spawn,
      reportError: message => errors.push(message),
      reportOutput: message => output.push(message),
    });

    expect(status).toBe(1);
    expect(errors).toEqual(['Wrangler returned an invalid protected response.']);
    expect(output).toEqual(['Authenticated staging Product D1 target confirmed.']);
    expect([...errors, ...output].join('\n')).not.toContain('private');
  });

  test('keeps the count-only redemption precheck equivalent to migration 0006', () => {
    const migration = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../api/migrations/0006_promo_selection_redemption_bundles.sql',
      ),
      'utf8',
    );
    const guardStart = migration.indexOf('INSERT INTO legacy_redemption_migration_guard');
    const predicateStart = migration.indexOf('FROM redemptions AS redemption', guardStart);
    const predicateEnd = migration.indexOf('LIMIT 1;', predicateStart);
    const migrationPredicate = migration.slice(predicateStart, predicateEnd);
    const precheckPredicate = LEGACY_REDEMPTION_PRECHECK_SQL.slice(
      LEGACY_REDEMPTION_PRECHECK_SQL.indexOf('FROM redemptions AS redemption'),
      LEGACY_REDEMPTION_PRECHECK_SQL.lastIndexOf(';'),
    );
    const normalize = (value: string) => value.replaceAll(/\s+/gu, ' ').trim();

    expect(normalize(precheckPredicate)).toBe(normalize(migrationPredicate));
  });
});
