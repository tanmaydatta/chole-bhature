import { describe, expect, test } from 'vitest';

import type {
  Condition,
  ConditionGroup,
  VariableDefinition,
} from '@incentives/contracts';

import {
  evaluateCondition,
  evaluateConditionGroup,
  type FactSet,
} from './index.js';

const definitions: VariableDefinition[] = [
  {
    key: 'cart.subtotal',
    label: 'Subtotal',
    source: 'cart',
    type: 'number',
    required: true,
  },
  {
    key: 'customer.tier',
    label: 'Tier',
    source: 'customer',
    type: 'enum',
    required: false,
    enumValues: ['silver', 'gold'],
  },
  {
    key: 'customer.first_purchase',
    label: 'First purchase',
    source: 'customer',
    type: 'boolean',
    required: false,
  },
  {
    key: 'context.ordered_at',
    label: 'Ordered at',
    source: 'context',
    type: 'date',
    required: false,
  },
  {
    key: 'line_item.category',
    label: 'Category',
    source: 'line_item',
    type: 'string',
    required: false,
  },
];

const facts: FactSet = {
  scalar: {
    'cart.subtotal': 4_000,
    'customer.tier': 'gold',
    'customer.first_purchase': false,
    'context.ordered_at': '2026-07-18',
  },
  lineItems: [
    { 'line_item.category': 'shoes' },
    { 'line_item.category': 'accessories' },
  ],
};

describe('condition evaluation', () => {
  test('returns the first failing condition in declaration order', () => {
    const groupWithTwoFailures: ConditionGroup = {
      match: 'ALL',
      conditions: [
        {
          id: 'minimum-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 5_000,
        },
        {
          id: 'wrong-tier',
          variable: 'customer.tier',
          operator: 'eq',
          value: 'silver',
        },
      ],
    };

    const result = evaluateConditionGroup(groupWithTwoFailures, definitions, facts);

    expect(result).toMatchObject({
      passed: false,
      firstFailure: { conditionId: 'minimum-cart' },
    });
  });

  test.each<Condition>([
    { id: 'eq', variable: 'cart.subtotal', operator: 'eq', value: '4000' },
    { id: 'neq', variable: 'customer.tier', operator: 'neq', value: 'silver' },
    { id: 'gt', variable: 'cart.subtotal', operator: 'gt', value: 3_999 },
    { id: 'gte', variable: 'cart.subtotal', operator: 'gte', value: 4_000 },
    { id: 'lt', variable: 'cart.subtotal', operator: 'lt', value: 4_001 },
    { id: 'lte', variable: 'cart.subtotal', operator: 'lte', value: 4_000 },
    { id: 'in', variable: 'customer.tier', operator: 'in', value: ['silver', 'gold'] },
    { id: 'between', variable: 'cart.subtotal', operator: 'between', value: ['3999', '4001'] },
    { id: 'is', variable: 'customer.first_purchase', operator: 'is', value: false },
    { id: 'date', variable: 'context.ordered_at', operator: 'between', value: ['2026-07-01', '2026-07-31'] },
    { id: 'line-item', variable: 'line_item.category', operator: 'eq', value: 'shoes' },
  ])('applies schema-directed $operator semantics', (condition) => {
    expect(evaluateCondition(condition, definitions, facts)).toEqual({ passed: true });
  });

  test('fails only a condition that needs an absent optional fact', () => {
    const condition: Condition = {
      id: 'missing-tier',
      variable: 'customer.tier',
      operator: 'eq',
      value: 'gold',
    };

    expect(evaluateCondition(condition, definitions, {
      scalar: { 'cart.subtotal': 4_000 },
      lineItems: [],
    })).toEqual({
      passed: false,
      failure: {
        conditionId: 'missing-tier',
        variable: 'customer.tier',
        reasonCode: 'ATTRIBUTE_MISSING',
      },
    });
  });

  test('supports ANY and one nested group while preserving first failure order', () => {
    const group: ConditionGroup = {
      match: 'ANY',
      conditions: [{
        id: 'minimum-cart',
        variable: 'cart.subtotal',
        operator: 'gte',
        value: 5_000,
      }],
      groups: [{
        match: 'ALL',
        conditions: [{
          id: 'gold-tier',
          variable: 'customer.tier',
          operator: 'eq',
          value: 'gold',
        }],
      }],
    };

    expect(evaluateConditionGroup(group, definitions, facts)).toEqual({ passed: true });
  });
});
