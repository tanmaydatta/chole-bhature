import { makeSignature } from 'better-auth/crypto';

import type { Env } from './worker.js';

const RECOVERY_GRANT_TTL_MS = 10 * 60_000;
const RECOVERY_SESSION_TTL_MS = 10 * 60_000;
const RECOVERY_RATE_WINDOW_MS = 15 * 60_000;
const RECOVERY_RATE_MAX = 5;
const REPLACEMENT_CODE_COUNT = 8;

interface RecoveryInput {
  userId: string;
  code: string;
}

interface RecoverySession {
  sessionId: string;
  userId: string;
  recoveryOnly: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function randomSecret(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function keyedHash(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function errorResponse(
  correlationId: string,
  status: number,
  code: string,
  message: string,
  retryable = false,
  headers?: HeadersInit,
): Response {
  return Response.json({
    error: { code, message, retryable },
    correlationId,
  }, {
    status,
    headers: { ...Object.fromEntries(new Headers(headers)), 'x-correlation-id': correlationId },
  });
}

async function audit(
  env: Env,
  correlationId: string,
  input: {
    actorKind: 'anonymous' | 'root' | 'system';
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: 'succeeded' | 'failed' | 'denied';
  },
): Promise<void> {
  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
    `).bind(
      crypto.randomUUID(), Date.now(), input.actorKind, input.actorId, input.action,
      input.targetType, input.targetId, input.outcome, correlationId,
    ).run();
  } catch {
    // Audit failures must not turn authentication failures into detail-bearing errors.
  }
}

async function parseRecoveryInput(request: Request): Promise<RecoveryInput | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return null;
    const { userId, code } = body as { userId?: unknown; code?: unknown };
    if (typeof userId !== 'string' || typeof code !== 'string' || !userId || !code) return null;
    return { userId, code };
  } catch {
    return null;
  }
}

async function consumeRecoveryRateLimit(
  request: Request,
  env: Env,
  input: RecoveryInput,
): Promise<number | null> {
  const now = Date.now();
  const cutoff = now - RECOVERY_RATE_WINDOW_MS;
  const source = request.headers.get('cf-connecting-ip') ?? 'no-trusted-source';
  const codeDigest = await sha256(input.code);
  const keys = await Promise.all([
    keyedHash(env.AUTH_SECRET, `recovery-source:${source}`),
    keyedHash(env.AUTH_SECRET, `recovery-credential:${input.userId}:${codeDigest}`),
  ]);
  const results = await env.AUTH_DB.batch(keys.map(key => env.AUTH_DB.prepare(`
    INSERT INTO recovery_rate_limit (key_hash, window_started_at, attempt_count)
    VALUES (?1, ?2, 1)
    ON CONFLICT(key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN recovery_rate_limit.window_started_at <= ?3 THEN ?2
        ELSE recovery_rate_limit.window_started_at
      END,
      attempt_count = CASE
        WHEN recovery_rate_limit.window_started_at <= ?3 THEN 1
        ELSE recovery_rate_limit.attempt_count + 1
      END
    RETURNING window_started_at, attempt_count
  `).bind(key, now, cutoff)));
  const rows = results.flatMap(result => result.results ?? []) as Array<{
    window_started_at: number;
    attempt_count: number;
  }>;
  const throttled = rows.filter(row => row.attempt_count > RECOVERY_RATE_MAX);
  if (throttled.length === 0) return null;
  return Math.max(1, Math.ceil(Math.max(
    ...throttled.map(row => row.window_started_at + RECOVERY_RATE_WINDOW_MS - now),
  ) / 1_000));
}

export async function beginRootRecovery(
  request: Request,
  env: Env,
  correlationId: string,
): Promise<Response> {
  const input = await parseRecoveryInput(request);
  if (!input) {
    await audit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 400, 'INVALID_REQUEST', 'Invalid recovery request.');
  }

  const retryAfter = await consumeRecoveryRateLimit(request, env, input);
  if (retryAfter !== null) {
    await audit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.rate_limited',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(
      correlationId,
      429,
      'RATE_LIMITED',
      'Recovery failed. Please try again later.',
      true,
      { 'retry-after': retryAfter.toString() },
    );
  }

  const now = Date.now();
  const flowId = crypto.randomUUID();
  const grant = randomSecret();
  const grantHash = await sha256(grant);
  const codeHash = await sha256(input.code);
  const expiresAt = now + RECOVERY_GRANT_TTL_MS;
  try {
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare(`
        INSERT INTO recovery_flow (id, user_id, grant_hash, created_at, expires_at)
        SELECT ?1, recovery.user_id, ?2, ?3, ?4
        FROM root_recovery_code AS recovery
        INNER JOIN auth_profile ON auth_profile.user_id = recovery.user_id
        WHERE recovery.user_id = ?5
          AND recovery.code_hash = ?6
          AND recovery.used_at IS NULL
          AND auth_profile.subject_kind = 'root'
          AND auth_profile.status = 'active'
      `).bind(flowId, grantHash, now, expiresAt, input.userId, codeHash),
      env.AUTH_DB.prepare(`
        UPDATE root_recovery_code
        SET used_at = ?1, recovery_flow_id = ?2
        WHERE user_id = ?3 AND used_at IS NULL
          AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?2)
      `).bind(now, flowId, input.userId),
      env.AUTH_DB.prepare(`
        DELETE FROM session
        WHERE userId = ?1 AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?2)
      `).bind(input.userId, flowId),
      env.AUTH_DB.prepare(`
        DELETE FROM passkey
        WHERE userId = ?1 AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?2)
      `).bind(input.userId, flowId),
      env.AUTH_DB.prepare(`
        INSERT INTO identity_audit (
          id, occurred_at, actor_kind, actor_id, action, target_type,
          target_id, outcome, correlation_id, metadata_json
        )
        SELECT ?1, ?2, 'root', user_id, 'root.recovery.claimed',
          'recovery_flow', id, 'succeeded', ?3, NULL
        FROM recovery_flow WHERE id = ?4
      `).bind(crypto.randomUUID(), now, correlationId, flowId),
    ]);
  } catch {
    // A concurrent valid code loses the unique active-root flow race and is
    // intentionally indistinguishable from invalid recovery material.
  }

  const claimed = await env.AUTH_DB.prepare(`
    SELECT id FROM recovery_flow WHERE id = ?1
  `).bind(flowId).first<{ id: string }>();
  if (!claimed) {
    await audit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');
  }

  return Response.json(
    { grant, expiresAt },
    { status: 200, headers: { 'x-correlation-id': correlationId } },
  );
}

function sessionCookieName(env: Env): string {
  const securePrefix = new URL(env.PUBLIC_APP_ORIGIN).protocol === 'https:' ? '__Secure-' : '';
  return `${securePrefix}${env.COOKIE_PREFIX}.session_token`;
}

async function setSessionCookieHeader(env: Env, token: string): Promise<string> {
  const signature = await makeSignature(token, env.AUTH_SECRET);
  const secure = new URL(env.PUBLIC_APP_ORIGIN).protocol === 'https:' ? '; Secure' : '';
  return `${sessionCookieName(env)}=${encodeURIComponent(`${token}.${signature}`)}`
    + `; Max-Age=${Math.floor(RECOVERY_SESSION_TTL_MS / 1_000)}`
    + `; Path=/; HttpOnly${secure}; SameSite=Lax`;
}

export function expiredSessionCookieHeader(env: Env): string {
  const secure = new URL(env.PUBLIC_APP_ORIGIN).protocol === 'https:' ? '; Secure' : '';
  return `${sessionCookieName(env)}=; Max-Age=0; Path=/; HttpOnly${secure}; SameSite=Lax`;
}

export async function exchangeRecoveryGrant(
  request: Request,
  env: Env,
  correlationId: string,
): Promise<Response> {
  let grant: string | null = null;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && typeof (body as { grant?: unknown }).grant === 'string') {
      grant = (body as { grant: string }).grant;
    }
  } catch {
    // The generic response below intentionally covers malformed grants.
  }
  if (!grant) return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');

  const now = Date.now();
  const sessionId = crypto.randomUUID();
  const sessionToken = randomSecret();
  const sessionExpiresAt = now + RECOVERY_SESSION_TTL_MS;
  const grantHash = await sha256(grant);
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow
      SET exchanged_at = ?1, session_id = ?2
      WHERE grant_hash = ?3 AND expires_at > ?1 AND exchanged_at IS NULL AND completed_at IS NULL
    `).bind(now, sessionId, grantHash),
    env.AUTH_DB.prepare(`
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
      SELECT ?1, ?2, ?3, ?4, ?4, user_id FROM recovery_flow WHERE session_id = ?1
    `).bind(sessionId, sessionExpiresAt, sessionToken, now),
    env.AUTH_DB.prepare(`
      INSERT INTO session_context (
        session_id, authentication_method, authenticated_at, recovery_only
      )
      SELECT ?1, 'recovery', ?2, 1 FROM recovery_flow WHERE session_id = ?1
    `).bind(sessionId, now),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      )
      SELECT ?1, ?2, 'root', user_id, 'root.recovery.exchanged',
        'recovery_flow', id, 'succeeded', ?3, NULL
      FROM recovery_flow WHERE session_id = ?4
    `).bind(crypto.randomUUID(), now, correlationId, sessionId),
  ]);
  const session = await env.AUTH_DB.prepare(`
    SELECT id FROM session WHERE id = ?1
  `).bind(sessionId).first<{ id: string }>();
  if (!session) {
    await audit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.exchange_failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');
  }

  return Response.json({ ok: true }, {
    status: 200,
    headers: {
      'set-cookie': await setSessionCookieHeader(env, sessionToken),
      'x-correlation-id': correlationId,
    },
  });
}

export async function getRecoverySession(
  env: Env,
  sessionId: string,
): Promise<RecoverySession | null> {
  return env.AUTH_DB.prepare(`
    SELECT session.id AS sessionId, session.userId AS userId,
      session_context.recovery_only AS recoveryOnly
    FROM session
    INNER JOIN session_context ON session_context.session_id = session.id
    INNER JOIN recovery_flow ON recovery_flow.session_id = session.id
    WHERE session.id = ?1
      AND session.expiresAt > ?2
      AND session_context.authentication_method = 'recovery'
      AND session_context.recovery_only = 1
      AND recovery_flow.completed_at IS NULL
  `).bind(sessionId, Date.now()).first<RecoverySession>();
}

export async function markReplacementPasskeyRegistered(
  env: Env,
  sessionId: string,
  correlationId: string,
): Promise<void> {
  const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow SET passkey_registered_at = ?1
      WHERE session_id = ?2 AND completed_at IS NULL AND passkey_registered_at IS NULL
    `).bind(now, sessionId),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      )
      SELECT ?1, ?2, 'root', user_id, 'root.recovery.passkey_registered',
        'recovery_flow', id, 'succeeded', ?3, NULL
      FROM recovery_flow WHERE session_id = ?4 AND passkey_registered_at = ?2
    `).bind(crypto.randomUUID(), now, correlationId, sessionId),
  ]);
}

export async function rotateRecoveryCodes(
  env: Env,
  sessionId: string,
  correlationId: string,
): Promise<Response> {
  const now = Date.now();
  const rotationId = crypto.randomUUID();
  const codes = Array.from({ length: REPLACEMENT_CODE_COUNT }, randomSecret);
  const hashes = await Promise.all(codes.map(sha256));
  const statements: D1PreparedStatement[] = [
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow SET completed_at = ?1, rotation_id = ?2
      WHERE session_id = ?3 AND completed_at IS NULL AND passkey_registered_at IS NOT NULL
    `).bind(now, rotationId, sessionId),
    ...hashes.map(hash => env.AUTH_DB.prepare(`
      INSERT INTO root_recovery_code (
        id, user_id, code_hash, created_at, recovery_flow_id
      )
      SELECT ?1, user_id, ?2, ?3, id FROM recovery_flow
      WHERE session_id = ?4 AND rotation_id = ?5 AND completed_at = ?3
    `).bind(crypto.randomUUID(), hash, now, sessionId, rotationId)),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      )
      SELECT ?1, ?2, 'root', user_id, 'root.recovery.completed',
        'recovery_flow', id, 'succeeded', ?3, NULL
      FROM recovery_flow WHERE session_id = ?4 AND rotation_id = ?5
    `).bind(crypto.randomUUID(), now, correlationId, sessionId, rotationId),
    env.AUTH_DB.prepare(`
      DELETE FROM session WHERE id = ?1 AND EXISTS (
        SELECT 1 FROM recovery_flow WHERE session_id = ?1 AND rotation_id = ?2
      )
    `).bind(sessionId, rotationId),
  ];
  await env.AUTH_DB.batch(statements);
  const completed = await env.AUTH_DB.prepare(`
    SELECT id FROM recovery_flow WHERE session_id = ?1 AND rotation_id = ?2
  `).bind(sessionId, rotationId).first<{ id: string }>();
  if (!completed) {
    await audit(env, correlationId, {
      actorKind: 'root', actorId: 'root', action: 'root.recovery.rotation_denied',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(
      correlationId, 409, 'PASSKEY_REQUIRED',
      'A verified replacement passkey is required.',
    );
  }
  return Response.json({ codes }, {
    status: 200,
    headers: {
      'set-cookie': expiredSessionCookieHeader(env),
      'x-correlation-id': correlationId,
    },
  });
}
