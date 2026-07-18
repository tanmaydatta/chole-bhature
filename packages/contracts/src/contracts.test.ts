import { describe, expect, test } from 'vitest';

import {
  EffectSchema,
  EvaluationResponseSchema,
  EvaluationRequestSchema,
  MoneySchema,
  PromoProgramSchema,
  VariableDefinitionSchema,
  buildOpenApiDocument,
  buildPublishedEvaluationJsonSchema,
} from './index.js';

describe('canonical contracts', () => {
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
  });
});
