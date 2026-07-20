import { createIdentityAuth } from './auth.js';

export interface Env {
  AUTH_DB: D1Database;
  AUTH_SECRET: string;
  APP_ENV: 'local' | 'staging';
  PUBLIC_APP_ORIGIN: string;
  COOKIE_PREFIX: string;
  EMAIL_MODE: 'local-capture' | 'resend';
  MAGIC_LINK_TTL_SECONDS: string;
  EMAIL_RATE_LIMIT_MAX: string;
  EMAIL_RATE_LIMIT_WINDOW_SECONDS: string;
  STAGING_ALLOWED_RECIPIENTS: string;
  PASSKEY_RP_ID: string;
  PASSKEY_RP_NAME: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

function signupDisabled() {
  return Response.json({
    code: 'SIGNUP_DISABLED',
    message: 'Self-service signup is unavailable.',
  }, { status: 404 });
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function recoverRoot(request: Request, env: Env): Promise<Response> {
  let userId: string;
  let code: string;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object') throw new Error('invalid body');
    const input = body as { userId?: unknown; code?: unknown };
    if (typeof input.userId !== 'string' || typeof input.code !== 'string') {
      throw new Error('invalid body');
    }
    userId = input.userId;
    code = input.code;
  } catch {
    return Response.json({ code: 'INVALID_REQUEST', message: 'Invalid recovery request.' }, { status: 400 });
  }

  const now = Date.now();
  const claimed = await env.AUTH_DB.prepare(`
    UPDATE root_recovery_code
    SET used_at = ?1
    WHERE user_id = ?2
      AND code_hash = ?3
      AND used_at IS NULL
      AND EXISTS (
        SELECT 1 FROM auth_profile
        WHERE auth_profile.user_id = root_recovery_code.user_id
          AND auth_profile.subject_kind = 'root'
          AND auth_profile.status = 'active'
      )
    RETURNING id
  `).bind(now, userId, await sha256(code)).first<{ id: string }>();

  if (!claimed) {
    return Response.json({ code: 'INVALID_RECOVERY_CODE', message: 'Recovery failed.' }, { status: 401 });
  }

  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM session WHERE userId = ?1').bind(userId),
    env.AUTH_DB.prepare('DELETE FROM passkey WHERE userId = ?1').bind(userId),
    env.AUTH_DB.prepare(`
      UPDATE root_recovery_code SET used_at = ?1 WHERE user_id = ?2 AND used_at IS NULL
    `).bind(now, userId),
    env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, 'root', ?3, 'root.recovered', 'user', ?3, 'succeeded', ?4, NULL)
    `).bind(crypto.randomUUID(), now, userId, correlationId),
  ]);

  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/auth/sign-up/')) return signupDisabled();
    if (url.pathname === '/auth/root/recovery' && request.method === 'POST') {
      return recoverRoot(request, env);
    }
    return createIdentityAuth(env).handler(request);
  },
} satisfies ExportedHandler<Env>;
