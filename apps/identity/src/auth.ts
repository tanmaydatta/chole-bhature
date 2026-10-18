import { passkey } from '@better-auth/passkey';
import { betterAuth, type BetterAuthPlugin, type BetterAuthOptions } from 'better-auth';
import { magicLink, testUtils } from 'better-auth/plugins';
import { makeSignature } from 'better-auth/crypto';
import type { StoredControlLease, E2eControlAccount, E2eControlRuntime } from '@incentives/contracts';
import { businessControlRuntime, controlRuntime } from './e2e-control-runtime.js';
import { withControlWrite } from './services/e2e-write-fence.js';

import { createIdentityEmailAdapter, type EmailAdapter } from './email.js';
import {
  cancelRecoverySession,
  errorResponse,
  expiredSessionCookieHeader,
  markReplacementPasskeyRegistered,
  writeIdentityAudit,
} from './recovery.js';
import type { Env } from './worker.js';
import { assertCiStack } from './ci-stack.js';

export type AuthenticationMethod = 'magic-link' | 'passkey' | 'recovery' | 'e2e-fixture';

export interface IdentityAuth {
  createFixtureSession(input: { userId: string; runId: string; merchantId: string }): Promise<{
    sessionId: string; cookieHeader: string;
    cookieAttributes?: E2eControlAccount['cookieAttributes'];
  }>;
  handler(request: Request, executionContext?: ExecutionContext): Promise<Response>;
  getSession(headers: Headers): Promise<{
    session: {
      id: string;
      userId: string;
      authenticationMethod: AuthenticationMethod;
      authenticatedAt: number;
      recoveryOnly: boolean;
    };
    user: { id: string };
  } | null>;
}

export interface IdentityAuthDependencies {
  controlGrant?: Readonly<{ userId: string; sessionId: string; lease: StoredControlLease }>;
  emailAdapter?: EmailAdapter;
  afterPasskeyAuthorization?: (
    input: { credentialId: string; userId: string },
  ) => Promise<void>;
  beforeMagicLinkEmployeeLookup?: () => Promise<void>;
}

interface RateLimitRow {
  count: number;
  lastRequest: number;
}

interface SessionAccess {
  sessionId: string;
  userId: string;
  subjectKind: 'employee' | 'root';
  authenticationMethod: AuthenticationMethod;
  authenticatedAt: number;
  recoveryOnly: number;
}

interface PasskeyAuthorization {
  credentialId: string;
  userId: string;
  recoveryGeneration: string;
  recoveryFence: number;
}

type CurrentSession = Awaited<ReturnType<IdentityAuth['getSession']>>;

function correlationId(request: Request): string {
  return request.headers.get('x-correlation-id') ?? crypto.randomUUID();
}

function genericMagicLinkResponse(request: Request): Response {
  return Response.json({ ok: true }, {
    status: 202,
    headers: { 'x-correlation-id': correlationId(request) },
  });
}

export function assertPasskeyUserVerified(userVerified: boolean): void {
  if (!userVerified) throw new Error('PASSKEY_USER_VERIFICATION_REQUIRED');
}

async function requirePasskeyUserVerification(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object') {
    throw new Error('Passkey authentication options response is invalid');
  }
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...body, userVerification: 'required' }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function normalizePasskeyAuthenticationOptionsResponse(
  response: Response,
  correlationId: string,
): Promise<Response> {
  if (!response.ok) {
    return normalizedAuthResponse(
      response,
      correlationId,
      '/auth/passkey/generate-authenticate-options',
    );
  }
  return requirePasskeyUserVerification(response);
}

export async function classifyPasskeyAuthenticationInfrastructureFailure(
  response: Response,
  capturedAuthorizationCurrent: boolean,
): Promise<boolean> {
  if (!capturedAuthorizationCurrent) return false;
  if (response.status >= 500) return true;
  if (response.status !== 400) return false;
  try {
    const body: unknown = await response.clone().json();
    return body !== null
      && typeof body === 'object'
      && (body as { code?: unknown }).code === 'AUTHENTICATION_FAILED';
  } catch {
    return false;
  }
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseAllowedRecipients(value: string): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error('STAGING_ALLOWED_RECIPIENTS must be a JSON string array');
  }
  return new Set(parsed.map(email => email.trim().toLowerCase()));
}

export function validateIdentityEnvironment(env: Env): void {
  assertCiStack(env);
  if (env.APP_ENV !== 'ci' && env.APP_ENV !== 'local' && env.APP_ENV !== 'staging') {
    throw new Error('APP_ENV must be local, staging or ci');
  }
  if (env.EMAIL_MODE !== 'local-capture' && env.EMAIL_MODE !== 'resend') {
    throw new Error('EMAIL_MODE must be local-capture or resend');
  }
  if (env.APP_ENV === 'local' && env.EMAIL_MODE !== 'local-capture') {
    throw new Error('Local identity must use local-capture email mode');
  }
  if (env.APP_ENV === 'staging' && env.EMAIL_MODE !== 'resend') {
    throw new Error('Staging identity must use resend email mode');
  }
}

async function writeAudit(
  env: Env,
  id: string,
  input: {
    actorKind: 'anonymous' | 'member' | 'root' | 'system';
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: 'succeeded' | 'failed' | 'denied';
  },
): Promise<void> {
  await writeIdentityAudit(env, id, input);
}

export async function disableEmailLogin(
  database: D1Database,
  userId: string,
  id: string,
): Promise<void> {
  const now = Date.now();
  await database.batch([
    database.prepare(`
      UPDATE auth_profile SET email_login_enabled = 0 WHERE user_id = ?1
    `).bind(userId),
    database.prepare(`
      DELETE FROM verification
      WHERE lower(json_extract(value, '$.email')) = lower((SELECT email FROM user WHERE id = ?1))
    `).bind(userId),
    database.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, 'system', 'identity', 'email_login.disabled',
        'user', ?3, 'succeeded', ?4, NULL)
    `).bind(crypto.randomUUID(), now, userId, id),
  ]);
}

async function consumeEmailRateLimit(
  env: Env,
  request: Request,
  windowSeconds: number,
  max: number,
): Promise<Response | null> {
  const source = request.headers.get('cf-connecting-ip') ?? 'no-trusted-ip';
  const key = `identity-email:${source}`;
  const now = Date.now();
  const cutoff = now - windowSeconds * 1_000;
  const row = await env.AUTH_DB.prepare(`
    INSERT INTO rateLimit (id, key, count, lastRequest)
    VALUES (?1, ?2, 1, ?3)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE
        WHEN rateLimit.lastRequest <= ?4 THEN 1
        ELSE rateLimit.count + 1
      END,
      lastRequest = CASE
        WHEN rateLimit.lastRequest <= ?4 THEN ?3
        ELSE rateLimit.lastRequest
      END
    RETURNING count, lastRequest
  `).bind(crypto.randomUUID(), key, now, cutoff).first<RateLimitRow>();

  if (!row || row.count <= max) return null;
  const retryAfter = Math.max(1, Math.ceil(
    (row.lastRequest + windowSeconds * 1_000 - now) / 1_000,
  ));
  return errorResponse(
    correlationId(request),
    429,
    'RATE_LIMITED',
    'Too many requests. Please try again later.',
    true,
    { 'retry-after': retryAfter.toString() },
  );
}

async function findKnownEmployee(env: Env, email: string): Promise<{ id: string } | null> {
  return env.AUTH_DB.prepare(`
    SELECT user.id
    FROM user
    INNER JOIN auth_profile ON auth_profile.user_id = user.id
    WHERE lower(user.email) = ?1
      AND auth_profile.subject_kind = 'employee'
      AND auth_profile.status = 'active'
      AND auth_profile.email_login_enabled = 1
  `).bind(email).first<{ id: string }>();
}

async function handleMagicLinkRequest(
  request: Request,
  env: Env,
  authHandler: (
    request: Request,
    delivery: { correlationId: string; userId: string | null },
  ) => Promise<Response>,
  executionContext: ExecutionContext | undefined,
  windowSeconds: number,
  max: number,
  beforeEmployeeLookup?: IdentityAuthDependencies['beforeMagicLinkEmployeeLookup'],
): Promise<Response> {
  const rateLimitResponse = await consumeEmailRateLimit(env, request, windowSeconds, max);
  if (rateLimitResponse) {
    await writeAudit(env, correlationId(request), {
      actorKind: 'anonymous', actorId: 'anonymous', action: 'magic_link.rate_limited',
      targetType: 'authentication', targetId: 'magic-link', outcome: 'denied',
    });
    return rateLimitResponse;
  }
  const requestCorrelationId = correlationId(request);

  let email: string;
  let parsedBody: Record<string, unknown>;
  try {
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== 'object' || typeof (body as { email?: unknown }).email !== 'string') {
      return errorResponse(
        requestCorrelationId, 400, 'INVALID_REQUEST', 'A valid email is required.',
      );
    }
    parsedBody = body as Record<string, unknown>;
    email = (body as { email: string }).email.trim().toLowerCase();
  } catch {
    return errorResponse(
      requestCorrelationId, 400, 'INVALID_REQUEST', 'A valid email is required.',
    );
  }

  await writeAudit(env, requestCorrelationId, {
    actorKind: 'anonymous', actorId: 'anonymous', action: 'magic_link.requested',
    targetType: 'authentication', targetId: 'magic-link', outcome: 'succeeded',
  });
  const backgroundWork = async () => {
    let employee: { id: string } | null = null;
    try {
      await beforeEmployeeLookup?.();
      employee = await findKnownEmployee(env, email);
      if (employee) {
        const headers = new Headers(request.headers);
        headers.delete('content-length');
        const canonicalRequest = new Request(request, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...parsedBody, email }),
        });
        await authHandler(canonicalRequest, {
          correlationId: requestCorrelationId,
          userId: employee.id,
        });
      } else {
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
        await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM verification WHERE 0').first();
      }
    } catch {
      await writeAudit(env, requestCorrelationId, {
        actorKind: 'system', actorId: 'identity', action: 'magic_link.delivery',
        targetType: employee ? 'user' : 'authentication',
        targetId: employee?.id ?? 'magic-link', outcome: 'failed',
      });
    }
  };
  if (executionContext) {
    executionContext.waitUntil(backgroundWork());
  } else {
    await backgroundWork();
  }
  return genericMagicLinkResponse(request);
}

function authenticationMethodForPath(path: string): Exclude<AuthenticationMethod, 'recovery'> | null {
  if (path.includes('/magic-link/verify')) return 'magic-link';
  if (path.includes('/passkey/verify-authentication')) return 'passkey';
  return null;
}

async function isSessionCreationAllowed(env: Env, userId: string, method: string): Promise<boolean> {
  if (method === 'magic-link') {
    return await env.AUTH_DB.prepare(`
      SELECT user_id FROM auth_profile
      WHERE user_id = ?1 AND subject_kind = 'employee'
        AND status = 'active' AND email_login_enabled = 1
    `).bind(userId).first() !== null;
  }
  if (method === 'passkey') {
    return await env.AUTH_DB.prepare(`
      SELECT user_id FROM auth_profile
      WHERE user_id = ?1 AND subject_kind = 'root' AND status = 'active'
    `).bind(userId).first() !== null;
  }
  return false;
}

async function isPasskeyAuthorizationCurrent(
  env: Env,
  authorization: PasskeyAuthorization | null,
  userId: string,
): Promise<boolean> {
  if (!authorization || authorization.userId !== userId) return false;
  return await env.AUTH_DB.prepare(`
    SELECT passkey.id
    FROM passkey
    INNER JOIN auth_profile ON auth_profile.user_id = passkey.userId
    WHERE passkey.credentialID = ?1 AND passkey.userId = ?2
      AND auth_profile.subject_kind = 'root' AND auth_profile.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM recovery_flow
        WHERE recovery_flow.user_id = passkey.userId
          AND recovery_flow.completed_at IS NULL
          AND recovery_flow.cancelled_at IS NULL
      )
      AND COALESCE((
        SELECT recovery_flow.id FROM recovery_flow
        WHERE recovery_flow.user_id = passkey.userId
        ORDER BY recovery_flow.rowid DESC LIMIT 1
      ), '') = ?3
  `).bind(
    authorization.credentialId,
    authorization.userId,
    authorization.recoveryGeneration,
  ).first() !== null;
}

export async function isControlSession(db: D1Database, sessionId: string): Promise<boolean> {
  const columns = (await db.prepare('PRAGMA table_info(user)').all<{ name:string }>()).results;
  if (columns.some(column => column.name === 'e2e_control_run_id') && await db.prepare(`SELECT 1 FROM session s
    JOIN user u ON u.id=s.userId WHERE s.id=?1 AND u.e2e_control_run_id IS NOT NULL`).bind(sessionId).first()) return true;
  const accounts = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='e2e_control_accounts'").first();
  return accounts !== null && await db.prepare(`SELECT 1 FROM e2e_control_accounts a JOIN session s ON s.userId=a.user_id
    WHERE s.id=?1 OR a.session_id=?1`).bind(sessionId).first() !== null;
}

export async function controlSessionIsCurrent(db: D1Database, sessionId: string, runtime: E2eControlRuntime | undefined): Promise<boolean> {
  if (!await isControlSession(db,sessionId)) return true;
  if (!runtime?.enabled) return false;
  try {
    return await db.prepare(`SELECT 1 FROM e2e_control_accounts a
      JOIN e2e_control_valid_runs r ON r.run_id=a.run_id JOIN session s ON s.id=a.session_id AND s.userId=a.user_id
      JOIN user u ON u.id=a.user_id JOIN memberships m ON m.id=a.membership_id JOIN organizations o ON o.id=m.organization_id
      JOIN e2e_fixture_sessions f ON f.session_id=s.id
      WHERE a.session_id=?1 AND a.state='issued' AND a.generation=r.generation AND r.generation=?2 AND r.target_id=?3
        AND r.phase='active' AND r.claim_status='active' AND r.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)
        AND u.e2e_control_run_id=r.run_id AND o.e2e_control_run_id=r.run_id AND o.id=r.organization_id
        AND o.merchant_id=r.merchant_id AND o.provisioning_id=r.provisioning_id AND m.user_id=a.user_id AND m.role=a.role
        AND m.status='active' AND o.status='active' AND f.run_id=r.run_id AND f.user_id=a.user_id AND f.merchant_id=r.merchant_id
        AND s.createdAt=f.issued_at AND s.expiresAt<=r.expires_at AND s.expiresAt<=f.hard_expires_at
        AND f.hard_expires_at=f.issued_at+900000 AND f.hard_expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)`)
      .bind(sessionId,runtime.generation,runtime.targetId).first() !== null;
  } catch { return false; }
}

export async function getSessionAccess(env: Env, sessionId: string): Promise<SessionAccess | null> {
  assertCiStack(env);
  const access = await env.AUTH_DB.prepare(`
    SELECT session.id AS sessionId, session.userId AS userId,
      auth_profile.subject_kind AS subjectKind,
      session.authenticationMethod, session.authenticatedAt,
      session.recoveryOnly
    FROM session
    INNER JOIN auth_profile ON auth_profile.user_id = session.userId
    WHERE session.id = ?1 AND
      (CASE WHEN typeof(session.expiresAt) = 'text'
        THEN CAST(strftime('%s', session.expiresAt) AS INTEGER) * 1000
        ELSE session.expiresAt END) > ?2
      AND session.authenticationMethod IN ('magic-link', 'passkey', 'recovery', 'e2e-fixture')
      AND session.authenticatedAt IS NOT NULL
      AND session.recoveryOnly IN (0, 1)
      AND (
        auth_profile.status = 'active'
        OR (
          auth_profile.status = 'pending'
          AND session.authenticationMethod = 'recovery'
          AND EXISTS (
            SELECT 1 FROM recovery_flow AS bootstrap_flow
            WHERE bootstrap_flow.session_id = session.id
              AND bootstrap_flow.purpose = 'bootstrap'
              AND bootstrap_flow.completed_at IS NULL
              AND bootstrap_flow.cancelled_at IS NULL
          )
        )
      )
      AND (
        (
          session.authenticationMethod = 'magic-link'
          AND session.recoveryOnly = 0
          AND auth_profile.subject_kind = 'employee'
          AND auth_profile.email_login_enabled = 1
        )
        OR (
          session.authenticationMethod = 'e2e-fixture'
          AND ?3 IN ('staging', 'ci', 'managed-local')
          AND session.recoveryOnly = 0
          AND auth_profile.subject_kind = 'employee'
          AND auth_profile.email_login_enabled = 0
          AND EXISTS (
            SELECT 1 FROM e2e_fixture_sessions
            JOIN memberships ON memberships.user_id = e2e_fixture_sessions.user_id
            JOIN organizations ON organizations.id = memberships.organization_id
            JOIN e2e_run_claims ON e2e_run_claims.merchant_id = organizations.merchant_id
            JOIN user ON user.id = memberships.user_id
            WHERE e2e_fixture_sessions.session_id = session.id
              AND e2e_fixture_sessions.user_id = session.userId
              AND e2e_fixture_sessions.run_id = e2e_run_claims.run_id
              AND e2e_fixture_sessions.merchant_id = organizations.merchant_id
              AND e2e_fixture_sessions.hard_expires_at > ?2
              AND e2e_fixture_sessions.hard_expires_at
                = e2e_fixture_sessions.issued_at + 900000
              AND memberships.status = 'active'
              AND organizations.status = 'active'
              AND e2e_run_claims.status = 'active'
              AND substr(user.email, 1, length('e2e+' || e2e_run_claims.run_id || '_'))
                = 'e2e+' || e2e_run_claims.run_id || '_'
              AND substr(user.email, -12) = '@e2e.invalid'
          )
        )
        OR (
          session.authenticationMethod = 'passkey'
          AND session.recoveryOnly = 0
          AND auth_profile.subject_kind = 'root'
          AND NOT EXISTS (
            SELECT 1 FROM recovery_flow
            WHERE recovery_flow.user_id = session.userId
              AND recovery_flow.completed_at IS NULL
              AND recovery_flow.cancelled_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM recovery_flow AS completed_recovery
            WHERE completed_recovery.user_id = session.userId
              AND completed_recovery.completed_at IS NOT NULL
              AND session.authenticatedAt <= completed_recovery.completed_at
          )
        )
        OR (
          session.authenticationMethod = 'recovery'
          AND session.recoveryOnly = 1
          AND auth_profile.subject_kind = 'root'
          AND EXISTS (
            SELECT 1 FROM recovery_flow
            WHERE recovery_flow.session_id = session.id
              AND recovery_flow.completed_at IS NULL
              AND recovery_flow.cancelled_at IS NULL
          )
        )
      )
  `).bind(sessionId, Date.now(), env.APP_ENV === 'local' && businessControlRuntime(env) ? 'managed-local' : env.APP_ENV).first<SessionAccess>();
  if (!access || access.authenticationMethod !== 'e2e-fixture') return access;
  const marked = await isControlSession(env.AUTH_DB,sessionId);
  if (!marked) return env.APP_ENV === 'local' ? null : access;
  const runtime = businessControlRuntime(env);
  return await controlSessionIsCurrent(env.AUTH_DB,sessionId,runtime) ? access : null;
}

function isPasskeyManagementPath(pathname: string): boolean {
  if (!pathname.startsWith('/auth/passkey/')) return false;
  return pathname !== '/auth/passkey/generate-authenticate-options'
    && pathname !== '/auth/passkey/verify-authentication';
}

function recoverySessionAllows(pathname: string, method: string): boolean {
  return (pathname === '/auth/passkey/generate-register-options' && method === 'GET')
    || (pathname === '/auth/passkey/verify-registration' && method === 'POST')
    || (pathname === '/auth/sign-out' && method === 'POST');
}

function hasSessionCookie(headers: Headers, env: Env): boolean {
  const cookie = headers.get('cookie') ?? '';
  return cookie.split(';').some(part => {
    const name = part.trim().split('=', 1)[0];
    return name === `${env.COOKIE_PREFIX}.session_token`
      || name === `__Secure-${env.COOKIE_PREFIX}.session_token`;
  });
}

async function normalizedAuthResponse(
  response: Response,
  id: string,
  pathname: string,
  verifiedInfrastructureFailure = false,
): Promise<Response> {
  if (response.status < 400) return response;
  if (verifiedInfrastructureFailure) {
    return errorResponse(
      id, 503, 'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable.', true,
    );
  }
  if (
    pathname === '/auth/passkey/verify-authentication'
  ) {
    return errorResponse(
      id, 401, 'AUTHENTICATION_FAILED', 'Passkey authentication failed.',
    );
  }
  if (response.status >= 500) {
    return errorResponse(
      id, 503, 'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable.', true,
    );
  }
  if (pathname === '/auth/passkey/verify-registration') {
    return errorResponse(
      id, response.status === 401 || response.status === 403 ? 403 : 400,
      'PASSKEY_REGISTRATION_FAILED', 'Passkey registration failed.',
    );
  }
  const status = response.status === 401 || response.status === 403 || response.status === 429
    ? response.status
    : 400;
  return errorResponse(
    id,
    status,
    status === 429 ? 'RATE_LIMITED' : 'AUTHENTICATION_FAILED',
    status === 429
      ? 'Too many requests. Please try again later.'
      : 'Authentication failed.',
    status === 429,
    status === 429 && response.headers.get('retry-after')
      ? { 'retry-after': response.headers.get('retry-after') as string }
      : undefined,
  );
}

async function responseUserId(response: Response): Promise<string | null> {
  if (!response.ok) return null;
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== 'object') return null;
    const user = (body as { user?: unknown }).user;
    if (!user || typeof user !== 'object') return null;
    const id = (user as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

async function responsePasskeyId(response: Response): Promise<string | null> {
  if (!response.ok) return null;
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== 'object') return null;
    const id = (body as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function createIdentityAuth(
  env: Env,
  dependencies: IdentityAuthDependencies = {},
): IdentityAuth {
  validateIdentityEnvironment(env);
  const magicLinkTtl = positiveInteger(env.MAGIC_LINK_TTL_SECONDS, 'MAGIC_LINK_TTL_SECONDS');
  const emailRateLimitMax = positiveInteger(env.EMAIL_RATE_LIMIT_MAX, 'EMAIL_RATE_LIMIT_MAX');
  const emailRateLimitWindow = positiveInteger(
    env.EMAIL_RATE_LIMIT_WINDOW_SECONDS,
    'EMAIL_RATE_LIMIT_WINDOW_SECONDS',
  );
  const publicOrigin = new URL(env.PUBLIC_APP_ORIGIN).origin;
  const email = dependencies.emailAdapter ?? createIdentityEmailAdapter({
    mode: env.EMAIL_MODE,
    database: env.AUTH_DB,
    allowedRecipients: parseAllowedRecipients(env.STAGING_ALLOWED_RECIPIENTS),
    ...(env.RESEND_API_KEY === undefined ? {} : { resendApiKey: env.RESEND_API_KEY }),
    ...(env.RESEND_FROM === undefined ? {} : { resendFrom: env.RESEND_FROM }),
  });
  let deliveryState: {
    correlationId: string;
    userId: string | null;
  } | null = null;
  let passkeyAuthorization: PasskeyAuthorization | null = null;
  // createIdentityAuth is instantiated per private RPC invocation. This grant is
  // held only across one Better Auth testUtils.login call and never exposed as a route.
  let fixtureUserGrant: string | null = null;
  // The native SQLite adapter defaults to ISO dates. Only the immutable control
  // grant writes millisecond session dates required by the existing v2 triggers;
  // ordinary sessions keep their current encoding. Both encodings resolve to Date.
  const sessionDate = {
    type:'date',required:true,input:false,
    transform:{
      input(value) { return dependencies.controlGrant && value instanceof Date ? value.getTime() : value; },
      output(value) { return typeof value==='number' || typeof value==='string' ? new Date(value) : value; },
    },
  } satisfies NonNullable<NonNullable<BetterAuthOptions['session']>['additionalFields']>[string];
  const auth = betterAuth({
    appName: 'Incentives Operator',
    database: env.AUTH_DB,
    baseURL: publicOrigin,
    basePath: '/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [publicOrigin],
    emailAndPassword: { enabled: false, disableSignUp: true },
    session: {
      storeSessionInDatabase: true,
      cookieCache: { enabled: false },
      additionalFields: {
        createdAt:{ ...sessionDate,defaultValue:() => new Date() },
        updatedAt:{ ...sessionDate,onUpdate:() => new Date() },
        expiresAt:sessionDate,
        authenticationMethod: {
          type: 'string', required: true, input: false, returned: true,
        },
        authenticatedAt: {
          type: 'number', required: true, input: false, returned: true, bigint: true,
        },
        recoveryOnly: {
          type: 'boolean', required: true, input: false, returned: true,
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: emailRateLimitWindow,
      max: 100,
      customRules: {
        '/sign-in/magic-link': { window: emailRateLimitWindow, max: emailRateLimitMax },
      },
    },
    advanced: {
      cookiePrefix: env.COOKIE_PREFIX,
      useSecureCookies: publicOrigin.startsWith('https://'),
      defaultCookieAttributes: {
        httpOnly: true,
        secure: publicOrigin.startsWith('https://'),
        sameSite: 'lax',
        path: '/',
      },
      crossSubDomainCookies: { enabled: false },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    logger: { disabled: true },
    databaseHooks: {
      user: { create: { before: async () => false } },
      session: {
        create: {
          before: async (session, context) => {
            const grant = dependencies.controlGrant;
            const method = fixtureUserGrant === session.userId && (env.APP_ENV === 'staging' || env.APP_ENV === 'ci' || (grant && businessControlRuntime(env)))
              ? 'e2e-fixture' : authenticationMethodForPath(context?.path ?? '');
            const allowed = method === 'passkey'
              ? await isPasskeyAuthorizationCurrent(env, passkeyAuthorization, session.userId)
              : method === 'e2e-fixture' ? true
                : method !== null && await isSessionCreationAllowed(env, session.userId, method);
            if (!method || !allowed) {
              return false;
            }
            return {
              data: {
                ...session,
                ...(method === 'e2e-fixture'
                  ? { ...(grant ? { id: grant.sessionId } : {}), expiresAt: new Date(Math.min(session.createdAt.getTime() + 900_000, grant?.lease.expiresAt ?? Infinity)) } : {}),
                authenticationMethod: method,
                authenticatedAt: method === 'passkey'
                  ? Math.max(Date.now(), (passkeyAuthorization?.recoveryFence ?? 0) + 1)
                  : Date.now(),
                recoveryOnly: false,
              },
            };
          },
          after: async (session, context) => {
            const method = authenticationMethodForPath(context?.path ?? '');
            if (!method) return;
            const id = context?.headers?.get('x-correlation-id') ?? crypto.randomUUID();
            if (
              method === 'passkey'
              && !await isPasskeyAuthorizationCurrent(env, passkeyAuthorization, session.userId)
            ) {
              await env.AUTH_DB.prepare('DELETE FROM session WHERE id = ?1').bind(session.id).run();
              await writeAudit(env, id, {
                actorKind: 'root', actorId: session.userId,
                action: 'session.creation_denied', targetType: 'session',
                targetId: session.id, outcome: 'denied',
              });
              throw new Error('PASSKEY_SESSION_AUTHORIZATION_STALE');
            }
          },
        },
        delete: {
          after: async (session, context) => {
            await writeAudit(
              env,
              context?.headers?.get('x-correlation-id') ?? crypto.randomUUID(),
              {
                actorKind: 'system', actorId: session.userId, action: 'session.revoked',
                targetType: 'session', targetId: session.id, outcome: 'succeeded',
              },
            );
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: magicLinkTtl,
        disableSignUp: true,
        storeToken: 'hashed',
        rateLimit: { window: emailRateLimitWindow, max: emailRateLimitMax },
        async sendMagicLink(data) {
          const state = deliveryState;
          if (!state?.userId) return;
          const userId = state.userId;
          const delivery = email.send({
            to: data.email.trim().toLowerCase(),
            subject: 'Sign in to Incentives Operator',
            text: `Use this single-use link to sign in. It expires shortly.\n${data.url}`,
          }).then(async () => {
            await writeAudit(env, state.correlationId, {
              actorKind: 'system', actorId: 'identity', action: 'magic_link.delivery',
              targetType: 'user', targetId: userId, outcome: 'succeeded',
            });
          }).catch(async () => {
            await writeAudit(env, state.correlationId, {
              actorKind: 'system', actorId: 'identity', action: 'magic_link.delivery',
              targetType: 'user', targetId: userId, outcome: 'failed',
            });
          });
          await delivery;
        },
      }),
      passkey({
        rpID: env.PASSKEY_RP_ID,
        rpName: env.PASSKEY_RP_NAME,
        origin: publicOrigin,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        advanced: { webAuthnChallengeCookie: `${env.COOKIE_PREFIX}.passkey_challenge` },
        registration: {
          async afterVerification({ verification }) {
            assertPasskeyUserVerified(verification.registrationInfo?.userVerified === true);
          },
        },
        authentication: {
          async afterVerification({ clientData, verification }) {
            assertPasskeyUserVerified(verification.authenticationInfo.userVerified);
            const profile = await env.AUTH_DB.prepare(`
              SELECT auth_profile.user_id,
                COALESCE((
                  SELECT recovery_flow.id FROM recovery_flow
                  WHERE recovery_flow.user_id = auth_profile.user_id
                  ORDER BY recovery_flow.rowid DESC LIMIT 1
                ), '') AS recovery_generation,
                COALESCE((
                  SELECT MAX(recovery_flow.completed_at) FROM recovery_flow
                  WHERE recovery_flow.user_id = auth_profile.user_id
                ), 0) AS recovery_fence
              FROM passkey
              INNER JOIN auth_profile ON auth_profile.user_id = passkey.userId
              WHERE passkey.credentialID = ?1
                AND auth_profile.subject_kind = 'root'
                AND auth_profile.status = 'active'
                AND NOT EXISTS (
                  SELECT 1 FROM recovery_flow
                  WHERE recovery_flow.user_id = auth_profile.user_id
                    AND recovery_flow.completed_at IS NULL
                    AND recovery_flow.cancelled_at IS NULL
                )
            `).bind(clientData.id).first<{
              user_id: string;
              recovery_generation: string;
              recovery_fence: number;
            }>();
            if (!profile) throw new Error('Passkey authentication is not permitted');
            passkeyAuthorization = {
              credentialId: clientData.id,
              userId: profile.user_id,
              recoveryGeneration: profile.recovery_generation,
              recoveryFence: profile.recovery_fence,
            };
            await dependencies.afterPasskeyAuthorization?.({
              credentialId: clientData.id,
              userId: profile.user_id,
            });
          },
        },
      }),
      // Better Auth's testUtils declaration permits `init().options` to be
      // undefined under exactOptionalPropertyTypes; the runtime plugin is valid.
      ...((env.APP_ENV === 'staging' || env.APP_ENV === 'ci') ? [testUtils() as unknown as BetterAuthPlugin] : []),
    ],
  });

  const resolveSession = async (headers: Headers): Promise<{
    session: CurrentSession;
    invalid: boolean;
  }> => {
    const context = await auth.$context;
    const signed = (headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(context.authCookies.sessionToken.name+'='));
    const token = signed?.slice(context.authCookies.sessionToken.name.length+1).split('.')[0];
    const presented = token ? await env.AUTH_DB.prepare('SELECT id FROM session WHERE token=?1').bind(token).first<{ id:string }>() : null;
    const controlled = presented && await isControlSession(env.AUTH_DB,presented.id) ? presented : null;
    if (controlled && !await getSessionAccess(env,controlled.id)) return { session:null,invalid:true };
    let session;
    try { session = await auth.api.getSession({ headers, ...(controlled ? { query: { disableRefresh: true } } : {}) }); }
    catch (error) { if (controlled) return { session:null,invalid:true }; throw error; }
    if (!session) return { session: null, invalid: false };
    const current = session as unknown as NonNullable<CurrentSession>;
    const access = await getSessionAccess(env, current.session.id);
    if (access) {
      return { invalid: false, session: {
        session: {
          ...current.session,
          authenticationMethod: access.authenticationMethod,
          authenticatedAt: access.authenticatedAt,
          recoveryOnly: access.recoveryOnly === 1,
        },
        user: current.user,
      } };
    }
    if (controlled) return { session:null,invalid:true };
    await env.AUTH_DB.prepare('DELETE FROM session WHERE id = ?1')
      .bind(current.session.id).run();
    await writeAudit(env, crypto.randomUUID(), {
      actorKind: 'system', actorId: current.session.userId, action: 'session.denied',
      targetType: 'session', targetId: current.session.id, outcome: 'denied',
    });
    return { session: null, invalid: true };
  };

  const getSession = async (headers: Headers): Promise<CurrentSession> => {
    assertCiStack(env);
    return (await resolveSession(headers)).session;
  };

  return {
    getSession,
    async createFixtureSession(input) {
      assertCiStack(env);
      const grant = dependencies.controlGrant;
      if (env.APP_ENV !== 'ci' && env.APP_ENV !== 'staging' && !(grant && businessControlRuntime(env))) throw new Error('E2E fixture sessions are staging-only');
      if (fixtureUserGrant !== null) throw new Error('E2E fixture session creation is busy');
      const owned = await env.AUTH_DB.prepare(`
        SELECT memberships.id
        FROM memberships
        JOIN organizations ON organizations.id = memberships.organization_id
        JOIN e2e_run_claims ON e2e_run_claims.merchant_id = organizations.merchant_id
        JOIN user ON user.id = memberships.user_id
        JOIN auth_profile ON auth_profile.user_id = user.id
        WHERE memberships.user_id = ?1 AND e2e_run_claims.run_id = ?2
          AND e2e_run_claims.merchant_id = ?3 AND e2e_run_claims.status = 'active'
          AND organizations.status = 'active' AND memberships.status = 'active'
          AND auth_profile.subject_kind = 'employee' AND auth_profile.status = 'active'
          AND auth_profile.email_login_enabled = 0
          AND substr(user.email, 1, length('e2e+' || e2e_run_claims.run_id || '_'))
            = 'e2e+' || e2e_run_claims.run_id || '_'
          AND substr(user.email, -12) = '@e2e.invalid'
      `).bind(input.userId, input.runId, input.merchantId).first();
      if (!owned) throw new Error('E2E fixture session user is not run-owned');
      fixtureUserGrant = input.userId;
      try {
        if (grant) {
          if (grant.userId !== input.userId || grant.lease.runId !== input.runId || grant.lease.merchantId !== input.merchantId) throw new Error('E2E_CONTROL_FORBIDDEN');
          const context = await auth.$context;
          const session = await context.internalAdapter.createSession(input.userId);
          if (!session || session.id !== grant.sessionId) throw new Error('E2E_CONTROL_SESSION');
          const issuedAt = session.createdAt.getTime();
          await withControlWrite(env.AUTH_DB,controlRuntime(env),grant.lease,'provision',[
            env.AUTH_DB.prepare(`INSERT INTO e2e_fixture_sessions (session_id,user_id,run_id,merchant_id,issued_at,hard_expires_at)
              VALUES (?1,?2,?3,?4,?5,?6)`).bind(session.id,input.userId,input.runId,input.merchantId,issuedAt,issuedAt+900000),
          ]);
          const cookie = context.authCookies.sessionToken;
          if (cookie.attributes.path !== '/' || cookie.attributes.httpOnly !== true || cookie.attributes.sameSite !== 'lax' || cookie.attributes.domain !== undefined) throw new Error('E2E_CONTROL_INCOMPATIBLE');
          return { sessionId:session.id,cookieHeader:cookie.name+'='+session.token+'.'+await makeSignature(session.token,context.secret),
            cookieAttributes:{ name:cookie.name,path:'/',httpOnly:true,secure:cookie.attributes.secure === true,sameSite:'Lax',expiresAt:Math.min(grant.lease.expiresAt,issuedAt+900000) } };
        }
        const context = await auth.$context as typeof auth.$context extends Promise<infer T>
          ? T & { test?: { login(input: { userId: string }): Promise<{
            session: { id: string } | null; headers: Headers;
          }> } } : never;
        if (!context.test) throw new Error('Better Auth fixture helper is unavailable');
        const result = await context.test.login({ userId: input.userId });
        const cookieHeader = result.headers.get('cookie');
        if (!result.session || !cookieHeader) throw new Error('Better Auth fixture session failed');
        const issuedAt = Date.now();
        await env.AUTH_DB.prepare(`
          INSERT INTO e2e_fixture_sessions
            (session_id, user_id, run_id, merchant_id, issued_at, hard_expires_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `).bind(result.session.id, input.userId, input.runId, input.merchantId,
          issuedAt, issuedAt + 900_000).run();
        return { sessionId: result.session.id, cookieHeader };
      } finally {
        fixtureUserGrant = null;
      }
    },
    async handler(request, executionContext) {
      assertCiStack(env);
      const pathname = new URL(request.url).pathname;
      const id = correlationId(request);
      if (pathname === '/auth/sign-in/magic-link' && request.method === 'POST') {
        return handleMagicLinkRequest(
          request,
          env,
          async (authRequest, state) => {
            deliveryState = state;
            try {
              return await auth.handler(authRequest);
            } finally {
              deliveryState = null;
            }
          },
          executionContext,
          emailRateLimitWindow,
          emailRateLimitMax,
          dependencies.beforeMagicLinkEmployeeLookup,
        );
      }

      if (pathname === '/auth/passkey/verify-authentication') {
        passkeyAuthorization = null;
      }

      const presentedSessionCookie = hasSessionCookie(request.headers, env);
      const resolved = await resolveSession(request.headers);
      const current = resolved.session;
      const access = current ? await getSessionAccess(env, current.session.id) : null;
      if (presentedSessionCookie && resolved.invalid) {
        return errorResponse(id, 401, 'SESSION_INVALID', 'The session is invalid.');
      }
      if (access?.recoveryOnly === 1 && !recoverySessionAllows(pathname, request.method)) {
        return errorResponse(
          id, 403, 'RECOVERY_RESTRICTED', 'Recovery sessions cannot access this resource.',
        );
      }
      if (isPasskeyManagementPath(pathname) && access?.subjectKind !== 'root') {
        return errorResponse(
          id, 403, 'ROOT_PASSKEY_REQUIRED', 'Root authentication is required.',
        );
      }
      if (
        pathname === '/auth/passkey/generate-authenticate-options'
        && request.method === 'GET'
      ) {
        return normalizePasskeyAuthenticationOptionsResponse(await auth.handler(request), id);
      }

      if (
        pathname === '/auth/sign-out'
        && request.method === 'POST'
        && access?.recoveryOnly === 1
      ) {
        await cancelRecoverySession(env, access.sessionId, id);
        return Response.json({ success: true }, {
          status: 200,
          headers: {
            'set-cookie': expiredSessionCookieHeader(env),
            'x-correlation-id': id,
          },
        });
      }

      const controlledSession = current && access?.authenticationMethod === 'e2e-fixture'
        && await isControlSession(env.AUTH_DB,current.session.id);
      let authRequest = request;
      if (controlledSession && pathname === '/auth/get-session') {
        const url = new URL(request.url);
        url.searchParams.set('disableRefresh','true');
        authRequest = new Request(url,request);
      }
      const response = await auth.handler(authRequest);
      if (controlledSession && current && !await getSessionAccess(env,current.session.id)) {
        return errorResponse(id,401,'SESSION_INVALID','The session is invalid.');
      }
      const passkeyAuthorizationCurrent =
        pathname === '/auth/passkey/verify-authentication'
        && !response.ok
        && passkeyAuthorization !== null
        && await isPasskeyAuthorizationCurrent(
          env, passkeyAuthorization, passkeyAuthorization.userId,
        );
      const passkeyAuthenticationInfrastructureFailure =
        pathname === '/auth/passkey/verify-authentication'
        && !response.ok
        && passkeyAuthorization !== null
        && await classifyPasskeyAuthenticationInfrastructureFailure(
          response,
          passkeyAuthorizationCurrent,
        );
      if (pathname === '/auth/passkey/verify-registration') {
        if (response.ok && access?.recoveryOnly === 1) {
          const passkeyId = await responsePasskeyId(response);
          if (!passkeyId) {
            await cancelRecoverySession(env, access.sessionId, id, 'passkey-mark-failed');
            throw new Error('RECOVERY_PASSKEY_ID_MISSING');
          }
          try {
            await markReplacementPasskeyRegistered(env, access.sessionId, passkeyId, id);
          } catch (error) {
            await cancelRecoverySession(
              env, access.sessionId, id, 'passkey-mark-failed', passkeyId,
            );
            throw error;
          }
        }
        if (!response.ok) {
          await writeAudit(env, id, {
            actorKind: access?.subjectKind === 'root' ? 'root' : 'anonymous',
            actorId: access?.userId ?? 'anonymous',
            action: 'passkey.registration',
            targetType: 'authentication',
            targetId: 'passkey',
            outcome: response.status >= 500 ? 'failed' : 'denied',
          });
        }
      }
      if (pathname === '/auth/passkey/verify-authentication') {
        const actorId = passkeyAuthenticationInfrastructureFailure
          ? passkeyAuthorization?.userId ?? null
          : await responseUserId(response);
        await writeAudit(env, id, {
          actorKind: response.ok || passkeyAuthenticationInfrastructureFailure
            ? 'root'
            : 'anonymous',
          actorId: actorId ?? 'anonymous',
          action: 'passkey.authentication',
          targetType: 'authentication',
          targetId: 'passkey',
          outcome: response.ok
            ? 'succeeded'
            : passkeyAuthenticationInfrastructureFailure ? 'failed' : 'denied',
        });
      }
      if (pathname.includes('/magic-link/verify')) {
        const location = response.headers.get('location');
        const denied = response.status >= 400 || (location?.includes('error=') ?? false);
        await writeAudit(env, id, {
          actorKind: denied ? 'anonymous' : 'member',
          actorId: await responseUserId(response) ?? 'anonymous',
          action: 'magic_link.verification',
          targetType: 'authentication', targetId: 'magic-link',
          outcome: response.status >= 500 ? 'failed' : denied ? 'denied' : 'succeeded',
        });
      }
      return normalizedAuthResponse(
        response,
        id,
        pathname,
        passkeyAuthenticationInfrastructureFailure,
      );
    },
  };
}
