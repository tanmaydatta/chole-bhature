import { ApiErrorSchema } from '@incentives/contracts';
import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import * as authModule from '../src/auth.js';
import {
  authenticationResponse,
  createTestCredential,
  registrationResponse,
  type TestCredential,
} from './webauthn-fixture.js';

const testEnv = env as typeof env & {
  AUTH_DB: D1Database;
  WRANGLER_CONFIG_TEXT: string;
};
const publicOrigin = 'https://operator.example.test';

async function clearAuthData() {
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare('DELETE FROM local_email_capture'),
    testEnv.AUTH_DB.prepare('DELETE FROM identity_audit'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_rate_limit'),
    testEnv.AUTH_DB.prepare('DELETE FROM root_recovery_code'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_flow'),
    testEnv.AUTH_DB.prepare('DELETE FROM rateLimit'),
    testEnv.AUTH_DB.prepare('DELETE FROM passkey'),
    testEnv.AUTH_DB.prepare('DELETE FROM verification'),
    testEnv.AUTH_DB.prepare('DELETE FROM account'),
    testEnv.AUTH_DB.prepare('DELETE FROM session'),
    testEnv.AUTH_DB.prepare('DELETE FROM auth_profile'),
    testEnv.AUTH_DB.prepare('DELETE FROM user'),
  ]);
}

async function seedUser(input: {
  id: string;
  email: string;
  kind?: 'employee' | 'root';
  emailLoginEnabled?: boolean;
}) {
  const now = Date.now();
  const kind = input.kind ?? 'employee';
  const emailLoginEnabled = input.emailLoginEnabled ?? kind === 'employee';
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?1, ?2, ?3, 1, ?4, ?4)
    `).bind(input.id, input.email.split('@')[0], input.email, now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES (?1, ?2, 'active', ?3)
    `).bind(input.id, kind, emailLoginEnabled ? 1 : 0),
  ]);
}

function authRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('origin', publicOrigin);
  headers.set('content-type', 'application/json');
  headers.set('cf-connecting-ip', headers.get('cf-connecting-ip') ?? '203.0.113.10');
  return SELF.fetch(`${publicOrigin}${path}`, { ...init, headers });
}

function requestMagicLink(email: string, ip = '203.0.113.10') {
  return authRequest('/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, callbackURL: '/signed-in' }),
  });
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Expected response to set a cookie');
  return cookie;
}

function combineCookies(...cookies: string[]): string {
  return cookies.map(cookie => cookie.split(';', 1)[0]).join('; ');
}

async function capturedMagicLink(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = await testEnv.AUTH_DB.prepare(`
      SELECT text_body FROM local_email_capture ORDER BY created_at DESC, id DESC LIMIT 1
    `).first<{ text_body: string }>();
    const link = row?.text_body.match(/https?:\/\/\S+/)?.[0];
    if (link) return link;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Expected a captured magic link');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

function testRecoveryCode(byte: number): string {
  const bytes = new Uint8Array(32).fill(byte);
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function seedPasskey(userId: string, credential: TestCredential, id = crypto.randomUUID()) {
  await testEnv.AUTH_DB.prepare(`
    INSERT INTO passkey (
      id, name, publicKey, userId, credentialID, counter, deviceType,
      backedUp, transports, createdAt, aaguid
    ) VALUES (?1, 'test passkey', ?2, ?3, ?4, 0, 'singleDevice', 0, 'internal', ?5, '')
  `).bind(id, credential.publicKey, userId, credential.id, Date.now()).run();
}

async function seedRecoveryMaterial(userId: string, codes: string[]) {
  const now = Date.now();
  const hashes = await Promise.all(codes.map(sha256));
  const statements = hashes.map((codeHash, index) => testEnv.AUTH_DB.prepare(`
    INSERT INTO root_recovery_code (id, user_id, code_hash, created_at)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(`recovery-${index}`, userId, codeHash, now));
  await testEnv.AUTH_DB.batch(statements);
}

async function beginRecovery(userId: string, code: string, ip = '203.0.113.90') {
  return authRequest('/auth/root/recovery', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body: JSON.stringify({ userId, code }),
  });
}

async function exchangeRecovery(grant: string) {
  return authRequest('/auth/root/recovery/exchange', {
    method: 'POST',
    body: JSON.stringify({ grant }),
  });
}

async function expectSafeError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const correlationId = response.headers.get('x-correlation-id');
  expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  const body: unknown = await response.json();
  const parsed = ApiErrorSchema.parse(body);
  expect(parsed.error).toEqual({
    code,
    message: expect.any(String),
    correlationId,
    retryable: expect.any(Boolean),
  });
  return parsed;
}

beforeEach(clearAuthData);

describe('identity deployment isolation', () => {
  test('disables public worker URLs and binds only Auth D1', () => {
    expect(testEnv.WRANGLER_CONFIG_TEXT).toMatch(/^workers_dev\s*=\s*false$/m);
    expect(testEnv.WRANGLER_CONFIG_TEXT).toMatch(/^preview_urls\s*=\s*false$/m);
    expect(testEnv.WRANGLER_CONFIG_TEXT).toMatch(/^binding\s*=\s*"AUTH_DB"$/m);
    expect(testEnv.WRANGLER_CONFIG_TEXT).not.toMatch(/PRODUCT_DB|incentives-product/i);
  });
});

describe('magic-link hardening', () => {
  test('returns the same response before delivery completes and audits both known and unknown requests', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    let releaseDelivery!: () => void;
    const delivery = new Promise<void>(resolve => { releaseDelivery = resolve; });
    const send = vi.fn(() => delivery);
    const pending: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil(promise: Promise<unknown>) { pending.push(promise); },
      passThroughOnException() {},
    } as ExecutionContext;
    type DeferredAuth = {
      handler(request: Request, context?: ExecutionContext): Promise<Response>;
    };
    const createAuth = authModule.createIdentityAuth as unknown as (
      environment: typeof testEnv,
      dependencies: { emailAdapter: { send: typeof send } },
    ) => DeferredAuth;
    const identity = createAuth(testEnv, { emailAdapter: { send } });
    const makeRequest = (email: string, ip: string) => new Request(
      `${publicOrigin}/auth/sign-in/magic-link`,
      {
        method: 'POST',
        headers: {
          origin: publicOrigin,
          'content-type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify({ email, callbackURL: '/signed-in' }),
      },
    );

    const known = await Promise.race([
      identity.handler(makeRequest('known@example.test', '203.0.113.21'), executionContext),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error('Known-email response waited for delivery')),
        25,
      )),
    ]);
    const unknown = await identity.handler(
      makeRequest('unknown@example.test', '203.0.113.22'),
      executionContext,
    );

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    await expect(known.json()).resolves.toEqual({ ok: true });
    await expect(unknown.json()).resolves.toEqual({ ok: true });
    for (let attempt = 0; attempt < 50 && send.mock.calls.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(2);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit WHERE action = 'magic_link.requested'
    `).first('count')).resolves.toBe(2);

    releaseDelivery();
    await Promise.all(pending);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'magic_link.delivery' AND outcome = 'succeeded'
    `).first('count')).resolves.toBe(1);
  });

  test('invalidates outstanding links and rechecks account policy at link consumption', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    expect((await requestMagicLink('known@example.test')).status).toBe(202);
    await capturedMagicLink();

    const disableEmailLogin = (authModule as unknown as {
      disableEmailLogin?: (database: D1Database, userId: string, correlationId: string) => Promise<void>;
    }).disableEmailLogin;
    expect(disableEmailLogin).toBeTypeOf('function');
    await disableEmailLogin?.(testEnv.AUTH_DB, 'employee-1', crypto.randomUUID());
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM verification').first('count'))
      .resolves.toBe(0);

    await testEnv.AUTH_DB.prepare(`
      UPDATE auth_profile SET email_login_enabled = 1 WHERE user_id = 'employee-1'
    `).run();
    expect((await requestMagicLink('known@example.test', '203.0.113.23')).status).toBe(202);
    const link = await capturedMagicLink();
    await testEnv.AUTH_DB.prepare(`
      UPDATE auth_profile SET email_login_enabled = 0 WHERE user_id = 'employee-1'
    `).run();

    const consumed = await SELF.fetch(link, { redirect: 'manual' });
    expect(consumed.status).toBe(302);
    expect(consumed.headers.get('set-cookie')).toBeNull();
    expect(consumed.headers.get('location')).toContain('error=');
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);
  });

  test('persists authentication context and audits session revocation', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    expect((await requestMagicLink('known@example.test')).status).toBe(202);
    const link = await capturedMagicLink();
    const login = await SELF.fetch(link, { redirect: 'manual' });
    const cookie = cookieFrom(login);

    await expect(testEnv.AUTH_DB.prepare(`
      SELECT authenticationMethod AS method, recoveryOnly
      FROM session
    `).first()).resolves.toMatchObject({ method: 'magic-link', recoveryOnly: 0 });

    const signout = await authRequest('/auth/sign-out', {
      method: 'POST',
      headers: { cookie },
      body: '{}',
    });
    expect(signout.status).toBe(200);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'session.revoked' AND outcome = 'succeeded'
    `).first('count')).resolves.toBe(1);
  });
});

describe('root recovery hardening', () => {
  test('atomically claims one code, revokes all old material, and returns a hashed single-use grant', async () => {
    const codes = [testRecoveryCode(1), testRecoveryCode(2)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);
    const credential = await createTestCredential();
    await seedPasskey('root-1', credential);
    const now = Date.now();
    await testEnv.AUTH_DB.batch([
      testEnv.AUTH_DB.prepare(`
        INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
        VALUES ('old-session-1', ?1, 'old-token-1', ?2, ?2, 'root-1')
      `).bind(now + 60_000, now),
      testEnv.AUTH_DB.prepare(`
        INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
        VALUES ('old-session-2', ?1, 'old-token-2', ?2, ?2, 'root-1')
      `).bind(now + 60_000, now),
    ]);

    const responses = await Promise.all([
      beginRecovery('root-1', codes[0] ?? '', '203.0.113.31'),
      beginRecovery('root-1', codes[1] ?? '', '203.0.113.32'),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 401]);
    const success = responses.find(response => response.status === 200);
    const denied = responses.find(response => response.status === 401);
    if (!success || !denied) throw new Error('Expected one successful recovery claim');
    await expectSafeError(denied, 401, 'RECOVERY_FAILED');
    const result = await success.json<{ grant: string; expiresAt: number }>();
    expect(decodeBase64Url(result.grant)).toHaveLength(32);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);

    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM passkey').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM root_recovery_code
      WHERE used_at IS NOT NULL AND recovery_flow_id IS NOT NULL
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM root_recovery_code WHERE used_at IS NULL
    `).first('count')).resolves.toBe(1);
    const flow = await testEnv.AUTH_DB.prepare(`
      SELECT grant_hash AS grantHash FROM recovery_flow
    `).first<{ grantHash: string }>();
    expect(flow?.grantHash).toBe(await sha256(result.grant));
    expect(flow?.grantHash).not.toContain(result.grant);
    const auditText = JSON.stringify((await testEnv.AUTH_DB.prepare(`
      SELECT * FROM identity_audit ORDER BY occurred_at
    `).all()).results);
    expect(auditText).not.toContain(result.grant);
    expect(auditText).not.toContain(codes[0] ?? '');
    expect(auditText).not.toContain('203.0.113.31');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit WHERE action = 'root.recovery.claimed'
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'root.recovery.failed' AND outcome = 'denied'
    `).first('count')).resolves.toBe(1);
  });

  test('atomically throttles recovery by keyed source and credential buckets', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', [testRecoveryCode(3)]);

    const sourceResponses: Response[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      sourceResponses.push(await beginRecovery('root-1', testRecoveryCode(4), '203.0.113.41'));
    }
    expect(sourceResponses.map(response => response.status)).toEqual([401, 401, 401, 401, 401, 429]);
    await expectSafeError(sourceResponses[5] as Response, 429, 'RATE_LIMITED');
    expect(sourceResponses[5]?.headers.get('retry-after')).toMatch(/^\d+$/);

    await testEnv.AUTH_DB.prepare('DELETE FROM recovery_rate_limit').run();
    const credentialResponses: Response[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      credentialResponses.push(await beginRecovery(
        'root-1',
        testRecoveryCode(5),
        `203.0.113.${50 + attempt}`,
      ));
    }
    expect(credentialResponses.map(response => response.status))
      .toEqual([401, 401, 401, 401, 401, 429]);
    await expectSafeError(credentialResponses[5] as Response, 429, 'RATE_LIMITED');

    const rows = await testEnv.AUTH_DB.prepare(`
      SELECT key_hash AS keyHash, attempt_count AS attemptCount FROM recovery_rate_limit
    `).all<{ keyHash: string; attemptCount: number }>();
    expect(rows.results.every(row => /^[0-9a-f]{64}$/.test(row.keyHash))).toBe(true);
    expect(rows.results.some(row => row.attemptCount === 6)).toBe(true);
    const persisted = JSON.stringify(rows.results);
    expect(persisted).not.toContain('root-1');
    expect(persisted).not.toContain(testRecoveryCode(5));
    expect(persisted).not.toContain('203.0.113.');
  });

  test('idempotently exchanges a grant for the same recovery-only session', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    const recoveryCode = testRecoveryCode(6);
    await seedRecoveryMaterial('root-1', [recoveryCode]);
    const recovery = await beginRecovery('root-1', recoveryCode);
    expect(recovery.status).toBe(200);
    const { grant } = await recovery.json<{ grant: string }>();

    const exchange = await exchangeRecovery(grant);
    expect(exchange.status).toBe(200);
    const cookie = cookieFrom(exchange);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT authenticationMethod AS method, recoveryOnly
      FROM session
    `).first()).resolves.toMatchObject({ method: 'recovery', recoveryOnly: 1 });
    const replay = await exchangeRecovery(grant);
    expect(replay.status).toBe(200);
    expect(cookieFrom(replay)).toBe(cookie);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(1);

    await expectSafeError(await authRequest('/auth/get-session', {
      headers: { cookie },
    }), 403, 'RECOVERY_RESTRICTED');
    const registrationOptions = await authRequest('/auth/passkey/generate-register-options', {
      headers: { cookie },
    });
    expect(registrationOptions.status).toBe(200);
    const signout = await authRequest('/auth/sign-out', {
      method: 'POST', headers: { cookie }, body: '{}',
    });
    expect(signout.status).toBe(200);
  });

  test('requires verified replacement passkey registration before rotating strong recovery codes', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    const recoveryCode = testRecoveryCode(7);
    await seedRecoveryMaterial('root-1', [recoveryCode]);
    const recovery = await beginRecovery('root-1', recoveryCode);
    const { grant } = await recovery.json<{ grant: string }>();
    const exchange = await exchangeRecovery(grant);
    const recoveryCookie = cookieFrom(exchange);

    const premature = await authRequest('/auth/root/recovery/rotate-codes', {
      method: 'POST', headers: { cookie: recoveryCookie }, body: '{}',
    });
    await expectSafeError(premature, 409, 'PASSKEY_REQUIRED');

    const credential = await createTestCredential();
    const optionsResponse = await authRequest('/auth/passkey/generate-register-options', {
      headers: { cookie: recoveryCookie },
    });
    expect(optionsResponse.status).toBe(200);
    const challengeCookie = cookieFrom(optionsResponse);
    const options = await optionsResponse.json<{ challenge: string; rp: { id: string } }>();
    const registration = await authRequest('/auth/passkey/verify-registration', {
      method: 'POST',
      headers: { cookie: combineCookies(recoveryCookie, challengeCookie) },
      body: JSON.stringify({
        name: 'replacement',
        response: await registrationResponse(options, credential, publicOrigin, true),
      }),
    });
    expect(registration.status).toBe(200);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow WHERE passkey_registered_at IS NOT NULL
    `).first('count')).resolves.toBe(1);

    const rotation = await authRequest('/auth/root/recovery/rotate-codes', {
      method: 'POST', headers: { cookie: recoveryCookie }, body: '{}',
    });
    expect(rotation.status).toBe(200);
    const { userId, codes } = await rotation.json<{ userId: string; codes: string[] }>();
    expect(userId).toBe('root-1');
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every(code => decodeBase64Url(code).length === 32)).toBe(true);
    const stored = await testEnv.AUTH_DB.prepare(`
      SELECT code_hash AS codeHash FROM root_recovery_code WHERE used_at IS NULL
    `).all<{ codeHash: string }>();
    expect(stored.results).toHaveLength(8);
    expect(stored.results.every(row => /^[0-9a-f]{64}$/.test(row.codeHash))).toBe(true);
    expect(codes.every(code => !stored.results.some(row => row.codeHash.includes(code)))).toBe(true);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow WHERE completed_at IS NOT NULL
    `).first('count')).resolves.toBe(1);
    expect(rotation.headers.get('set-cookie')).toMatch(/Max-Age=0/i);

    const authenticationOptions = await authRequest('/auth/passkey/generate-authenticate-options');
    const authenticationCookie = cookieFrom(authenticationOptions);
    const authentication = await authRequest('/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { cookie: authenticationCookie },
      body: JSON.stringify({
        response: await authenticationResponse(
          await authenticationOptions.json<{ challenge: string; rpId: string }>(),
          credential,
          publicOrigin,
          1,
          true,
        ),
      }),
    });
    expect(authentication.status).toBe(200);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT authenticationMethod AS method, recoveryOnly
      FROM session
    `).first()).resolves.toMatchObject({ method: 'passkey', recoveryOnly: 0 });
  });
});

describe('installed passkey verification', () => {
  test('rejects false user verification without mutation and permits only verified root credentials', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    const rootCredential = await createTestCredential();
    await seedPasskey('root-1', rootCredential, 'root-passkey');

    const falseOptionsResponse = await authRequest('/auth/passkey/generate-authenticate-options');
    const falseChallengeCookie = cookieFrom(falseOptionsResponse);
    const falseResponse = await authRequest('/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { cookie: falseChallengeCookie },
      body: JSON.stringify({
        response: await authenticationResponse(
          await falseOptionsResponse.json<{ challenge: string; rpId: string }>(),
          rootCredential,
          publicOrigin,
          1,
          false,
        ),
      }),
    });
    expect(falseResponse.status).toBeGreaterThanOrEqual(400);
    expect(falseResponse.headers.get('set-cookie')).toBeNull();
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT counter FROM passkey WHERE id = 'root-passkey'
    `).first('counter')).resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);

    const rootOptionsResponse = await authRequest('/auth/passkey/generate-authenticate-options');
    const rootChallengeCookie = cookieFrom(rootOptionsResponse);
    const rootResponse = await authRequest('/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { cookie: rootChallengeCookie },
      body: JSON.stringify({
        response: await authenticationResponse(
          await rootOptionsResponse.json<{ challenge: string; rpId: string }>(),
          rootCredential,
          publicOrigin,
          1,
          true,
        ),
      }),
    });
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.headers.get('set-cookie')).toContain('incentives-local.session_token=');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT authenticationMethod AS method FROM session
    `).first('method')).resolves.toBe('passkey');

    await seedUser({ id: 'employee-1', email: 'employee@example.test' });
    const employeeCredential = await createTestCredential();
    await seedPasskey('employee-1', employeeCredential, 'employee-passkey');
    const employeeOptionsResponse = await authRequest('/auth/passkey/generate-authenticate-options');
    const employeeResponse = await authRequest('/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { cookie: cookieFrom(employeeOptionsResponse) },
      body: JSON.stringify({
        response: await authenticationResponse(
          await employeeOptionsResponse.json<{ challenge: string; rpId: string }>(),
          employeeCredential,
          publicOrigin,
          1,
          true,
        ),
      }),
    });
    expect(employeeResponse.status).toBeGreaterThanOrEqual(400);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM session WHERE userId = 'employee-1'
    `).first('count')).resolves.toBe(0);
  });
});
