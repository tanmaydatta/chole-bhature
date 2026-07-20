import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createResendEmailAdapter } from '../src/email.js';

const testEnv = env as typeof env & { AUTH_DB: D1Database };
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

async function capturedMessages(expectedCount = 1) {
  let messages: Array<{ recipient: string; subject: string; textBody: string }> = [];
  const deadline = Date.now() + 2_000;
  do {
    const result = await testEnv.AUTH_DB.prepare(`
      SELECT recipient, subject, text_body AS textBody
      FROM local_email_capture
      ORDER BY created_at, id
    `).all<{ recipient: string; subject: string; textBody: string }>();
    messages = result.results;
    if (messages.length < expectedCount) await new Promise(resolve => setTimeout(resolve, 10));
  } while (messages.length < expectedCount && Date.now() < deadline);
  return messages;
}

function linkFrom(text: string) {
  const link = text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error('Expected a captured magic link');
  return link;
}

beforeEach(clearAuthData);

describe('invite-only passwordless authentication', () => {
  test('blocks public signup at the HTTP route and does not create a user', async () => {
    const response = await authRequest('/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        email: 'public@example.test',
        password: 'not-a-real-password',
        name: 'Public User',
      }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'SIGNUP_DISABLED',
        message: 'Self-service signup is unavailable.',
        retryable: false,
      },
      correlationId: response.headers.get('x-correlation-id'),
    });
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM user').first('count'))
      .resolves.toBe(0);
  });

  test('returns an indistinguishable response for known and unknown emails without creating unknown users', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });

    const known = await requestMagicLink('known@example.test', '203.0.113.11');
    const unknown = await requestMagicLink('unknown@example.test', '203.0.113.12');

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    await expect(known.json()).resolves.toEqual({ ok: true });
    await expect(unknown.json()).resolves.toEqual({ ok: true });
    const messages = await capturedMessages();
    expect(messages.map(message => message.recipient)).toEqual(['known@example.test']);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM user').first('count'))
      .resolves.toBe(1);
  });

  test('consumes passwordless links exactly once', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    expect((await requestMagicLink('known@example.test')).status).toBe(202);
    const link = linkFrom((await capturedMessages())[0]?.textBody ?? '');

    const first = await SELF.fetch(link, { redirect: 'manual' });
    const second = await SELF.fetch(link, { redirect: 'manual' });

    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe(`${publicOrigin}/signed-in`);
    expect(first.headers.get('set-cookie')).toContain('incentives-local.session_token=');
    expect(second.status).toBe(302);
    expect(second.headers.get('location')).toContain('error=INVALID_TOKEN');
  });

  test('rejects expired passwordless links', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    expect((await requestMagicLink('known@example.test')).status).toBe(202);
    const link = linkFrom((await capturedMessages())[0]?.textBody ?? '');
    await testEnv.AUTH_DB.prepare('UPDATE verification SET expiresAt = 0').run();

    const response = await SELF.fetch(link, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('revokes a database-backed session immediately', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    expect((await requestMagicLink('known@example.test')).status).toBe(202);
    const link = linkFrom((await capturedMessages())[0]?.textBody ?? '');
    const login = await SELF.fetch(link, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    expect(cookie).toBeTruthy();

    const before = await authRequest('/auth/get-session', { headers: { cookie: cookie ?? '' } });
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ user: { id: 'employee-1' } });

    const revoked = await authRequest('/auth/sign-out', {
      method: 'POST',
      headers: { cookie: cookie ?? '' },
      body: '{}',
    });
    expect(revoked.status).toBe(200);

    const after = await authRequest('/auth/get-session', { headers: { cookie: cookie ?? '' } });
    expect(after.status).toBe(200);
    expect(await after.json()).toBeNull();
  });

  test('requires passkey for root sign-in and keeps it independent of email', async () => {
    await seedUser({
      id: 'root-1',
      email: 'root@example.test',
      kind: 'root',
      emailLoginEnabled: false,
    });
    const emailAttempt = await requestMagicLink('root@example.test');
    expect(emailAttempt.status).toBe(202);
    expect(await capturedMessages(0)).toEqual([]);

    const passkeyOptions = await authRequest('/auth/passkey/generate-authenticate-options');
    expect(passkeyOptions.status).toBe(200);
    expect(await passkeyOptions.json()).toMatchObject({
      challenge: expect.any(String),
      userVerification: 'required',
    });

    expect(await capturedMessages(0)).toEqual([]);
  });

  test('rate-limits passwordless email requests using Auth D1', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    const ip = '203.0.113.44';

    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(await requestMagicLink('known@example.test', ip));
    }

    expect(responses.map(response => response.status)).toEqual([202, 202, 202, 429]);
    expect(responses[3]?.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await capturedMessages(3)).toHaveLength(3);
    await expect(testEnv.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM rateLimit').first('count'))
      .resolves.toBeGreaterThan(0);
  });

  test('creates same-origin links and host-only secure cookies for the Operator Web proxy', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    expect((await requestMagicLink('known@example.test')).status).toBe(202);
    const link = linkFrom((await capturedMessages())[0]?.textBody ?? '');
    expect(new URL(link).origin).toBe(publicOrigin);

    const response = await SELF.fetch(link, { redirect: 'manual' });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('incentives-local.session_token=');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('secure');
    expect(cookie.toLowerCase()).toContain('samesite=lax');
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });

  test('never writes magic links, tokens, or configured secrets to logs', async () => {
    await seedUser({ id: 'employee-1', email: 'known@example.test' });
    const spies = ['debug', 'info', 'log', 'warn', 'error'].map(method =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined));

    try {
      expect((await requestMagicLink('known@example.test')).status).toBe(202);
      const link = linkFrom((await capturedMessages())[0]?.textBody ?? '');
      const token = new URL(link).searchParams.get('token');
      const logText = spies.flatMap(spy => spy.mock.calls).flat().join(' ');

      expect(token).toBeTruthy();
      expect(logText).not.toContain(link);
      expect(logText).not.toContain(token ?? '');
      expect(logText).not.toContain('identity-test-secret-at-least-thirty-two-characters');
      expect(logText).not.toContain('re_test_secret');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('Resend staging adapter', () => {
  test('enforces configured staging recipients before calling Resend', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    );
    const adapter = createResendEmailAdapter({
      apiKey: 're_test_secret',
      from: 'identity@example.test',
      allowedRecipients: new Set(['allowed@example.test']),
      fetch: fetchMock,
    });

    await expect(adapter.send({
      to: 'blocked@example.test',
      subject: 'Sign in',
      text: 'body',
    })).rejects.toThrow('Recipient is not allowed in staging');
    expect(fetchMock).not.toHaveBeenCalled();

    await adapter.send({
      to: 'allowed@example.test',
      subject: 'Sign in',
      text: 'body',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
