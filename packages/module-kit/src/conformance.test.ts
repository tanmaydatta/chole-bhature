import { describe, expect, test } from 'vitest';

import { resolveDecisionConflicts } from '@incentives/engine';

import type { IncentiveModule, ModuleConformanceFixture } from './index.js';
import { runModuleConformanceSuite } from './index.js';

interface FakeConfig {
  programRef: string;
}

function fixture(): ModuleConformanceFixture<FakeConfig> {
  return {
    context: {
      merchantId: 'merchant-1',
      evaluationId: 'eval-1',
      now: new Date('2026-07-18T12:00:00Z'),
      request: {
        cart: { currency: 'GBP', subtotal: 6_500, items: [] },
      },
      facts: {
        scalar: { 'cart.subtotal': 6_500 },
        lineItems: [],
      },
      definitions: [{
        key: 'cart.subtotal',
        label: 'Cart subtotal',
        source: 'cart',
        type: 'number',
        required: true,
      }],
    },
    config: { programRef: 'fake-program' },
  };
}

const fakeModule: IncentiveModule<FakeConfig> = {
  type: 'promo',
  async evaluate(_context, config) {
    return [{
      programRef: config.programRef,
      programRevision: 1,
      programType: 'promo',
      outcome: 'qualified',
      rewardRuleRef: 'default-reward',
      effects: [{ type: 'free_shipping' }],
      reasonCodes: [],
      commitRequired: true,
      eligible: true,
      priority: 10,
      stackable: false,
    }];
  },
};

describe('runModuleConformanceSuite', () => {
  test('accepts a deterministic, pure module with canonical decisions', async () => {
    await expect(runModuleConformanceSuite(fakeModule, fixture())).resolves.toEqual({
      passed: true,
    });
  });

  test('emits decisions directly consumable by the central conflict resolver', async () => {
    const value = fixture();
    const decisions = await fakeModule.evaluate(value.context, value.config);

    expect(resolveDecisionConflicts(decisions)).toEqual(decisions);
  });

  test('rejects a decision whose program type differs from its module', async () => {
    const wrongType = {
      ...fakeModule,
      async evaluate(context, config) {
        const decisions = await fakeModule.evaluate(context, config);
        return decisions.map((decision) => ({
          ...decision,
          programType: 'referral' as const,
        }));
      },
    } satisfies IncentiveModule<FakeConfig>;

    await expect(runModuleConformanceSuite(wrongType, fixture())).rejects.toThrow(
      /program type/i,
    );
  });

  test('rejects effects that do not satisfy the canonical effect schema', async () => {
    const invalidEffect = {
      ...fakeModule,
      async evaluate(context, config) {
        const [decision] = await fakeModule.evaluate(context, config);
        if (!decision) return [];
        return [{
          ...decision,
          effects: [{ type: 'order_discount', calculation: 'fixed' }],
        }];
      },
    } as IncentiveModule<FakeConfig>;

    await expect(runModuleConformanceSuite(invalidEffect, fixture())).rejects.toThrow(
      /effect/i,
    );
  });

  test('rejects output that changes for identical input', async () => {
    let invocation = 0;
    const nondeterministic = {
      ...fakeModule,
      async evaluate(context, config) {
        const [decision] = await fakeModule.evaluate(context, config);
        if (!decision) return [];
        invocation += 1;
        return [{ ...decision, programRef: `${config.programRef}-${invocation}` }];
      },
    } satisfies IncentiveModule<FakeConfig>;

    await expect(runModuleConformanceSuite(nondeterministic, fixture())).rejects.toThrow(
      /deterministic/i,
    );
  });

  test('rejects unstable reason-code syntax', async () => {
    const unstableReasonCode = {
      ...fakeModule,
      async evaluate(context, config) {
        const [decision] = await fakeModule.evaluate(context, config);
        if (!decision) return [];
        return [{
          ...decision,
          outcome: 'not_qualified' as const,
          reasonCodes: ['changes-too-easily'],
          effects: [],
          commitRequired: false,
          eligible: false,
        }];
      },
    } satisfies IncentiveModule<FakeConfig>;

    await expect(runModuleConformanceSuite(unstableReasonCode, fixture())).rejects.toThrow(
      /reason code/i,
    );
  });

  test('rejects an eligible value that contradicts the outcome', async () => {
    const contradictoryEligibility = {
      ...fakeModule,
      async evaluate(context, config) {
        const [decision] = await fakeModule.evaluate(context, config);
        return decision ? [{ ...decision, eligible: false }] : [];
      },
    } satisfies IncentiveModule<FakeConfig>;

    await expect(
      runModuleConformanceSuite(contradictoryEligibility, fixture()),
    ).rejects.toThrow(/eligible/i);
  });

  test.each([
    ['missing', undefined],
    ['non-boolean', 'yes'],
  ] as const)('rejects %s stackable conflict metadata at runtime', async (
    _description,
    stackable,
  ) => {
    const invalidStackable = {
      ...fakeModule,
      async evaluate(context, config) {
        const [decision] = await fakeModule.evaluate(context, config);
        if (!decision) return [];
        return [{ ...decision, stackable }];
      },
    } as IncentiveModule<FakeConfig>;

    await expect(
      runModuleConformanceSuite(invalidStackable, fixture()),
    ).rejects.toThrow(/stackable.*boolean/i);
  });

  test.each([
    ['request', (value: ModuleConformanceFixture<FakeConfig>) => {
      value.context.request.cart.subtotal = 1;
    }],
    ['facts', (value: ModuleConformanceFixture<FakeConfig>) => {
      value.context.facts.scalar['cart.subtotal'] = 1;
    }],
    ['config', (value: ModuleConformanceFixture<FakeConfig>) => {
      value.config.programRef = 'mutated';
    }],
  ] as const)('rejects mutation of the %s fixture', async (_name, mutate) => {
    const mutatingModule = {
      ...fakeModule,
      async evaluate(context, config) {
        const wrapped = { context, config };
        mutate(wrapped);
        return fakeModule.evaluate(context, config);
      },
    } satisfies IncentiveModule<FakeConfig>;

    await expect(runModuleConformanceSuite(mutatingModule, fixture())).rejects.toThrow(
      /mutate/i,
    );
  });
});
