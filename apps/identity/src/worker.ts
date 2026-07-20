import { createIdentityAuth, validateIdentityEnvironment } from './auth.js';
import {
  beginRootRecovery,
  errorResponse,
  exchangeRecoveryGrant,
  getRecoverySession,
  reissueRecoveryCodes,
  rotateRecoveryCodes,
  writeIdentityAudit,
} from './recovery.js';

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

function withCorrelationId(request: Request, correlationId: string): Request {
  if (request.headers.get('x-correlation-id')) return request;
  const headers = new Headers(request.headers);
  headers.set('x-correlation-id', correlationId);
  return new Request(request, { headers });
}

function correlated(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('x-correlation-id', correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function signupDisabled(correlationId: string): Response {
  return errorResponse(
    correlationId,
    404,
    'SIGNUP_DISABLED',
    'Self-service signup is unavailable.',
  );
}

export default {
  async fetch(originalRequest, env, executionContext) {
    const correlationId = originalRequest.headers.get('x-correlation-id') ?? crypto.randomUUID();
    const request = withCorrelationId(originalRequest, correlationId);
    try {
      validateIdentityEnvironment(env);
      const url = new URL(request.url);
      let response: Response;
      if (url.pathname.startsWith('/auth/sign-up/')) {
        response = signupDisabled(correlationId);
      } else if (url.pathname === '/auth/root/recovery' && request.method === 'POST') {
        response = await beginRootRecovery(request, env, correlationId);
      } else if (
        url.pathname === '/auth/root/recovery/exchange'
        && request.method === 'POST'
      ) {
        response = await exchangeRecoveryGrant(request, env, correlationId);
      } else if (
        url.pathname === '/auth/root/recovery/rotate-codes'
        && request.method === 'POST'
      ) {
        const identity = createIdentityAuth(env);
        const session = await identity.getSession(request.headers);
        const recovery = session
          ? await getRecoverySession(env, session.session.id)
          : null;
        if (recovery) {
          response = await rotateRecoveryCodes(env, recovery.sessionId, correlationId);
        } else if (
          session?.session.authenticationMethod === 'passkey'
          && session.session.recoveryOnly === false
        ) {
          response = await reissueRecoveryCodes(env, session.user.id, correlationId);
        } else {
          response = errorResponse(
              correlationId,
              403,
              'RECOVERY_RESTRICTED',
              'A recovery session or verified root passkey is required.',
            );
        }
      } else {
        const identity = createIdentityAuth(env);
        response = await identity.handler(request, executionContext);
      }
      return correlated(response, correlationId);
    } catch {
      await writeIdentityAudit(env, correlationId, {
        actorKind: 'system', actorId: 'identity', action: 'identity.worker_failure',
        targetType: 'identity', targetId: 'worker', outcome: 'failed',
      });
      return errorResponse(
        correlationId,
        503,
        'IDENTITY_UNAVAILABLE',
        'Identity is temporarily unavailable.',
        true,
      );
    }
  },
} satisfies ExportedHandler<Env>;
