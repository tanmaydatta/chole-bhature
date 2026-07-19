import { validateFutureProgramScheduleAndCaps } from './affiliate-program.js';
import { ConditionGroupSchema } from './conditions.js';
import { ProgramStatusSchema } from './programs.js';
import {
  PositiveSafeIntegerSchema,
  ReferralConditionalRewardsSchema,
} from './reward-rules.js';
import { z } from './zod.js';

export const ReferralProgramSchema = ReferralConditionalRewardsSchema.safeExtend({
  id: z.string().min(1),
  type: z.literal('referral'),
  name: z.string().min(1).max(200),
  status: ProgramStatusSchema,
  eligibility: ConditionGroupSchema,
  priority: z.number().int(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  usageCap: PositiveSafeIntegerSchema.optional(),
  perCustomerCap: PositiveSafeIntegerSchema.optional(),
}).superRefine(validateFutureProgramScheduleAndCaps).openapi({
  description: 'Future configuration contract; no runtime routes',
});

export type ReferralProgram = z.infer<typeof ReferralProgramSchema>;
