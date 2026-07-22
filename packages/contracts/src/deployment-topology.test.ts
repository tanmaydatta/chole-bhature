import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  loadStagingConfiguration,
  renderStagingWranglerConfig,
} from '../../../scripts/staging-wrangler-config.mjs';

const apiWrangler = readFileSync(
  new URL('../../../apps/api/wrangler.toml', import.meta.url),
  'utf8',
);
const identityWrangler = readFileSync(
  new URL('../../../apps/identity/wrangler.toml', import.meta.url),
  'utf8',
);
const apiPackage = JSON.parse(readFileSync(
  new URL('../../../apps/api/package.json', import.meta.url),
  'utf8',
)) as { scripts: Record<string, string> };
const identityPackage = JSON.parse(readFileSync(
  new URL('../../../apps/identity/package.json', import.meta.url),
  'utf8',
)) as { scripts: Record<string, string> };
const gitignore = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');

function section(config: string, header: string): string {
  const marker = `[${header}]`;
  const start = config.indexOf(marker);
  if (start < 0) throw new Error(`Missing TOML section ${marker}`);
  const contentStart = start + marker.length;
  const remainder = config.slice(contentStart);
  const nextSection = remainder.search(/^\[/m);
  return nextSection < 0 ? remainder : remainder.slice(0, nextSection);
}

function value(source: string, key: string): string {
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"$`, 'm'));
  if (!match?.[1]) throw new Error(`Missing ${key}`);
  return match[1];
}

describe('local and staging worker topology', () => {
  test('keeps the checked-in Wrangler files local-only', () => {
    const apiLocalName = value(apiWrangler, 'name');

    expect(value(section(identityWrangler, '[services]'), 'service')).toBe(apiLocalName);
    expect(apiLocalName).toBe('incentives-api');
    expect(value(section(apiWrangler, '[d1_databases]'), 'database_name'))
      .toBe('incentives-dev');
    expect(value(section(identityWrangler, '[d1_databases]'), 'database_name'))
      .toBe('incentives-auth-local');
    expect(`${apiWrangler}\n${identityWrangler}`).not.toMatch(
      /\[env\.staging\]|example\.invalid|incentives-(?:api|auth)-staging/,
    );
  });

  test('generates the complete staging topology from validated inputs', () => {
    const productDatabaseId = 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1';
    const authDatabaseId = '6a65017f-df57-474e-bebb-e676e09377e5';
    const configuration = loadStagingConfiguration({
      STAGING_ENVIRONMENT: 'staging',
      STAGING_PRODUCT_D1_ID: productDatabaseId,
      STAGING_AUTH_D1_ID: authDatabaseId,
      STAGING_OPERATOR_ORIGIN: 'https://operator.staging.example.com',
      STAGING_API_ORIGIN: 'https://api.staging.example.com',
      STAGING_PASSKEY_RP_ID: 'operator.staging.example.com',
      STAGING_ALLOWED_RECIPIENTS: '["operator@example.com"]',
    });
    const apiStaging = renderStagingWranglerConfig('api', configuration, '/repository');
    const identityStaging = renderStagingWranglerConfig(
      'identity', configuration, '/repository',
    );
    const operatorStaging = renderStagingWranglerConfig(
      'operator-web', configuration, '/repository',
    );

    for (const generated of [apiStaging, identityStaging, operatorStaging]) {
      expect(section(generated, 'observability')).toContain('enabled = true');
      expect(section(generated, 'observability')).toContain('head_sampling_rate = 1');
    }
    expect(value(apiStaging, 'name')).toBe('incentives-api-staging');
    expect(value(identityStaging, 'name')).toBe('incentives-identity-staging');
    expect(value(section(apiStaging, '[d1_databases]'), 'database_name'))
      .toBe('incentives-staging');
    expect(value(section(identityStaging, '[d1_databases]'), 'database_name'))
      .toBe('incentives-auth-staging');
    expect(value(section(apiStaging, '[d1_databases]'), 'database_id'))
      .toBe(productDatabaseId);
    expect(value(section(identityStaging, '[d1_databases]'), 'database_id'))
      .toBe(authDatabaseId);
    expect(productDatabaseId).not.toBe(authDatabaseId);
    expect(value(section(identityStaging, '[services]'), 'service'))
      .toBe(value(apiStaging, 'name'));
    expect(value(section(identityStaging, 'vars'), 'PUBLIC_APP_ORIGIN'))
      .toBe('https://operator.staging.example.com');
    expect(value(section(identityStaging, 'vars'), 'PASSKEY_RP_ID'))
      .toBe('operator.staging.example.com');
    expect(apiStaging.match(/^routes\s*=/gmu) ?? []).toHaveLength(1);
    expect(apiStaging).toContain(
      'routes = [{ pattern = "api.staging.example.com", custom_domain = true }]',
    );
    expect(operatorStaging.match(/^routes\s*=/gmu) ?? []).toHaveLength(1);
    expect(operatorStaging).toContain(
      'routes = [{ pattern = "operator.staging.example.com", custom_domain = true }]',
    );
    expect(identityStaging).not.toMatch(/^routes\s*=/mu);
  });

  test('provides explicit local and staging commands without declaring production', () => {
    expect(apiPackage.scripts).toMatchObject({
      'predev:local': 'pnpm run build:dependencies',
      'dev:local': 'wrangler dev --config wrangler.toml',
      'predev:staging': 'pnpm run build:dependencies',
      'dev:staging': 'node ../../scripts/staging-wrangler-runner.mjs api dev',
      'predeploy:staging': 'pnpm run build:dependencies',
      'deploy:staging': 'node ../../scripts/staging-wrangler-runner.mjs api deploy',
      'db:migrate:local':
        'wrangler d1 migrations apply incentives-dev --local --config wrangler.toml',
      'db:migrate:staging':
        'node ../../scripts/staging-wrangler-runner.mjs api migrate',
    });
    expect(identityPackage.scripts).toMatchObject({
      'predev:local': 'pnpm --filter @incentives/contracts build',
      'dev:local': 'wrangler dev --config wrangler.toml',
      'predev:staging': 'pnpm --filter @incentives/contracts build',
      'dev:staging': 'node ../../scripts/staging-wrangler-runner.mjs identity dev',
      'predeploy:staging': 'pnpm --filter @incentives/contracts build',
      'deploy:staging': 'node ../../scripts/staging-wrangler-runner.mjs identity deploy',
      'db:migrate:local':
        'wrangler d1 migrations apply incentives-auth-local --local --config wrangler.toml',
      'db:migrate:staging':
        'node ../../scripts/staging-wrangler-runner.mjs identity migrate',
    });
    expect(`${apiWrangler}\n${identityWrangler}`).not.toMatch(/\[env\.(?:prod|production)\]/);
  });

  test('ignores filled environment files while retaining the staging example', () => {
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.staging\.example$/m);
  });
});
