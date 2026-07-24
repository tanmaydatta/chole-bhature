import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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

function validEnvironment(): NodeJS.ProcessEnv {
  return {
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
  ])('builds exact %s arguments', (action, expected) => {
    expect(stagingWranglerArguments(
      'api',
      action,
      '/tmp/api.wrangler.toml',
    )).toEqual(expected);
  });

  test('allows only the fixed private backup filename', () => {
    const output = '/private/owner-task10/incentives-staging-before-0006.sql';
    expect(stagingWranglerArguments(
      'api',
      'task10-export',
      '/tmp/api.wrangler.toml',
      output,
    )).toEqual([
      'd1', 'export', 'incentives-staging', '--remote',
      '--output', output, '--config', '/tmp/api.wrangler.toml',
    ]);
  });

  test('uses Wrangler 4.112 rollback syntax and the exact API Worker name', () => {
    expect(stagingWranglerArguments(
      'api',
      'task10-rollback',
      '/tmp/api.wrangler.toml',
      apiVersionId,
    )).toEqual([
      'rollback',
      apiVersionId,
      '--name',
      'incentives-api-staging',
      '--message',
      'Task 10 emergency rollback after a verified zero-write cutover',
      '--yes',
      '--config',
      '/tmp/api.wrangler.toml',
    ]);
  });

  test.each([
    ['identity', 'task10-counts', undefined],
    ['operator-web', 'task10-export', '/tmp/incentives-staging-before-0006.sql'],
    ['api', 'task10-export', undefined],
    ['api', 'task10-export', 'incentives-staging-before-0006.sql'],
    ['api', 'task10-export', '/tmp/arbitrary.sql'],
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
          versions: [{ version_id: apiVersionId, percentage: 100 }],
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

  test('suppresses Wrangler signed export output', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'task10-private-export-'));
    const outputPath = path.join(
      realpathSync(directory),
      'incentives-staging-before-0006.sql',
    );
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      writeFileSync(outputPath, '-- private export\n', { mode: 0o600 });
      return {
        status: 0,
        stdout: 'Download: https://signed.example.invalid/private-export',
        stderr: 'temporary signed URL',
      };
    });
    const output: string[] = [];

    try {
      const status = await runStagingWrangler({
        app: 'api',
        action: 'task10-export',
        actionArgument: outputPath,
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
      expect(output.join('\n')).toContain('Product D1 export completed.');
      expect(output.join('\n')).not.toContain('signed.example');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('suppresses a signed export URL when Wrangler fails', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'task10-private-export-'));
    const outputPath = path.join(
      realpathSync(directory),
      'incentives-staging-before-0006.sql',
    );
    const spawn = vi.fn((_command: string, args: string[]) => {
      if (args[1] === 'd1' && args[2] === 'info') {
        return { status: 0, stdout: JSON.stringify({ uuid: productId }), stderr: '' };
      }
      return {
        status: 1,
        stdout: 'https://signed.example.invalid/private-export',
        stderr: 'Download failed at https://signed.example.invalid/private-export',
      };
    });
    const errors: string[] = [];
    const output: string[] = [];

    try {
      const status = await runStagingWrangler({
        app: 'api',
        action: 'task10-export',
        actionArgument: outputPath,
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
      expect(errors).toEqual(['Unable to execute Wrangler.']);
      expect([...errors, ...output].join('\n')).not.toContain('signed.example');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an export parent that is not mode 0700 before invoking Wrangler', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'task10-export-mode-'));
    chmodSync(directory, 0o755);
    const outputPath = path.join(
      realpathSync(directory),
      'incentives-staging-before-0006.sql',
    );
    const spawn = vi.fn();
    const errors: string[] = [];

    try {
      const status = await runStagingWrangler({
        app: 'api',
        action: 'task10-export',
        actionArgument: outputPath,
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
      expect(errors.join('\n')).toContain('mode 0700');
    } finally {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects an export path whose parent is a symlink before invoking Wrangler', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'task10-export-link-'));
    const realParent = path.join(directory, 'private-parent');
    const linkedParent = path.join(directory, 'linked-parent');
    mkdirSync(realParent, { mode: 0o700 });
    symlinkSync(realParent, linkedParent);
    const outputPath = path.join(linkedParent, 'incentives-staging-before-0006.sql');
    const spawn = vi.fn();
    const errors: string[] = [];

    try {
      const status = await runStagingWrangler({
        app: 'api',
        action: 'task10-export',
        actionArgument: outputPath,
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
      expect(errors.join('\n')).toContain('non-symlink');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
