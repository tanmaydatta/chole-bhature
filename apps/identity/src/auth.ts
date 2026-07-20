import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

import { createIdentityEmailAdapter, type EmailAdapter } from './email.js';
import {
  errorResponse,
  markReplacementPasskeyRegistered,
} from './recovery.js';
import type { Env } from './worker.js';

export type AuthenticationMethod = 'magic-link' | 'passkey' | 'recovery';

export interface IdentityAuth {
  handler(request: Request, executionContext?: ExecutionContext): Promise<Response>;
  getSession(headers: Headers): Promise<{
    session: { id: string; userId: string };
    user: { id: string };
  } | null>;
}

export interface IdentityAuthDependencies {
  emailAdapter?: EmailAdapter;
}

interface RateLimitRow {
  count: number;
  lastRequest: number;
}

interface SessionAccess {
  sessionId: string;
  userId: string;
  subjectKind: 'employee' | 'root';
  recoveryOnly: number;
}

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
  try {
    await env.AUTH_DB.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
    `).bind(
      crypto.randomUUID(), Date.now(), input.actorKind, input.actorId, input.action,
      input.targetType, input.targetId, input.outcome, id,
    ).run();
  } catch {
    // Authentication outcomes stay generic even if the safe audit sink fails.
  }
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
      WHERE json_extract(value, '$.email') = (SELECT email FROM user WHERE id = ?1)
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
    WHERE user.email = ?1
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
    delivery: { executionContext?: ExecutionContext; correlationId: string; userId: string | null },
  ) => Promise<Response>,
  executionContext: ExecutionContext | undefined,
  windowSeconds: number,
  max: number,
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
  try {
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== 'object' || typeof (body as { email?: unknown }).email !== 'string') {
      return errorResponse(
        requestCorrelationId, 400, 'INVALID_REQUEST', 'A valid email is required.',
      );
    }
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
  try {
    await authHandler(request, {
      ...(executionContext ? { executionContext } : {}),
      correlationId: requestCorrelationId,
      userId: employee?.id ?? null,
    });
  } catch {
    if (employee) {
      await writeAudit(env, requestCorrelationId, {
        actorKind: 'system', actorId: 'identity', action: 'magic_link.delivery',
        targetType: 'user', targetId: employee.id, outcome: 'failed',
      });
    }
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

async function getSessionAccess(env: Env, sessionId: string): Promise<SessionAccess | null> {
  return env.AUTH_DB.prepare(`
    SELECT session.id AS sessionId, session.userId AS userId,
      auth_profile.subject_kind AS subjectKind,
      COALESCE(session_context.recovery_only, 0) AS recoveryOnly
    FROM session
    INNER JOIN auth_profile ON auth_profile.user_id = session.userId
    LEFT JOIN session_context ON session_context.session_id = session.id
    WHERE session.id = ?1 AND auth_profile.status = 'active'
  `).bind(sessionId).first<SessionAccess>();
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
  const scheduleDelivery = dependencies.emailAdapter !== undefined || env.EMAIL_MODE === 'resend';
  let deliveryState: {
    executionContext?: ExecutionContext;
    correlationId: string;
    userId: string | null;
  } | null = null;
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
            return method !== null && await isSessionCreationAllowed(env, session.userId, method);
          },
          after: async (session, context) => {
            const method = authenticationMethodForPath(context?.path ?? '');
            if (!method) return;
            const id = context?.headers?.get('x-correlation-id') ?? crypto.randomUUID();
            const now = Date.now();
            await env.AUTH_DB.batch([
              env.AUTH_DB.prepare(`
                INSERT INTO session_context (
                  session_id, authentication_method, authenticated_at, recovery_only
                ) VALUES (?1, ?2, ?3, 0)
              `).bind(session.id, method, now),
              env.AUTH_DB.prepare(`
                INSERT INTO identity_audit (
                  id, occurred_at, actor_kind, actor_id, action, target_type,
                  target_id, outcome, correlation_id, metadata_json
                ) VALUES (?1, ?2, ?3, ?4, 'session.created', 'session', ?5,
                  'succeeded', ?6, NULL)
              `).bind(
                crypto.randomUUID(), now, method === 'passkey' ? 'root' : 'employee',
                session.userId, session.id, id,
              ),
            ]);
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
          if (scheduleDelivery && state.executionContext) state.executionContext.waitUntil(delivery);
          else await delivery;
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
              SELECT auth_profile.user_id
              FROM passkey
              INNER JOIN auth_profile ON auth_profile.user_id = passkey.userId
              WHERE passkey.credentialID = ?1
                AND auth_profile.subject_kind = 'root'
                AND auth_profile.status = 'active'
            `).bind(clientData.id).first<{ user_id: string }>();
            if (!profile) throw new Error('Passkey authentication is not permitted');
          },
        },
      }),
    ],
  });

  const getSession = async (headers: Headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session) return null;
    return session as {
      session: { id: string; userId: string };
      user: { id: string };
    };
  };

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
        );
      }

      const current = await getSession(request.headers);
      const access = current ? await getSessionAccess(env, current.session.id) : null;
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

      const response = await auth.handler(request);
      if (pathname === '/auth/passkey/verify-registration') {
        if (response.ok && access?.recoveryOnly === 1) {
          await markReplacementPasskeyRegistered(env, access.sessionId, id);
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
        await writeAudit(env, id, {
          actorKind: response.ok ? 'root' : 'anonymous',
          actorId: response.ok ? 'root' : 'anonymous',
          action: 'passkey.authentication',
          targetType: 'authentication',
          targetId: 'passkey',
          outcome: response.ok ? 'succeeded' : 'denied',
        });
      }
      return response;
    },
  };
}
