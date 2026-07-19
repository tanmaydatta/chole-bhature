import { ConditionGroupSchema } from './conditions.js';
import type { ConditionGroup } from './conditions.js';
import {
  FreeShippingEffectSchema,
  LineItemDiscountEffectSchema,
  OrderDiscountEffectSchema,
} from './evaluation.js';
import { MoneySchema } from './money.js';
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

/** @internal Shared by future configuration contracts, but not part of the package API. */
export const PositiveSafeIntegerSchema = z.number().int().positive()
  .max(Number.MAX_SAFE_INTEGER);

const PositiveMoneySchema = MoneySchema.extend({
  minorUnits: PositiveSafeIntegerSchema,
});

export const CommissionRewardSchema = z.discriminatedUnion('calculation', [
  z.object({
    type: z.literal('commission'),
    calculation: z.literal('fixed'),
    amount: PositiveMoneySchema,
  }).strict(),
  z.object({
    type: z.literal('commission'),
    calculation: z.literal('percent'),
    basisPoints: z.number().int().min(1).max(10_000),
  }).strict(),
]);

export const WalletAccrualSchema = z.discriminatedUnion('calculation', [
  z.object({
    type: z.literal('wallet_accrual'),
    assetRef: z.string().min(1),
    calculation: z.literal('fixed'),
    quantity: PositiveSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('wallet_accrual'),
    assetRef: z.string().min(1),
    calculation: z.literal('per_unit'),
    sourceVariable: z.string()
      .regex(/^(event|customer|system)\.[a-z][a-z0-9_]*$/),
    sourceUnitsPerStep: PositiveSafeIntegerSchema,
    quantityPerStep: PositiveSafeIntegerSchema,
    rounding: z.literal('floor'),
  }).strict(),
]);

export const AffiliateRuleRewardSchema = z.object({
  customerReward: CommerceRewardSchema.optional(),
  affiliateReward: CommissionRewardSchema.optional(),
}).strict().superRefine((reward, context) => {
  if (reward.customerReward === undefined && reward.affiliateReward === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'at least one customer or affiliate reward is required',
    });
  }
});

const ReferralSideRewardSchema = z.union([
  CommerceRewardSchema,
  WalletAccrualSchema,
]);

export const ReferralRuleRewardSchema = z.object({
  referrerReward: ReferralSideRewardSchema.optional(),
  refereeReward: ReferralSideRewardSchema.optional(),
}).strict().superRefine((reward, context) => {
  if (reward.referrerReward === undefined && reward.refereeReward === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'at least one referrer or referee reward is required',
    });
  }
});

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
const AffiliateConditionalRewardSchemas = createConditionalRewardsSchema(AffiliateRuleRewardSchema);
const ReferralConditionalRewardSchemas = createConditionalRewardsSchema(ReferralRuleRewardSchema);
const LoyaltyConditionalRewardSchemas = createConditionalRewardsSchema(WalletAccrualSchema);

export const PromoRewardRuleSchema = PromoConditionalRewardSchemas.rule;
export const PromoFallbackRewardSchema = PromoConditionalRewardSchemas.fallback;
export const PromoConditionalRewardsSchema = PromoConditionalRewardSchemas.conditionalRewards;
export const AffiliateRewardRuleSchema = AffiliateConditionalRewardSchemas.rule;
export const AffiliateFallbackRewardSchema = AffiliateConditionalRewardSchemas.fallback;
export const AffiliateConditionalRewardsSchema = AffiliateConditionalRewardSchemas.conditionalRewards;
export const ReferralRewardRuleSchema = ReferralConditionalRewardSchemas.rule;
export const ReferralFallbackRewardSchema = ReferralConditionalRewardSchemas.fallback;
export const ReferralConditionalRewardsSchema = ReferralConditionalRewardSchemas.conditionalRewards;
export const LoyaltyRewardRuleSchema = LoyaltyConditionalRewardSchemas.rule;
export const LoyaltyFallbackRewardSchema = LoyaltyConditionalRewardSchemas.fallback;
export const LoyaltyConditionalRewardsSchema = LoyaltyConditionalRewardSchemas.conditionalRewards;

export type CommerceReward = z.infer<typeof CommerceRewardSchema>;
export type CommissionReward = z.infer<typeof CommissionRewardSchema>;
export type WalletAccrual = z.infer<typeof WalletAccrualSchema>;
export type AffiliateRuleReward = z.infer<typeof AffiliateRuleRewardSchema>;
export type ReferralRuleReward = z.infer<typeof ReferralRuleRewardSchema>;
export type PromoRewardRule = z.infer<typeof PromoRewardRuleSchema>;
export type PromoFallbackReward = z.infer<typeof PromoFallbackRewardSchema>;
export type PromoConditionalRewards = z.infer<typeof PromoConditionalRewardsSchema>;
export type AffiliateRewardRule = z.infer<typeof AffiliateRewardRuleSchema>;
export type AffiliateFallbackReward = z.infer<typeof AffiliateFallbackRewardSchema>;
export type AffiliateConditionalRewards = z.infer<typeof AffiliateConditionalRewardsSchema>;
export type ReferralRewardRule = z.infer<typeof ReferralRewardRuleSchema>;
export type ReferralFallbackReward = z.infer<typeof ReferralFallbackRewardSchema>;
export type ReferralConditionalRewards = z.infer<typeof ReferralConditionalRewardsSchema>;
export type LoyaltyRewardRule = z.infer<typeof LoyaltyRewardRuleSchema>;
export type LoyaltyFallbackReward = z.infer<typeof LoyaltyFallbackRewardSchema>;
export type LoyaltyConditionalRewards = z.infer<typeof LoyaltyConditionalRewardsSchema>;
