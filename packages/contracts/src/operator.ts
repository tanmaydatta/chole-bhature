import { z } from './zod.js';
import { ApiErrorSchema } from './errors.js';

export const PermissionKeySchema = z.enum([
  'members:read',
  'members:manage',
  'schemas:read',
  'schemas:manage',
  'schemas:publish',
  'customers:read',
  'customers:manage',
  'programs:read',
  'programs:manage',
  'programs:publish',
  'evaluations:run',
  'redemptions:commit',
  'credentials:read',
  'credentials:manage',
  'audit:read',
]);

export const OperatorActorKindSchema = z.enum(['root', 'member']);

export const OperatorPrincipalSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  authenticationMethods: z.array(z.string().min(1)).min(1),
  authenticatedAt: z.iso.datetime({ offset: true }),
  platformRole: z.literal('root').optional(),
  organizationId: z.string().min(1).optional(),
  merchantId: z.string().min(1).optional(),
  membershipId: z.string().min(1).optional(),
  permissions: z.array(PermissionKeySchema),
}).strict();

export const OperatorCallContextSchema = z.object({
  correlationId: z.string().min(1),
  actorUserId: z.string().min(1),
  actorKind: OperatorActorKindSchema,
  merchantId: z.string().min(1),
  permission: PermissionKeySchema,
}).strict();

export const MerchantProvisionRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  provisioningId: z.string().min(1),
}).strict();

const MerchantProvisionRecordSchema = MerchantProvisionRequestSchema.extend({
  status: z.enum(['provisioning', 'active']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const MerchantProvisionResultSchema = MerchantProvisionRecordSchema;

export const MerchantActivationRequestSchema = z.object({
  id: z.string().min(1),
  provisioningId: z.string().min(1),
}).strict();

export const MerchantActivationResultSchema = MerchantProvisionRecordSchema.extend({
  status: z.literal('active'),
}).strict();

export const CoreOperatorErrorSchema = z.object({
  code: z.enum(['CONFLICT', 'UNAVAILABLE', 'INTERNAL']),
  message: z.string().min(1),
  retryable: z.boolean(),
}).strict();

function coreResultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }).strict(),
    z.object({ ok: z.literal(false), error: CoreOperatorErrorSchema }).strict(),
  ]);
}

export const CoreMerchantProvisionResultSchema = coreResultSchema(MerchantProvisionResultSchema);
export const CoreMerchantActivationResultSchema = coreResultSchema(MerchantActivationResultSchema);

export const FixedOperatorRoleSchema = z.enum(['admin', 'operator', 'viewer']);

export const ClientProvisioningStepSchema = z.enum([
  'core_provision',
  'identity_organization',
  'core_activation',
  'identity_activation',
]);

export const ClientProvisionInputSchema = z.object({
  provisioningId: z.string().min(1),
  merchantId: z.string().min(1),
  name: z.string().min(1).max(200),
  correlationId: z.string().min(1),
}).strict();

export const ClientProvisioningViewSchema = z.object({
  provisioningId: z.string().min(1),
  merchantId: z.string().min(1),
  organizationId: z.string().min(1).nullable(),
  name: z.string().min(1).max(200),
  status: z.enum(['provisioning', 'failed', 'active']),
  failedStep: ClientProvisioningStepSchema.nullable(),
  retryable: z.boolean(),
}).strict();

export const CreateInvitationInputSchema = z.object({
  organizationId: z.string().min(1),
  email: z.email(),
  role: FixedOperatorRoleSchema,
  expiresInSeconds: z.number().int().positive(),
  correlationId: z.string().min(1),
}).strict();

export const InvitationViewSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  email: z.email(),
  role: FixedOperatorRoleSchema,
  status: z.enum(['pending', 'sent', 'delivery_failed', 'accepted', 'revoked', 'expired']),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export const AcceptInvitationInputSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  email: z.email(),
  correlationId: z.string().min(1),
}).strict();

export const MembershipViewSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  role: FixedOperatorRoleSchema,
  status: z.enum(['active', 'removed']),
}).strict();

const SessionAuthenticatedRequestSchema = z.object({
  sessionId: z.string().min(1),
  selectedMerchantId: z.string().min(1),
}).strict();

export const IdentityResolvePrincipalRequestSchema = z.object({
  sessionId: z.string().min(1),
  selectedMerchantId: z.string().min(1).optional(),
  correlationId: z.string().min(1),
}).strict();

export const IdentityProvisionClientRequestSchema = SessionAuthenticatedRequestSchema.extend({
  input: ClientProvisionInputSchema,
}).strict();

export const IdentityGetProvisioningRequestSchema = SessionAuthenticatedRequestSchema.extend({
  provisioningId: z.string().min(1),
  correlationId: z.string().min(1),
}).strict();

export const IdentityCreateInvitationRequestSchema = SessionAuthenticatedRequestSchema.extend({
  input: CreateInvitationInputSchema,
}).strict();

export const IdentityRetryInvitationRequestSchema = SessionAuthenticatedRequestSchema.extend({
  invitationId: z.string().min(1),
  correlationId: z.string().min(1),
}).strict();

export const IdentityRemoveMemberRequestSchema = SessionAuthenticatedRequestSchema.extend({
  membershipId: z.string().min(1),
  correlationId: z.string().min(1),
}).strict();

export const IdentityChangeMemberRoleRequestSchema = IdentityRemoveMemberRequestSchema.extend({
  role: FixedOperatorRoleSchema,
}).strict();

export const IdentityAcceptInvitationRequestSchema = AcceptInvitationInputSchema;
export const IdentityRpcErrorSchema = ApiErrorSchema;

export type PermissionKey = z.infer<typeof PermissionKeySchema>;
export type OperatorActorKind = z.infer<typeof OperatorActorKindSchema>;
export type OperatorPrincipal = z.infer<typeof OperatorPrincipalSchema>;
export type OperatorCallContext = z.infer<typeof OperatorCallContextSchema>;
export type MerchantProvisionRequest = z.infer<typeof MerchantProvisionRequestSchema>;
export type MerchantProvisionResult = z.infer<typeof MerchantProvisionResultSchema>;
export type MerchantActivationRequest = z.infer<typeof MerchantActivationRequestSchema>;
export type MerchantActivationResult = z.infer<typeof MerchantActivationResultSchema>;
export type CoreOperatorError = z.infer<typeof CoreOperatorErrorSchema>;
export type CoreMerchantProvisionResult = z.infer<typeof CoreMerchantProvisionResultSchema>;
export type CoreMerchantActivationResult = z.infer<typeof CoreMerchantActivationResultSchema>;
export type FixedOperatorRole = z.infer<typeof FixedOperatorRoleSchema>;
export type ClientProvisioningStep = z.infer<typeof ClientProvisioningStepSchema>;
export type ClientProvisionInput = z.infer<typeof ClientProvisionInputSchema>;
export type ClientProvisioningView = z.infer<typeof ClientProvisioningViewSchema>;
export type CreateInvitationInput = z.infer<typeof CreateInvitationInputSchema>;
export type InvitationView = z.infer<typeof InvitationViewSchema>;
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationInputSchema>;
export type MembershipView = z.infer<typeof MembershipViewSchema>;
export type IdentityResolvePrincipalRequest = z.infer<typeof IdentityResolvePrincipalRequestSchema>;
export type IdentityProvisionClientRequest = z.infer<typeof IdentityProvisionClientRequestSchema>;
export type IdentityGetProvisioningRequest = z.infer<typeof IdentityGetProvisioningRequestSchema>;
export type IdentityCreateInvitationRequest = z.infer<typeof IdentityCreateInvitationRequestSchema>;
export type IdentityRetryInvitationRequest = z.infer<typeof IdentityRetryInvitationRequestSchema>;
export type IdentityRemoveMemberRequest = z.infer<typeof IdentityRemoveMemberRequestSchema>;
export type IdentityChangeMemberRoleRequest = z.infer<typeof IdentityChangeMemberRoleRequestSchema>;
export type IdentityAcceptInvitationRequest = z.infer<typeof IdentityAcceptInvitationRequestSchema>;
