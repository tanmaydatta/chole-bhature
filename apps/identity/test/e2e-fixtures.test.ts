import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';

import { createIdentityAuth, getSessionAccess } from '../src/auth.js';
import { createIdentityE2eFixtures } from '../src/services/e2e-fixtures.js';
import { createIdentityE2eLifecycle } from '../src/services/e2e-lifecycle.js';
import { createOrganizationService } from '../src/services/organizations.js';
import { IdentityOperatorService, type Env } from '../src/worker.js';

const first = {
  runId: 'e2e_0123456789abcdef01234567', merchantId: 'fixture-merchant-first',
  provisioningId: 'fixture-provision-first', proofHash: 'a'.repeat(64),
};
const second = {
  runId: 'e2e_89abcdef0123456701234567', merchantId: 'fixture-merchant-second',
  provisioningId: 'fixture-provision-second', proofHash: 'b'.repeat(64),
};

async function seed(input: typeof first) {
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
  ]);
}

describe('staging-only E2E fixture accounts', () => {
  beforeEach(async () => {
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('DELETE FROM e2e_fixture_sessions'),
      env.AUTH_DB.prepare('DELETE FROM invitations'),
      env.AUTH_DB.prepare('DELETE FROM memberships'),
      env.AUTH_DB.prepare('DELETE FROM organizations'),
      env.AUTH_DB.prepare('DELETE FROM client_provisionings'),
      env.AUTH_DB.prepare('DELETE FROM e2e_run_claims'),
      env.AUTH_DB.prepare("DELETE FROM user WHERE email LIKE 'e2e+%'"),
      env.AUTH_DB.prepare("DELETE FROM user WHERE id = 'fixture-root'"),
    ]);
  });

  test('creates only an active run-scoped member without email login and reuses it on retry', async () => {
    await seed(first);
    const sessionUserIds: string[] = [];
    const fixtures = createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'staging',
      createSession: async userId => { sessionUserIds.push(userId); return {
        sessionId: `session-${sessionUserIds.length}`, cookieHeader: 'signed-cookie',
      }; } });
    const input = { ...first, slug: 'viewer', role: 'viewer' as const };
    const created = await fixtures.createAccount(input, 'root-1', 'correlation-1');
    const retried = await fixtures.createAccount(input, 'root-1', 'correlation-2');
    expect(retried.userId).toBe(created.userId);
    expect(retried.membershipId).toBe(created.membershipId);
    expect(sessionUserIds).toEqual([created.userId, created.userId]);
    expect(created.email).toBe(`e2e+${first.runId}_viewer@e2e.invalid`);
    expect(await env.AUTH_DB.prepare(`SELECT auth_profile.status,
      auth_profile.email_login_enabled AS emailLoginEnabled, memberships.role,
      user.emailVerified FROM user JOIN auth_profile ON auth_profile.user_id = user.id
      JOIN memberships ON memberships.user_id = user.id WHERE user.id = ?1`)
      .bind(created.userId).first()).toMatchObject({ status: 'active',
        emailLoginEnabled: 0, role: 'viewer', emailVerified: 0 });
  });

  test('rejects wrong proof, foreign tenant and non-staging without creating users', async () => {
    await Promise.all([seed(first), seed(second)]);
    const createSession = async () => { throw new Error('must not create session'); };
    const fixtures = createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'staging',
      createSession });
    await expect(fixtures.createAccount({ ...first, proofHash: second.proofHash,
      slug: 'viewer', role: 'viewer' }, 'root', 'correlation')).rejects.toThrow(/provenance/u);
    await expect(fixtures.createAccount({ ...first, merchantId: second.merchantId,
      slug: 'viewer', role: 'viewer' }, 'root', 'correlation')).rejects.toThrow(/provenance/u);
    const local = createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'local', createSession });
    await expect(local.createAccount({ ...first, slug: 'viewer', role: 'viewer' },
      'root', 'correlation')).rejects.toThrow(/staging-only/u);
    expect(await env.AUTH_DB.prepare("SELECT count(*) AS total FROM user WHERE email LIKE 'e2e+%'")
      .first()).toMatchObject({ total: 0 });
  });

  test('concurrent runs create isolated users and memberships', async () => {
    await Promise.all([seed(first), seed(second)]);
    const fixtures = createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'staging',
      createSession: async userId => ({ sessionId: userId, cookieHeader: 'signed-cookie' }) });
    const [one, two] = await Promise.all([
      fixtures.createAccount({ ...first, slug: 'admin', role: 'admin' }, 'root', 'one'),
      fixtures.createAccount({ ...second, slug: 'admin', role: 'admin' }, 'root', 'two'),
    ]);
    expect(one.userId).not.toBe(two.userId);
    expect(one.membershipId).not.toBe(two.membershipId);
    expect(one.email).toContain(first.runId);
    expect(two.email).toContain(second.runId);
  });

  test('Better Auth creates a short-lived signed fixture session accepted by member authorization', async () => {
    await seed(first);
    const staging = { ...env, APP_ENV: 'staging', EMAIL_MODE: 'resend' } as Env;
    const auth = createIdentityAuth(staging, { emailAdapter: {
      async send() { throw new Error('Fixture auth must never send email'); },
    } });
    const fixtures = createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'staging',
      createSession: (userId, runId, merchantId) => createIdentityAuth(staging, {
        emailAdapter: { async send() { throw new Error('No email in fixture flow'); } },
      }).createFixtureSession({ userId, runId, merchantId }) });
    const created = await fixtures.createAccount({ ...first, slug: 'admin', role: 'admin' },
      'root', 'correlation');
    const raw = await env.AUTH_DB.prepare(`SELECT authenticationMethod, recoveryOnly,
      createdAt, expiresAt FROM session WHERE id = ?1`)
      .bind(created.sessionId).first<{ authenticationMethod: string; recoveryOnly: number;
        createdAt: number; expiresAt: number }>();
    expect(raw?.authenticationMethod).toBe('e2e-fixture');
    expect(raw?.recoveryOnly).toBe(0);
    expect(Date.parse(String(raw?.expiresAt))).toBeGreaterThan(Date.now());
    expect(Date.parse(String(raw?.expiresAt)))
      .toBeLessThanOrEqual(Date.parse(String(raw?.createdAt)) + 900_000);
    const directPrincipal = await createOrganizationService({ database: env.AUTH_DB,
      appEnv: 'staging' }).resolvePrincipal(created.sessionId);
    expect(directPrincipal).toMatchObject({ merchantId: first.merchantId });
    const checks = await env.AUTH_DB.prepare(`SELECT
      (CAST(strftime('%s', session.expiresAt) AS INTEGER) * 1000 > ?2) AS live,
      (CAST(strftime('%s', session.expiresAt) AS INTEGER) * 1000
        <= CAST(strftime('%s', session.createdAt) AS INTEGER) * 1000 + 900000) AS short,
      (substr(user.email, -12) = '@e2e.invalid') AS domain,
      (substr(user.email, 1, length('e2e+' || e2e_run_claims.run_id || '_'))
        = 'e2e+' || e2e_run_claims.run_id || '_') AS prefix,
      session.authenticatedAt AS authenticatedAt
      FROM session JOIN user ON user.id = session.userId
      JOIN memberships ON memberships.user_id = user.id
      JOIN organizations ON organizations.id = memberships.organization_id
      JOIN e2e_run_claims ON e2e_run_claims.merchant_id = organizations.merchant_id
      WHERE session.id = ?1`)
      .bind(created.sessionId, Date.now()).first();
    expect(checks).toMatchObject({ live: 1, short: 1, domain: 1, prefix: 1 });
    expect(await getSessionAccess(staging, created.sessionId)).not.toBeNull();
    const session = await auth.getSession(new Headers({ cookie: created.cookieHeader }));
    expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE id = ?1')
      .bind(created.sessionId).first()).not.toBeNull();
    expect(session?.session).toMatchObject({ id: created.sessionId,
      userId: created.userId, authenticationMethod: 'e2e-fixture', recoveryOnly: false });
    const expires = await env.AUTH_DB.prepare('SELECT expiresAt FROM session WHERE id = ?1')
      .bind(created.sessionId).first<{ expiresAt: number }>();
    expect(Date.parse(String(expires?.expiresAt))).toBeGreaterThan(Date.now());
    // Better Auth may slide its own session expiry; immutable fixture issuance
    // must remain the authoritative cap.
    const fixture = await env.AUTH_DB.prepare(`SELECT issued_at AS issuedAt,
      hard_expires_at AS hardExpiresAt FROM e2e_fixture_sessions WHERE session_id = ?1`)
      .bind(created.sessionId).first<{ issuedAt: number; hardExpiresAt: number }>();
    expect(fixture?.hardExpiresAt).toBe((fixture?.issuedAt ?? 0) + 900_000);
    expect(fixture?.hardExpiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
    const principal = await createOrganizationService({ database: env.AUTH_DB, appEnv: 'staging' })
      .resolvePrincipal(created.sessionId);
    expect(principal).toMatchObject({ merchantId: first.merchantId,
      membershipId: created.membershipId, authenticationMethods: ['e2e-fixture'] });
    expect(principal?.platformRole).toBeUndefined();
    await expect(auth.createFixtureSession({ userId: 'root-or-foreign', runId: first.runId,
      merchantId: first.merchantId })).rejects.toThrow(/fixture/u);
    const expiredAt = Date.now() - 1;
    await env.AUTH_DB.prepare(`UPDATE e2e_fixture_sessions
      SET issued_at = ?1, hard_expires_at = ?2 WHERE session_id = ?3`)
      .bind(expiredAt - 900_000, expiredAt, created.sessionId).run();
    expect(await auth.getSession(new Headers({ cookie: created.cookieHeader }))).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE id = ?1')
      .bind(created.sessionId).first()).toBeNull();
    expect(await createOrganizationService({ database: env.AUTH_DB, appEnv: 'staging' })
      .resolvePrincipal(created.sessionId)).toBeNull();
  });

  test('private RPC requires live root and exact proof before creating a signed account session', async () => {
    const proof = 'A'.repeat(43);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof));
    const proofHash = [...new Uint8Array(digest)]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
    await seed({ ...first, proofHash });
    const now = Date.now();
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare(`INSERT INTO user
        (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES ('fixture-root', 'Root', 'root@fixture.test', 1, ?1, ?1)`).bind(now),
      env.AUTH_DB.prepare(`INSERT INTO auth_profile
        (user_id, subject_kind, status, email_login_enabled)
        VALUES ('fixture-root', 'root', 'active', 0)`),
      env.AUTH_DB.prepare(`INSERT INTO session
        (id, expiresAt, token, createdAt, updatedAt, userId,
         authenticationMethod, authenticatedAt, recoveryOnly)
        VALUES ('fixture-root-session', ?1, 'fixture-root-token', ?2, ?2,
          'fixture-root', 'passkey', ?2, 0)`).bind(now + 60000, now),
    ]);
    const staging = { ...env, APP_ENV: 'staging', EMAIL_MODE: 'resend',
      RESEND_API_KEY: 'test-key', RESEND_FROM: 'fixture@example.test' } as Env;
    const service = new IdentityOperatorService(createExecutionContext(), staging);
    const request = { runId: first.runId, proof, slug: 'viewer', role: 'viewer',
      sessionId: 'fixture-root-session', correlationId: 'fixture-rpc' };
    expect(await service.createE2eAccount({ ...request, proof: 'B'.repeat(43) }))
      .toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await service.createE2eAccount({ ...request, sessionId: 'missing' }))
      .toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    const local = new IdentityOperatorService(createExecutionContext(),
      { ...staging, APP_ENV: 'local' });
    expect(await local.createE2eAccount(request))
      .toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await env.AUTH_DB.prepare("SELECT count(*) AS total FROM user WHERE email LIKE 'e2e+%'")
      .first()).toMatchObject({ total: 0 });
    const created = await service.createE2eAccount(request);
    expect(created).toMatchObject({ runId: first.runId, merchantId: first.merchantId,
      role: 'viewer', email: `e2e+${first.runId}_viewer@e2e.invalid` });
    expect('cookieHeader' in created).toBe(true);
  });

  test('full run disposal removes fixture users and sessions but preserves the concurrent run', async () => {
    await seed(first);
    await seed(second);
    const staging = { ...env, APP_ENV: 'staging', EMAIL_MODE: 'resend' } as Env;
    const auth = createIdentityAuth(staging, { emailAdapter: {
      async send() { throw new Error('No email in fixture flow'); },
    } });
    const fixtures = createIdentityE2eFixtures({ database: env.AUTH_DB, appEnv: 'staging',
      createSession: (userId, runId, merchantId) => createIdentityAuth(staging, {
        emailAdapter: { async send() { throw new Error('No email in fixture flow'); } },
      }).createFixtureSession({ userId, runId, merchantId }) });
    const [one, two] = await Promise.all([
      fixtures.createAccount({ ...first, slug: 'viewer', role: 'viewer' }, 'root', 'one'),
      fixtures.createAccount({ ...second, slug: 'viewer', role: 'viewer' }, 'root', 'two'),
    ]);
    const lifecycle = createIdentityE2eLifecycle({ database: env.AUTH_DB, appEnv: 'staging',
      core: { async preview() { return { status: 'active', counts: { merchants: 1 } }; },
        async dispose() { return { status: 'disposed', counts: { merchants: 0 } }; } } });
    expect((await lifecycle.preview(first)).auth.fixture_sessions).toBe(1);
    expect((await lifecycle.dispose(first, 'root', 'dispose')).auth.fixture_sessions).toBe(0);
    expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id = ?1')
      .bind(one.userId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE id = ?1')
      .bind(one.sessionId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT session_id FROM e2e_fixture_sessions WHERE run_id = ?1')
      .bind(first.runId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id = ?1')
      .bind(two.userId).first()).toMatchObject({ id: two.userId });
    expect(await auth.getSession(new Headers({ cookie: two.cookieHeader }))).not.toBeNull();
  });
});
