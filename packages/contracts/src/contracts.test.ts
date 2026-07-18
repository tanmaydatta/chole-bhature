import { describe, expect, test } from 'vitest';

import {
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

  test('emits strict JSON Schema for merchant extensions', () => {
    const schema = buildPublishedEvaluationJsonSchema([
      {
        key: 'context.channel',
        label: 'Channel',
        source: 'context',
        type: 'enum',
        required: true,
        enumValues: ['web', 'app'],
      },
    ]);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(schema).not.toHaveProperty('properties.customer');
    expect(schema).toHaveProperty('properties.context.additionalProperties', false);
    expect(schema).toHaveProperty('required', ['context']);
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
  });
});
