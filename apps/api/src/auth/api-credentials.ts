import type {
  ApiCredentialKind,
  ApiCredentialScope,
} from '@incentives/contracts';
import type { MiddlewareHandler } from 'hono';

import type { AppEnvironment } from '../env.js';
import { ForbiddenError, RateLimitError, UnauthorizedError } from '../errors.js';

const encoder = new TextEncoder();

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const match = /^Bearer[ \t]+((?:pk|sk)_[A-Za-z0-9_-]{32,256})$/u.exec(authorization);
  return match?.[1] ?? null;
}

async function digest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function requireCredential(
  requiredKind: ApiCredentialKind | 'publishable-or-secret',
  requiredScope?: ApiCredentialScope,
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const token = bearerToken(context.req.header('authorization'));
    if (token === null) throw new UnauthorizedError();

    const repositories = context.get('repositories');
    const authentication = await repositories.credentials.authenticateByDigest(await digest(token));
    if (authentication === null) throw new UnauthorizedError();
    const { credential, allowedOrigins } = authentication;
    const merchant = await repositories.merchants.get(credential.merchantId);
    const expired = credential.expiresAt !== undefined
      && Date.parse(credential.expiresAt) <= Date.now();
    if (credential.status !== 'active' || expired || merchant?.status !== 'active') {
      throw new UnauthorizedError();
    }
    if (requiredKind === 'secret' && credential.kind !== 'secret') throw new ForbiddenError();
    if (requiredScope !== undefined && !credential.scopes.includes(requiredScope)) {
      throw new ForbiddenError();
    }

    const origin = context.req.header('origin');
    if (credential.kind === 'publishable' && origin !== undefined) {
      if (!allowedOrigins.includes(origin)) throw new ForbiddenError();
      context.header('Access-Control-Allow-Origin', origin);
      context.header('Vary', 'Origin');
    }

    if (credential.kind === 'publishable') {
      const checkedAt = Date.now();
      const windowStartedAt = Math.floor(checkedAt / 60_000) * 60_000;
      const allowed = await repositories.credentials.consumePublishableRateLimit(
        credential.id,
        credential.requestsPerMinute,
        windowStartedAt,
      );
      if (!allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((windowStartedAt + 60_000 - checkedAt) / 1_000),
        );
        throw new RateLimitError(retryAfterSeconds);
      }
    }

    context.set('merchantId', credential.merchantId);
    context.set('credentialId', credential.id);
    await repositories.credentials.markUsed(credential.id, new Date().toISOString());
    await next();
  };
}

export const requirePublishable = requireCredential('publishable-or-secret');
export const requireSecret = requireCredential('secret');

export function requirePublishableScope(scope: ApiCredentialScope): MiddlewareHandler<AppEnvironment> {
  return requireCredential('publishable-or-secret', scope);
}

export function requireSecretScope(scope: ApiCredentialScope): MiddlewareHandler<AppEnvironment> {
  return requireCredential('secret', scope);
}

export function publishablePreflight(
  scope: ApiCredentialScope,
  method: 'GET' | 'POST',
  allowedHeaders: readonly ('Authorization' | 'Content-Type')[],
): MiddlewareHandler<AppEnvironment> {
  return async (context) => {
    const origin = context.req.header('origin');
    const requestedMethod = context.req.header('access-control-request-method');
    const requestedHeaders = new Set(
      (context.req.header('access-control-request-headers') ?? '')
        .split(',')
        .map(header => header.trim().toLowerCase())
        .filter(header => header.length > 0),
    );
    const requiredHeaders = allowedHeaders.map(header => header.toLowerCase());
    if (
      origin === undefined
      || requestedMethod !== method
      || requiredHeaders.some(header => !requestedHeaders.has(header))
      || requestedHeaders.size !== requiredHeaders.length
      || !await context.get('repositories').credentials.hasAllowedPublishableOrigin(
        origin,
        scope,
        new Date().toISOString(),
      )
    ) {
      throw new ForbiddenError();
    }

    context.header('Access-Control-Allow-Origin', origin);
    context.header('Access-Control-Allow-Methods', method);
    context.header('Access-Control-Allow-Headers', allowedHeaders.join(', '));
    context.header(
      'Vary',
      'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    );
    return context.body(null, 204);
  };
}
