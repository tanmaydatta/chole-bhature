import { z } from './zod.js';

export const DeploymentEnvironmentSchema = z.enum([
  'local',
  'staging',
  'production',
]);

export const ApiCredentialKindSchema = z.enum(['publishable', 'secret']);

export const ApiCredentialScopeSchema = z.enum([
  'schema:read',
  'customers:write',
  'evaluations:write',
  'redemptions:write',
]);

export const ApiCredentialStatusSchema = z.enum([
  'active',
  'revoked',
  'expired',
]);

export const ApiCredentialViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  merchantId: z.string().min(1),
  environment: DeploymentEnvironmentSchema,
  kind: ApiCredentialKindSchema,
  scopes: z.array(ApiCredentialScopeSchema).min(1),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string().min(1),
  lastUsedAt: z.iso.datetime({ offset: true }).optional(),
  status: ApiCredentialStatusSchema,
  suffix: z.string().regex(/^[A-Za-z0-9_-]{4,12}$/),
}).strict();

export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironmentSchema>;
export type ApiCredentialKind = z.infer<typeof ApiCredentialKindSchema>;
export type ApiCredentialScope = z.infer<typeof ApiCredentialScopeSchema>;
export type ApiCredentialStatus = z.infer<typeof ApiCredentialStatusSchema>;
export type ApiCredentialView = z.infer<typeof ApiCredentialViewSchema>;
