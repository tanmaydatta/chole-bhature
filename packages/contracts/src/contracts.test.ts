import { describe, expect, test } from 'vitest';

import {
  CartSnapshotSchema,
  CustomerSnapshotSchema,
  EffectSchema,
  EvaluationResponseSchema,
  EvaluationRequestSchema,
  MoneySchema,
  OrderSnapshotSchema,
  PromoProgramSchema,
  VariableDefinitionSchema,
  buildOpenApiDocument,
  buildPublishedEvaluationJsonSchema,
} from './index.js';

describe('canonical contracts', () => {
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
        programType: 'promo',
        outcome: 'qualified',
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

  test('preserves existing condition operator names in promo programs', () => {
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
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 1000 },
      },
      stackable: false,
      priority: 10,
    });
    expect(result.success).toBe(true);
  });

  test('requires a code for promos that do not auto-apply', () => {
    expect(PromoProgramSchema.safeParse({
      id: 'missing-code',
      type: 'promo',
      name: 'Missing code',
      status: 'active',
      autoApply: false,
      eligibility: { match: 'ALL', conditions: [] },
      reward: { type: 'free_shipping' },
      stackable: false,
      priority: 10,
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
      reward: { type: 'free_shipping' },
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
      reward: { type: 'free_shipping' },
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
      required: expect.arrayContaining(['autoApply', 'code']),
    });
    expect(automaticVariant).toMatchObject({
      properties: { autoApply: {}, code: {} },
    });
    expect((automaticVariant as { required?: string[] } | undefined)?.required)
      .not.toContain('code');
  });
});
