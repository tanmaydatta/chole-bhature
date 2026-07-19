import {
  FreeShippingEffectSchema,
  LineItemDiscountEffectSchema,
  OrderDiscountEffectSchema,
} from './evaluation.js';
import { ConditionGroupSchema } from './conditions.js';
import { MoneySchema } from './money.js';
import { z } from './zod.js';

export const PromoRewardSchema = z.union([
  OrderDiscountEffectSchema,
  LineItemDiscountEffectSchema,
  FreeShippingEffectSchema,
]);

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
  reward: PromoRewardSchema,
  budget: MoneySchema.refine((money) => money.minorUnits >= 0, {
    message: 'budget must not be negative',
  }).optional(),
  usageCap: z.number().int().positive().optional(),
  perCustomerCap: z.number().int().positive().optional(),
  stackable: z.boolean(),
  priority: z.number().int(),
  stackingGroup: z.string().min(1).optional(),
}).strict();

const ManualPromoProgramSchema = PromoProgramBaseSchema.extend({
  autoApply: z.literal(false),
  code: z.string().min(1),
});

const AutomaticPromoProgramSchema = PromoProgramBaseSchema.extend({
  autoApply: z.literal(true),
  code: z.string().min(1).optional(),
});

export const PromoProgramSchema = z.discriminatedUnion('autoApply', [
  ManualPromoProgramSchema,
  AutomaticPromoProgramSchema,
]).superRefine((program, context) => {
  if (program.startDate && program.endDate && program.startDate > program.endDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }
});

export type PromoReward = z.infer<typeof PromoRewardSchema>;
export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;
export type PromoProgram = z.infer<typeof PromoProgramSchema>;
