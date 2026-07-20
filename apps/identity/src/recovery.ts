import { makeSignature } from 'better-auth/crypto';

import type { Env } from './worker.js';

const RECOVERY_GRANT_TTL_MS = 10 * 60_000;
const RECOVERY_SESSION_TTL_MS = 10 * 60_000;
const RECOVERY_RATE_WINDOW_MS = 15 * 60_000;
const RECOVERY_RATE_MAX = 5;
const REPLACEMENT_CODE_COUNT = 8;
const ROOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface RecoveryInput {
  userId: string;
  code: string;
}

interface RecoveryFlow {
  id: string;
  userId: string;
  grantHash: string;
  initiatingCodeHash: string;
  expiresAt: number;
  sessionId: string | null;
  sessionToken: string | null;
  sessionExpiresAt: number | null;
  replacementPasskeyId: string | null;
}

export interface RecoverySession {
  sessionId: string;
  userId: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!SECRET_PATTERN.test(value)) return null;
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(44, '=');
    const decoded = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function validSecret(value: string): boolean {
  return decodeBase64Url(value) !== null;
}

function randomSecret(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function keyedBytes(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  ));
}

async function keyedHash(secret: string, value: string): Promise<string> {
  return [...await keyedBytes(secret, value)]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function deriveGrant(env: Env, flowId: string, codeHash: string): Promise<string> {
  return base64Url(await keyedBytes(
    env.AUTH_SECRET,
    `identity-recovery-grant-v1:${flowId}:${codeHash}`,
  ));
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

export async function writeIdentityAudit(
  env: Env,
  correlationId: string,
  input: {
    actorKind: 'anonymous' | 'employee' | 'root' | 'system';
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
    // Audit failures never widen authorization or reveal sensitive material.
  }
}

async function parseRecoveryInput(request: Request): Promise<RecoveryInput | null> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') return null;
    const { userId, code } = body as { userId?: unknown; code?: unknown };
    if (typeof userId !== 'string' || typeof code !== 'string') return null;
    if (!ROOT_ID_PATTERN.test(userId) || !validSecret(code)) return null;
    return { userId, code };
  } catch {
    return null;
  }
}

async function consumeRecoveryRateLimit(
  request: Request,
  env: Env,
  userId: string,
): Promise<number | null> {
  const now = Date.now();
  const cutoff = now - RECOVERY_RATE_WINDOW_MS;
  const source = request.headers.get('cf-connecting-ip') ?? 'no-trusted-source';
  const keys = await Promise.all([
    keyedHash(env.AUTH_SECRET, `recovery-source:${source}`),
    keyedHash(env.AUTH_SECRET, `recovery-root:${userId.toLowerCase()}`),
  ]);
  const results = await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      DELETE FROM recovery_rate_limit WHERE window_started_at <= ?1
    `).bind(cutoff),
    ...keys.map(key => env.AUTH_DB.prepare(`
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
    `).bind(key, now, cutoff)),
  ]);
  const rows = results.slice(1).flatMap(result => result.results ?? []) as Array<{
    window_started_at: number;
    attempt_count: number;
  }>;
  const throttled = rows.filter(row => row.attempt_count > RECOVERY_RATE_MAX);
  if (throttled.length === 0) return null;
  return Math.max(1, Math.ceil(Math.max(
    ...throttled.map(row => row.window_started_at + RECOVERY_RATE_WINDOW_MS - now),
  ) / 1_000));
}

async function activeFlow(env: Env, userId: string): Promise<RecoveryFlow | null> {
  return env.AUTH_DB.prepare(`
    SELECT recovery_flow.id, recovery_flow.user_id AS userId,
      recovery_flow.grant_hash AS grantHash,
      recovery_flow.initiating_code_hash AS initiatingCodeHash,
      recovery_flow.expires_at AS expiresAt,
      recovery_flow.session_id AS sessionId,
      session.token AS sessionToken,
      session.expiresAt AS sessionExpiresAt,
      recovery_flow.replacement_passkey_id AS replacementPasskeyId
    FROM recovery_flow
    LEFT JOIN session ON session.id = recovery_flow.session_id
    WHERE recovery_flow.user_id = ?1
      AND recovery_flow.completed_at IS NULL
      AND recovery_flow.cancelled_at IS NULL
  `).bind(userId).first<RecoveryFlow>();
}

function flowIsLive(flow: RecoveryFlow, now: number): boolean {
  if (!flow.sessionId) return flow.expiresAt > now;
  return flow.sessionToken !== null && (flow.sessionExpiresAt ?? 0) > now;
}

async function cancelFlowById(
  env: Env,
  flowId: string,
  correlationId: string,
  reason: string,
  pendingPasskeyId?: string,
): Promise<void> {
  const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow SET cancelled_at = ?1, cancel_reason = ?2
      WHERE id = ?3 AND completed_at IS NULL AND cancelled_at IS NULL
    `).bind(now, reason, flowId),
    env.AUTH_DB.prepare(`
      DELETE FROM passkey WHERE id = ?3 OR id IN (
        SELECT replacement_passkey_id FROM recovery_flow
        WHERE id = ?1 AND cancelled_at = ?2
      )
    `).bind(flowId, now, pendingPasskeyId ?? ''),
    env.AUTH_DB.prepare(`
      DELETE FROM session WHERE id IN (
        SELECT session_id FROM recovery_flow WHERE id = ?1 AND cancelled_at = ?2
      )
    `).bind(flowId, now),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      )
      SELECT ?1, ?2, 'root', user_id, 'root.recovery.cancelled',
        'recovery_flow', id, 'succeeded', ?3, NULL
      FROM recovery_flow WHERE id = ?4 AND cancelled_at = ?2
    `).bind(crypto.randomUUID(), now, correlationId, flowId),
  ]);
}

export async function beginRootRecovery(
  request: Request,
  env: Env,
  correlationId: string,
): Promise<Response> {
  const input = await parseRecoveryInput(request);
  if (!input) {
    await writeIdentityAudit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 400, 'INVALID_REQUEST', 'Invalid recovery request.');
  }

  const retryAfter = await consumeRecoveryRateLimit(request, env, input.userId);
  if (retryAfter !== null) {
    await writeIdentityAudit(env, correlationId, {
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
  const codeHash = await sha256(input.code);
  const existing = await activeFlow(env, input.userId);
  if (
    existing
    && existing.initiatingCodeHash === codeHash
    && flowIsLive(existing, now)
  ) {
    return Response.json({
      grant: await deriveGrant(env, existing.id, codeHash),
      expiresAt: existing.expiresAt,
    }, { status: 200, headers: { 'x-correlation-id': correlationId } });
  }

  const flowId = crypto.randomUUID();
  const expiresAt = now + RECOVERY_GRANT_TTL_MS;
  const grant = await deriveGrant(env, flowId, codeHash);
  const grantHash = await sha256(grant);
  try {
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare(`
        UPDATE recovery_flow SET cancelled_at = ?1, cancel_reason = 'expired'
        WHERE user_id = ?2 AND completed_at IS NULL AND cancelled_at IS NULL
          AND (
            (session_id IS NULL AND expires_at <= ?1)
            OR (session_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM session
              WHERE session.id = recovery_flow.session_id AND session.expiresAt > ?1
            ))
          )
      `).bind(now, input.userId),
      env.AUTH_DB.prepare(`
        DELETE FROM passkey WHERE id IN (
          SELECT replacement_passkey_id FROM recovery_flow
          WHERE user_id = ?1 AND cancelled_at = ?2 AND completed_at IS NULL
        )
      `).bind(input.userId, now),
      env.AUTH_DB.prepare(`
        DELETE FROM session WHERE id IN (
          SELECT session_id FROM recovery_flow
          WHERE user_id = ?1 AND cancelled_at = ?2 AND completed_at IS NULL
        )
      `).bind(input.userId, now),
      env.AUTH_DB.prepare(`
        INSERT INTO recovery_flow (
          id, user_id, grant_hash, initiating_code_hash, created_at, expires_at
        )
        SELECT ?1, recovery.user_id, ?2, ?3, ?4, ?5
        FROM root_recovery_code AS recovery
        INNER JOIN auth_profile ON auth_profile.user_id = recovery.user_id
        WHERE recovery.user_id = ?6
          AND recovery.code_hash = ?3
          AND recovery.used_at IS NULL
          AND auth_profile.subject_kind = 'root'
          AND auth_profile.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM recovery_flow AS active
            WHERE active.user_id = recovery.user_id
              AND active.completed_at IS NULL AND active.cancelled_at IS NULL
          )
      `).bind(flowId, grantHash, codeHash, now, expiresAt, input.userId),
      env.AUTH_DB.prepare(`
        UPDATE root_recovery_code SET used_at = ?1, recovery_flow_id = ?2
        WHERE user_id = ?3 AND code_hash = ?4 AND used_at IS NULL
          AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?2)
      `).bind(now, flowId, input.userId, codeHash),
      env.AUTH_DB.prepare(`
        DELETE FROM session WHERE userId = ?1
          AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?2)
      `).bind(input.userId, flowId),
      env.AUTH_DB.prepare(`
        DELETE FROM passkey WHERE userId = ?1
          AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?2)
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
    // The unique active-root index makes concurrent distinct codes one-winner.
  }

  const claimed = await activeFlow(env, input.userId);
  if (claimed?.initiatingCodeHash === codeHash && flowIsLive(claimed, now)) {
    return Response.json({
      grant: await deriveGrant(env, claimed.id, codeHash),
      expiresAt: claimed.expiresAt,
    }, { status: 200, headers: { 'x-correlation-id': correlationId } });
  }

  await writeIdentityAudit(env, correlationId, {
    actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.failed',
    targetType: 'recovery', targetId: 'root', outcome: 'denied',
  });
  return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');
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
    // Invalid input is normalized below.
  }
  if (!grant || !validSecret(grant)) {
    await writeIdentityAudit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.exchange_failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 400, 'INVALID_REQUEST', 'Invalid recovery request.');
  }

  const now = Date.now();
  const grantHash = await sha256(grant);
  let flow = await env.AUTH_DB.prepare(`
    SELECT recovery_flow.id, recovery_flow.user_id AS userId,
      recovery_flow.grant_hash AS grantHash,
      recovery_flow.initiating_code_hash AS initiatingCodeHash,
      recovery_flow.expires_at AS expiresAt,
      recovery_flow.session_id AS sessionId,
      session.token AS sessionToken,
      session.expiresAt AS sessionExpiresAt,
      recovery_flow.replacement_passkey_id AS replacementPasskeyId
    FROM recovery_flow
    LEFT JOIN session ON session.id = recovery_flow.session_id
    WHERE recovery_flow.grant_hash = ?1
      AND recovery_flow.completed_at IS NULL
      AND recovery_flow.cancelled_at IS NULL
  `).bind(grantHash).first<RecoveryFlow>();
  if (!flow) {
    await writeIdentityAudit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.exchange_failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');
  }

  if (flow.sessionId && flow.sessionToken && (flow.sessionExpiresAt ?? 0) > now) {
    return Response.json({ ok: true }, {
      status: 200,
      headers: {
        'set-cookie': await setSessionCookieHeader(env, flow.sessionToken),
        'x-correlation-id': correlationId,
      },
    });
  }
  if (flow.sessionId || flow.expiresAt <= now) {
    await cancelFlowById(env, flow.id, correlationId, 'expired');
    await writeIdentityAudit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.exchange_failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');
  }

  const sessionId = crypto.randomUUID();
  const sessionToken = randomSecret();
  const sessionExpiresAt = now + RECOVERY_SESSION_TTL_MS;
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow SET exchanged_at = ?1, session_id = ?2
      WHERE id = ?3 AND expires_at > ?1 AND session_id IS NULL
        AND completed_at IS NULL AND cancelled_at IS NULL
    `).bind(now, sessionId, flow.id),
    env.AUTH_DB.prepare(`
      INSERT INTO session (
        id, expiresAt, token, createdAt, updatedAt, userId,
        authenticationMethod, authenticatedAt, recoveryOnly
      )
      SELECT ?1, ?2, ?3, ?4, ?4, user_id, 'recovery', ?4, 1
      FROM recovery_flow WHERE session_id = ?1
    `).bind(sessionId, sessionExpiresAt, sessionToken, now),
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
  flow = await env.AUTH_DB.prepare(`
    SELECT recovery_flow.id, recovery_flow.user_id AS userId,
      recovery_flow.grant_hash AS grantHash,
      recovery_flow.initiating_code_hash AS initiatingCodeHash,
      recovery_flow.expires_at AS expiresAt,
      recovery_flow.session_id AS sessionId,
      session.token AS sessionToken,
      session.expiresAt AS sessionExpiresAt,
      recovery_flow.replacement_passkey_id AS replacementPasskeyId
    FROM recovery_flow INNER JOIN session ON session.id = recovery_flow.session_id
    WHERE recovery_flow.id = ?1 AND session.expiresAt > ?2
  `).bind(flow.id, now).first<RecoveryFlow>();
  if (!flow?.sessionToken) {
    await writeIdentityAudit(env, correlationId, {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'root.recovery.exchange_failed',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(correlationId, 401, 'RECOVERY_FAILED', 'Recovery failed.');
  }

  return Response.json({ ok: true }, {
    status: 200,
    headers: {
      'set-cookie': await setSessionCookieHeader(env, flow.sessionToken),
      'x-correlation-id': correlationId,
    },
  });
}

export async function getRecoverySession(
  env: Env,
  sessionId: string,
): Promise<RecoverySession | null> {
  return env.AUTH_DB.prepare(`
    SELECT session.id AS sessionId, session.userId AS userId
    FROM session
    INNER JOIN auth_profile ON auth_profile.user_id = session.userId
    INNER JOIN recovery_flow ON recovery_flow.session_id = session.id
    WHERE session.id = ?1 AND session.expiresAt > ?2
      AND session.authenticationMethod = 'recovery' AND session.recoveryOnly = 1
      AND auth_profile.subject_kind = 'root' AND auth_profile.status = 'active'
      AND recovery_flow.completed_at IS NULL AND recovery_flow.cancelled_at IS NULL
  `).bind(sessionId, Date.now()).first<RecoverySession>();
}

export async function cancelRecoverySession(
  env: Env,
  sessionId: string,
  correlationId: string,
  reason = 'signed-out',
  pendingPasskeyId?: string,
): Promise<void> {
  const flow = await env.AUTH_DB.prepare(`
    SELECT id FROM recovery_flow
    WHERE session_id = ?1 AND completed_at IS NULL AND cancelled_at IS NULL
  `).bind(sessionId).first<{ id: string }>();
  if (flow) await cancelFlowById(env, flow.id, correlationId, reason, pendingPasskeyId);
}

export async function markReplacementPasskeyRegistered(
  env: Env,
  sessionId: string,
  passkeyId: string,
  correlationId: string,
): Promise<void> {
  const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow SET passkey_registered_at = ?1, replacement_passkey_id = ?2
      WHERE session_id = ?3 AND completed_at IS NULL AND cancelled_at IS NULL
        AND passkey_registered_at IS NULL
    `).bind(now, passkeyId, sessionId),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      )
      SELECT ?1, ?2, 'root', user_id, 'root.recovery.passkey_registered',
        'recovery_flow', id, 'succeeded', ?3, NULL
      FROM recovery_flow
      WHERE session_id = ?4 AND passkey_registered_at = ?2
        AND replacement_passkey_id = ?5
    `).bind(crypto.randomUUID(), now, correlationId, sessionId, passkeyId),
  ]);
  const marked = await env.AUTH_DB.prepare(`
    SELECT id FROM recovery_flow
    WHERE session_id = ?1 AND replacement_passkey_id = ?2
      AND passkey_registered_at = ?3 AND completed_at IS NULL AND cancelled_at IS NULL
  `).bind(sessionId, passkeyId, now).first<{ id: string }>();
  if (!marked) throw new Error('RECOVERY_PASSKEY_MARK_FAILED');
}

function replacementCodeStatements(
  env: Env,
  userId: string,
  hashes: string[],
  now: number,
  recoveryFlowId: string | null,
): D1PreparedStatement[] {
  return hashes.map(hash => env.AUTH_DB.prepare(`
    INSERT INTO root_recovery_code (
      id, user_id, code_hash, created_at, recovery_flow_id
    ) VALUES (?1, ?2, ?3, ?4, ?5)
  `).bind(crypto.randomUUID(), userId, hash, now, recoveryFlowId));
}

export async function rotateRecoveryCodes(
  env: Env,
  sessionId: string,
  correlationId: string,
): Promise<Response> {
  const flow = await env.AUTH_DB.prepare(`
    SELECT id, user_id AS userId,
      passkey_registered_at AS passkeyRegisteredAt,
      replacement_passkey_id AS replacementPasskeyId
    FROM recovery_flow
    WHERE session_id = ?1 AND completed_at IS NULL AND cancelled_at IS NULL
  `).bind(sessionId).first<{
    id: string;
    userId: string;
    passkeyRegisteredAt: number | null;
    replacementPasskeyId: string | null;
  }>();
  if (!flow?.passkeyRegisteredAt || !flow.replacementPasskeyId) {
    await writeIdentityAudit(env, correlationId, {
      actorKind: flow ? 'root' : 'system', actorId: flow?.userId ?? 'identity',
      action: 'root.recovery.rotation_denied',
      targetType: 'recovery', targetId: 'root', outcome: 'denied',
    });
    return errorResponse(
      correlationId, 409, 'PASSKEY_REQUIRED',
      'A verified replacement passkey is required.',
    );
  }

  const now = Date.now();
  const rotationId = crypto.randomUUID();
  const codes = Array.from({ length: REPLACEMENT_CODE_COUNT }, randomSecret);
  const hashes = await Promise.all(codes.map(sha256));
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE recovery_flow SET completed_at = ?1, rotation_id = ?2
      WHERE id = ?3 AND completed_at IS NULL AND cancelled_at IS NULL
        AND passkey_registered_at IS NOT NULL AND replacement_passkey_id IS NOT NULL
    `).bind(now, rotationId, flow.id),
    env.AUTH_DB.prepare(`
      UPDATE root_recovery_code SET used_at = ?1
      WHERE user_id = ?2 AND used_at IS NULL
        AND EXISTS (SELECT 1 FROM recovery_flow WHERE id = ?3 AND rotation_id = ?4)
    `).bind(now, flow.userId, flow.id, rotationId),
    ...hashes.map(hash => env.AUTH_DB.prepare(`
      INSERT INTO root_recovery_code (
        id, user_id, code_hash, created_at, recovery_flow_id
      )
      SELECT ?1, user_id, ?2, ?3, id FROM recovery_flow
      WHERE id = ?4 AND rotation_id = ?5 AND completed_at = ?3
    `).bind(crypto.randomUUID(), hash, now, flow.id, rotationId)),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      )
      SELECT ?1, ?2, 'root', user_id, 'root.recovery.completed',
        'recovery_flow', id, 'succeeded', ?3, NULL
      FROM recovery_flow WHERE id = ?4 AND rotation_id = ?5
    `).bind(crypto.randomUUID(), now, correlationId, flow.id, rotationId),
    env.AUTH_DB.prepare(`
      DELETE FROM session WHERE userId = ?1 AND EXISTS (
        SELECT 1 FROM recovery_flow WHERE id = ?2 AND rotation_id = ?3
      )
    `).bind(flow.userId, flow.id, rotationId),
  ]);
  const completed = await env.AUTH_DB.prepare(`
    SELECT id FROM recovery_flow WHERE id = ?1 AND rotation_id = ?2
  `).bind(flow.id, rotationId).first<{ id: string }>();
  if (!completed) throw new Error('RECOVERY_COMPLETION_FAILED');
  return Response.json({ codes }, {
    status: 200,
    headers: {
      'set-cookie': expiredSessionCookieHeader(env),
      'x-correlation-id': correlationId,
    },
  });
}

export async function reissueRecoveryCodes(
  env: Env,
  userId: string,
  correlationId: string,
): Promise<Response> {
  const now = Date.now();
  const codes = Array.from({ length: REPLACEMENT_CODE_COUNT }, randomSecret);
  const hashes = await Promise.all(codes.map(sha256));
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`
      UPDATE root_recovery_code SET used_at = ?1
      WHERE user_id = ?2 AND used_at IS NULL
    `).bind(now, userId),
    ...replacementCodeStatements(env, userId, hashes, now, null),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, 'root', ?3, 'root.recovery.codes_reissued',
        'user', ?3, 'succeeded', ?4, NULL)
    `).bind(crypto.randomUUID(), now, userId, correlationId),
  ]);
  return Response.json({ codes }, {
    status: 200,
    headers: { 'x-correlation-id': correlationId },
  });
}
