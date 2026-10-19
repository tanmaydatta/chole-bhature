import { z } from './zod.js';
import {
  E2eFixtureAccountRequestSchema, E2eFixtureAccountSchema,
  E2eInspectionQuerySchema, E2eRunIdSchema, E2eRunInspectionSchema,
} from './operator.js';

const GenerationSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
// A 32-byte base64url encoding has 43 characters and two zero padding bits.
const CapabilitySchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const TimestampSchema = z.number().int().nonnegative();
const AccountQuotaSchema = z.number().int().min(1).max(32);
const ProtocolSchema = z.literal('incentives-e2e-control');
const RuntimeViewSchema = z.object({
  environment: z.enum(['local', 'staging']),
  generation: GenerationSchema, targetId: HashSchema,
}).strict();
const InventorySchema = z.record(z.string(), z.number().int().nonnegative());

export const E2eControlRuntimeSchema = RuntimeViewSchema.extend({
  enabled: z.boolean(), accountQuota: AccountQuotaSchema.default(3),
  cleanupGenerations: z.array(GenerationSchema),
}).strict();

export const E2eControlEnvelopeSchema = z.object({
  protocol: ProtocolSchema, version: z.literal(2),
  generation: GenerationSchema, targetId: HashSchema, requestId: z.uuid(),
}).strict();

export const E2eControlLeaseSchema = z.object({
  runId: E2eRunIdSchema, merchantId: z.uuid(), provisioningId: z.uuid(),
  organizationId: z.uuid().optional(), generation: GenerationSchema,
  targetId: HashSchema, issuedAt: TimestampSchema, expiresAt: TimestampSchema,
  phase: z.enum([
    'reserved', 'product-provisioned', 'auth-provisioned', 'active',
    'fencing', 'disposing', 'disposed', 'quarantined',
  ]),
}).strict().refine(lease => lease.expiresAt - lease.issuedAt === 900_000, {
  path: ['expiresAt'], message: 'Invalid creation lease duration',
});

export const StoredControlLeaseSchema = E2eControlLeaseSchema.safeExtend({
  proofHash: HashSchema, controllerHash: HashSchema, requestId: z.uuid(),
  payloadHash: HashSchema, accountQuota: AccountQuotaSchema,
}).strict();

export const E2eControlBootstrapSchema = z.object({
  operation: z.literal('bootstrap'), envelope: E2eControlEnvelopeSchema,
  runId: E2eRunIdSchema, proof: CapabilitySchema, controllerToken: CapabilitySchema,
  name: z.string().min(1).max(120),
}).strict().refine(input => input.proof !== input.controllerToken, {
  path: ['controllerToken'], message: 'Independent capabilities required',
});

const ActionShape = {
  envelope: E2eControlEnvelopeSchema, runId: E2eRunIdSchema, proof: CapabilitySchema,
};
export const E2eControlActionSchema = z.discriminatedUnion('operation', [
  z.object({ ...ActionShape, operation: z.enum(['status', 'cancel', 'dispose']) }).strict(),
  z.object({
    ...ActionShape, operation: z.literal('account'),
    slug: E2eFixtureAccountRequestSchema.shape.slug,
    role: E2eFixtureAccountRequestSchema.shape.role,
  }).strict(),
  z.object({
    ...ActionShape, operation: z.literal('inspect'), ...E2eInspectionQuerySchema.shape,
  }).strict(),
]);

export const E2eControlCapabilitiesSchema = z.object({
  protocol: ProtocolSchema, version: z.literal(2), runtime: RuntimeViewSchema,
  operator: z.literal(2), identity: z.literal(2), product: z.literal(2),
  migrations: z.object({
    auth: z.array(z.string().min(1)), product: z.array(z.string().min(1)),
  }).strict(),
  fencing: z.literal(true), recovery: z.literal(true),
}).strict();

export const E2eControlRunViewSchema = z.object({
  lease: E2eControlLeaseSchema, auth: InventorySchema, product: InventorySchema,
}).strict();

export const E2eControlAccountSchema = E2eFixtureAccountSchema.extend({
  cookieAttributes: z.object({
    name: z.string().min(1), path: z.literal('/'), httpOnly: z.literal(true),
    secure: z.boolean(), sameSite: z.literal('Lax'), expiresAt: TimestampSchema,
  }).strict(),
}).strict();

export const E2eControlBootstrapResultSchema = z.object({
  lease: E2eControlLeaseSchema,
  admin: E2eControlAccountSchema.extend({ role: z.literal('admin') }).strict(),
}).strict();

export const IdentityControlCallSchema = z.object({
  authorization: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('setup'), value: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('controller'), value: CapabilitySchema }).strict(),
  ]),
  input: z.union([
    z.object({ operation: z.literal('capabilities'), envelope: E2eControlEnvelopeSchema }).strict(),
    E2eControlBootstrapSchema, E2eControlActionSchema,
  ]),
}).strict();

export const CleanupInvocationSchema = z.object({
  id: z.uuid(), runId: E2eRunIdSchema, proofHash: HashSchema,
  currentGeneration: GenerationSchema, issuedAt: TimestampSchema, expiresAt: TimestampSchema,
}).strict().refine(cleanup => cleanup.expiresAt - cleanup.issuedAt === 300_000, {
  path: ['expiresAt'], message: 'Invalid cleanup invocation duration',
});

const CoreReservationShape = {
  envelope: E2eControlEnvelopeSchema, reservation: StoredControlLeaseSchema,
};
export const CoreControlCallSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('capabilities'), envelope: E2eControlEnvelopeSchema }).strict(),
  z.object({
    ...CoreReservationShape, operation: z.enum(['reserve', 'provision', 'activate', 'status']),
  }).strict(),
  z.object({
    ...CoreReservationShape, operation: z.literal('fence'), cleanup: CleanupInvocationSchema.optional(),
  }).strict(),
  z.object({
    ...CoreReservationShape, operation: z.literal('inspect'), query: E2eInspectionQuerySchema,
  }).strict(),
  z.object({
    ...CoreReservationShape, operation: z.literal('dispose'), cleanup: CleanupInvocationSchema,
  }).strict(),
]);

export const E2eControlErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'INVALID_REQUEST', 'INCOMPATIBLE',
      'CONFLICT', 'EXPIRED', 'QUARANTINED', 'UNAVAILABLE',
    ]),
    correlationId: z.string().min(1), retryable: z.boolean(),
  }).strict(),
}).strict();

export const CoreControlReplySchema = z.union([
  z.object({
    protocol: ProtocolSchema, version: z.literal(2), runtime: RuntimeViewSchema,
    product: z.literal(2), migrations: z.array(z.string().min(1)),
    fencing: z.literal(true), recovery: z.literal(true),
  }).strict(),
  z.object({ lease: E2eControlLeaseSchema, product: InventorySchema }).strict(),
  E2eRunInspectionSchema, E2eControlErrorSchema,
]);

export const E2eControlReplySchema = z.union([
  E2eControlCapabilitiesSchema, E2eControlBootstrapResultSchema, E2eControlRunViewSchema,
  E2eControlAccountSchema, E2eRunInspectionSchema, E2eControlErrorSchema,
]);

export type E2eControlRuntime = z.infer<typeof E2eControlRuntimeSchema>;
export type E2eControlEnvelope = z.infer<typeof E2eControlEnvelopeSchema>;
export type E2eControlLease = z.infer<typeof E2eControlLeaseSchema>;
export type StoredControlLease = z.infer<typeof StoredControlLeaseSchema>;
export type E2eControlBootstrap = z.infer<typeof E2eControlBootstrapSchema>;
export type E2eControlAction = z.infer<typeof E2eControlActionSchema>;
export type E2eControlCapabilities = z.infer<typeof E2eControlCapabilitiesSchema>;
export type E2eControlRunView = z.infer<typeof E2eControlRunViewSchema>;
export type E2eControlAccount = z.infer<typeof E2eControlAccountSchema>;
export type E2eControlBootstrapResult = z.infer<typeof E2eControlBootstrapResultSchema>;
export type IdentityControlCall = z.infer<typeof IdentityControlCallSchema>;
export type CoreControlCall = z.infer<typeof CoreControlCallSchema>;
export type CoreControlReply = z.infer<typeof CoreControlReplySchema>;
export type CleanupInvocation = z.infer<typeof CleanupInvocationSchema>;
export type E2eControlError = z.infer<typeof E2eControlErrorSchema>;
export type E2eControlReply = z.infer<typeof E2eControlReplySchema>;
