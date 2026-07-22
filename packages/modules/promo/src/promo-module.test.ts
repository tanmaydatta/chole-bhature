import { describe, expect, test } from 'vitest';

import type { PromoProgram, VariableDefinition } from '@incentives/contracts';
import type { FactSet } from '@incentives/engine';
import {
  runModuleConformanceSuite,
  type ModuleEvaluationContext,
} from '@incentives/module-kit';

import { PromoModule } from './index.js';

const definitions: VariableDefinition[] = [
  {
    key: 'cart.subtotal',
    label: 'Cart subtotal',
    source: 'cart',
    type: 'number',
    required: true,
    defaultErrorMessage: 'Spend more before using this code.',
  },
  {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'enum',
    required: false,
    enumValues: ['silver', 'gold'],
    defaultErrorMessage: 'This code is only for eligible tiers.',
  },
];

const facts: FactSet = {
  scalar: { 'cart.subtotal': 6_500 },
  lineItems: [],
};

const context: ModuleEvaluationContext = {
  merchantId: 'merchant-1',
  evaluationId: 'eval-1',
  now: new Date('2026-07-18T12:00:00Z'),
  request: {
    code: 'WELCOME10',
    cart: { currency: 'GBP', subtotal: 6_500, items: [] },
  },
  facts,
  definitions,
};

const welcome10: PromoProgram = {
  id: 'welcome-10',
  type: 'promo',
  name: 'Welcome £10',
  status: 'active',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  code: 'WELCOME10',
  autoApply: false,
  eligibility: {
    match: 'ALL',
    conditions: [{
      id: 'minimum-cart',
      variable: 'cart.subtotal',
      operator: 'gte',
      value: 5_000,
    }],
  },
  rewardRules: [{
    id: 'default-reward',
    name: 'Default reward',
    conditions: {
      match: 'ALL',
      conditions: [{
        id: 'positive-cart',
        variable: 'cart.subtotal',
        operator: 'gte',
        value: 0,
      }],
    },
    reward: {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    },
  }],
  stackable: false,
  priority: 100,
};

describe('PromoModule', () => {
  test('satisfies the shared module conformance suite', async () => {
    await expect(runModuleConformanceSuite(PromoModule, {
      context,
      config: welcome10,
    })).resolves.toEqual({ passed: true });
  });

  test('qualifies and emits a canonical fixed order discount', async () => {
    const [decision] = await PromoModule.evaluate(context, welcome10);

    expect(decision).toMatchObject({
      programRef: 'welcome-10',
      programRevision: 1,
      programType: 'promo',
      outcome: 'qualified',
      rewardRuleRef: 'default-reward',
      effects: [{
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 1_000 },
      }],
      reasonCodes: [],
      commitRequired: true,
      eligible: true,
      priority: 100,
      stackable: false,
    });
  });

  test('returns invalid_code without an effect for a mismatched code', async () => {
    const [decision] = await PromoModule.evaluate({
      ...context,
      request: { ...context.request, code: 'WRONG' },
    }, welcome10);

    expect(decision).toMatchObject({
      outcome: 'invalid_code',
      effects: [],
      reasonCodes: ['INVALID_PROMO_CODE'],
      commitRequired: false,
      eligible: false,
    });
    expect(decision).not.toHaveProperty('rewardRuleRef');
  });

  test.each(['draft', 'scheduled', 'paused', 'ended'] as const)(
    'treats %s programs as unavailable',
    async (status) => {
      const [decision] = await PromoModule.evaluate(context, { ...welcome10, status });
      expect(decision).toMatchObject({
        outcome: 'unavailable',
        effects: [],
        reasonCodes: ['PROGRAM_UNAVAILABLE'],
        commitRequired: false,
        eligible: false,
      });
      expect(decision).not.toHaveProperty('rewardRuleRef');
    },
  );

  test.each(['draft', 'scheduled', 'paused', 'ended'] as const)(
    'keeps a %s program unavailable even when the request code is wrong',
    async (status) => {
      const [decision] = await PromoModule.evaluate({
        ...context,
        request: { ...context.request, code: 'WRONG' },
      }, { ...welcome10, status });

      expect(decision).toMatchObject({
        outcome: 'unavailable',
        reasonCodes: ['PROGRAM_UNAVAILABLE'],
      });
    },
  );

  test('does not qualify a non-auto-apply program with no configured code', async () => {
    const { code: _code, ...withoutCode } = welcome10;
    const [decision] = await PromoModule.evaluate(
      {
        ...context,
        request: {
          cart: context.request.cart,
        },
      },
      withoutCode as PromoProgram,
    );

    expect(decision).toMatchObject({
      outcome: 'invalid_code',
      effects: [],
      reasonCodes: ['INVALID_PROMO_CODE'],
      commitRequired: false,
      eligible: false,
    });
    expect(decision).not.toHaveProperty('rewardRuleRef');
  });

  test.each([
    ['before its start date', new Date('2026-06-30T23:59:59Z')],
    ['after its end date', new Date('2026-08-01T00:00:00Z')],
  ])('treats an active program %s as unavailable', async (_description, now) => {
    const [decision] = await PromoModule.evaluate({ ...context, now }, welcome10);
    expect(decision).toMatchObject({
      outcome: 'unavailable',
      reasonCodes: ['PROGRAM_UNAVAILABLE'],
      effects: [],
    });
  });

  test('uses the first failing condition and its resolved message', async () => {
    const program: PromoProgram = {
      ...welcome10,
      eligibility: {
        match: 'ALL',
        conditions: [
          {
            id: 'minimum-cart',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 7_000,
            message: 'Add another item to use this code.',
          },
          {
            id: 'gold-only',
            variable: 'customer.tier',
            operator: 'eq',
            value: 'gold',
          },
        ],
      },
    };

    const [decision] = await PromoModule.evaluate(context, program);
    expect(decision).toMatchObject({
      outcome: 'not_qualified',
      reasonCodes: ['CONDITION_NOT_MET'],
      message: 'Add another item to use this code.',
      effects: [],
      commitRequired: false,
      eligible: false,
    });
    expect(decision).not.toHaveProperty('rewardRuleRef');
  });

  test('selects the first matching reward rule and preserves authoritative order', async () => {
    const over5k = welcome10.rewardRules[0]!;
    const over6k = {
      ...over5k,
      id: 'over-6000',
      name: 'Over 6000',
      conditions: {
        match: 'ALL' as const,
        conditions: [{
          id: 'cart-over-6000',
          variable: 'cart.subtotal',
          operator: 'gte' as const,
          value: 6_000,
        }],
      },
      reward: { type: 'free_shipping' as const },
    };

    const [first] = await PromoModule.evaluate(context, {
      ...welcome10,
      rewardRules: [over5k, over6k],
    });
    const [reversed] = await PromoModule.evaluate(context, {
      ...welcome10,
      rewardRules: [over6k, over5k],
    });

    expect(first).toMatchObject({
      outcome: 'qualified',
      rewardRuleRef: 'default-reward',
      effects: [over5k.reward],
    });
    expect(reversed).toMatchObject({
      outcome: 'qualified',
      rewardRuleRef: 'over-6000',
      effects: [over6k.reward],
    });
  });

  test('selects the fallback when no conditional rule matches', async () => {
    const [decision] = await PromoModule.evaluate(context, {
      ...welcome10,
      rewardRules: [{
        ...welcome10.rewardRules[0]!,
        conditions: {
          match: 'ALL',
          conditions: [{
            id: 'cart-over-10000',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 10_000,
          }],
        },
      }],
      fallbackReward: {
        id: 'fallback',
        name: 'Fallback',
        reward: { type: 'free_shipping' },
      },
    });

    expect(decision).toMatchObject({
      outcome: 'qualified',
      rewardRuleRef: 'fallback',
      effects: [{ type: 'free_shipping' }],
    });
  });

  test('returns no-match semantics when no reward rule matches', async () => {
    const [decision] = await PromoModule.evaluate(context, {
      ...welcome10,
      rewardRules: [{
        ...welcome10.rewardRules[0]!,
        conditions: {
          match: 'ALL',
          conditions: [{
            id: 'cart-over-10000',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 10_000,
          }],
        },
      }],
    });

    expect(decision).toEqual(expect.objectContaining({
      outcome: 'not_qualified',
      effects: [],
      reasonCodes: ['NO_REWARD_RULE_MATCHED'],
      commitRequired: false,
      eligible: false,
    }));
    expect(decision).not.toHaveProperty('rewardRuleRef');
    expect(decision).not.toHaveProperty('message');
  });

  test('emits percent rewards as integer basis points without precomputing money', async () => {
    const [decision] = await PromoModule.evaluate(context, {
      ...welcome10,
      rewardRules: [{
        ...welcome10.rewardRules[0]!,
        reward: {
          type: 'order_discount',
          calculation: 'percent',
          basisPoints: 1_250,
        },
      }],
    });

    expect(decision?.effects).toEqual([{
      type: 'order_discount',
      calculation: 'percent',
      basisPoints: 1_250,
    }]);
  });

  test.each([
    {
      type: 'line_item_discount' as const,
      productRef: 'product-1',
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 250 },
    },
    { type: 'free_shipping' as const },
  ])('copies a selected $type reward into effects', async (reward) => {
    const [decision] = await PromoModule.evaluate(context, {
      ...welcome10,
      rewardRules: [{ ...welcome10.rewardRules[0]!, reward }],
    });

    expect(decision).toMatchObject({
      rewardRuleRef: 'default-reward',
      effects: [reward],
    });
    expect(decision?.effects[0]).not.toBe(reward);
  });

  test('handles absent optional customer data as an ordinary first failure', async () => {
    const [decision] = await PromoModule.evaluate(context, {
      ...welcome10,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'gold-only',
          variable: 'customer.tier',
          operator: 'eq',
          value: 'gold',
        }],
      },
    });

    expect(decision).toMatchObject({
      outcome: 'not_qualified',
      reasonCodes: ['ATTRIBUTE_MISSING'],
      message: 'This code is only for eligible tiers.',
      effects: [],
      commitRequired: false,
      eligible: false,
    });
  });

  test('does not mutate request, facts, definitions, or program configuration', async () => {
    const contextBefore = structuredClone(context);
    const programBefore = structuredClone(welcome10);

    await PromoModule.evaluate(context, welcome10);

    expect(context).toEqual(contextBefore);
    expect(welcome10).toEqual(programBefore);
  });
});
