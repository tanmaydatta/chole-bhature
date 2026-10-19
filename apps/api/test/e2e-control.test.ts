import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { createProductE2eControl } from '../src/services/e2e-control.js';
import type { StoredControlLease, E2eControlRuntime } from '@incentives/contracts';
import { createProductControlStore } from '../src/services/e2e-control-store.js';
import { withControlWrite } from '../src/repositories/e2e-write-fence.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';

const generation = 'a'.repeat(40), targetId = 'b'.repeat(64);
const envelope = () => ({ protocol: 'incentives-e2e-control', version: 2,
  generation, targetId, requestId: crypto.randomUUID() });
const managed = () => ({ ...env, APP_ENV: 'local' as const, E2E_LOCAL_TEST_MODE: '1',
  PUBLIC_APP_ORIGIN: 'http://127.0.0.1:5173', E2E_CONTROL_ENABLED: '1',
  E2E_CONTROL_GENERATION: generation, E2E_CONTROL_TARGET_ID: targetId });
const runtime: E2eControlRuntime = { environment: 'local', generation, targetId, enabled: true, accountQuota: 3, cleanupGenerations: [] };
async function active() {
  const now = Date.now();
  const reserved: StoredControlLease = { runId: `e2e_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
    merchantId: crypto.randomUUID(), provisioningId: crypto.randomUUID(), organizationId: crypto.randomUUID(),
    generation, targetId, issuedAt: now, expiresAt: now+900000, phase: 'reserved',
    proofHash: 'c'.repeat(64), controllerHash: 'd'.repeat(64), requestId: crypto.randomUUID(), payloadHash: 'e'.repeat(64), accountQuota: 3 };
  const store = createProductControlStore(env.DB);
  await store.mirror(reserved);
  await withControlWrite(env.DB, runtime, reserved, 'provision', [env.DB.prepare(`INSERT INTO merchants
    (id,name,status,provisioning_id,created_at,e2e_control_run_id) VALUES (?1,?2,'active',?3,?4,?5)`)
    .bind(reserved.merchantId, reserved.runId+'_merchant', reserved.provisioningId, new Date(now).toISOString(), reserved.runId)]);
  await store.advance(reserved.runId, 'reserved', 'product-provisioned');
  await store.advance(reserved.runId, 'product-provisioned', 'auth-provisioned');
  return store.advance(reserved.runId, 'auth-provisioned', 'active');
}
async function businessRows() {
  const rows: Record<string, unknown> = {};
  for (const table of ['customers','program_counters','product_audit','redemption_operations']) rows[table] = (await env.DB.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;
  return rows;
}

describe('private Product control authority', () => {
  test('ordinary repository construction derives trusted runtime for an active v2 tenant', async () => {
    const lease = await active();
    const result = await createRepositories(managed()).customers.upsert({ merchantId: lease.merchantId, externalRef: 'buyer', attributes: { tier: 'gold' } });
    expect(result).toMatchObject({ externalRef: 'buyer', version: 1, attributes: { tier: 'gold' } });
    expect(await env.DB.prepare('SELECT attributes_json FROM customers WHERE merchant_id=?1').bind(lease.merchantId).first())
      .toEqual({ attributes_json: '{"tier":"gold"}' });
  });
  test.each(['missing', 'invalid', 'disabled', 'fenced'])('%s business default refuses v2 with durable equality', async mode => {
    const lease = await active(), config = managed();
    if (mode === 'invalid') config.E2E_CONTROL_GENERATION = 'invalid';
    if (mode === 'disabled') config.E2E_CONTROL_ENABLED = '0';
    if (mode === 'fenced') await createProductControlStore(env.DB).advance(lease.runId, 'active', 'fencing');
    const before = await businessRows();
    await expect(createRepositories(mode === 'missing' ? { DB: env.DB } : config).customers.upsert({ merchantId: lease.merchantId,
      externalRef: 'blocked', attributes: {} })).rejects.toThrow();
    expect(await businessRows()).toEqual(before);
  });
  test.each(['missing', 'invalid', 'disabled'])('%s control configuration preserves manual ordinary factories', async mode => {
    const id = crypto.randomUUID(), config = managed();
    if (mode === 'invalid') config.E2E_CONTROL_GENERATION = 'invalid';
    if (mode === 'disabled') config.E2E_CONTROL_ENABLED = '0';
    await env.DB.prepare(`INSERT INTO merchants (id,name,status,created_at) VALUES (?1,'Manual','active',?2)`).bind(id,new Date().toISOString()).run();
    expect(await createRepositories(mode === 'missing' ? { DB: env.DB } : config).customers.upsert({ merchantId: id, externalRef: 'manual', attributes: {} }))
      .toMatchObject({ externalRef: 'manual', version: 1 });
  });
  test('live migrated managed local Product advertises genuine guarded v2 recovery', async () => {
    expect(await createProductE2eControl(managed()).execute({ operation: 'capabilities', envelope: envelope() }))
      .toMatchObject({ version: 2, product: 2, fencing: true, recovery: true,
        runtime: { environment: 'local', generation, targetId }, migrations: ['0008_e2e_tenant_lifecycle.sql', '0009_e2e_control_leases.sql'] });
  });
  test.each(['normal local', 'production', 'unknown', 'ci', 'wrong target', 'wrong generation'])
    ('%s refuses before claim or merchant writes', async mode => {
      const config = managed();
      const before = (await env.DB.prepare('SELECT * FROM e2e_control_runs ORDER BY rowid').all()).results;
      const input = envelope();
      if (mode === 'normal local') config.E2E_LOCAL_TEST_MODE = '0';
      if (mode === 'wrong target') input.targetId = 'c'.repeat(64);
      if (mode === 'wrong generation') input.generation = 'c'.repeat(40);
      const result = await createProductE2eControl({ ...config,
        ...(mode === 'production' || mode === 'unknown' || mode === 'ci' ? { APP_ENV: mode } : {}),
      } as typeof config).execute({ operation: 'capabilities', envelope: input });
      expect(result).toHaveProperty('error');
      expect((await env.DB.prepare('SELECT * FROM e2e_control_runs ORDER BY rowid').all()).results).toEqual(before);
    });
});
