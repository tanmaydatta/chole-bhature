import { ProductE2eCapabilitiesSchema } from '@incentives/contracts';

import type { Env } from '../env.js';
import { assertCiStack } from '../ci-stack.js';

export async function productE2eCapabilities(env: Env) {
  assertCiStack(env);
  if (env.APP_ENV !== 'ci' && env.APP_ENV !== 'staging'
    && !(env.APP_ENV === 'local' && env.E2E_LOCAL_TEST_MODE === '1')) {
    throw new Error('E2E capabilities are unavailable outside staging or isolated local mode');
  }
  const migrations = await env.DB.prepare(`SELECT name FROM d1_migrations
    WHERE name = '0008_e2e_tenant_lifecycle.sql'`).all<{ name: string }>();
  const tables = await env.DB.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('e2e_run_claims', 'e2e_run_disposal_audit')`)
    .all<{ name: string }>();
  if (migrations.results.length !== 1
    || migrations.results[0]?.name !== '0008_e2e_tenant_lifecycle.sql'
    || !['e2e_run_claims', 'e2e_run_disposal_audit']
      .every(name => tables.results.some(table => table.name === name))) {
    throw new Error('Product E2E migration 0008 is missing or incomplete');
  }
  return ProductE2eCapabilitiesSchema.parse({
    version: 1, migrations: ['0008_e2e_tenant_lifecycle.sql'],
    inspection: true, disposal: true,
  });
}
