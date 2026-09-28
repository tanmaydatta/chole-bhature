import { z } from './zod.js';
import { ApiErrorSchema } from './errors.js';
import { MerchandisePriceBreakdownSchema, RedemptionResponseSchema } from './evaluation.js';

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

export const E2eRunIdSchema = z.string().regex(/^e2e_[a-f0-9]{24}$/u);
export const E2eRunProofSchema = z.object({
  runId: E2eRunIdSchema,
  proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();
export const E2eRunClaimSchema = z.object({
  runId: E2eRunIdSchema,
  proofHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export const ProductE2eCapabilitiesSchema = z.object({
  version: z.literal(1),
  migrations: z.tuple([z.literal('0008_e2e_tenant_lifecycle.sql')]),
  inspection: z.literal(true), disposal: z.literal(true),
}).strict();
export const IdentityE2eCapabilitiesSchema = z.object({
  version: z.literal(1),
  migrations: z.tuple([
    z.literal('0005_e2e_tenant_lifecycle.sql'),
    z.literal('0006_e2e_fixture_session.sql'),
  ]),
  product: ProductE2eCapabilitiesSchema,
}).strict();
export const E2eCapabilitiesSchema = z.object({
  protocol: z.literal('incentives-e2e'), version: z.literal(1),
  operator: z.object({ version: z.literal(1) }).strict(),
  identity: IdentityE2eCapabilitiesSchema.omit({ product: true }),
  product: ProductE2eCapabilitiesSchema,
}).strict();
export const E2eTenantIdentitySchema = E2eRunClaimSchema.extend({
  merchantId: z.string().min(1),
  provisioningId: z.string().min(1),
}).strict();
export type E2eTenantIdentity = z.infer<typeof E2eTenantIdentitySchema>;
export const E2eRunActionRequestSchema = z.object({
  runId: E2eRunIdSchema,
  proof: E2eRunProofSchema.shape.proof,
  correlationId: z.string().min(1).max(200),
  sessionId: z.string().min(1),
}).strict();
export const E2eFixtureAccountRequestSchema = E2eRunActionRequestSchema.extend({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u),
  role: z.enum(['admin', 'operator', 'viewer']),
}).strict();
export const E2eFixtureAccountSchema = z.object({
  runId: E2eRunIdSchema,
  merchantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  membershipId: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'operator', 'viewer']),
  sessionId: z.string().min(1),
  cookieHeader: z.string().min(1).regex(/^[^\r\n]+$/u),
}).strict();
export const E2eRunInventorySchema = z.object({
  runId: E2eRunIdSchema,
  merchantId: z.string().min(1),
  status: z.enum(['active', 'disposing', 'disposed']),
  productStatus: z.enum(['active', 'disposed']),
  auth: z.record(z.string(), z.number().int().nonnegative()),
  product: z.record(z.string(), z.number().int().nonnegative()),
}).strict();
export const E2eInspectionQuerySchema = z.object({
  evaluationId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  programRefs: z.array(z.string().min(1).max(200)).min(1).max(4),
}).strict();
export type E2eInspectionQuery = z.infer<typeof E2eInspectionQuerySchema>;
export const E2eRunInspectionRequestSchema = E2eRunActionRequestSchema.extend(
  E2eInspectionQuerySchema.shape,
).strict();
export const E2eRunInspectionSchema = z.object({
  runId: E2eRunIdSchema,
  merchantId: z.string().min(1),
  evaluation: z.object({
    evaluationId: z.string().min(1),
    priceBreakdown: MerchandisePriceBreakdownSchema,
    integrityVerified: z.literal(true),
  }).strict(),
  redemption: z.object({
    redemptionId: z.string().min(1),
    result: RedemptionResponseSchema,
    receiptIntegrityVerified: z.literal(true),
    entries: z.array(z.object({
      position: z.number().int().nonnegative(),
      programRef: z.string().min(1),
      discountMinorUnits: z.number().int().nonnegative(),
    }).strict()),
  }).strict(),
  counters: z.array(z.object({
    programRef: z.string().min(1),
    usageCount: z.number().int().nonnegative(),
    budgetRemaining: z.number().int().nonnegative().nullable(),
    committedSpend: z.number().int().nonnegative(),
  }).strict()),
}).strict();

export const MerchantProvisionRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  provisioningId: z.string().min(1),
  e2eRun: E2eRunClaimSchema.optional(),
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
  e2eRun: E2eRunProofSchema.optional(),
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

export const OperatorMemberViewSchema = MembershipViewSchema.extend({
  email: z.email(),
}).strict();

const SessionAuthenticatedRequestSchema = z.object({
  sessionId: z.string().min(1),
  selectedMerchantId: z.string().min(1),
}).strict();

const BrowserSessionAuthenticatedRequestSchema = z.object({
  cookieHeader: z.string().max(8192),
  selectedMerchantId: z.string().min(1).max(200).optional(),
  correlationId: z.string().min(1).max(200),
}).strict();

export const IdentityRootBrowserRequestSchema = z.object({
  cookieHeader: z.string().max(8192),
  correlationId: z.string().min(1).max(200),
}).strict();

export const IdentityRootProvisioningRequestSchema = IdentityRootBrowserRequestSchema.extend({
  provisioningId: z.string().min(1).max(200),
}).strict();

export const IdentityRootSessionRequestSchema = z.object({
  sessionId: z.string().min(1),
  correlationId: z.string().min(1).max(200),
}).strict();

export const IdentityRootSessionProvisioningRequestSchema =
  IdentityRootSessionRequestSchema.extend({
    provisioningId: z.string().min(1).max(200),
  }).strict();

export const IdentityResolvePrincipalRequestSchema = z.object({
  sessionId: z.string().min(1),
  selectedMerchantId: z.string().min(1).optional(),
  correlationId: z.string().min(1),
}).strict();

export const IdentityResolveBrowserPrincipalRequestSchema =
  BrowserSessionAuthenticatedRequestSchema;

export const IdentityListMembersRequestSchema = SessionAuthenticatedRequestSchema.extend({
  correlationId: z.string().min(1),
}).strict();

export const IdentityListInvitationsRequestSchema = IdentityListMembersRequestSchema;

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
export type OperatorMemberView = z.infer<typeof OperatorMemberViewSchema>;
export type IdentityResolvePrincipalRequest = z.infer<typeof IdentityResolvePrincipalRequestSchema>;
export type IdentityRootBrowserRequest = z.infer<typeof IdentityRootBrowserRequestSchema>;
export type IdentityRootProvisioningRequest = z.infer<
  typeof IdentityRootProvisioningRequestSchema
>;
export type IdentityRootSessionRequest = z.infer<typeof IdentityRootSessionRequestSchema>;
export type IdentityRootSessionProvisioningRequest = z.infer<
  typeof IdentityRootSessionProvisioningRequestSchema
>;
export type IdentityResolveBrowserPrincipalRequest = z.infer<
  typeof IdentityResolveBrowserPrincipalRequestSchema
>;
export type IdentityListMembersRequest = z.infer<typeof IdentityListMembersRequestSchema>;
export type IdentityListInvitationsRequest = z.infer<
  typeof IdentityListInvitationsRequestSchema
>;
export type IdentityProvisionClientRequest = z.infer<typeof IdentityProvisionClientRequestSchema>;
export type IdentityGetProvisioningRequest = z.infer<typeof IdentityGetProvisioningRequestSchema>;
export type IdentityCreateInvitationRequest = z.infer<typeof IdentityCreateInvitationRequestSchema>;
export type IdentityRetryInvitationRequest = z.infer<typeof IdentityRetryInvitationRequestSchema>;
export type IdentityRemoveMemberRequest = z.infer<typeof IdentityRemoveMemberRequestSchema>;
export type IdentityChangeMemberRoleRequest = z.infer<typeof IdentityChangeMemberRoleRequestSchema>;
export type IdentityAcceptInvitationRequest = z.infer<typeof IdentityAcceptInvitationRequestSchema>;
