import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

describe('repository deployment policy', () => {
  test('runs repository verification without granting or invoking Cloudflare writes', async () => {
    const workflow = await readFile(
      path.join(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('branches: [dev]');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).toContain('pnpm build');
    expect(workflow).toContain('pnpm lint');
    expect(workflow).toContain('pnpm test');
    expect(workflow).not.toMatch(/wrangler|deploy:staging|CLOUDFLARE_/iu);
  });

  test('pins owned domains while keeping deploy-specific values out of Git', async () => {
    const template = await readFile(path.join(repositoryRoot, '.env.staging.example'), 'utf8');
    const operations = await readFile(
      path.join(repositoryRoot, 'docs/integration/staging-operations.md'),
      'utf8',
    );

    expect(template).toContain(
      'STAGING_OPERATOR_ORIGIN=https://operator.staging.wastd.dev',
    );
    expect(template).toContain('STAGING_API_ORIGIN=https://api.staging.wastd.dev');
    expect(template).toContain('STAGING_PASSKEY_RP_ID=operator.staging.wastd.dev');
    expect(template).not.toMatch(
      /STAGING_(?:PRODUCT|AUTH)_D1_ID=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/iu,
    );
    expect(operations).toContain('pnpm staging:preflight');
    expect(operations).toContain('pnpm --filter @incentives/api db:migrate:staging');
    expect(operations).toContain('pnpm --filter @incentives/identity db:migrate:staging');
    expect(operations).toContain('--name incentives-identity-staging');
    expect(operations).toContain('--name incentives-operator-web-staging');
    expect(operations).toContain('The assistant must not run these Cloudflare-changing commands');
  });
});
