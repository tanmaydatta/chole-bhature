import { describe, expect, test } from 'vitest';

import type { Condition, VariableDefinition } from '@incentives/contracts';

import {
  operatorLabel,
  renderMessage,
  resolveFailureMessage,
  rewardSummaryFor,
} from './index.js';

const variable: VariableDefinition = {
  key: 'system.budget_remaining',
  label: 'Budget remaining',
  source: 'system',
  type: 'number',
  required: false,
  defaultErrorMessage: 'Offer ended',
};

const baseCondition: Condition = {
  id: '1',
  variable: 'system.budget_remaining',
  operator: 'gt',
  value: '0',
};

describe('message fallback', () => {
  test('falls back to the variable default', () => {
    expect(resolveFailureMessage(baseCondition, variable)).toBe('Offer ended');
  });

  test('falls back to the program message after the variable default', () => {
    const { defaultErrorMessage: _default, ...withoutDefault } = variable;
    expect(resolveFailureMessage(baseCondition, withoutDefault, 'Prog msg')).toBe('Prog msg');
  });

  test('prefers the condition message', () => {
    expect(resolveFailureMessage(
      { ...baseCondition, message: 'Row msg' },
      variable,
    )).toBe('Row msg');
  });

  test('falls back to the system default last', () => {
    const { defaultErrorMessage: _default, ...withoutDefault } = variable;
    expect(resolveFailureMessage(baseCondition, withoutDefault, ' ', 'System msg')).toBe('System msg');
  });

  test('empty or whitespace condition messages fall through to the variable default', () => {
    expect(resolveFailureMessage({ ...baseCondition, message: '' }, variable)).toBe('Offer ended');
    expect(resolveFailureMessage({ ...baseCondition, message: '   ' }, variable)).toBe('Offer ended');
  });

  test('maps gte to its operator label', () => {
    expect(operatorLabel('gte')).toBe('≥');
  });
});

describe('message interpolation', () => {
  test('interpolates subtraction with money filter', () => {
    expect(renderMessage('Add {{ 50 − basket_value | money }} more', { basket_value: 38 }))
      .toBe('Add $12 more');
  });

  test('substitutes a plain variable', () => {
    expect(renderMessage('Hi {{ customer_tier }}', { customer_tier: 'gold' })).toBe('Hi gold');
  });

  test('substitutes a canonical dotted fact key', () => {
    expect(renderMessage('Subtotal {{ cart.subtotal }}', { 'cart.subtotal': 38 }))
      .toBe('Subtotal 38');
  });

  test('leaves text without tokens untouched', () => {
    expect(renderMessage('No tokens here', {})).toBe('No tokens here');
  });

  test('handles ASCII hyphen subtraction', () => {
    expect(renderMessage('Add {{ 50 - basket_value | money }} more', { basket_value: 38 }))
      .toBe('Add $12 more');
  });

  test('subtracts a canonical dotted fact key', () => {
    expect(renderMessage('Add {{ 50 - cart.subtotal | money }} more', {
      'cart.subtotal': 38,
    })).toBe('Add $12 more');
  });

  test('renders an unknown subtraction operand as empty', () => {
    expect(renderMessage('{{ unknown_var - 5 | money }}', {})).toBe('');
  });
});

describe('reward summaries', () => {
  test.each([
    [{ kind: 'percent', value: 15 } as const, '15% off'],
    [{ kind: 'fixed', value: 10 } as const, '$10 off'],
    [{ kind: 'free_shipping' } as const, 'Free shipping'],
    [{ kind: 'points', value: 5 } as const, '5% back as points'],
    [{ kind: 'credit', value: 20 } as const, '$20 credit'],
    [{ kind: 'percent' } as const, '0% off'],
  ])('preserves dashboard summary behavior for $kind', (reward, summary) => {
    expect(rewardSummaryFor(reward)).toBe(summary);
  });
});
