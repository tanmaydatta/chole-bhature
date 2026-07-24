import {
  ApiErrorSchema,
  IdentityResolveBrowserPrincipalRequestSchema,
  OperatorCallContextSchema,
  OperatorPrincipalSchema,
  type ApiError,
  type OperatorCallContext,
  type OperatorPrincipal,
  type PermissionKey,
} from '@incentives/contracts';

import type { OperatorWebEnv } from './routes/types.js';

const selectionLifetimeSeconds = 8 * 60 * 60;

function selectionCookieName(env: OperatorWebEnv): string {
  return env.APP_ENV === 'staging'
    ? '__Host-incentives-operator-selection'
    : 'incentives-operator-selection';
}

export function apiError(
  correlationId: string,
  code: string,
  message: string,
  retryable = false,
): ApiError {
  return ApiErrorSchema.parse({ error: { code, message, correlationId, retryable } });
}

export function apiErrorStatus(error: ApiError): number {
  switch (error.error.code) {
    case 'UNAUTHORIZED': return 401;
    case 'FORBIDDEN': return 403;
    case 'NOT_FOUND': return 404;
    case 'VERSION_CONFLICT':
    case 'SCHEMA_CONFLICT':
    case 'PROGRAM_CONFLICT':
    case 'PROMO_CODE_CONFLICT':
    case 'OPERATION_FAILED': return 409;
    case 'IDENTITY_UNAVAILABLE':
    case 'CORE_UNAVAILABLE':
    case 'OPERATOR_WEB_UNAVAILABLE': return 503;
    default: return 400;
  }
}

function encode(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('OPERATOR_SELECTION_SECRET is invalid');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false,
    ['sign', 'verify'],
  );
}

interface SelectionPayload {
  sessionId: string;
  merchantId: string;
  expiresAt: number;
}

export async function selectionCookie(
  env: OperatorWebEnv,
  principal: OperatorPrincipal,
  merchantId: string,
): Promise<string> {
  const payload: SelectionPayload = {
    sessionId: principal.sessionId,
    merchantId,
    expiresAt: Date.now() + selectionLifetimeSeconds * 1000,
  };
  const encodedPayload = encode(new TextEncoder().encode(JSON.stringify(payload)).buffer);
  const signature = await crypto.subtle.sign(
    'HMAC', await hmacKey(env.OPERATOR_SELECTION_SECRET),
    new TextEncoder().encode(encodedPayload),
  );
  const secure = env.APP_ENV === 'staging' ? '; Secure' : '';
  return `${selectionCookieName(env)}=${encodedPayload}.${encode(signature)}; Path=/; Max-Age=${selectionLifetimeSeconds}; HttpOnly${secure}; SameSite=Strict`;
}

function cookieValue(cookieHeader: string, name: string): string | null {
  for (const item of cookieHeader.split(';')) {
    const [candidate, ...value] = item.trim().split('=');
    if (candidate === name) return value.join('=');
  }
  return null;
}

export async function selectedMerchant(
  env: OperatorWebEnv,
  cookieHeader: string,
  principal: OperatorPrincipal,
): Promise<string | null> {
  try {
    const value = cookieValue(cookieHeader, selectionCookieName(env));
    if (!value) return null;
    const [payloadPart, signaturePart, extra] = value.split('.');
    if (!payloadPart || !signaturePart || extra !== undefined) return null;
    const valid = await crypto.subtle.verify(
      'HMAC', await hmacKey(env.OPERATOR_SELECTION_SECRET), decode(signaturePart),
      new TextEncoder().encode(payloadPart),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(payloadPart))) as SelectionPayload;
    if (
      typeof payload.sessionId !== 'string'
      || typeof payload.merchantId !== 'string'
      || typeof payload.expiresAt !== 'number'
      || payload.sessionId !== principal.sessionId
      || payload.expiresAt <= Date.now()
      || payload.expiresAt > Date.now() + selectionLifetimeSeconds * 1000
    ) return null;
    return payload.merchantId;
  } catch {
    return null;
  }
}

async function derivedIdentifier(
  env: OperatorWebEnv,
  purpose: 'merchant' | 'provisioning',
  rootUserId: string,
  idempotencyKey: string,
): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.OPERATOR_SELECTION_SECRET),
    new TextEncoder().encode(
      `incentives/operator-web/${purpose}/v1\u0000${rootUserId}\u0000${idempotencyKey}`,
    ),
  );
  return `${purpose}_${encode(signature).slice(0, 32)}`;
}

export async function deriveProvisioningIds(
  env: OperatorWebEnv,
  rootUserId: string,
  idempotencyKey: string,
): Promise<{ merchantId: string; provisioningId: string }> {
  const [merchantId, provisioningId] = await Promise.all([
    derivedIdentifier(env, 'merchant', rootUserId, idempotencyKey),
    derivedIdentifier(env, 'provisioning', rootUserId, idempotencyKey),
  ]);
  return { merchantId, provisioningId };
}

export async function resolveBrowserPrincipal(
  env: OperatorWebEnv,
  cookieHeader: string,
  correlationId: string,
  selectedMerchantId?: string,
): Promise<OperatorPrincipal | ApiError> {
  try {
    const input = IdentityResolveBrowserPrincipalRequestSchema.parse({
      cookieHeader,
      correlationId,
      ...(selectedMerchantId === undefined ? {} : { selectedMerchantId }),
    });
    const raw = await env.IDENTITY.resolveBrowserPrincipal(input);
    const failure = ApiErrorSchema.safeParse(raw);
    if (failure.success) {
      if (failure.data.error.correlationId !== correlationId) {
        throw new Error('Identity returned an invalid correlation id');
      }
      return failure.data;
    }
    return OperatorPrincipalSchema.parse(raw);
  } catch {
    return apiError(
      correlationId, 'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true,
    );
  }
}

export async function principalForOperation(
  env: OperatorWebEnv,
  cookieHeader: string,
  correlationId: string,
): Promise<OperatorPrincipal | ApiError> {
  const base = await resolveBrowserPrincipal(env, cookieHeader, correlationId);
  if ('error' in base) return base;
  if (base.platformRole !== 'root') return base;
  const merchantId = await selectedMerchant(env, cookieHeader, base);
  if (!merchantId) {
    return apiError(
      correlationId,
      'MERCHANT_SELECTION_REQUIRED',
      'Select a merchant before continuing',
    );
  }
  const selected = await resolveBrowserPrincipal(env, cookieHeader, correlationId, merchantId);
  if ('error' in selected) return selected;
  if (
    selected.platformRole !== 'root'
    || selected.sessionId !== base.sessionId
    || selected.merchantId !== merchantId
  ) {
    return apiError(correlationId, 'FORBIDDEN', 'Operation is not permitted');
  }
  return selected;
}

export function operatorContext(
  principal: OperatorPrincipal,
  permission: PermissionKey,
  correlationId: string,
): OperatorCallContext | null {
  if (!principal.merchantId) return null;
  if (principal.platformRole !== 'root' && !principal.permissions.includes(permission)) return null;
  return OperatorCallContextSchema.parse({
    correlationId,
    actorUserId: principal.userId,
    actorKind: principal.platformRole === 'root' ? 'root' : 'member',
    merchantId: principal.merchantId,
    permission,
  });
}
