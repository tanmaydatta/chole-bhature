import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { makeSignature } from 'better-auth/crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import * as authModule from '../src/auth.js';
import identityWorker, { type Env } from '../src/worker.js';
import {
  authenticationResponse,
  createTestCredential,
  registrationResponse,
  type TestCredential,
} from './webauthn-fixture.js';

const testEnv = env as Env & {
  HARDENING_MIGRATION_TEXT: string;
};
const publicOrigin = 'https://operator.example.test';
const triggerNames = ['test_fail_recovery_mark', 'test_fail_recovery_completion'] as const;

interface ErrorEnvelope {
  error: { code: string; message: string; retryable: boolean };
  correlationId: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function recoveryCode(byte: number): string {
  return base64Url(new Uint8Array(32).fill(byte));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function dropFaultTriggers() {
  for (const name of triggerNames) {
    await testEnv.AUTH_DB.prepare(`DROP TRIGGER IF EXISTS ${name}`).run();
  }
}

async function clearAuthData() {
  await dropFaultTriggers();
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare('DELETE FROM local_email_capture'),
    testEnv.AUTH_DB.prepare('DELETE FROM identity_audit'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_rate_limit'),
    testEnv.AUTH_DB.prepare('DELETE FROM session_context'),
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

async function seedRecoveryMaterial(userId: string, codes: string[]) {
  const hashes = await Promise.all(codes.map(sha256));
  const now = Date.now();
  await testEnv.AUTH_DB.batch(hashes.map((hash, index) => testEnv.AUTH_DB.prepare(`
    INSERT INTO root_recovery_code (id, user_id, code_hash, created_at)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(`code-${index}`, userId, hash, now)));
}

async function seedPasskey(userId: string, credential: TestCredential, id = crypto.randomUUID()) {
  await testEnv.AUTH_DB.prepare(`
    INSERT INTO passkey (
      id, name, publicKey, userId, credentialID, counter, deviceType,
      backedUp, transports, createdAt, aaguid
    ) VALUES (?1, 'test passkey', ?2, ?3, ?4, 0, 'singleDevice', 0, 'internal', ?5, '')
  `).bind(id, credential.publicKey, userId, credential.id, Date.now()).run();
}

function authRequest(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('origin', publicOrigin);
  headers.set('content-type', 'application/json');
  headers.set('cf-connecting-ip', headers.get('cf-connecting-ip') ?? '203.0.113.100');
  return SELF.fetch(`${publicOrigin}${path}`, { ...init, headers });
}

function beginRecovery(userId: string, code: string, ip = '203.0.113.100') {
  return authRequest('/auth/root/recovery', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body: JSON.stringify({ userId, code }),
  });
}

function exchangeRecovery(grant: string) {
  return authRequest('/auth/root/recovery/exchange', {
    method: 'POST',
    body: JSON.stringify({ grant }),
  });
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Expected response cookie');
  return cookie;
}

function combineCookies(...cookies: string[]): string {
  return cookies.map(cookie => cookie.split(';', 1)[0]).join('; ');
}

async function expectSafeError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const correlationId = response.headers.get('x-correlation-id');
  expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(response.json<ErrorEnvelope>()).resolves.toEqual({
    error: { code, message: expect.any(String), retryable: expect.any(Boolean) },
    correlationId,
  });
}

async function startRecovery(userId: string, code: string) {
  const begun = await beginRecovery(userId, code);
  expect(begun.status).toBe(200);
  const body = await begun.json<{ grant: string; expiresAt: number }>();
  const exchanged = await exchangeRecovery(body.grant);
  expect(exchanged.status).toBe(200);
  return { ...body, cookie: cookieFrom(exchanged) };
}

async function registerReplacement(cookie: string, suppliedCredential?: TestCredential) {
  const credential = suppliedCredential ?? await createTestCredential();
  const optionsResponse = await authRequest('/auth/passkey/generate-register-options', {
    headers: { cookie },
  });
  expect(optionsResponse.status).toBe(200);
  const optionsCookie = cookieFrom(optionsResponse);
  const options = await optionsResponse.json<{ challenge: string; rp: { id: string } }>();
  const response = await authRequest('/auth/passkey/verify-registration', {
    method: 'POST',
    headers: { cookie: combineCookies(cookie, optionsCookie) },
    body: JSON.stringify({
      name: 'replacement',
      response: await registrationResponse(options, credential, publicOrigin, true),
    }),
  });
  return { response, credential };
}

async function authenticate(credential: TestCredential, counter: number) {
  const optionsResponse = await authRequest('/auth/passkey/generate-authenticate-options');
  const optionsCookie = cookieFrom(optionsResponse);
  const options = await optionsResponse.json<{ challenge: string; rpId: string }>();
  return authRequest('/auth/passkey/verify-authentication', {
    method: 'POST',
    headers: { cookie: optionsCookie },
    body: JSON.stringify({
      response: await authenticationResponse(
        options,
        credential,
        publicOrigin,
        counter,
        true,
      ),
    }),
  });
}

async function capturedMagicLink() {
  const row = await testEnv.AUTH_DB.prepare(`
    SELECT text_body AS textBody FROM local_email_capture ORDER BY created_at DESC LIMIT 1
  `).first<{ textBody: string }>();
  const link = row?.textBody.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('Expected captured magic link');
  return link;
}

async function signedSessionCookie(token: string): Promise<string> {
  const signature = await makeSignature(token, testEnv.AUTH_SECRET);
  return `__Secure-${testEnv.COOKIE_PREFIX}.session_token=`
    + encodeURIComponent(`${token}.${signature}`);
}

beforeEach(clearAuthData);
afterEach(dropFaultTriggers);

describe('resumable root recovery', () => {
  test('replays a dropped begin response with the same initiating code and deterministic grant', async () => {
    const codes = [recoveryCode(10), recoveryCode(11)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);

    const first = await beginRecovery('root-1', codes[0] as string);
    const firstBody = await first.json<{ grant: string; expiresAt: number }>();
    const replay = await beginRecovery('root-1', codes[0] as string, '203.0.113.101');
    const replayBody = await replay.json<{ grant: string; expiresAt: number }>();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replayBody).toEqual(firstBody);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM root_recovery_code WHERE used_at IS NOT NULL
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM root_recovery_code WHERE used_at IS NULL
    `).first('count')).resolves.toBe(1);
    const persisted = JSON.stringify((await testEnv.AUTH_DB.prepare(`
      SELECT * FROM recovery_flow
    `).all()).results);
    expect(persisted).not.toContain(firstBody.grant);
  });

  test('replays a dropped exchange response with the same constrained session cookie', async () => {
    const code = recoveryCode(12);
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', [code, recoveryCode(13)]);
    const begun = await beginRecovery('root-1', code);
    const { grant } = await begun.json<{ grant: string }>();

    const first = await exchangeRecovery(grant);
    const replay = await exchangeRecovery(grant);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(cookieFrom(replay)).toBe(cookieFrom(first));
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM session WHERE authenticationMethod = 'recovery'
    `).first('count')).resolves.toBe(1);
  });

  test('supersedes an expired unexchanged grant with another unused code', async () => {
    const codes = [recoveryCode(14), recoveryCode(15)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);
    expect((await beginRecovery('root-1', codes[0] as string)).status).toBe(200);
    await testEnv.AUTH_DB.prepare('UPDATE recovery_flow SET expires_at = 0').run();

    const restarted = await beginRecovery('root-1', codes[1] as string, '203.0.113.102');

    expect(restarted.status).toBe(200);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow WHERE cancelled_at IS NOT NULL
    `).first('count')).resolves.toBe(1);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow
      WHERE cancelled_at IS NULL AND completed_at IS NULL
    `).first('count')).resolves.toBe(1);
  });

  test.each(['expired', 'missing'] as const)(
    'supersedes a %s recovery session and deletes its pending replacement passkey',
    async mode => {
      const codes = [recoveryCode(16), recoveryCode(17)];
      await seedUser({
        id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
      });
      await seedRecoveryMaterial('root-1', codes);
      const recovery = await startRecovery('root-1', codes[0] as string);
      const registration = await registerReplacement(recovery.cookie);
      expect(registration.response.status).toBe(200);
      if (mode === 'expired') {
        await testEnv.AUTH_DB.prepare('UPDATE session SET expiresAt = 0').run();
      } else {
        await testEnv.AUTH_DB.prepare('DELETE FROM session').run();
      }

      const restarted = await beginRecovery('root-1', codes[1] as string, '203.0.113.103');

      expect(restarted.status).toBe(200);
      await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM passkey').first('count'))
        .resolves.toBe(0);
      await expect(testEnv.AUTH_DB.prepare(`
        SELECT COUNT(*) AS count FROM recovery_flow WHERE cancelled_at IS NOT NULL
      `).first('count')).resolves.toBe(1);
    },
  );

  test('sign-out cancels recovery, deletes the pending passkey, and permits immediate restart', async () => {
    const codes = [recoveryCode(18), recoveryCode(19)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);
    const recovery = await startRecovery('root-1', codes[0] as string);
    const registration = await registerReplacement(recovery.cookie);
    expect(registration.response.status).toBe(200);

    const signout = await authRequest('/auth/sign-out', {
      method: 'POST', headers: { cookie: recovery.cookie }, body: '{}',
    });
    const restarted = await beginRecovery('root-1', codes[1] as string, '203.0.113.104');

    expect(signout.status).toBe(200);
    expect(restarted.status).toBe(200);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM passkey').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow WHERE cancelled_at IS NOT NULL
    `).first('count')).resolves.toBe(1);
  });

  test('passkey-mark failure removes the new credential and cancels the recovery session', async () => {
    const codes = [recoveryCode(20), recoveryCode(21)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);
    const recovery = await startRecovery('root-1', codes[0] as string);
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_recovery_mark
      BEFORE UPDATE OF passkey_registered_at ON recovery_flow
      BEGIN SELECT RAISE(ABORT, 'forced recovery mark failure'); END
    `).run();

    const registration = await registerReplacement(recovery.cookie);

    await expectSafeError(registration.response, 503, 'IDENTITY_UNAVAILABLE');
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM passkey').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM session').first('count'))
      .resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow WHERE cancelled_at IS NOT NULL
    `).first('count')).resolves.toBe(1);
  });

  test('completion failure keeps the replacement passkey pending and unable to authenticate', async () => {
    const codes = [recoveryCode(22), recoveryCode(23)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);
    const recovery = await startRecovery('root-1', codes[0] as string);
    const { response, credential } = await registerReplacement(recovery.cookie);
    expect(response.status).toBe(200);
    await testEnv.AUTH_DB.prepare(`
      CREATE TRIGGER test_fail_recovery_completion
      BEFORE UPDATE OF completed_at ON recovery_flow
      WHEN NEW.completed_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'forced recovery completion failure'); END
    `).run();

    const rotation = await authRequest('/auth/root/recovery/rotate-codes', {
      method: 'POST', headers: { cookie: recovery.cookie }, body: '{}',
    });
    const authentication = await authenticate(credential, 1);

    await expectSafeError(rotation, 503, 'IDENTITY_UNAVAILABLE');
    await expectSafeError(authentication, 401, 'AUTHENTICATION_FAILED');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_flow
      WHERE completed_at IS NULL AND cancelled_at IS NULL
    `).first('count')).resolves.toBe(1);
  });

  test('a verified passkey session can reissue codes after a dropped rotation response', async () => {
    const codes = [recoveryCode(24), recoveryCode(25)];
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', codes);
    const recovery = await startRecovery('root-1', codes[0] as string);
    const { response, credential } = await registerReplacement(recovery.cookie);
    expect(response.status).toBe(200);
    const firstRotation = await authRequest('/auth/root/recovery/rotate-codes', {
      method: 'POST', headers: { cookie: recovery.cookie }, body: '{}',
    });
    const firstCodes = (await firstRotation.json<{ codes: string[] }>()).codes;
    const authentication = await authenticate(credential, 1);
    expect(authentication.status).toBe(200);

    const reissue = await authRequest('/auth/root/recovery/rotate-codes', {
      method: 'POST', headers: { cookie: cookieFrom(authentication) }, body: '{}',
    });

    expect(reissue.status).toBe(200);
    const reissuedCodes = (await reissue.json<{ codes: string[] }>()).codes;
    expect(reissuedCodes).toHaveLength(8);
    expect(reissuedCodes).not.toEqual(firstCodes);
    const hashes = await Promise.all(firstCodes.map(sha256));
    const placeholders = hashes.map((_, index) => `?${index + 1}`).join(', ');
    const stillUsable = await testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM root_recovery_code
      WHERE code_hash IN (${placeholders}) AND used_at IS NULL
    `).bind(...hashes).first('count');
    expect(stillUsable).toBe(0);
  });
});

describe('rate-limit identity and compaction', () => {
  test('changing guesses and sources still exhausts the canonical root identity bucket', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', [recoveryCode(30)]);

    const responses: Response[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await beginRecovery(
        'root-1',
        recoveryCode(31 + attempt),
        `203.0.113.${110 + attempt}`,
      ));
    }

    expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(responses[5]?.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  test('compacts expired recovery rate-limit rows during a bounded attempt', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    await seedRecoveryMaterial('root-1', [recoveryCode(40)]);
    await testEnv.AUTH_DB.batch(Array.from({ length: 40 }, (_, index) => testEnv.AUTH_DB.prepare(`
      INSERT INTO recovery_rate_limit (key_hash, window_started_at, attempt_count)
      VALUES (?1, 0, 1)
    `).bind(index.toString(16).padStart(64, '0'))));

    await beginRecovery('root-1', recoveryCode(41));

    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_rate_limit WHERE window_started_at = 0
    `).first('count')).resolves.toBe(0);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_rate_limit
    `).first('count')).resolves.toBeLessThanOrEqual(3);
  });
});

describe('atomic session authorization context', () => {
  test('migration stores authorization context in session and revokes legacy rows', async () => {
    const columns = await testEnv.AUTH_DB.prepare(`PRAGMA table_info('session')`)
      .all<{ name: string }>();
    expect(columns.results.map(column => column.name)).toEqual(expect.arrayContaining([
      'authenticationMethod', 'authenticatedAt', 'recoveryOnly',
    ]));
    expect(testEnv.HARDENING_MIGRATION_TEXT).toMatch(/DELETE\s+FROM\s+["']?session["']?/i);
  });

  test('denies and revokes a legacy contextless root session', async () => {
    await seedUser({
      id: 'root-1', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    const now = Date.now();
    await testEnv.AUTH_DB.prepare(`
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
      VALUES ('legacy-session', ?1, 'legacy-token', ?2, ?2, 'root-1')
    `).bind(now + 60_000, now).run();

    const response = await authRequest('/auth/get-session', {
      headers: { cookie: await signedSessionCookie('legacy-token') },
    });

    await expectSafeError(response, 401, 'SESSION_INVALID');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM session WHERE id = 'legacy-session'
    `).first('count')).resolves.toBe(0);
  });

  test('rechecks current method policy for every session use', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    const requested = await authRequest('/auth/sign-in/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: 'known@example.test', callbackURL: '/signed-in' }),
    });
    expect(requested.status).toBe(202);
    const login = await SELF.fetch(await capturedMagicLink(), { redirect: 'manual' });
    const cookie = cookieFrom(login);
    await testEnv.AUTH_DB.prepare(`
      UPDATE auth_profile SET email_login_enabled = 0 WHERE user_id = 'employee-1'
    `).run();

    const response = await authRequest('/auth/get-session', { headers: { cookie } });

    await expectSafeError(response, 401, 'SESSION_INVALID');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM session WHERE userId = 'employee-1'
    `).first('count')).resolves.toBe(0);
  });
});

describe('magic-link state and Identity error boundary', () => {
  test('unknown email equalization leaves no durable verification or PII row', async () => {
    const response = await authRequest('/auth/sign-in/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: 'Unknown.Person@Example.Test', callbackURL: '/signed-in' }),
    });

    expect(response.status).toBe(202);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM verification').first('count'))
      .resolves.toBe(0);
    const persisted = JSON.stringify((await testEnv.AUTH_DB.prepare(`
      SELECT * FROM verification
    `).all()).results).toLowerCase();
    expect(persisted).not.toContain('unknown.person@example.test');
  });

  test('canonicalizes known email before Better Auth persistence and delivery', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    const send = vi.fn(async () => undefined);
    const identity = authModule.createIdentityAuth(testEnv, { emailAdapter: { send } });
    const request = new Request(`${publicOrigin}/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: {
        origin: publicOrigin,
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.130',
      },
      body: JSON.stringify({ email: '  KNOWN@EXAMPLE.TEST  ', callbackURL: '/signed-in' }),
    });

    const response = await identity.handler(request);

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'known@example.test' }));
    const verification = await testEnv.AUTH_DB.prepare(`
      SELECT value FROM verification ORDER BY createdAt DESC LIMIT 1
    `).first<{ value: string }>();
    expect(JSON.parse(verification?.value ?? '{}')).toMatchObject({ email: 'known@example.test' });
  });

  test('normalizes native Better Auth errors and audits failed passkey verification', async () => {
    const options = await authRequest('/auth/passkey/generate-authenticate-options');
    const response = await authRequest('/auth/passkey/verify-authentication', {
      method: 'POST',
      headers: { cookie: cookieFrom(options) },
      body: JSON.stringify({ response: {} }),
    });

    await expectSafeError(response, 401, 'AUTHENTICATION_FAILED');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'passkey.authentication' AND outcome = 'denied'
    `).first('count')).resolves.toBe(1);
  });

  test('audits magic-link verification failure without retaining the token', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    const requested = await authRequest('/auth/sign-in/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email: 'known@example.test', callbackURL: '/signed-in' }),
    });
    expect(requested.status).toBe(202);
    const link = await capturedMagicLink();
    const token = new URL(link).searchParams.get('token') ?? '';
    await testEnv.AUTH_DB.prepare('UPDATE verification SET expiresAt = 0').run();

    const response = await SELF.fetch(link, { redirect: 'manual' });

    expect(response.status).toBe(302);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'magic_link.verification' AND outcome = 'denied'
    `).first('count')).resolves.toBe(1);
    const audit = JSON.stringify((await testEnv.AUTH_DB.prepare(`
      SELECT * FROM identity_audit
    `).all()).results);
    expect(audit).not.toContain(token);
  });

  test('audits malformed grants and top-level worker failures with safe envelopes', async () => {
    const malformedGrant = await exchangeRecovery('***');
    await expectSafeError(malformedGrant, 400, 'INVALID_REQUEST');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'root.recovery.exchange_failed' AND outcome = 'denied'
    `).first('count')).resolves.toBe(1);

    const badEnv: Env = {
      AUTH_DB: testEnv.AUTH_DB,
      AUTH_SECRET: testEnv.AUTH_SECRET,
      APP_ENV: testEnv.APP_ENV,
      PUBLIC_APP_ORIGIN: testEnv.PUBLIC_APP_ORIGIN,
      COOKIE_PREFIX: testEnv.COOKIE_PREFIX,
      EMAIL_MODE: testEnv.EMAIL_MODE,
      MAGIC_LINK_TTL_SECONDS: '0',
      EMAIL_RATE_LIMIT_MAX: testEnv.EMAIL_RATE_LIMIT_MAX,
      EMAIL_RATE_LIMIT_WINDOW_SECONDS: testEnv.EMAIL_RATE_LIMIT_WINDOW_SECONDS,
      STAGING_ALLOWED_RECIPIENTS: testEnv.STAGING_ALLOWED_RECIPIENTS,
      PASSKEY_RP_ID: testEnv.PASSKEY_RP_ID,
      PASSKEY_RP_NAME: testEnv.PASSKEY_RP_NAME,
    };
    const executionContext = {
      waitUntil() {},
      passThroughOnException() {},
    } as ExecutionContext;
    const worker = identityWorker as unknown as {
      fetch(request: Request, environment: Env, context: ExecutionContext): Promise<Response>;
    };
    const failed = await worker.fetch(
      new Request(`${publicOrigin}/auth/get-session`),
      badEnv,
      executionContext,
    );

    await expectSafeError(failed, 503, 'IDENTITY_UNAVAILABLE');
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM identity_audit
      WHERE action = 'identity.worker_failure' AND outcome = 'failed'
    `).first('count')).resolves.toBe(1);
  });
});

describe('minor boundary hardening', () => {
  test('deletes outstanding magic links case-insensitively', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    await testEnv.AUTH_DB.prepare(`
      INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
      VALUES ('verification-1', 'hash', ?1, ?2, ?3, ?3)
    `).bind(
      JSON.stringify({ email: 'KNOWN@EXAMPLE.TEST' }),
      Date.now() + 60_000,
      Date.now(),
    ).run();

    await authModule.disableEmailLogin(testEnv.AUTH_DB, 'employee-1', crypto.randomUUID());

    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM verification').first('count'))
      .resolves.toBe(0);
  });

  test('records the stable root user ID for successful passkey authentication', async () => {
    await seedUser({
      id: 'stable-root-id', email: 'root@example.test', kind: 'root', emailLoginEnabled: false,
    });
    const credential = await createTestCredential();
    await seedPasskey('stable-root-id', credential);

    const response = await authenticate(credential, 1);

    expect(response.status).toBe(200);
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT actor_id AS actorId FROM identity_audit
      WHERE action = 'passkey.authentication' AND outcome = 'succeeded'
    `).first('actorId')).resolves.toBe('stable-root-id');
  });

  test('bounds and validates root IDs, recovery codes, and grants before hashing', async () => {
    const invalidBegins = [
      beginRecovery('r'.repeat(129), recoveryCode(50), '203.0.113.150'),
      beginRecovery('root id', recoveryCode(51), '203.0.113.151'),
      beginRecovery('root-1', 'short', '203.0.113.152'),
      beginRecovery('root-1', `${recoveryCode(52)}x`, '203.0.113.153'),
      beginRecovery('root-1', '*'.repeat(43), '203.0.113.154'),
    ];
    const responses = await Promise.all(invalidBegins);
    for (const response of responses) {
      await expectSafeError(response, 400, 'INVALID_REQUEST');
    }
    for (const grant of ['short', `${recoveryCode(53)}x`, '*'.repeat(43)]) {
      await expectSafeError(await exchangeRecovery(grant), 400, 'INVALID_REQUEST');
    }
    await expect(testEnv.AUTH_DB.prepare(`
      SELECT COUNT(*) AS count FROM recovery_rate_limit
    `).first('count')).resolves.toBe(0);
  });
});
