import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';

import { createIdentityE2eLifecycle } from '../src/services/e2e-lifecycle.js';
import { createIdentityAuth } from '../src/auth.js';
import { createIdentityE2eFixtures } from '../src/services/e2e-fixtures.js';
import { createOrganizationService } from '../src/services/organizations.js';
import { IdentityOperatorService, type Env } from '../src/worker.js';

const first = {
  runId: 'e2e_0123456789abcdef01234567', merchantId: 'merchant-e2e-first',
  provisioningId: 'provision-e2e-first', proofHash: 'a'.repeat(64),
};
const second = {
  runId: 'e2e_89abcdef0123456701234567', merchantId: 'merchant-e2e-second',
  provisioningId: 'provision-e2e-second', proofHash: 'b'.repeat(64),
};
const proof = 'A'.repeat(43);
const stagingSecretBindings = {
  AUTH_SECRET_STORE: { get: async () => env.AUTH_SECRET },
  RESEND_API_KEY_STORE: { get: async () => 'test-resend-key' },
  RESEND_FROM_STORE: { get: async () => 'Fixture <fixture@example.test>' },
};

async function seedRoot() {
  const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`INSERT INTO user
      (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES ('e2e-root', 'Root', 'root@example.test', 1, ?1, ?1)`).bind(now),
    env.AUTH_DB.prepare(`INSERT INTO auth_profile
      (user_id, subject_kind, status, email_login_enabled)
      VALUES ('e2e-root', 'root', 'active', 0)`),
    env.AUTH_DB.prepare(`INSERT INTO session
      (id, expiresAt, token, createdAt, updatedAt, userId,
       authenticationMethod, authenticatedAt, recoveryOnly)
      VALUES ('e2e-root-session', ?1, 'e2e-root-token', ?2, ?2,
        'e2e-root', 'passkey', ?2, 0)`).bind(now + 60000, now),
  ]);
}

async function seed(input: typeof first, email = `e2e+${input.runId}_admin@example.test`) {
  const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`INSERT INTO client_provisionings
      (provisioning_id, merchant_id, organization_id, name, status, current_step,
       retryable, attempt_count, created_at, updated_at, correlation_id)
      VALUES (?1, ?2, ?3, ?4, 'active', 'complete', 0, 1, ?5, ?5, ?6)`)
      .bind(input.provisioningId, input.merchantId, `org-${input.runId}`,
        `${input.runId}_merchant`, now, input.runId),
    env.AUTH_DB.prepare(`INSERT INTO organizations
      (id, merchant_id, provisioning_id, name, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`)
      .bind(`org-${input.runId}`, input.merchantId, input.provisioningId,
        `${input.runId}_merchant`, now),
    env.AUTH_DB.prepare(`INSERT INTO e2e_run_claims
      (run_id, merchant_id, provisioning_id, proof_hash, status, created_at)
      VALUES (?1, ?2, ?3, ?4, 'active', ?5)`)
      .bind(input.runId, input.merchantId, input.provisioningId, input.proofHash, now),
    env.AUTH_DB.prepare(`INSERT INTO invitations
      (id, organization_id, email, role, token_hash, status, invited_by,
       expires_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, 'admin', ?4, 'sent', 'root', ?5, ?6, ?6)`)
      .bind(`invite-${input.runId}`, `org-${input.runId}`, email,
        `hash-${input.runId}`, now + 3600000, now),
  ]);
}

describe('staging E2E tenant disposal in Auth D1', () => {
  test('CI root provisions a proof-bound tenant, creates fixtures and disposes only that run', async () => {
    await seedRoot();
    const hash = '0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a';
    const expected = { ...first, proofHash: hash };
    const disposed = new Set<string>();
    const provisioned = new Map<string, { name: string; provisioningId: string }>();
    const now = new Date().toISOString();
    const core: Env['CORE'] = {
      async provisionMerchant(context, input) {
        expect(context.actorKind).toBe('root');
        expect(input.e2eRun).toEqual({ runId: first.runId, proofHash: hash });
        provisioned.set(input.id, { name: input.name, provisioningId: input.provisioningId });
        return { ok: true, value: { id: input.id, name: input.name,
          provisioningId: input.provisioningId, status: 'provisioning',
          createdAt: now, updatedAt: now } };
      },
      async activateMerchant(context, input) {
        expect(context.actorKind).toBe('root');
        const row = provisioned.get(input.id);
        if (!row || row.provisioningId !== input.provisioningId) throw new Error('wrong activation');
        return { ok: true, value: { id: input.id, name: row.name,
          provisioningId: input.provisioningId, status: 'active',
          createdAt: now, updatedAt: now } };
      },
      async getE2eCapabilities(context) {
        expect(context).toEqual({ actorUserId: 'e2e-root', actorKind: 'root', correlationId: 'ci-capability' });
        return { version: 1, migrations: ['0008_e2e_tenant_lifecycle.sql'], inspection: true, disposal: true };
      },
      async inspectE2eRun() { throw new Error('unexpected inspection'); },
      async previewE2eRun(context, input) {
        expect(context.actorKind).toBe('root');
        expect(input).toEqual(expected);
        return { status: disposed.has(input.runId) ? 'disposed' : 'active',
          counts: { merchants: disposed.has(input.runId) ? 0 : 1 } };
      },
      async disposeE2eRun(context, input) {
        expect(context).toMatchObject({ actorKind: 'root', actorUserId: 'e2e-root', merchantId: first.merchantId });
        expect(input).toEqual(expected);
        disposed.add(input.runId);
        return { status: 'disposed', counts: { merchants: 0 } };
      },
    };
    const origin = 'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev';
    const ci: Env = { ...env, APP_ENV: 'ci', CI_STACK_KEY: '0123456789abcdef0123',
      PUBLIC_APP_ORIGIN: origin, PASSKEY_RP_ID: new URL(origin).hostname,
      EMAIL_MODE: 'local-capture', STAGING_ALLOWED_RECIPIENTS: '[]', CORE: core };
    const service = new IdentityOperatorService(createExecutionContext(), ci);
    expect(await service.getE2eCapabilities({ sessionId: 'missing', correlationId: 'ci-capability' }))
      .toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(await service.getE2eCapabilities({ sessionId: 'e2e-root-session', correlationId: 'ci-capability' }))
      .toMatchObject({ version: 1, product: { disposal: true } });
    const created = await service.provisionClient({ sessionId: 'e2e-root-session', selectedMerchantId: first.merchantId, input: {
      provisioningId: first.provisioningId, merchantId: first.merchantId,
      name: first.runId + '_merchant', correlationId: 'ci-provision', e2eRun: { runId: first.runId, proof },
    } });
    expect(created).toMatchObject({ status: 'active', merchantId: first.merchantId });
    expect(await env.AUTH_DB.prepare('SELECT proof_hash AS proofHash, status FROM e2e_run_claims WHERE run_id = ?1')
      .bind(first.runId).first()).toEqual({ proofHash: hash, status: 'active' });
    await seed(second);
    const otherAuth = createIdentityAuth(ci);
    const other = await createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'ci', ciEnv: ci,
      createSession: (userId, runId, merchantId) => otherAuth.createFixtureSession({ userId, runId, merchantId }) })
      .createAccount({ ...second, slug: 'admin', role: 'admin' }, 'root', 'other-run');
    const request = { sessionId: 'e2e-root-session', runId: first.runId, proof, correlationId: 'ci-fixture',
      slug: 'viewer', role: 'viewer' };
    expect(await service.createE2eAccount({ ...request, proof: 'B'.repeat(43) }))
      .toMatchObject({ error: { code: 'FORBIDDEN' } });
    const fixture = await service.createE2eAccount(request);
    expect(fixture).toMatchObject({ role: 'viewer', merchantId: first.merchantId });
    if (!('sessionId' in fixture)) throw new Error('expected fixture session');
    expect(await env.AUTH_DB.prepare('SELECT role, status FROM memberships WHERE user_id = ?1')
      .bind(fixture.userId).first()).toEqual({ role: 'viewer', status: 'active' });
    expect(await service.getE2eCapabilities({ sessionId: fixture.sessionId, correlationId: 'ci-capability' }))
      .toMatchObject({ error: { code: 'FORBIDDEN' } });
    const action = { sessionId: 'e2e-root-session', runId: first.runId, proof, correlationId: 'ci-dispose' };
    expect(await service.disposeE2eRun({ ...action, proof: 'B'.repeat(43) }))
      .toMatchObject({ error: { code: 'FORBIDDEN' } });
    const result = await service.disposeE2eRun(action);
    expect(result).toMatchObject({ status: 'disposed', product: { merchants: 0 },
      auth: { users: 0, memberships: 0, fixture_sessions: 0, organizations: 0 } });
    expect(await service.disposeE2eRun(action)).toEqual(result);
    expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id = ?1').bind(fixture.userId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE id = ?1').bind(fixture.sessionId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT status FROM e2e_run_claims WHERE run_id = ?1')
      .bind(second.runId).first()).toEqual({ status: 'active' });
    expect((await otherAuth.getSession(new Headers({ cookie: other.cookieHeader })))?.user.id).toBe(other.userId);
    expect(await env.AUTH_DB.prepare("SELECT id FROM user WHERE id = 'e2e-root'").first()).toEqual({ id: 'e2e-root' });
    expect(await env.AUTH_DB.prepare('SELECT actor_id, correlation_id FROM e2e_run_disposal_audit WHERE run_id = ?1')
      .bind(first.runId).first()).toEqual({ actor_id: 'e2e-root', correlation_id: 'ci-dispose' });
    const before = await env.AUTH_DB.prepare('SELECT COUNT(*) AS total FROM identity_audit').first();
    ci.CI_STACK_KEY = 'ffffffffffffffffffff';
    await expect(service.previewE2eRun(action)).rejects.toThrow(/CI/u);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS total FROM identity_audit').first()).toEqual(before);
  });

  beforeEach(async () => {
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('DELETE FROM e2e_fixture_sessions'),
      env.AUTH_DB.prepare("DELETE FROM user WHERE email LIKE 'e2e+%'"),
      env.AUTH_DB.prepare('DELETE FROM invitations'),
      env.AUTH_DB.prepare('DELETE FROM memberships'),
      env.AUTH_DB.prepare('DELETE FROM organizations'),
      env.AUTH_DB.prepare('DELETE FROM client_provisionings'),
      env.AUTH_DB.prepare('DELETE FROM e2e_run_claims'),
      env.AUTH_DB.prepare('DELETE FROM e2e_run_disposal_audit'),
      env.AUTH_DB.prepare("DELETE FROM session WHERE id = 'e2e-root-session'"),
      env.AUTH_DB.prepare("DELETE FROM auth_profile WHERE user_id = 'e2e-root'"),
      env.AUTH_DB.prepare("DELETE FROM user WHERE id = 'e2e-root'"),
    ]);
  });

  test('rejects an invitation outside the run namespace and never calls Product disposal', async () => {
    await seed(first, 'real-customer@example.test');
    let called = false;
    const lifecycle = createIdentityE2eLifecycle({ database: env.AUTH_DB, appEnv: 'staging',
      core: { async preview() { called = true; return { status: 'active', counts: {} }; },
        async dispose() { called = true; return { status: 'disposed', counts: {} }; } } });
    await expect(lifecycle.dispose(first, 'root', 'correlation'))
      .rejects.toThrow(/namespace/u);
    expect(called).toBe(false);
    expect(await env.AUTH_DB.prepare('SELECT id FROM organizations WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toMatchObject({ id: `org-${first.runId}` });
  });

  test('records a proof claim at root provisioning and forwards the same hash to Product', async () => {
    const proof = 'A'.repeat(43);
    let forwardedHash = '';
    const now = new Date().toISOString();
    const service = createOrganizationService({ database: env.AUTH_DB, appEnv: 'staging', core: {
      async provisionMerchant(_context, input) {
        forwardedHash = input.e2eRun?.proofHash ?? '';
        return { ok: true, value: { id: input.id, name: input.name,
          provisioningId: input.provisioningId, status: 'provisioning',
          createdAt: now, updatedAt: now } };
      },
      async activateMerchant(_context, input) {
        return { ok: true, value: { id: input.id, name: `${first.runId}_merchant`,
          provisioningId: input.provisioningId, status: 'active',
          createdAt: now, updatedAt: now } };
      },
    } });
    const principal = { userId: 'root-user', sessionId: 'root-session',
      authenticationMethods: ['passkey'], authenticatedAt: now, platformRole: 'root' as const,
      merchantId: first.merchantId, permissions: [] };
    const result = await service.provisionClient(principal, {
      provisioningId: first.provisioningId, merchantId: first.merchantId,
      name: `${first.runId}_merchant`, correlationId: 'provenance-test',
      e2eRun: { runId: first.runId, proof },
    });
    expect(result.status).toBe('active');
    expect(forwardedHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await env.AUTH_DB.prepare('SELECT proof_hash AS proofHash FROM e2e_run_claims WHERE run_id = ?1')
      .bind(first.runId).first()).toMatchObject({ proofHash: forwardedHash });
  });

  test('cannot retry a claimed E2E provisioning through the ordinary proofless path', async () => {
    await seed(first);
    const service = createOrganizationService({ database: env.AUTH_DB, appEnv: 'staging', core: {
      async provisionMerchant() { throw new Error('must not call'); },
      async activateMerchant() { throw new Error('must not call'); },
    } });
    await expect(service.provisionClient({ userId: 'root', sessionId: 'root-session',
      authenticationMethods: ['passkey'], authenticatedAt: new Date().toISOString(),
      platformRole: 'root', merchantId: first.merchantId, permissions: [],
    }, { provisioningId: first.provisioningId, merchantId: first.merchantId,
      name: `${first.runId}_merchant`, correlationId: 'proofless-retry' }))
      .rejects.toThrow(/proof/u);
  });

  test('records partial Product failure, resumes, and deletes only its Auth tenant', async () => {
    await seed(first);
    await seed(second);
    let fail = true;
    const lifecycle = createIdentityE2eLifecycle({ database: env.AUTH_DB, appEnv: 'staging',
      core: { async preview() { return { status: 'active', counts: { customers: 1 } }; },
        async dispose() {
          if (fail) throw new Error('Product unavailable');
          return { status: 'disposed', counts: { customers: 0 } };
        } } });
    await expect(lifecycle.dispose(first, 'root', 'correlation'))
      .rejects.toThrow(/Product unavailable/u);
    expect(await env.AUTH_DB.prepare('SELECT status FROM e2e_run_claims WHERE run_id = ?1')
      .bind(first.runId).first()).toMatchObject({ status: 'disposing' });
    fail = false;
    await lifecycle.dispose(first, 'root', 'correlation');
    await lifecycle.dispose(first, 'root', 'correlation');
    expect(await env.AUTH_DB.prepare('SELECT id FROM organizations WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM invitations WHERE organization_id = ?1')
      .bind(`org-${first.runId}`).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM organizations WHERE merchant_id = ?1')
      .bind(second.merchantId).first()).toMatchObject({ id: `org-${second.runId}` });
    expect(await env.AUTH_DB.prepare('SELECT status FROM e2e_run_claims WHERE run_id = ?1')
      .bind(first.runId).first()).toMatchObject({ status: 'disposed' });
  });

  test('explicit local E2E mode removes claimed Auth rows but ordinary local remains closed', async () => {
    await seed(first);
    const core = { async preview() { return { status: 'active', counts: { merchants: 1 } }; },
      async dispose() { return { status: 'disposed', counts: { merchants: 0 } }; } };
    await expect(createIdentityE2eLifecycle({ database: env.AUTH_DB, appEnv: 'local', core })
      .preview(first)).rejects.toThrow(/staging/u);
    const local = createIdentityE2eLifecycle({ database: env.AUTH_DB,
      appEnv: 'local', localTestMode: '1', core });
    await local.dispose(first, 'root', 'local-test');
    expect(await env.AUTH_DB.prepare('SELECT id FROM organizations WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM invitations WHERE organization_id = ?1')
      .bind(`org-${first.runId}`).first()).toBeNull();
  });

  test('private Identity RPC requires a live root, exact proof, and staging before Core access', async () => {
    await seedRoot();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof));
    const proofHash = [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    await seed({ ...first, proofHash });
    let calls = 0;
    const core = {
      async previewE2eRun(context: unknown, input: unknown) {
        calls++;
        expect(context).toMatchObject({ actorKind: 'root', actorUserId: 'e2e-root',
          merchantId: first.merchantId });
        expect(input).toMatchObject({ ...first, proofHash });
        return { status: 'active', counts: { merchants: 1 } };
      },
      async disposeE2eRun() { throw new Error('not expected'); },
    };
    const service = new IdentityOperatorService(createExecutionContext(), {
      ...env, ...stagingSecretBindings, APP_ENV: 'staging', CORE: core,
    } as unknown as Env);
    const request = { sessionId: 'e2e-root-session', runId: first.runId,
      proof, correlationId: 'e2e-rpc-test' };
    expect(await service.previewE2eRun({ ...request, proof: 'B'.repeat(43) }))
      .toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await service.previewE2eRun({ ...request, sessionId: 'missing' }))
      .toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(calls).toBe(0);
    expect(await service.previewE2eRun(request)).toMatchObject({
      runId: first.runId, product: { merchants: 1 },
    });
    expect(calls).toBe(1);
    const local = new IdentityOperatorService(createExecutionContext(), {
      ...env, APP_ENV: 'local', CORE: core,
    } as unknown as Env);
    expect(await local.previewE2eRun(request)).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    expect(calls).toBe(1);
  });

  test('capability RPC requires live root, Auth migrations, and matching private Core', async () => {
    await seedRoot();
    let coreCalls = 0;
    const core = { async getE2eCapabilities() { coreCalls++;
      return { version: 1, migrations: ['0008_e2e_tenant_lifecycle.sql'],
        inspection: true, disposal: true }; } };
    const service = new IdentityOperatorService(createExecutionContext(), {
      ...env, ...stagingSecretBindings, APP_ENV: 'staging', CORE: core,
    } as unknown as Env);
    const input = { sessionId: 'e2e-root-session', correlationId: 'capability-test' };
    expect(await service.getE2eCapabilities({ ...input, sessionId: 'missing' }))
      .toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    expect(coreCalls).toBe(0);
    expect(await service.getE2eCapabilities(input)).toMatchObject({
      version: 1, migrations: [
        '0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql',
      ], product: { version: 1, inspection: true, disposal: true },
    });
    await env.AUTH_DB.prepare("DELETE FROM d1_migrations WHERE name = '0006_e2e_fixture_session.sql'").run();
    try {
      expect(await service.getE2eCapabilities(input)).toMatchObject({
        error: { code: 'IDENTITY_UNAVAILABLE' },
      });
      expect(coreCalls).toBe(1);
    } finally {
      await env.AUTH_DB.prepare("INSERT INTO d1_migrations (name) VALUES ('0006_e2e_fixture_session.sql')").run();
    }
  });

  test('inspection also refuses wrong run proof before contacting Product', async () => {
    await seedRoot();
    await seed(first);
    let called = false;
    const service = new IdentityOperatorService(createExecutionContext(), {
      ...env, ...stagingSecretBindings, APP_ENV: 'staging',
      CORE: { async inspectE2eRun() { called = true; } },
    } as unknown as Env);
    expect(await service.inspectE2eRun({ sessionId: 'e2e-root-session',
      runId: first.runId, proof: 'B'.repeat(43), correlationId: 'inspect-correlation',
      evaluationId: 'evaluation-1', idempotencyKey: `${first.runId}_attempt`,
      programRefs: [`${first.runId}_promo`],
    })).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(called).toBe(false);
  });
});
