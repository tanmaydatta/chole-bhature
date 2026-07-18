import {
  FreeShippingEffectSchema,
  LineItemDiscountEffectSchema,
  OrderDiscountEffectSchema,
} from './evaluation.js';
import { MoneySchema } from './money.js';
import { z } from './zod.js';

export const ConditionOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'between',
  'is',
]);

export const ConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

export const ConditionSchema = z.object({
  id: z.string().min(1),
  variable: z.string().regex(/^(customer|context|cart|line_item|event|system)\.[a-z][a-z0-9_]*$/),
  operator: ConditionOperatorSchema,
  value: ConditionValueSchema,
  message: z.string().max(500).optional(),
}).strict();

const NestedConditionGroupSchema = z.object({
  match: z.enum(['ALL', 'ANY']),
  conditions: z.array(ConditionSchema),
}).strict();

export const ConditionGroupSchema = z.object({
  match: z.enum(['ALL', 'ANY']),
  conditions: z.array(ConditionSchema),
  groups: z.array(NestedConditionGroupSchema).optional(),
}).strict();

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

export const PromoProgramSchema = z.object({
  id: z.string().min(1),
  type: z.literal('promo'),
  name: z.string().min(1).max(200),
  status: ProgramStatusSchema,
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  code: z.string().min(1).optional(),
  autoApply: z.boolean(),
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
}).strict().superRefine((program, context) => {
  if (!program.autoApply && program.code === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['code'],
      message: 'code is required unless the promo auto-applies',
    });
  }
  if (program.startDate && program.endDate && program.startDate > program.endDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }
});

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;
export type ConditionValue = z.infer<typeof ConditionValueSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ConditionGroup = z.infer<typeof ConditionGroupSchema>;
export type PromoReward = z.infer<typeof PromoRewardSchema>;
export type ProgramStatus = z.infer<typeof ProgramStatusSchema>;
export type PromoProgram = z.infer<typeof PromoProgramSchema>;
