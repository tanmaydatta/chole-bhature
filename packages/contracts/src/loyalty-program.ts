import { validateFutureProgramScheduleAndCaps } from './affiliate-program.js';
import { ConditionGroupSchema } from './conditions.js';
import { ProgramStatusSchema } from './programs.js';
import {
  LoyaltyConditionalRewardsSchema,
  PositiveSafeIntegerSchema,
} from './reward-rules.js';
import { z } from './zod.js';

export const LoyaltyProgramSchema = LoyaltyConditionalRewardsSchema.safeExtend({
  id: z.string().min(1),
  type: z.literal('loyalty'),
  name: z.string().min(1).max(200),
  status: ProgramStatusSchema,
  triggerEvent: z.string().min(1),
  eligibility: ConditionGroupSchema,
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  usageCap: PositiveSafeIntegerSchema.optional(),
  perCustomerCap: PositiveSafeIntegerSchema.optional(),
}).superRefine(validateFutureProgramScheduleAndCaps).superRefine((program, context) => {
  const rewards = [
    ...program.rewardRules.map((rule, index) => ({
      reward: rule.reward,
      path: ['rewardRules', index, 'reward', 'assetRef'] as Array<string | number>,
    })),
    ...(program.fallbackReward === undefined ? [] : [{
      reward: program.fallbackReward.reward,
      path: ['fallbackReward', 'reward', 'assetRef'] as Array<string | number>,
    }]),
  ];
  const assetRef = rewards[0]?.reward.assetRef;

  for (const { reward, path } of rewards.slice(1)) {
    if (reward.assetRef !== assetRef) {
      context.addIssue({
        code: 'custom',
        path,
        message: 'all loyalty rewards must use the same assetRef',
      });
    }
  }
}).openapi({
  description: 'Future configuration contract; no runtime routes',
});

// The future Loyalty configuration service must resolve sourceVariable against the
// merchant's published registry and require a numeric definition. This schema only
// validates the reference syntax; the current Promo API performs no such resolution.

export type LoyaltyProgram = z.infer<typeof LoyaltyProgramSchema>;
