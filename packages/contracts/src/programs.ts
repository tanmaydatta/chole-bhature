import { ConditionGroupSchema } from './conditions.js';
import { MoneySchema } from './money.js';
import { PromoCodeSchema } from './promo-codes.js';
import {
  PromoFallbackRewardSchema,
  PromoRewardRuleSchema,
  validateConditionalRewardIdentitiesAndPresence,
} from './reward-rules.js';
import { z } from './zod.js';

export const ProgramStatusSchema = z.enum([
  'draft',
  'scheduled',
  'active',
  'paused',
  'ended',
]);

const PromoProgramBaseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('promo'),
  name: z.string().min(1).max(200),
  status: ProgramStatusSchema,
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  eligibility: ConditionGroupSchema,
  rewardRules: z.array(PromoRewardRuleSchema),
  fallbackReward: PromoFallbackRewardSchema.optional(),
  budget: MoneySchema.refine((money) => money.minorUnits >= 0, {
    message: 'budget must not be negative',
  }).optional(),
  usageCap: z.number().int().positive().optional(),
  perCustomerCap: z.number().int().positive().optional(),
  stackable: z.boolean(),
  priority: z.number().int(),
}).strict();

const AutomaticPromoProgramSchema = PromoProgramBaseSchema.extend({
  autoApply: z.literal(true),
  stackable: z.literal(false),
});

const CodedPromoProgramSchema = PromoProgramBaseSchema.extend({
  autoApply: z.literal(false),
  code: PromoCodeSchema,
  stackable: z.boolean(),
});

export const PromoProgramSchema = z.discriminatedUnion('autoApply', [
  AutomaticPromoProgramSchema,
  CodedPromoProgramSchema,
]).superRefine((program, context) => {
  if (program.startDate && program.endDate && program.startDate > program.endDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }
}).superRefine(validateConditionalRewardIdentitiesAndPresence);

export const ProgramRevisionSchema = z.object({
  programRef: z.string().min(1),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  configuration: PromoProgramSchema,
  createdAt: z.iso.datetime({ offset: true }),
  createdBy: z.string().min(1),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  publishedBy: z.string().min(1).optional(),
}).strict().superRefine((revision, context) => {
  if (revision.configuration.id !== revision.programRef) {
    context.addIssue({
      code: 'custom',
      path: ['configuration', 'id'],
      message: 'configuration id must match programRef',
    });
  }
  if ((revision.publishedAt === undefined) === (revision.publishedBy === undefined)) return;
  context.addIssue({
    code: 'custom',
    path: [revision.publishedAt === undefined ? 'publishedAt' : 'publishedBy'],
    message: 'publishedAt and publishedBy must be supplied together',
  });
});

export const ProgramLifecycleSchema = z.object({
  programRef: z.string().min(1),
  status: ProgramStatusSchema,
  activeRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  draftRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;
export type PromoProgram = z.infer<typeof PromoProgramSchema>;
export type ProgramRevision = z.infer<typeof ProgramRevisionSchema>;
export type ProgramLifecycle = z.infer<typeof ProgramLifecycleSchema>;
