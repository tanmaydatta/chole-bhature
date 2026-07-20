import { z } from './zod.js';

export const AuditActorKindSchema = z.enum([
  'anonymous',
  'root',
  'member',
  'credential',
  'system',
]);

export const AuditOutcomeSchema = z.enum(['succeeded', 'failed', 'denied']);

const AuditMetadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const AuditEntrySchema = z.object({
  id: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  actorKind: AuditActorKindSchema,
  actorId: z.string().min(1),
  merchantId: z.string().min(1).optional(),
  action: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/),
  targetType: z.string().regex(/^[a-z][a-z0-9_]*$/),
  targetId: z.string().min(1),
  outcome: AuditOutcomeSchema,
  correlationId: z.string().min(1),
  metadata: z.record(z.string(), AuditMetadataValueSchema).optional(),
}).strict();

export type AuditActorKind = z.infer<typeof AuditActorKindSchema>;
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
