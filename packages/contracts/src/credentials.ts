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

export const PublishableRequestsPerMinuteSchema = z.number().int().min(1).max(10_000);

export const ExactOriginSchema = z.string().url().refine(
  origin => new URL(origin).origin === origin,
  { message: 'Origin must be an exact serialized origin' },
);

const ApiCredentialViewBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  merchantId: z.string().min(1),
  environment: DeploymentEnvironmentSchema,
  scopes: z.array(ApiCredentialScopeSchema).min(1),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string().min(1),
  lastUsedAt: z.iso.datetime({ offset: true }).optional(),
  status: ApiCredentialStatusSchema,
  suffix: z.string().regex(/^[A-Za-z0-9_-]{4,12}$/),
});

export const ApiCredentialViewSchema = z.discriminatedUnion('kind', [
  ApiCredentialViewBaseSchema.extend({
    kind: z.literal('publishable'),
    requestsPerMinute: PublishableRequestsPerMinuteSchema,
  }).strict(),
  ApiCredentialViewBaseSchema.extend({
    kind: z.literal('secret'),
  }).strict(),
]);

const ApiCredentialCreateBaseSchema = z.object({
  name: z.string().min(1).max(200),
  environment: DeploymentEnvironmentSchema,
  scopes: z.array(ApiCredentialScopeSchema).min(1),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export const ApiCredentialCreateInputSchema = z.discriminatedUnion('kind', [
  ApiCredentialCreateBaseSchema.extend({
    kind: z.literal('publishable'),
    allowedOrigins: z.array(ExactOriginSchema).max(100).optional(),
    requestsPerMinute: PublishableRequestsPerMinuteSchema.default(60),
  }).strict(),
  ApiCredentialCreateBaseSchema.extend({
    kind: z.literal('secret'),
  }).strict(),
]);

export const ApiCredentialCreateResultSchema = z.object({
  credential: ApiCredentialViewSchema,
  token: z.string().regex(/^(?:pk|sk)_[A-Za-z0-9_-]{32,256}$/),
}).strict().superRefine((result, context) => {
  const expectedPrefix = result.credential.kind === 'publishable' ? 'pk_' : 'sk_';
  if (result.token.startsWith(expectedPrefix)) return;
  context.addIssue({
    code: 'custom',
    path: ['token'],
    message: `token must use the ${expectedPrefix} prefix for this credential kind`,
  });
});

export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironmentSchema>;
export type ApiCredentialKind = z.infer<typeof ApiCredentialKindSchema>;
export type ApiCredentialScope = z.infer<typeof ApiCredentialScopeSchema>;
export type ApiCredentialStatus = z.infer<typeof ApiCredentialStatusSchema>;
export type ApiCredentialView = z.infer<typeof ApiCredentialViewSchema>;
export type ApiCredentialCreateInput = z.input<typeof ApiCredentialCreateInputSchema>;
export type ApiCredentialCreateResult = z.infer<typeof ApiCredentialCreateResultSchema>;
