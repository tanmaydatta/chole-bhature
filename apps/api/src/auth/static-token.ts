import type { MiddlewareHandler } from 'hono';

import type { AppEnvironment, Env } from '../env.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';

export const SEEDED_MERCHANT_ID = 'phase-0-merchant';

type CredentialKind = 'publishable' | 'secret';
type TokenConfiguration = Record<CredentialKind, string>;

const TOKEN_PATTERN = /^\S{8,512}$/u;
const encoder = new TextEncoder();
const workersSubtle = crypto.subtle as SubtleCrypto & {
  timingSafeEqual(
    left: ArrayBuffer | ArrayBufferView,
    right: ArrayBuffer | ArrayBufferView,
  ): boolean;
};

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;

  const match = /^Bearer[ \t]+(\S{1,512})$/i.exec(authorization);
  return match?.[1] ?? null;
}

async function digest(value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function fixedTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  return workersSubtle.timingSafeEqual(leftDigest, rightDigest);
}

async function tokenConfiguration(env: Env): Promise<TokenConfiguration> {
  const publishable = env.PUBLISHABLE_TOKEN;
  const secret = env.SECRET_TOKEN;

  if (
    typeof publishable !== 'string'
    || typeof secret !== 'string'
    || !TOKEN_PATTERN.test(publishable)
    || !TOKEN_PATTERN.test(secret)
    || await fixedTimeEqual(publishable, secret)
  ) {
    throw new Error('Static token configuration is invalid');
  }

  return { publishable, secret };
}

async function credentialKind(
  configuration: TokenConfiguration,
  token: string,
): Promise<CredentialKind | null> {
  const [secret, publishable] = await Promise.all([
    fixedTimeEqual(token, configuration.secret),
    fixedTimeEqual(token, configuration.publishable),
  ]);

  if (secret) return 'secret';
  if (publishable) return 'publishable';
  return null;
}

function requireCredential(required: CredentialKind): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const configuration = await tokenConfiguration(context.env);
    const token = bearerToken(context.req.header('authorization'));
    const kind = token === null ? null : await credentialKind(configuration, token);

    if (kind === null) throw new UnauthorizedError();
    if (required === 'secret' && kind !== 'secret') throw new ForbiddenError();

    context.set('merchantId', SEEDED_MERCHANT_ID);
    await next();
  };
}

export const requirePublishable = requireCredential('publishable');
export const requireSecret = requireCredential('secret');
