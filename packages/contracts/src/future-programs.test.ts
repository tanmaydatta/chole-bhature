import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { describe, expect, test } from 'vitest';

import {
  AffiliateProgramSchema,
  CommissionRewardSchema,
  LoyaltyProgramSchema,
  ProgramListResponseSchema,
  ReferralProgramSchema,
  WalletAccrualSchema,
} from './index.js';

const futureContractDescription = 'Future configuration contract; no runtime routes';

const eligibility = {
  match: 'ALL' as const,
  conditions: [],
};

const eventOrderTotalAtLeast100 = {
  match: 'ALL' as const,
  conditions: [{
    id: 'order-total-at-least-100',
    variable: 'event.order_total',
    operator: 'gte' as const,
    value: 10_000,
  }],
};

const customerReward = {
  type: 'order_discount' as const,
  calculation: 'fixed' as const,
  amount: { currency: 'GBP', minorUnits: 500 },
};

const affiliateReward = {
  type: 'commission' as const,
  calculation: 'fixed' as const,
  amount: { currency: 'USD', minorUnits: 200 },
};

const fixedWalletAccrual = {
  type: 'wallet_accrual' as const,
  assetRef: 'stars',
  calculation: 'fixed' as const,
  quantity: 10,
};

const perUnitWalletAccrual = {
  type: 'wallet_accrual' as const,
  assetRef: 'stars',
  calculation: 'per_unit' as const,
  sourceVariable: 'event.order_total',
  sourceUnitsPerStep: 100,
  quantityPerStep: 2,
  rounding: 'floor' as const,
};

const affiliateBase = {
  id: 'affiliate-1',
  type: 'affiliate' as const,
  name: 'Affiliate programme',
  status: 'draft' as const,
  eligibility,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  usageCap: 1_000,
  perCustomerCap: 5,
  codeBatchCount: 100,
  perCodeUseLimit: 1,
};

const referralBase = {
  id: 'referral-1',
  type: 'referral' as const,
  name: 'Referral programme',
  status: 'draft' as const,
  eligibility,
  priority: 10,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  usageCap: 1_000,
  perCustomerCap: 5,
};

const loyaltyBase = {
  id: 'loyalty-1',
  type: 'loyalty' as const,
  name: 'Loyalty programme',
  status: 'draft' as const,
  triggerEvent: 'order_completed',
  eligibility,
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  usageCap: 1_000,
  perCustomerCap: 5,
};

function rule<TReward>(id: string, reward: TReward) {
  return {
    id,
    name: `Reward ${id}`,
    conditions: eventOrderTotalAtLeast100,
    reward,
  };
}

describe('future Affiliate configuration contract', () => {
  test.each([
    ['customer-only', { customerReward }],
    ['affiliate-only', { affiliateReward }],
    ['two-sided', { customerReward, affiliateReward }],
  ])('accepts a %s reward bundle', (_name, reward) => {
    expect(AffiliateProgramSchema.safeParse({
      ...affiliateBase,
      rewardRules: [rule('affiliate-rule', reward)],
    }).success).toBe(true);
  });

  test('rejects an empty reward bundle', () => {
    expect(AffiliateProgramSchema.safeParse({
      ...affiliateBase,
      rewardRules: [rule('empty', {})],
    }).success).toBe(false);
  });

  test('validates fixed and percentage commissions', () => {
    expect(CommissionRewardSchema.safeParse(affiliateReward).success).toBe(true);
    expect(CommissionRewardSchema.safeParse({
      type: 'commission',
      calculation: 'percent',
      basisPoints: 1,
    }).success).toBe(true);
    expect(CommissionRewardSchema.safeParse({
      type: 'commission',
      calculation: 'percent',
      basisPoints: 10_000,
    }).success).toBe(true);

    for (const commission of [
      { type: 'commission', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 0 } },
      { type: 'commission', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 1.5 } },
      {
        type: 'commission',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: Number.MAX_SAFE_INTEGER + 1 },
      },
      { type: 'commission', calculation: 'percent', basisPoints: 0 },
      { type: 'commission', calculation: 'percent', basisPoints: 10_001 },
      { type: 'commission', calculation: 'percent', basisPoints: 1.5 },
    ]) {
      expect(CommissionRewardSchema.safeParse(commission).success).toBe(false);
    }
  });

  test('validates commission and customer-reward currencies independently', () => {
    const parsed = AffiliateProgramSchema.parse({
      ...affiliateBase,
      rewardRules: [rule('two-currencies', { customerReward, affiliateReward })],
    });

    const reward = parsed.rewardRules[0]?.reward;
    expect(reward?.customerReward?.calculation === 'fixed'
      ? reward.customerReward.amount.currency
      : undefined).toBe('GBP');
    expect(reward?.affiliateReward?.calculation === 'fixed'
      ? reward.affiliateReward.amount.currency
      : undefined).toBe('USD');
  });

  test.each(['codeBatchCount', 'perCodeUseLimit'])(
    'requires %s to be a positive safe integer',
    (field) => {
      for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(AffiliateProgramSchema.safeParse({
          ...affiliateBase,
          rewardRules: [rule('affiliate-rule', { customerReward })],
          [field]: value,
        }).success).toBe(false);
      }
    },
  );
});

describe('future Referral configuration contract', () => {
  test.each([
    ['referrer-only commerce', { referrerReward: customerReward }],
    ['referee-only wallet accrual', { refereeReward: fixedWalletAccrual }],
    ['two-sided wallet and commerce', {
      referrerReward: perUnitWalletAccrual,
      refereeReward: customerReward,
    }],
    ['two-sided commerce and wallet', {
      referrerReward: customerReward,
      refereeReward: perUnitWalletAccrual,
    }],
  ])('accepts a %s reward bundle', (_name, reward) => {
    expect(ReferralProgramSchema.safeParse({
      ...referralBase,
      rewardRules: [rule('referral-rule', reward)],
    }).success).toBe(true);
  });

  test('rejects an empty reward bundle', () => {
    expect(ReferralProgramSchema.safeParse({
      ...referralBase,
      rewardRules: [rule('empty', {})],
    }).success).toBe(false);
  });
});

describe('future Loyalty configuration contract', () => {
  test('accepts fixed wallet accrual', () => {
    expect(LoyaltyProgramSchema.safeParse({
      ...loyaltyBase,
      rewardRules: [rule('fixed-stars', fixedWalletAccrual)],
    }).success).toBe(true);
  });

  test('accepts a loyalty asset with client-defined terminology', () => {
    expect(LoyaltyProgramSchema.parse({
      ...loyaltyBase,
      triggerEvent: 'order_completed',
      rewardRules: [{
        id: 'gold-order',
        name: 'Gold order Stars',
        conditions: eventOrderTotalAtLeast100,
        reward: {
          type: 'wallet_accrual',
          assetRef: 'stars',
          calculation: 'per_unit',
          sourceVariable: 'event.order_total',
          sourceUnitsPerStep: 100,
          quantityPerStep: 2,
          rounding: 'floor',
        },
      }],
    }).rewardRules[0]?.reward.assetRef).toBe('stars');
  });

  test.each(['stars', 'miles', 'cashback_gbp'])(
    'accepts the opaque asset reference %s',
    (assetRef) => {
      expect(WalletAccrualSchema.safeParse({
        ...fixedWalletAccrual,
        assetRef,
      }).success).toBe(true);
    },
  );

  test('requires positive safe integer accrual inputs', () => {
    for (const accrual of [
      { ...fixedWalletAccrual, quantity: 0 },
      { ...fixedWalletAccrual, quantity: Number.MAX_SAFE_INTEGER + 1 },
      { ...fixedWalletAccrual, quantity: 1.5 },
      { ...perUnitWalletAccrual, sourceUnitsPerStep: 0 },
      { ...perUnitWalletAccrual, sourceUnitsPerStep: Number.MAX_SAFE_INTEGER + 1 },
      { ...perUnitWalletAccrual, quantityPerStep: 0 },
      { ...perUnitWalletAccrual, quantityPerStep: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(WalletAccrualSchema.safeParse(accrual).success).toBe(false);
    }
  });

  test('requires floor rounding and an allowed source-variable namespace', () => {
    for (const sourceVariable of [
      'event.order_total',
      'customer.lifetime_value',
      'system.exchange_rate',
    ]) {
      expect(WalletAccrualSchema.safeParse({
        ...perUnitWalletAccrual,
        sourceVariable,
      }).success).toBe(true);
    }

    for (const accrual of [
      { ...perUnitWalletAccrual, rounding: 'ceil' },
      { ...perUnitWalletAccrual, sourceVariable: 'cart.subtotal' },
      { ...perUnitWalletAccrual, sourceVariable: 'event.OrderTotal' },
      { ...perUnitWalletAccrual, sourceVariable: 'event.order.total' },
    ]) {
      expect(WalletAccrualSchema.safeParse(accrual).success).toBe(false);
    }
  });

  test('requires one asset reference across every selectable reward', () => {
    expect(LoyaltyProgramSchema.safeParse({
      ...loyaltyBase,
      rewardRules: [
        rule('fixed-stars', fixedWalletAccrual),
        rule('variable-stars', perUnitWalletAccrual),
      ],
      fallbackReward: {
        id: 'fallback-stars',
        name: 'Fallback Stars',
        reward: fixedWalletAccrual,
      },
    }).success).toBe(true);

    expect(LoyaltyProgramSchema.safeParse({
      ...loyaltyBase,
      rewardRules: [
        rule('fixed-stars', fixedWalletAccrual),
        rule('variable-miles', { ...perUnitWalletAccrual, assetRef: 'miles' }),
      ],
    }).success).toBe(false);

    expect(LoyaltyProgramSchema.safeParse({
      ...loyaltyBase,
      rewardRules: [rule('fixed-stars', fixedWalletAccrual)],
      fallbackReward: {
        id: 'fallback-miles',
        name: 'Fallback Miles',
        reward: { ...fixedWalletAccrual, assetRef: 'miles' },
      },
    }).success).toBe(false);
  });
});

describe.each([
  ['Affiliate', AffiliateProgramSchema, {
    ...affiliateBase,
    rewardRules: [rule('affiliate-rule', { customerReward })],
  }],
  ['Referral', ReferralProgramSchema, {
    ...referralBase,
    rewardRules: [rule('referral-rule', { referrerReward: customerReward })],
  }],
  ['Loyalty', LoyaltyProgramSchema, {
    ...loyaltyBase,
    rewardRules: [rule('loyalty-rule', fixedWalletAccrual)],
  }],
])('%s program constraints', (_name, schema, validProgram) => {
  test('rejects an end date before the start date', () => {
    expect(schema.safeParse({
      ...validProgram,
      startDate: '2026-08-02',
      endDate: '2026-08-01',
    }).success).toBe(false);
  });

  test('rejects a per-customer cap above the usage cap', () => {
    expect(schema.safeParse({
      ...validProgram,
      usageCap: 5,
      perCustomerCap: 6,
    }).success).toBe(false);
  });

  test('allows equal schedule boundaries and caps', () => {
    expect(schema.safeParse({
      ...validProgram,
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      usageCap: 5,
      perCustomerCap: 5,
    }).success).toBe(true);
  });

  test.each(['usageCap', 'perCustomerCap'])(
    'requires %s to be a positive safe integer',
    (field) => {
      for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(schema.safeParse({
          ...validProgram,
          [field]: value,
        }).success).toBe(false);
      }
    },
  );

  test('rejects unknown top-level configuration fields', () => {
    expect(schema.safeParse({
      ...validProgram,
      runtimeEnabled: true,
    }).success).toBe(false);
  });

  test('is identified as a non-runtime configuration contract', () => {
    const registry = new OpenAPIRegistry();
    registry.register('FutureProgram', schema);
    const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: { title: 'Future program contract', version: '1.0.0' },
    });

    expect(document.components?.schemas?.FutureProgram).toMatchObject({
      description: futureContractDescription,
    });
  });
});

test.each([
  ['Affiliate', {
    ...affiliateBase,
    rewardRules: [rule('affiliate-rule', { customerReward })],
  }],
  ['Referral', {
    ...referralBase,
    rewardRules: [rule('referral-rule', { referrerReward: customerReward })],
  }],
  ['Loyalty', {
    ...loyaltyBase,
    rewardRules: [rule('loyalty-rule', fixedWalletAccrual)],
  }],
])('keeps %s programs out of the runtime program list', (_name, program) => {
  expect(ProgramListResponseSchema.safeParse({ programs: [program] }).success).toBe(false);
});
