import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Env } from '../src/env.js';
import { createProductE2eLifecycle } from '../src/services/e2e-lifecycle.js';
import { provisionMerchant } from '../src/routes/internal-merchants.js';
import apiWorker, { CoreOperatorService } from '../src/worker.js';
import { inspectProductE2eRun } from '../src/services/e2e-inspection.js';

const first = {
  runId: 'e2e_0123456789abcdef01234567',
  merchantId: 'merchant-e2e-first',
  provisioningId: 'provision-e2e-first',
  proofHash: 'a'.repeat(64),
};
const second = {
  runId: 'e2e_89abcdef0123456701234567',
  merchantId: 'merchant-e2e-second',
  provisioningId: 'provision-e2e-second',
  proofHash: 'b'.repeat(64),
};

function stagingEnv(): Env {
  return { ...env, APP_ENV: 'staging' } as Env;
}

async function seedRun(input: typeof first, target = stagingEnv()): Promise<void> {
  const result = await provisionMerchant(target, {
    actorUserId: 'root-test', actorKind: 'root', merchantId: input.merchantId,
    permission: 'credentials:manage', correlationId: input.runId,
  }, {
    id: input.merchantId, name: `${input.runId}_merchant`,
    provisioningId: input.provisioningId,
    e2eRun: { runId: input.runId, proofHash: input.proofHash },
  });
  expect(result.id).toBe(input.merchantId);
  await env.DB.prepare(`INSERT INTO customers
    (id, merchant_id, external_ref, attributes_json, version, updated_at)
    VALUES (?1, ?2, ?3, '{}', 1, ?4)`)
    .bind(`customer-${input.runId}`, input.merchantId, `${input.runId}_buyer`, new Date().toISOString()).run();
}

describe('staging E2E tenant disposal in Product D1', () => {
  test('invalid CI fetch and RPC configuration refuses before database mutation', async () => {
    await seedRun(first);
    const ci = { ...env, APP_ENV: 'ci', CI_STACK_KEY: '0123456789abcdef0123',
      PUBLIC_APP_ORIGIN: 'https://operator.example.test',
      DECISION_SIGNING_SECRET: 'disposable-ci-decision-secret-32-characters' } as Env;
    const service = new CoreOperatorService(createExecutionContext(), ci);
    await expect(service.disposeE2eRun({ actorKind: 'root', actorUserId: 'root', merchantId: first.merchantId,
      permission: 'credentials:manage', correlationId: 'ci' }, first)).rejects.toThrow(/CI/u);
    expect(() => apiWorker.fetch(new Request('https://operator.example.test/'), ci, createExecutionContext()))
      .toThrow(/CI/u);
    expect(await env.DB.prepare('SELECT status FROM e2e_run_claims WHERE run_id = ?1')
      .bind(first.runId).first()).toEqual({ status: 'active' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM customers WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toEqual({ total: 1 });
  });

  test('validated CI capabilities and disposal retain proof and concurrent-run isolation', async () => {
    await seedRun(first);
    await seedRun(second);
    const ci = { ...env, APP_ENV: 'ci', CI_STACK_KEY: '0123456789abcdef0123',
      PUBLIC_APP_ORIGIN: 'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev',
      DECISION_SIGNING_SECRET: 'disposable-ci-decision-secret-32-characters' } as Env;
    const rpc = new CoreOperatorService(createExecutionContext(), ci);
    expect(await rpc.getE2eCapabilities({ actorKind: 'root', actorUserId: 'root',
      correlationId: 'ci' })).toMatchObject({ version: 1, disposal: true });
    const lifecycle = createProductE2eLifecycle(ci);
    await expect(lifecycle.dispose({ ...first, proofHash: second.proofHash })).rejects.toThrow(/provenance/u);
    const disposed = await lifecycle.dispose(first);
    expect(Object.values(disposed.counts).every(value => value === 0)).toBe(true);
    expect((await lifecycle.dispose(first)).status).toBe('disposed');
    expect((await lifecycle.preview(second)).counts.customers).toBe(1);
  });

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM e2e_run_claims'),
      env.DB.prepare('DELETE FROM customers'),
      env.DB.prepare("DELETE FROM merchants WHERE id LIKE 'merchant-e2e-%' OR id = 'foreign-merchant'"),
    ]);
  });

  test.each(['local', 'production'])('rejects foreign merchant, wrong proof, and %s environment', async mode => {
    await seedRun(first);
    await env.DB.prepare(`INSERT INTO merchants
      (id, name, status, created_at, updated_at)
      VALUES ('foreign-merchant', 'real customer', 'active', ?1, ?1)`)
      .bind(new Date().toISOString()).run();
    const service = createProductE2eLifecycle(stagingEnv());
    await expect(service.preview({ ...first, merchantId: 'foreign-merchant' })).rejects.toThrow();
    await expect(service.dispose({ ...first, proofHash: 'c'.repeat(64) })).rejects.toThrow();
    await expect(createProductE2eLifecycle({ ...env, APP_ENV: mode } as Env)
      .preview(first)).rejects.toThrow(/staging/u);
    expect(await env.DB.prepare("SELECT id FROM merchants WHERE id = 'foreign-merchant'").first())
      .toMatchObject({ id: 'foreign-merchant' });
  });

  test('disposes one concurrent run completely and resumes idempotently without touching another', async () => {
    await Promise.all([seedRun(first), seedRun(second)]);
    const service = createProductE2eLifecycle(stagingEnv());
    expect((await service.preview(first)).counts.customers).toBe(1);
    await service.dispose(first);
    await service.dispose(first);
    expect(await env.DB.prepare('SELECT id FROM merchants WHERE id = ?1')
      .bind(first.merchantId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM customers WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM merchants WHERE id = ?1')
      .bind(second.merchantId).first()).toMatchObject({ id: second.merchantId });
    expect(await env.DB.prepare('SELECT status FROM e2e_run_claims WHERE run_id = ?1')
      .bind(first.runId).first()).toMatchObject({ status: 'disposed' });
  });

  test('allows complete disposal in explicit isolated local E2E mode only', async () => {
    const localEnv = { ...env, APP_ENV: 'local', E2E_LOCAL_TEST_MODE: '1' } as Env;
    await seedRun(first, localEnv);
    const local = createProductE2eLifecycle(localEnv);
    expect((await local.preview(first)).counts.customers).toBe(1);
    await local.dispose(first);
    expect(await env.DB.prepare('SELECT id FROM merchants WHERE id = ?1')
      .bind(first.merchantId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM customers WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toBeNull();
  });

  test('private Core lifecycle RPC rejects non-root and mismatched merchant contexts', async () => {
    await seedRun(first);
    const service = new CoreOperatorService(createExecutionContext(), stagingEnv());
    const context = {
      actorUserId: 'root-test', actorKind: 'root' as const,
      merchantId: first.merchantId, permission: 'credentials:manage' as const,
      correlationId: first.runId,
    };
    await expect(service.previewE2eRun({ ...context, actorKind: 'member' }, first))
      .rejects.toThrow();
    await expect(service.disposeE2eRun({ ...context, merchantId: second.merchantId }, first))
      .rejects.toThrow();
    expect(await service.previewE2eRun(context, first)).toMatchObject({
      status: 'active', merchantId: first.merchantId,
    });
  });

  test('read-only capability RPC proves Product migration and refuses its absence', async () => {
    const service = new CoreOperatorService(createExecutionContext(), stagingEnv());
    const root = { actorUserId: 'root-test', actorKind: 'root' as const,
      correlationId: 'capability-test' };
    await expect(service.getE2eCapabilities({ ...root, actorKind: 'member' }))
      .rejects.toThrow(/root/u);
    expect(await service.getE2eCapabilities(root)).toMatchObject({
      version: 1, migrations: ['0008_e2e_tenant_lifecycle.sql'],
      inspection: true, disposal: true,
    });
    await env.DB.prepare("DELETE FROM d1_migrations WHERE name = '0008_e2e_tenant_lifecycle.sql'").run();
    try {
      await expect(service.getE2eCapabilities(root)).rejects.toThrow(/migration/u);
    } finally {
      await env.DB.prepare("INSERT INTO d1_migrations (name) VALUES ('0008_e2e_tenant_lifecycle.sql')").run();
    }
  });

  test('inspection refuses foreign program and idempotency identifiers before reading rows', async () => {
    await seedRun(first);
    await expect(inspectProductE2eRun(stagingEnv(), first, {
      evaluationId: 'evaluation-1', idempotencyKey: 'foreign-attempt',
      programRefs: [`${first.runId}_promo`],
    })).rejects.toThrow(/namespace/u);
    await expect(inspectProductE2eRun(stagingEnv(), first, {
      evaluationId: 'evaluation-1', idempotencyKey: `${first.runId}_attempt`,
      programRefs: [`${second.runId}_promo`],
    })).rejects.toThrow(/namespace/u);
  });

  test('private inspection RPC rejects non-root before any tenant read', async () => {
    const service = new CoreOperatorService(createExecutionContext(), stagingEnv());
    await expect(service.inspectE2eRun({ actorUserId: 'member', actorKind: 'member',
      merchantId: first.merchantId, permission: 'credentials:manage',
      correlationId: first.runId }, first, {
      evaluationId: 'evaluation-1', idempotencyKey: `${first.runId}_attempt`,
      programRefs: [`${first.runId}_promo`],
    })).rejects.toThrow(/root/u);
  });
});
