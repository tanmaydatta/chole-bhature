import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

import { createIdentityEmailAdapter, type EmailAdapter } from './email.js';
import {
  cancelRecoverySession,
  errorResponse,
  expiredSessionCookieHeader,
  markReplacementPasskeyRegistered,
  writeIdentityAudit,
} from './recovery.js';
import type { Env } from './worker.js';

export type AuthenticationMethod = 'magic-link' | 'passkey' | 'recovery';

export interface IdentityAuth {
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
  emailAdapter?: EmailAdapter;
  afterPasskeyAuthorization?: (
    input: { credentialId: string; userId: string },
  ) => Promise<void>;
  beforeMagicLinkBackgroundWork?: (
    input: { kind: 'known' | 'unknown' },
  ) => Promise<void>;
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
  if (env.APP_ENV !== 'local' && env.APP_ENV !== 'staging') {
    throw new Error('APP_ENV must be local or staging');
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
    actorKind: 'anonymous' | 'employee' | 'root' | 'system';
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
  beforeBackgroundWork?: IdentityAuthDependencies['beforeMagicLinkBackgroundWork'],
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

  const employee = await findKnownEmployee(env, email);
  await writeAudit(env, requestCorrelationId, {
    actorKind: 'anonymous', actorId: 'anonymous', action: 'magic_link.requested',
    targetType: 'authentication', targetId: 'magic-link', outcome: 'succeeded',
  });
  const backgroundWork = async () => {
    try {
      await beforeBackgroundWork?.({ kind: employee ? 'known' : 'unknown' });
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

async function getSessionAccess(env: Env, sessionId: string): Promise<SessionAccess | null> {
  return env.AUTH_DB.prepare(`
    SELECT session.id AS sessionId, session.userId AS userId,
      auth_profile.subject_kind AS subjectKind,
      session.authenticationMethod, session.authenticatedAt,
      session.recoveryOnly
    FROM session
    INNER JOIN auth_profile ON auth_profile.user_id = session.userId
    WHERE session.id = ?1 AND session.expiresAt > ?2
      AND session.authenticationMethod IN ('magic-link', 'passkey', 'recovery')
      AND session.authenticatedAt IS NOT NULL
      AND session.recoveryOnly IN (0, 1)
      AND auth_profile.status = 'active'
      AND (
        (
          session.authenticationMethod = 'magic-link'
          AND session.recoveryOnly = 0
          AND auth_profile.subject_kind = 'employee'
          AND auth_profile.email_login_enabled = 1
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
  `).bind(sessionId, Date.now()).first<SessionAccess>();
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
): Promise<Response> {
  if (response.status < 400) return response;
  if (pathname === '/auth/passkey/verify-authentication') {
    return errorResponse(
      id, 401, 'AUTHENTICATION_FAILED', 'Passkey authentication failed.',
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
            const method = authenticationMethodForPath(context?.path ?? '');
            const allowed = method === 'passkey'
              ? await isPasskeyAuthorizationCurrent(env, passkeyAuthorization, session.userId)
              : method !== null && await isSessionCreationAllowed(env, session.userId, method);
            if (!method || !allowed) {
              return false;
            }
            return {
              data: {
                ...session,
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
            await writeAudit(env, id, {
              actorKind: method === 'passkey' ? 'root' : 'employee',
              actorId: session.userId,
              action: 'session.created',
              targetType: 'session',
              targetId: session.id,
              outcome: 'succeeded',
            });
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
    ],
  });

  const resolveSession = async (headers: Headers): Promise<{
    session: CurrentSession;
    invalid: boolean;
  }> => {
    const session = await auth.api.getSession({ headers });
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
    await env.AUTH_DB.prepare('DELETE FROM session WHERE id = ?1')
      .bind(current.session.id).run();
    await writeAudit(env, crypto.randomUUID(), {
      actorKind: 'system', actorId: current.session.userId, action: 'session.denied',
      targetType: 'session', targetId: current.session.id, outcome: 'denied',
    });
    return { session: null, invalid: true };
  };

  const getSession = async (headers: Headers): Promise<CurrentSession> =>
    (await resolveSession(headers)).session;

  return {
    getSession,
    async handler(request, executionContext) {
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
          dependencies.beforeMagicLinkBackgroundWork,
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
        return requirePasskeyUserVerification(await auth.handler(request));
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

      const response = await auth.handler(request);
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
        await writeAudit(env, id, {
          actorKind: access?.subjectKind === 'root' ? 'root' : 'anonymous',
          actorId: access?.userId ?? 'anonymous',
          action: 'passkey.registration',
          targetType: 'authentication',
          targetId: 'passkey',
          outcome: response.ok ? 'succeeded' : 'denied',
        });
      }
      if (pathname === '/auth/passkey/verify-authentication') {
        const actorId = await responseUserId(response);
        await writeAudit(env, id, {
          actorKind: response.ok ? 'root' : 'anonymous',
          actorId: actorId ?? 'anonymous',
          action: 'passkey.authentication',
          targetType: 'authentication',
          targetId: 'passkey',
          outcome: response.ok ? 'succeeded' : 'denied',
        });
      }
      if (pathname.includes('/magic-link/verify')) {
        const location = response.headers.get('location');
        const denied = response.status >= 400 || (location?.includes('error=') ?? false);
        await writeAudit(env, id, {
          actorKind: denied ? 'anonymous' : 'employee',
          actorId: await responseUserId(response) ?? 'anonymous',
          action: 'magic_link.verification',
          targetType: 'authentication', targetId: 'magic-link',
          outcome: denied ? 'denied' : 'succeeded',
        });
      }
      return normalizedAuthResponse(response, id, pathname);
    },
  };
}
