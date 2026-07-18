import { describe, expect, test } from 'vitest';

import type {
  Condition,
  ConditionGroup,
  VariableDefinition,
} from '@incentives/contracts';

import {
  OPERATORS_BY_TYPE,
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
  {
    key: 'line_item.quantity',
    label: 'Quantity',
    source: 'line_item',
    type: 'number',
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
    { 'line_item.category': 'shoes', 'line_item.quantity': 1 },
    { 'line_item.category': 'accessories', 'line_item.quantity': 2 },
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
    { id: 'date-eq', variable: 'context.ordered_at', operator: 'eq', value: '2026-07-18' },
    { id: 'date-gte', variable: 'context.ordered_at', operator: 'gte', value: '2026-07-18' },
    { id: 'line-item', variable: 'line_item.category', operator: 'eq', value: 'shoes' },
  ])('applies schema-directed $operator semantics', (condition) => {
    expect(evaluateCondition(condition, definitions, facts)).toEqual({ passed: true });
  });

  test('publishes every evaluator-supported date operator', () => {
    expect(OPERATORS_BY_TYPE.date).toEqual([
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
    ]);
  });

  test('returns INVALID_CONDITION for an operator not allowed by the variable type', () => {
    expect(evaluateCondition({
      id: 'invalid-string-comparison',
      variable: 'line_item.category',
      operator: 'gt',
      value: 'boots',
    }, definitions, facts)).toEqual({
      passed: false,
      failure: {
        conditionId: 'invalid-string-comparison',
        variable: 'line_item.category',
        reasonCode: 'INVALID_CONDITION',
      },
    });
  });

  test.each([
    { operator: 'eq' as const, value: 'bronze' },
    { operator: 'in' as const, value: ['gold', 'bronze'] },
  ])('returns INVALID_CONDITION for an invalid enum operand with $operator', ({
    operator,
    value,
  }) => {
    expect(evaluateCondition({
      id: 'invalid-tier',
      variable: 'customer.tier',
      operator,
      value,
    }, definitions, facts)).toEqual({
      passed: false,
      failure: {
        conditionId: 'invalid-tier',
        variable: 'customer.tier',
        reasonCode: 'INVALID_CONDITION',
      },
    });
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

  test('requires direct line-item conditions in an ALL group to match the same item', () => {
    const group: ConditionGroup = {
      match: 'ALL',
      conditions: [
        {
          id: 'shoes-only',
          variable: 'line_item.category',
          operator: 'eq',
          value: 'shoes',
        },
        {
          id: 'minimum-quantity',
          variable: 'line_item.quantity',
          operator: 'gte',
          value: 2,
        },
      ],
    };

    expect(evaluateConditionGroup(group, definitions, facts)).toEqual({
      passed: false,
      firstFailure: {
        conditionId: 'minimum-quantity',
        variable: 'line_item.quantity',
        reasonCode: 'CONDITION_NOT_MET',
      },
    });
  });

  test('passes direct ALL line-item conditions when one item satisfies all of them', () => {
    const group: ConditionGroup = {
      match: 'ALL',
      conditions: [
        {
          id: 'shoes-only',
          variable: 'line_item.category',
          operator: 'eq',
          value: 'shoes',
        },
        {
          id: 'minimum-quantity',
          variable: 'line_item.quantity',
          operator: 'gte',
          value: 2,
        },
      ],
    };
    const sameItemFacts: FactSet = {
      ...facts,
      lineItems: [{
        'line_item.category': 'shoes',
        'line_item.quantity': 2,
      }],
    };

    expect(evaluateConditionGroup(group, definitions, sameItemFacts)).toEqual({ passed: true });
  });

  test('keeps ANY line-item conditions existential', () => {
    const group: ConditionGroup = {
      match: 'ANY',
      conditions: [
        {
          id: 'shoes-only',
          variable: 'line_item.category',
          operator: 'eq',
          value: 'shoes',
        },
        {
          id: 'minimum-quantity',
          variable: 'line_item.quantity',
          operator: 'gte',
          value: 2,
        },
      ],
    };

    expect(evaluateConditionGroup(group, definitions, facts)).toEqual({ passed: true });
  });

  test('correlates line items independently inside nested ALL groups', () => {
    const group: ConditionGroup = {
      match: 'ALL',
      conditions: [],
      groups: [
        {
          match: 'ALL',
          conditions: [{
            id: 'shoes-only',
            variable: 'line_item.category',
            operator: 'eq',
            value: 'shoes',
          }],
        },
        {
          match: 'ALL',
          conditions: [{
            id: 'minimum-quantity',
            variable: 'line_item.quantity',
            operator: 'gte',
            value: 2,
          }],
        },
      ],
    };

    expect(evaluateConditionGroup(group, definitions, facts)).toEqual({ passed: true });
  });
});
