import type { MiddlewareHandler } from 'hono';

import type { AppEnvironment, Env } from '../env.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';

export const SEEDED_MERCHANT_ID = 'phase-0-merchant';

type CredentialKind = 'publishable' | 'secret';

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;

  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function credentialKind(env: Env, token: string): CredentialKind | null {
  if (env.SECRET_TOKEN.length > 0 && token === env.SECRET_TOKEN) return 'secret';
  if (env.PUBLISHABLE_TOKEN.length > 0 && token === env.PUBLISHABLE_TOKEN) return 'publishable';
  return null;
}

function requireCredential(required: CredentialKind): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const token = bearerToken(context.req.header('authorization'));
    const kind = token === null ? null : credentialKind(context.env, token);

    if (kind === null) throw new UnauthorizedError();
    if (required === 'secret' && kind !== 'secret') throw new ForbiddenError();

    context.set('merchantId', SEEDED_MERCHANT_ID);
    await next();
  };
}

export const requirePublishable = requireCredential('publishable');
export const requireSecret = requireCredential('secret');
