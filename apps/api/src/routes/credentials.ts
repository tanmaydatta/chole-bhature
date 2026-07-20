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
  const credential = await repositories.credentials.create({
    id: crypto.randomUUID(),
    merchantId: operator.merchantId,
    name: parsed.name,
    environment: parsed.environment,
    kind: parsed.kind,
    scopes: parsed.scopes,
    allowedOrigins,
    digest: await digest(token),
    suffix: token.slice(-8),
    ...(parsed.expiresAt === undefined ? {} : { expiresAt: parsed.expiresAt }),
    createdBy: operator.actorUserId,
  });
  await repositories.audit.append({
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    actorKind: operator.actorKind,
    actorId: operator.actorUserId,
    merchantId: operator.merchantId,
    action: 'credential.created',
    targetType: 'credential',
    targetId: credential.id,
    outcome: 'succeeded',
    correlationId: operator.correlationId,
    metadata: { kind: credential.kind, suffix: credential.suffix },
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
  const revoked = await repositories.credentials.revoke(
    operator.merchantId,
    z.string().min(1).parse(credentialId),
    new Date().toISOString(),
    operator.actorUserId,
  );
  if (revoked === null) throw new NotFoundError('Credential not found');
  await repositories.audit.append({
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    actorKind: operator.actorKind,
    actorId: operator.actorUserId,
    merchantId: operator.merchantId,
    action: 'credential.revoked',
    targetType: 'credential',
    targetId: revoked.id,
    outcome: 'succeeded',
    correlationId: operator.correlationId,
    metadata: { kind: revoked.kind, suffix: revoked.suffix },
  });
  return revoked;
}
