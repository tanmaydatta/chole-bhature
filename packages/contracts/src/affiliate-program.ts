import { ConditionGroupSchema } from './conditions.js';
import { ProgramStatusSchema } from './programs.js';
import {
  AffiliateConditionalRewardsSchema,
  PositiveSafeIntegerSchema,
} from './reward-rules.js';
import { z } from './zod.js';

type FutureProgramConstraints = {
  startDate?: string | undefined;
  endDate?: string | undefined;
  usageCap?: number | undefined;
  perCustomerCap?: number | undefined;
};

/** @internal Shared cross-field validation for future program configuration schemas. */
export function validateFutureProgramScheduleAndCaps(
  program: FutureProgramConstraints,
  context: z.RefinementCtx,
) {
  if (program.startDate && program.endDate && program.startDate > program.endDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must be on or after startDate',
    });
  }

  if (
    program.usageCap !== undefined
    && program.perCustomerCap !== undefined
    && program.perCustomerCap > program.usageCap
  ) {
    context.addIssue({
      code: 'custom',
      path: ['perCustomerCap'],
      message: 'perCustomerCap must not exceed usageCap',
    });
  }
}

export const AffiliateProgramSchema = AffiliateConditionalRewardsSchema.safeExtend({
  id: z.string().min(1),
  type: z.literal('affiliate'),
  name: z.string().min(1).max(200),
  status: ProgramStatusSchema,
  eligibility: ConditionGroupSchema,
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  usageCap: PositiveSafeIntegerSchema.optional(),
  perCustomerCap: PositiveSafeIntegerSchema.optional(),
  codeBatchCount: PositiveSafeIntegerSchema,
  perCodeUseLimit: PositiveSafeIntegerSchema,
}).superRefine(validateFutureProgramScheduleAndCaps).openapi({
  description: 'Future configuration contract; no runtime routes',
});

export type AffiliateProgram = z.infer<typeof AffiliateProgramSchema>;
