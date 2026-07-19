import { ConditionGroupSchema } from './conditions.js';
import type { ConditionGroup } from './conditions.js';
import {
  FreeShippingEffectSchema,
  LineItemDiscountEffectSchema,
  OrderDiscountEffectSchema,
} from './evaluation.js';
import { z } from './zod.js';

export interface RewardRule<TReward> {
  id: string;
  name: string;
  conditions: ConditionGroup;
  reward: TReward;
}

export interface FallbackReward<TReward> {
  id: string;
  name: string;
  reward: TReward;
}

export interface ConditionalRewards<TReward> {
  rewardRules: RewardRule<TReward>[];
  fallbackReward?: FallbackReward<TReward>;
}

export const CommerceRewardSchema = z.union([
  OrderDiscountEffectSchema,
  LineItemDiscountEffectSchema,
  FreeShippingEffectSchema,
]);

export const NonEmptyConditionGroupSchema = ConditionGroupSchema.superRefine((group, context) => {
  const conditionCount = group.conditions.length
    + (group.groups ?? []).reduce((count, nested) => count + nested.conditions.length, 0);

  if (conditionCount === 0) {
    context.addIssue({
      code: 'custom',
      path: ['conditions'],
      message: 'conditional reward rules must contain at least one condition',
    });
  }
});

type ConditionalRewardsValue = {
  rewardRules: Array<{ id: string }>;
  fallbackReward?: { id: string } | undefined;
};

function validateConditionalRewardIdentitiesAndPresence(
  rewards: ConditionalRewardsValue,
  context: z.RefinementCtx,
) {
  if (rewards.rewardRules.length === 0 && rewards.fallbackReward === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['rewardRules'],
      message: 'at least one reward rule or fallback reward is required',
    });
  }

  const seenIds = new Set<string>();
  rewards.rewardRules.forEach((rule, index) => {
    if (seenIds.has(rule.id)) {
      context.addIssue({
        code: 'custom',
        path: ['rewardRules', index, 'id'],
        message: `duplicate reward id: ${rule.id}`,
      });
    }
    seenIds.add(rule.id);
  });

  if (rewards.fallbackReward && seenIds.has(rewards.fallbackReward.id)) {
    context.addIssue({
      code: 'custom',
      path: ['fallbackReward', 'id'],
      message: `duplicate reward id: ${rewards.fallbackReward.id}`,
    });
  }
}

function createConditionalRewardsSchema<TReward extends z.ZodType>(reward: TReward) {
  const rule = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    conditions: NonEmptyConditionGroupSchema,
    reward,
  }).strict();
  const fallback = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    reward,
  }).strict();
  const conditionalRewards = z.object({
    rewardRules: z.array(rule),
    fallbackReward: fallback.optional(),
  }).strict().superRefine(validateConditionalRewardIdentitiesAndPresence);

  return { conditionalRewards, fallback, rule };
}

const PromoConditionalRewardSchemas = createConditionalRewardsSchema(CommerceRewardSchema);

export const PromoRewardRuleSchema = PromoConditionalRewardSchemas.rule;
export const PromoFallbackRewardSchema = PromoConditionalRewardSchemas.fallback;
export const PromoConditionalRewardsSchema = PromoConditionalRewardSchemas.conditionalRewards;

export type CommerceReward = z.infer<typeof CommerceRewardSchema>;
export type PromoRewardRule = z.infer<typeof PromoRewardRuleSchema>;
export type PromoFallbackReward = z.infer<typeof PromoFallbackRewardSchema>;
export type PromoConditionalRewards = z.infer<typeof PromoConditionalRewardsSchema>;
