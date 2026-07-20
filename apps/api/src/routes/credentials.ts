import {
  ApiCredentialKindSchema,
  ApiCredentialScopeSchema,
  DeploymentEnvironmentSchema,
  type ApiCredentialScope,
  type OperatorCallContext,
} from '@incentives/contracts';
import { z } from 'zod';

import { requireOperatorContext } from '../auth/operator-context.js';
import type { Env } from '../env.js';
import { NotFoundError } from '../errors.js';
import { createRepositories } from '../repositories/d1-repositories.js';

const ExactOriginSchema = z.string().url().refine((origin) => new URL(origin).origin === origin, {
  message: 'Origin must be an exact serialized origin',
});
const CredentialInputSchema = z.object({
  name: z.string().min(1).max(200),
  environment: DeploymentEnvironmentSchema,
  kind: ApiCredentialKindSchema,
  scopes: z.array(ApiCredentialScopeSchema).min(1),
  allowedOrigins: z.array(ExactOriginSchema).max(100).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict();

const encoder = new TextEncoder();

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function tokenMaterial(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function digest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertCredentialPolicy(
  kind: 'publishable' | 'secret',
  scopes: ApiCredentialScope[],
  allowedOrigins: string[],
  environment: 'local' | 'staging' | 'production',
): void {
  if (!unique(scopes) || !unique(allowedOrigins)) throw new Error('Credential policy has duplicates');
  const allowedScopes: ReadonlySet<ApiCredentialScope> = kind === 'publishable'
    ? new Set(['schema:read', 'evaluations:write'])
    : new Set(['schema:read', 'customers:write', 'evaluations:write', 'redemptions:write']);
  if (scopes.some(scope => !allowedScopes.has(scope))) {
    throw new Error('Credential kind cannot receive one or more requested scopes');
  }
  if (kind === 'secret' && allowedOrigins.length > 0) {
    throw new Error('Secret credentials cannot configure browser origins');
  }
  if (kind === 'publishable' && environment === 'production' && allowedOrigins.length === 0) {
    throw new Error('Production publishable credentials require an allowed origin');
  }
}

export async function createCredential(
  env: Env,
  operatorInput: OperatorCallContext,
  input: unknown,
) {
  const operator = requireOperatorContext(operatorInput, 'credentials:manage');
  const parsed = CredentialInputSchema.parse(input);
  const allowedOrigins = parsed.allowedOrigins ?? [];
  assertCredentialPolicy(parsed.kind, parsed.scopes, allowedOrigins, parsed.environment);
  const repositories = createRepositories(env);
  const merchant = await repositories.merchants.get(operator.merchantId);
  if (merchant === null || merchant.status !== 'active') throw new NotFoundError('Merchant not found');

  const material = tokenMaterial();
  const token = `${parsed.kind === 'publishable' ? 'pk' : 'sk'}_${material}`;
  const credentialId = crypto.randomUUID();
  const suffix = token.slice(-8);
  const createdAt = new Date().toISOString();
  const credential = await repositories.credentials.createWithAudit({
    id: credentialId,
    merchantId: operator.merchantId,
    name: parsed.name,
    environment: parsed.environment,
    kind: parsed.kind,
    scopes: parsed.scopes,
    allowedOrigins,
    digest: await digest(token),
    suffix,
    ...(parsed.expiresAt === undefined ? {} : { expiresAt: parsed.expiresAt }),
    createdAt,
    createdBy: operator.actorUserId,
  }, {
    id: crypto.randomUUID(),
    occurredAt: createdAt,
    actorKind: operator.actorKind,
    actorId: operator.actorUserId,
    merchantId: operator.merchantId,
    action: 'credential.created',
    targetType: 'credential',
    targetId: credentialId,
    outcome: 'succeeded',
    correlationId: operator.correlationId,
    metadata: { kind: parsed.kind, suffix },
  });
  return { credential, token };
}

export async function listCredentials(env: Env, operatorInput: OperatorCallContext) {
  const operator = requireOperatorContext(operatorInput, 'credentials:read');
  return createRepositories(env).credentials.list(operator.merchantId);
}

export async function revokeCredential(
  env: Env,
  operatorInput: OperatorCallContext,
  credentialId: string,
) {
  const operator = requireOperatorContext(operatorInput, 'credentials:manage');
  const repositories = createRepositories(env);
  const revokedAt = new Date().toISOString();
  const existing = (await repositories.credentials.list(operator.merchantId))
    .find(credential => credential.id === credentialId);
  if (existing === undefined) throw new NotFoundError('Credential not found');
  const revoked = await repositories.credentials.revokeWithAudit(
    operator.merchantId,
    z.string().min(1).parse(credentialId),
    revokedAt,
    operator.actorUserId,
    {
      id: crypto.randomUUID(),
      occurredAt: revokedAt,
      actorKind: operator.actorKind,
      actorId: operator.actorUserId,
      merchantId: operator.merchantId,
      action: 'credential.revoked',
      targetType: 'credential',
      targetId: credentialId,
      outcome: 'succeeded',
      correlationId: operator.correlationId,
      metadata: { kind: existing.kind, suffix: existing.suffix },
    },
  );
  if (revoked === null) throw new NotFoundError('Credential not found');
  return revoked;
}
