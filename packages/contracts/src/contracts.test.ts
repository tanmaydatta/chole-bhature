import { describe, expect, test } from 'vitest';

import {
  CartSnapshotSchema,
  CodeEvaluationResultSchema,
  CommerceRewardSchema,
  CustomerSnapshotSchema,
  EffectSchema,
  EvaluationResponseSchema,
  EvaluationRequestSchema,
  MoneySchema,
  NormalizedPromoCodeSchema,
  OrderSnapshotSchema,
  PromoConditionalRewardsSchema,
  PromoCodeSchema,
  PromoProgramSchema,
  RedemptionEntrySchema,
  RedemptionRequestSchema,
  RedemptionResponseSchema,
  VariableDefinitionSchema,
  buildOpenApiDocument,
  buildPublishedEvaluationJsonSchema,
  normalizeDistinctPromoCodes,
  normalizePromoCode,
} from './index.js';
import type { CommerceReward, RewardRule } from './index.js';

const over100Rule: RewardRule<CommerceReward> = {
  id: 'over-100',
  name: 'Over 100',
  conditions: {
    match: 'ALL',
    conditions: [{
      id: 'cart-over-100',
      variable: 'cart.subtotal',
      operator: 'gte',
      value: 10_000,
    }],
  },
  reward: {
    type: 'order_discount',
    calculation: 'percent',
    basisPoints: 2_000,
  },
};

const under100Rule: RewardRule<CommerceReward> = {
  id: 'under-100',
  name: 'Under 100',
  conditions: {
    match: 'ANY',
    conditions: [],
    groups: [{
      match: 'ALL',
      conditions: [{
        id: 'cart-under-100',
        variable: 'cart.subtotal',
        operator: 'lt',
        value: 10_000,
      }],
    }],
  },
  reward: {
    type: 'line_item_discount',
    productRef: 'product-1',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 500 },
  },
};

const fallback = {
  id: 'default-reward',
  name: 'Default reward',
  reward: { type: 'free_shipping' as const },
};

const validCart = {
  currency: 'GBP',
  subtotal: 6_500,
  items: [],
};

const basePromo = {
  id: 'promo-a',
  type: 'promo' as const,
  name: 'Promo A',
  status: 'active' as const,
  eligibility: { match: 'ALL' as const, conditions: [] },
  rewardRules: [],
  fallbackReward: fallback,
  priority: 10,
};

describe('canonical contracts', () => {
  test('requires bounded conditional reward rule names', () => {
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [{ ...over100Rule, name: '' }],
    }).success).toBe(false);
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [{ ...over100Rule, name: 'x'.repeat(201) }],
    }).success).toBe(false);
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [over100Rule],
    }).success).toBe(true);
  });

  test('requires every conditional reward rule to contain a condition leaf', () => {
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [{
        ...over100Rule,
        conditions: { match: 'ALL', conditions: [] },
      }],
    }).success).toBe(false);
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [{
        ...over100Rule,
        conditions: {
          match: 'ALL',
          conditions: [],
          groups: [{ match: 'ANY', conditions: [] }],
        },
      }],
    }).success).toBe(false);
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [under100Rule],
    }).success).toBe(true);
  });

  test('requires unique conditional reward rule ids', () => {
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [over100Rule, { ...under100Rule, id: 'over-100' }],
    }).success).toBe(false);
  });

  test('requires at least one conditional reward rule or fallback', () => {
    expect(PromoConditionalRewardsSchema.safeParse({ rewardRules: [] }).success).toBe(false);
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [],
      fallbackReward: fallback,
    }).success).toBe(true);
  });

  test('preserves authoritative rule order and rejects a duplicate fallback id', () => {
    const parsed = PromoConditionalRewardsSchema.parse({
      rewardRules: [over100Rule, under100Rule],
      fallbackReward: fallback,
    });
    expect(parsed.rewardRules.map(rule => rule.id)).toEqual(['over-100', 'under-100']);
    expect(PromoConditionalRewardsSchema.safeParse({
      rewardRules: [over100Rule],
      fallbackReward: { ...fallback, id: 'over-100' },
    }).success).toBe(false);
  });

  test.each([
    {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    },
    {
      type: 'line_item_discount',
      productRef: 'product-1',
      calculation: 'percent',
      basisPoints: 1_000,
    },
    { type: 'free_shipping' },
  ])('parses $type payloads as commerce rewards', (reward) => {
    expect(CommerceRewardSchema.safeParse(reward).success).toBe(true);
  });

  test('defines strict platform-neutral commerce snapshots', () => {
    expect(CustomerSnapshotSchema.safeParse({
      externalRef: ' Customer::001 ',
      attributes: { tier: 'gold' },
    }).success).toBe(true);
    expect(CustomerSnapshotSchema.safeParse({
      externalRef: 'customer-1',
      attributes: {},
      platform: 'fake',
    }).success).toBe(false);

    expect(CartSnapshotSchema.safeParse({
      currency: 'GBP',
      subtotal: 6_500,
      items: [{
        productRef: ' Product::001 ',
        variantRef: ' Variant::001 ',
        quantity: 1,
        unitPrice: 6_500,
      }],
    }).success).toBe(true);
    expect(CartSnapshotSchema.safeParse({
      currency: 'GBP',
      subtotal: 6_500,
      items: [],
      customer: { tier: 'gold' },
    }).success).toBe(false);

    expect(OrderSnapshotSchema.safeParse({
      externalRef: ' Order::001 ',
      idempotencyKey: ' Idempotency::001 ',
      currency: 'GBP',
      total: 6_500,
      customerRef: ' Customer::001 ',
      items: [],
    }).success).toBe(true);
    expect(OrderSnapshotSchema.safeParse({
      externalRef: 'order-1',
      idempotencyKey: 'idempotency-1',
      currency: 'gbp',
      total: 65.5,
      items: [],
    }).success).toBe(false);
    expect(OrderSnapshotSchema.safeParse({
      externalRef: 'order-1',
      idempotencyKey: 'idempotency-1',
      currency: 'GBP',
      total: -1,
      items: [],
      platform: 'fake',
    }).success).toBe(false);
  });

  test('requires integer minor units and a three-letter currency', () => {
    expect(MoneySchema.safeParse({ currency: 'GBP', minorUnits: 1000 }).success).toBe(true);
    expect(MoneySchema.safeParse({ currency: 'gb', minorUnits: 10.5 }).success).toBe(false);
  });

  test('rejects persistent customer attributes in evaluation input', () => {
    const result = EvaluationRequestSchema.safeParse({
      customerRef: 'customer-1',
      customer: { tier: 'gold' },
      cart: { currency: 'GBP', subtotal: 6500, items: [] },
    });
    expect(result.success).toBe(false);
  });

  test('uses omitted or empty codes for automatic evaluation', () => {
    expect(EvaluationRequestSchema.parse({ cart: validCart })).toEqual({
      cart: validCart,
    });
    expect(EvaluationRequestSchema.parse({ codes: [], cart: validCart })).toEqual({
      codes: [],
      cart: validCart,
    });
  });

  test('accepts up to ten distinct submitted codes and rejects eleven', () => {
    const tenCodes = Array.from({ length: 10 }, (_, index) => `code-${index}`);
    expect(EvaluationRequestSchema.safeParse({
      codes: tenCodes,
      cart: validCart,
    }).success).toBe(true);
    expect(EvaluationRequestSchema.safeParse({
      codes: [...tenCodes, 'code-10'],
      cart: validCart,
    }).success).toBe(false);
  });

  test('counts distinct normalized codes rather than raw entries', () => {
    expect(EvaluationRequestSchema.safeParse({
      codes: [
        ' code-0 ',
        'CODE-0',
        'code-1',
        'code-2',
        'code-3',
        'code-4',
        'code-5',
        'code-6',
        'code-7',
        'code-8',
        'code-9',
      ],
      cart: validCart,
    }).success).toBe(true);
  });

  test('rejects the removed singular evaluation code', () => {
    expect(() => EvaluationRequestSchema.parse({
      code: 'GATEC15',
      cart: validCart,
    })).toThrow();
  });

  test('normalizes codes by trimming and default uppercase conversion', () => {
    expect(normalizePromoCode('  gatec15  ')).toEqual({
      display: 'gatec15',
      normalized: 'GATEC15',
    });
    expect(normalizePromoCode('ß')).toEqual({
      display: 'ß',
      normalized: 'SS',
    });
    expect(NormalizedPromoCodeSchema.parse(' gatec15 ')).toBe('GATEC15');
  });

  test('deduplicates normalized codes while preserving the first display value', () => {
    expect(normalizeDistinctPromoCodes([' gatec15 ', 'GATEC15', 'vip20'])).toEqual([
      { display: 'gatec15', normalized: 'GATEC15' },
      { display: 'vip20', normalized: 'VIP20' },
    ]);
  });

  test('uses Unicode code-point length for promo code bounds', () => {
    expect(PromoCodeSchema.safeParse('😀'.repeat(128)).success).toBe(true);
    expect(PromoCodeSchema.safeParse('😀'.repeat(129)).success).toBe(false);
    expect(PromoCodeSchema.safeParse('  ').success).toBe(false);
  });

  test('reports an invalid submitted code without throwing from safe parsing', () => {
    expect(() => EvaluationRequestSchema.safeParse({
      codes: ['  '],
      cart: validCart,
    })).not.toThrow();
    expect(EvaluationRequestSchema.safeParse({
      codes: ['  '],
      cart: validCart,
    }).success).toBe(false);
  });

  test('does not apply compatibility or fuzzy normalization', () => {
    expect(normalizeDistinctPromoCodes(['gatec15', 'ｇａｔｅｃ１５'])).toEqual([
      { display: 'gatec15', normalized: 'GATEC15' },
      { display: 'ｇａｔｅｃ１５', normalized: 'ＧＡＴＥＣ１５' },
    ]);
  });

  test('rejects more than ten distinct normalized codes in shared helpers', () => {
    expect(() => normalizeDistinctPromoCodes(
      Array.from({ length: 11 }, (_, index) => `code-${index}`),
    )).toThrow(RangeError);
  });

  test('accepts a typed line-item extension definition', () => {
    expect(VariableDefinitionSchema.parse({
      key: 'line_item.category',
      label: 'Category',
      source: 'line_item',
      type: 'string',
      required: false,
    }).key).toBe('line_item.category');
  });

  test('requires enum values and matching source namespaces', () => {
    expect(VariableDefinitionSchema.safeParse({
      key: 'context.channel',
      label: 'Channel',
      source: 'customer',
      type: 'enum',
      required: true,
    }).success).toBe(false);
  });

  test('accepts structured decisions with derived eligibility', () => {
    expect(EvaluationResponseSchema.safeParse({
      evaluationId: 'evaluation-1',
      schemaVersion: 3,
      expiresAt: '2026-07-18T15:05:00Z',
      decisions: [{
        programRef: 'welcome-10',
        programRevision: 1,
        programType: 'promo',
        outcome: 'qualified',
        rewardRuleRef: 'default-reward',
        effects: [{
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 1000 },
        }],
        reasonCodes: [],
        commitRequired: true,
        eligible: true,
      }],
    }).success).toBe(true);
  });

  test('rejects an empty selected reward rule reference', () => {
    expect(EvaluationResponseSchema.safeParse({
      evaluationId: 'evaluation-1',
      schemaVersion: 3,
      expiresAt: '2026-07-18T15:05:00Z',
      decisions: [{
        programRef: 'welcome-10',
        programRevision: 1,
        programType: 'promo',
        outcome: 'qualified',
        rewardRuleRef: '',
        effects: [],
        reasonCodes: [],
        commitRequired: true,
        eligible: true,
      }],
    }).success).toBe(false);
  });

  test('keeps non-qualified shared decisions valid without a reward rule reference', () => {
    expect(EvaluationResponseSchema.safeParse({
      evaluationId: 'evaluation-1',
      schemaVersion: 3,
      expiresAt: '2026-07-18T15:05:00Z',
      decisions: [{
        programRef: 'referral-1',
        programRevision: 1,
        programType: 'referral',
        outcome: 'not_qualified',
        effects: [],
        reasonCodes: ['NOT_ELIGIBLE'],
        commitRequired: false,
        eligible: false,
      }],
    }).success).toBe(true);
  });

  test('rejects discount effects with contradictory calculation fields', () => {
    expect(EffectSchema.safeParse({
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1000 },
    }).success).toBe(true);
    expect(EffectSchema.safeParse({
      type: 'line_item_discount',
      productRef: 'product-1',
      calculation: 'percent',
      basisPoints: 1000,
    }).success).toBe(true);
    expect(EffectSchema.safeParse({
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1000 },
      basisPoints: 1000,
    }).success).toBe(false);
    expect(EffectSchema.safeParse({
      type: 'line_item_discount',
      productRef: 'product-1',
      calculation: 'percent',
      amount: { currency: 'GBP', minorUnits: 1000 },
      basisPoints: 1000,
    }).success).toBe(false);
    expect(EffectSchema.safeParse({
      type: 'order_discount',
      calculation: 'fixed',
    }).success).toBe(false);
    expect(EffectSchema.safeParse({
      type: 'order_discount',
      calculation: 'percent',
    }).success).toBe(false);
  });

  test('rejects derived eligibility that contradicts the decision outcome', () => {
    const response = {
      evaluationId: 'evaluation-1',
      schemaVersion: 3,
      expiresAt: '2026-07-18T15:05:00Z',
      decisions: [{
        programRef: 'welcome-10',
        programRevision: 1,
        programType: 'promo',
        outcome: 'qualified',
        effects: [],
        reasonCodes: [],
        commitRequired: true,
        eligible: false,
      }],
    };
    expect(EvaluationResponseSchema.safeParse(response).success).toBe(false);
    expect(EvaluationResponseSchema.safeParse({
      ...response,
      decisions: [{ ...response.decisions[0], outcome: 'conflict', eligible: true }],
    }).success).toBe(false);
  });

  test('accepts only the bundle redemption request shape', () => {
    expect(RedemptionRequestSchema.parse({
      evaluationId: 'evaluation-1',
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-1',
    })).toBeTruthy();
    expect(() => RedemptionRequestSchema.parse({
      evaluationId: 'evaluation-1',
      programRef: 'promo-1',
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-1',
    })).toThrow();
  });

  test.each([
    'selected',
    'invalid_code',
    'not_qualified',
    'unavailable',
    'exhausted',
    'combination_rejected',
  ] as const)('accepts the coded diagnostic outcome %s', (outcome) => {
    const result = CodeEvaluationResultSchema.parse({
      code: 'gatec15',
      normalizedCode: ' gatec15 ',
      outcome,
      programRef: outcome === 'invalid_code' ? undefined : 'promo-a',
      reasonCodes: outcome === 'selected' ? [] : ['CODE_NOT_SELECTED'],
    });
    expect(result.normalizedCode).toBe('GATEC15');
  });

  test('adds optional code results to the strict evaluation response', () => {
    const response = {
      evaluationId: 'evaluation-1',
      schemaVersion: 1,
      expiresAt: '2026-07-24T10:00:00.000Z',
      decisions: [],
    };
    expect(EvaluationResponseSchema.parse(response)).toEqual(response);
    expect(EvaluationResponseSchema.parse({
      ...response,
      codeResults: [{
        code: 'GATEC15',
        normalizedCode: 'GATEC15',
        outcome: 'invalid_code',
        reasonCodes: ['INVALID_PROMO_CODE'],
      }],
    }).codeResults).toHaveLength(1);
  });

  test('defines strict ordered redemption bundle entries', () => {
    const response = {
      redemptionId: 'redemption-1',
      evaluationId: 'evaluation-1',
      externalOrderRef: 'order-1',
      status: 'committed',
      entries: [
        {
          programRef: 'promo-a',
          programRevision: 4,
          rewardRuleRef: 'rule-a',
          effects: [],
        },
        {
          programRef: 'promo-b',
          programRevision: 2,
          effects: [{ type: 'free_shipping' }],
        },
      ],
      idempotencyKey: 'checkout-1',
    } as const;

    expect(RedemptionEntrySchema.parse(response.entries[0])).toEqual(response.entries[0]);
    expect(RedemptionResponseSchema.parse(response)).toEqual(response);
    expect(() => RedemptionResponseSchema.parse({
      ...response,
      programRef: 'promo-a',
    })).toThrow();
    expect(() => RedemptionResponseSchema.parse({
      redemptionId: 'redemption-1',
      evaluationId: 'evaluation-1',
      externalOrderRef: 'order-1',
      status: 'committed',
      effects: [],
      idempotencyKey: 'checkout-1',
      entries: [],
    })).toThrow();
  });

  test('accepts canonical reward rules in promo programs', () => {
    const result = PromoProgramSchema.safeParse({
      id: 'welcome-10',
      type: 'promo',
      name: 'Welcome 10',
      status: 'active',
      code: 'WELCOME10',
      autoApply: false,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'minimum-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 5000,
        }],
      },
      rewardRules: [over100Rule],
      stackable: false,
      priority: 10,
    });
    expect(result.success).toBe(true);
  });

  test('rejects the removed top-level promo reward', () => {
    expect(PromoProgramSchema.safeParse({
      id: 'legacy-reward',
      type: 'promo',
      name: 'Legacy reward',
      status: 'active',
      code: 'LEGACY',
      autoApply: false,
      eligibility: { match: 'ALL', conditions: [] },
      reward: { type: 'free_shipping' },
      stackable: false,
      priority: 10,
    }).success).toBe(false);
  });

  test('requires a promo reward rule or fallback reward', () => {
    expect(PromoProgramSchema.safeParse({
      id: 'missing-reward',
      type: 'promo',
      name: 'Missing reward',
      status: 'active',
      code: 'MISSING',
      autoApply: false,
      eligibility: { match: 'ALL', conditions: [] },
      rewardRules: [],
      stackable: false,
      priority: 10,
    }).success).toBe(false);
  });

  test('requires a code for promos that do not auto-apply', () => {
    expect(PromoProgramSchema.safeParse({
      id: 'missing-code',
      type: 'promo',
      name: 'Missing code',
      status: 'active',
      autoApply: false,
      eligibility: { match: 'ALL', conditions: [] },
      fallbackReward: fallback,
      stackable: false,
      priority: 10,
    }).success).toBe(false);
  });

  test('enforces the strict automatic and coded Promo trigger union', () => {
    expect(PromoProgramSchema.safeParse({
      ...basePromo,
      autoApply: true,
      stackable: false,
    }).success).toBe(true);
    expect(PromoProgramSchema.safeParse({
      ...basePromo,
      autoApply: true,
      code: 'AUTO',
      stackable: false,
    }).success).toBe(false);
    expect(PromoProgramSchema.safeParse({
      ...basePromo,
      autoApply: true,
      stackable: true,
    }).success).toBe(false);
    expect(PromoProgramSchema.safeParse({
      ...basePromo,
      autoApply: false,
      code: 'SAVE20',
      stackable: true,
    }).success).toBe(true);
    expect(PromoProgramSchema.safeParse({
      ...basePromo,
      autoApply: false,
      code: 'SAVE20',
      stackable: false,
      stackingGroup: 'legacy',
    }).success).toBe(false);
  });

  test('rejects duplicate condition ids across top-level and nested groups', () => {
    const result = PromoProgramSchema.safeParse({
      id: 'duplicate-condition-id',
      type: 'promo',
      name: 'Duplicate condition id',
      status: 'active',
      code: 'DUPLICATE',
      autoApply: false,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'same-id',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 5_000,
        }],
        groups: [{
          match: 'ALL',
          conditions: [{
            id: 'same-id',
            variable: 'customer.tier',
            operator: 'eq',
            value: 'gold',
          }],
        }],
      },
      fallbackReward: fallback,
      stackable: false,
      priority: 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'duplicate condition id: same-id' }),
      ]));
    }
  });

  test('preserves program date ordering validation', () => {
    expect(PromoProgramSchema.safeParse({
      id: 'invalid-date-order',
      type: 'promo',
      name: 'Invalid date order',
      status: 'active',
      autoApply: true,
      startDate: '2026-07-31',
      endDate: '2026-07-01',
      eligibility: { match: 'ALL', conditions: [] },
      fallbackReward: fallback,
      stackable: false,
      priority: 10,
    }).success).toBe(false);
  });

  test('emits the strict canonical evaluation envelope with nested extensions', () => {
    const schema = buildPublishedEvaluationJsonSchema([
      {
        key: 'context.channel',
        label: 'Channel',
        source: 'context',
        type: 'enum',
        required: true,
        enumValues: ['web', 'app'],
      },
      {
        key: 'context.campaign',
        label: 'Campaign',
        source: 'context',
        type: 'string',
        required: false,
      },
      {
        key: 'cart.delivery_country',
        label: 'Delivery country',
        source: 'cart',
        type: 'string',
        required: false,
      },
      {
        key: 'line_item.category',
        label: 'Category',
        source: 'line_item',
        type: 'string',
        required: true,
      },
    ]);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(schema).not.toHaveProperty('properties.customer');
    expect(schema).toHaveProperty('properties.context.additionalProperties', false);
    expect(schema).not.toHaveProperty('properties.line_item');
    expect(schema).toHaveProperty('required', ['cart', 'context']);
    expect(schema).toHaveProperty('properties.cart.required', [
      'currency',
      'subtotal',
      'items',
    ]);
    expect(schema).toHaveProperty('properties.cart.properties.attributes.additionalProperties', false);
    expect(schema).toHaveProperty('properties.cart.properties.items.items.required', [
      'productRef',
      'quantity',
      'unitPrice',
      'attributes',
    ]);
    expect(schema).toHaveProperty(
      'properties.cart.properties.items.items.additionalProperties',
      false,
    );
    expect(schema).toHaveProperty(
      'properties.cart.properties.items.items.properties.attributes.additionalProperties',
      false,
    );
    expect(schema).toHaveProperty('properties.context.required', ['channel']);
  });

  test('keeps the canonical cart required without merchant definitions', () => {
    const schema = buildPublishedEvaluationJsonSchema([]);
    expect(schema).toHaveProperty('required', ['cart']);
    expect(schema).toHaveProperty('properties.cart.required', ['currency', 'subtotal', 'items']);
    expect(schema).toHaveProperty('properties.cart.additionalProperties', false);
  });

  test('rejects duplicate variable keys before publishing a schema', () => {
    expect(() => buildPublishedEvaluationJsonSchema([
      {
        key: 'context.channel',
        label: 'Channel',
        source: 'context',
        type: 'string',
        required: false,
      },
      {
        key: 'context.channel',
        label: 'Channel enum',
        source: 'context',
        type: 'enum',
        required: true,
        enumValues: ['web', 'app'],
      },
    ])).toThrow(/duplicate variable key/i);
  });

  test('publishes stable evaluation and redemption OpenAPI paths', () => {
    const document = buildOpenApiDocument();
    expect(document).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/v1/evaluate': { post: {} },
        '/v1/redemptions': { post: {} },
      },
    });
    expect(document.paths).not.toHaveProperty('/v1/test-publishable');
    expect(document.paths).not.toHaveProperty('/v1/test-secret');
    expect(document.paths?.['/v1/schema/published']?.get?.responses).toHaveProperty('429');
    expect(document.paths?.['/v1/evaluate']?.post?.responses).toHaveProperty('429');
    expect(document.components?.schemas).toMatchObject({
      PromoCode: {},
      CodeEvaluationResult: {},
      RedemptionEntry: {},
    });
    const effectSchema = document.components?.schemas?.Effect;
    const variants = (effectSchema as { anyOf?: unknown[] } | undefined)?.anyOf;
    expect(variants?.[0]).toMatchObject({
      properties: { calculation: { enum: ['fixed'] }, amount: {} },
      required: ['type', 'calculation', 'amount'],
      additionalProperties: false,
    });
    expect(variants?.[1]).toMatchObject({
      properties: { calculation: { enum: ['percent'] }, basisPoints: {} },
      required: ['type', 'calculation', 'basisPoints'],
      additionalProperties: false,
    });
    expect(variants?.[2]).toMatchObject({
      properties: { calculation: { enum: ['fixed'] }, amount: {} },
      required: ['type', 'productRef', 'calculation', 'amount'],
      additionalProperties: false,
    });
    expect(variants?.[3]).toMatchObject({
      properties: { calculation: { enum: ['percent'] }, basisPoints: {} },
      required: ['type', 'productRef', 'calculation', 'basisPoints'],
      additionalProperties: false,
    });
    expect(effectSchema).not.toHaveProperty('anyOf.0.properties.basisPoints');
    expect(effectSchema).not.toHaveProperty('anyOf.1.properties.amount');
    expect(effectSchema).not.toHaveProperty('anyOf.2.properties.basisPoints');
    expect(effectSchema).not.toHaveProperty('anyOf.3.properties.amount');

    const evaluationRequestSchema = document.components?.schemas?.EvaluationRequest as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    } | undefined;
    expect(evaluationRequestSchema).toMatchObject({
      properties: { codes: {}, cart: {} },
      required: ['cart'],
      additionalProperties: false,
    });
    expect(evaluationRequestSchema?.properties).not.toHaveProperty('code');

    const evaluationResponseSchema = document.components?.schemas?.EvaluationResponse as {
      properties?: Record<string, unknown>;
    } | undefined;
    expect(evaluationResponseSchema?.properties).toHaveProperty('codeResults');

    const redemptionRequestSchema = document.components?.schemas?.RedemptionRequest as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    } | undefined;
    expect(redemptionRequestSchema).toMatchObject({
      properties: {
        evaluationId: {},
        externalOrderRef: {},
        idempotencyKey: {},
      },
      required: ['evaluationId', 'externalOrderRef', 'idempotencyKey'],
      additionalProperties: false,
    });
    expect(redemptionRequestSchema?.properties).not.toHaveProperty('programRef');

    const redemptionResponseSchema = document.components?.schemas?.RedemptionResponse as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    } | undefined;
    expect(redemptionResponseSchema).toMatchObject({
      properties: {
        redemptionId: {},
        evaluationId: {},
        externalOrderRef: {},
        status: {},
        entries: {},
        idempotencyKey: {},
      },
      required: [
        'redemptionId',
        'evaluationId',
        'externalOrderRef',
        'status',
        'entries',
        'idempotencyKey',
      ],
      additionalProperties: false,
    });
    expect(redemptionResponseSchema?.properties).not.toHaveProperty('programRef');
    expect(redemptionResponseSchema?.properties).not.toHaveProperty('rewardRuleRef');
    expect(redemptionResponseSchema?.properties).not.toHaveProperty('effects');

    const promoSchema = document.components?.schemas?.PromoProgram as {
      anyOf?: Array<Record<string, unknown>>;
      oneOf?: Array<Record<string, unknown>>;
    } | undefined;
    const promoVariants = promoSchema?.oneOf ?? promoSchema?.anyOf;
    expect(promoVariants).toHaveLength(2);

    const autoApplyValue = (variant: Record<string, unknown>) => {
      const properties = variant.properties as Record<string, unknown> | undefined;
      const autoApply = properties?.autoApply as {
        const?: boolean;
        enum?: boolean[];
      } | undefined;
      return autoApply?.const ?? autoApply?.enum?.[0];
    };
    const manualVariant = promoVariants?.find((variant) => (
      autoApplyValue(variant) === false
    ));
    const automaticVariant = promoVariants?.find((variant) => (
      autoApplyValue(variant) === true
    ));
    expect(manualVariant).toMatchObject({
      properties: { autoApply: {}, code: {} },
      required: expect.arrayContaining(['autoApply', 'code', 'stackable']),
    });
    expect(automaticVariant).toMatchObject({
      properties: { autoApply: {}, stackable: {} },
    });
    expect((automaticVariant as { properties?: Record<string, unknown> } | undefined)?.properties)
      .not.toHaveProperty('code');
    expect((automaticVariant as { required?: string[] } | undefined)?.required)
      .not.toContain('code');
    for (const variant of promoVariants ?? []) {
      const properties = (variant as { properties?: Record<string, unknown> }).properties;
      expect(properties).not.toHaveProperty('stackingGroup');
    }
  });

  test('publishes conditional reward and future program components without widening Promo routes', () => {
    const document = buildOpenApiDocument();
    const schemas = document.components?.schemas;

    expect(schemas).toMatchObject({
      RewardRule: {},
      CommerceReward: {},
      PromoProgram: {},
      AffiliateProgram: {
        description: expect.stringMatching(/future configuration contract/i),
      },
      ReferralProgram: {
        description: expect.stringMatching(/future configuration contract/i),
      },
      LoyaltyProgram: {
        description: expect.stringMatching(/future configuration contract/i),
      },
    });

    const promoSchema = schemas?.PromoProgram as {
      anyOf?: Array<{ properties?: Record<string, unknown> }>;
      oneOf?: Array<{ properties?: Record<string, unknown> }>;
    } | undefined;
    const promoVariants = promoSchema?.oneOf ?? promoSchema?.anyOf ?? [];
    expect(promoVariants).toHaveLength(2);
    for (const variant of promoVariants) {
      expect(variant.properties).toHaveProperty('rewardRules');
      expect(variant.properties).not.toHaveProperty('reward');
    }

    const evaluationResponse = schemas?.EvaluationResponse as {
      properties?: {
        decisions?: { items?: { properties?: Record<string, unknown> } };
      };
    } | undefined;
    expect(evaluationResponse?.properties?.decisions?.items?.properties)
      .toHaveProperty('rewardRuleRef');

    const redemptionResponse = schemas?.RedemptionResponse as {
      properties?: Record<string, unknown>;
    } | undefined;
    expect(redemptionResponse?.properties).toHaveProperty('entries');
    expect(redemptionResponse?.properties).not.toHaveProperty('rewardRuleRef');

    type Operation = {
      requestBody?: {
        content?: { 'application/json'?: { schema?: { $ref?: string } } };
      };
      responses?: Record<string, {
        content?: { 'application/json'?: { schema?: { $ref?: string } } };
      }>;
    };
    const paths = document.paths as Record<string, Record<string, Operation>>;
    expect(paths['/v1/programs']).toBeUndefined();
    expect(paths['/v1/programs/{externalRef}']).toBeUndefined();
    expect(paths['/v1/schema/definitions']).toBeUndefined();
    expect(paths['/v1/schema/definitions/{id}']).toBeUndefined();
    expect(document.components?.parameters?.SchemaDefinitionId).toBeUndefined();
    expect(document.components?.parameters?.ProgramExternalRef).toBeUndefined();
    expect(paths['/v1/schema/publish']).toBeUndefined();

    const programList = schemas?.ProgramListResponse as {
      properties?: {
        programs?: {
          items?: {
            anyOf?: Array<{ properties?: { type?: { enum?: string[] } } }>;
            oneOf?: Array<{ properties?: { type?: { enum?: string[] } } }>;
          };
        };
      };
    } | undefined;
    const listedProgramSchema = programList?.properties?.programs?.items;
    const listedProgramVariants = listedProgramSchema?.oneOf ?? listedProgramSchema?.anyOf ?? [];
    expect(listedProgramVariants).toHaveLength(2);
    expect(listedProgramVariants.map(variant => variant.properties?.type?.enum))
      .toEqual([['promo'], ['promo']]);

    const liveProgramOperations = JSON.stringify({
      listSchema: programList,
    });
    expect(liveProgramOperations).not.toMatch(/AffiliateProgram|ReferralProgram|LoyaltyProgram/);
  });
});
