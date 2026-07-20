import { z } from './zod.js';

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

export type PermissionKey = z.infer<typeof PermissionKeySchema>;
export type OperatorActorKind = z.infer<typeof OperatorActorKindSchema>;
export type OperatorPrincipal = z.infer<typeof OperatorPrincipalSchema>;
export type OperatorCallContext = z.infer<typeof OperatorCallContextSchema>;
export type MerchantProvisionRequest = z.infer<typeof MerchantProvisionRequestSchema>;
export type MerchantProvisionResult = z.infer<typeof MerchantProvisionResultSchema>;
export type MerchantActivationRequest = z.infer<typeof MerchantActivationRequestSchema>;
export type MerchantActivationResult = z.infer<typeof MerchantActivationResultSchema>;
