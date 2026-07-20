import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

import { createIdentityEmailAdapter } from './email.js';
import type { Env } from './worker.js';

export type AuthenticationMethod = 'magic-link' | 'passkey' | 'recovery-code';

export interface IdentityAuth {
  handler(request: Request): Promise<Response>;
}

interface RateLimitRow {
  count: number;
  lastRequest: number;
}

const genericMagicLinkResponse = () => Response.json({ ok: true }, { status: 202 });

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

async function consumeEmailRateLimit(
  env: Env,
  request: Request,
  windowSeconds: number,
  max: number,
): Promise<Response | null> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'no-trusted-ip';
  const key = `identity-email:${ip}`;
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
  return Response.json(
    { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    { status: 429, headers: { 'x-retry-after': retryAfter.toString() } },
  );
}

async function isKnownEmployee(env: Env, email: string): Promise<boolean> {
  const row = await env.AUTH_DB.prepare(`
    SELECT user.id
    FROM user
    INNER JOIN auth_profile ON auth_profile.user_id = user.id
    WHERE user.email = ?1
      AND auth_profile.subject_kind = 'employee'
      AND auth_profile.status = 'active'
      AND auth_profile.email_login_enabled = 1
  `).bind(email).first<{ id: string }>();
  return row !== null;
}

async function handleMagicLinkRequest(
  request: Request,
  env: Env,
  authHandler: (request: Request) => Promise<Response>,
  windowSeconds: number,
  max: number,
): Promise<Response> {
  const rateLimitResponse = await consumeEmailRateLimit(env, request, windowSeconds, max);
  if (rateLimitResponse) return rateLimitResponse;

  let email: string;
  try {
    const body: unknown = await request.clone().json();
    if (!body || typeof body !== 'object' || typeof (body as { email?: unknown }).email !== 'string') {
      return Response.json({ code: 'INVALID_REQUEST', message: 'A valid email is required.' }, { status: 400 });
    }
    email = (body as { email: string }).email.trim().toLowerCase();
  } catch {
    return Response.json({ code: 'INVALID_REQUEST', message: 'A valid email is required.' }, { status: 400 });
  }

  try {
    if (await isKnownEmployee(env, email)) {
      await authHandler(request);
    }
  } catch {
    // Authentication and delivery failures fail closed. The public response is
    // deliberately unchanged so it cannot be used to enumerate employees.
  }
  return genericMagicLinkResponse();
}

async function isRootSession(
  env: Env,
  getSession: (headers: Headers) => Promise<{ user: { id: string } } | null>,
  request: Request,
): Promise<boolean> {
  const current = await getSession(request.headers);
  if (!current) return false;
  const profile = await env.AUTH_DB.prepare(`
    SELECT user_id
    FROM auth_profile
    WHERE user_id = ?1 AND subject_kind = 'root' AND status = 'active'
  `).bind(current.user.id).first<{ user_id: string }>();
  return profile !== null;
}

function isPasskeyManagementPath(pathname: string): boolean {
  if (!pathname.startsWith('/auth/passkey/')) return false;
  return pathname !== '/auth/passkey/generate-authenticate-options'
    && pathname !== '/auth/passkey/verify-authentication';
}

export function createIdentityAuth(env: Env): IdentityAuth {
  const magicLinkTtl = positiveInteger(env.MAGIC_LINK_TTL_SECONDS, 'MAGIC_LINK_TTL_SECONDS');
  const emailRateLimitMax = positiveInteger(env.EMAIL_RATE_LIMIT_MAX, 'EMAIL_RATE_LIMIT_MAX');
  const emailRateLimitWindow = positiveInteger(
    env.EMAIL_RATE_LIMIT_WINDOW_SECONDS,
    'EMAIL_RATE_LIMIT_WINDOW_SECONDS',
  );
  const publicOrigin = new URL(env.PUBLIC_APP_ORIGIN).origin;
  const email = createIdentityEmailAdapter({
    mode: env.EMAIL_MODE,
    database: env.AUTH_DB,
    allowedRecipients: parseAllowedRecipients(env.STAGING_ALLOWED_RECIPIENTS),
    ...(env.RESEND_API_KEY === undefined ? {} : { resendApiKey: env.RESEND_API_KEY }),
    ...(env.RESEND_FROM === undefined ? {} : { resendFrom: env.RESEND_FROM }),
  });
  const auth = betterAuth({
    appName: 'Incentives Operator',
    database: env.AUTH_DB,
    baseURL: publicOrigin,
    basePath: '/auth',
    secret: env.AUTH_SECRET,
    trustedOrigins: [publicOrigin],
    emailAndPassword: {
      enabled: false,
      disableSignUp: true,
    },
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
        '/sign-in/magic-link': {
          window: emailRateLimitWindow,
          max: emailRateLimitMax,
        },
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
      user: {
        create: {
          before: async () => false,
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: magicLinkTtl,
        disableSignUp: true,
        storeToken: 'hashed',
        rateLimit: {
          window: emailRateLimitWindow,
          max: emailRateLimitMax,
        },
        async sendMagicLink(data) {
          await email.send({
            to: data.email,
            subject: 'Sign in to Incentives Operator',
            text: `Use this single-use link to sign in. It expires shortly.\n${data.url}`,
          });
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
        advanced: {
          webAuthnChallengeCookie: `${env.COOKIE_PREFIX}.passkey_challenge`,
        },
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

  return {
    async handler(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/auth/sign-in/magic-link' && request.method === 'POST') {
        return handleMagicLinkRequest(
          request,
          env,
          auth.handler,
          emailRateLimitWindow,
          emailRateLimitMax,
        );
      }
      if (
        pathname === '/auth/passkey/generate-authenticate-options'
        && request.method === 'GET'
      ) {
        return requirePasskeyUserVerification(await auth.handler(request));
      }
      if (isPasskeyManagementPath(pathname) && !await isRootSession(
        env,
        headers => auth.api.getSession({ headers }),
        request,
      )) {
        return Response.json(
          { code: 'ROOT_PASSKEY_REQUIRED', message: 'Root authentication is required.' },
          { status: 403 },
        );
      }
      return auth.handler(request);
    },
  };
}
