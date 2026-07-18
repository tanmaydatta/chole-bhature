import { describe, expect, test } from 'vitest';

import { assembleFacts } from './index.js';

describe('assembleFacts', () => {
  test('loads stored customer, live context, line item, and system facts without overrides', () => {
    const facts = assembleFacts({
      customer: { tier: 'gold' },
      context: { channel: 'web' },
      cart: { delivery_country: 'GB' },
      lineItems: [{ productRef: 'p1', attributes: { category: 'shoes' } }],
      system: { budget_remaining: 5000 },
    });

    expect(facts.scalar['customer.tier']).toBe('gold');
    expect(facts.scalar['context.channel']).toBe('web');
    expect(facts.scalar['cart.delivery_country']).toBe('GB');
    expect(facts.scalar['system.budget_remaining']).toBe(5000);
    expect(facts.lineItems[0]?.['line_item.category']).toBe('shoes');
    expect(facts.lineItems[0]?.['line_item.product_ref']).toBe('p1');
  });

  test.each([
    ['context', { context: { 'customer.tier': 'forged' } }],
    ['cart', { cart: { 'customer.tier': 'forged' } }],
    [
      'line item',
      {
        lineItems: [{
          productRef: 'p1',
          attributes: { 'customer.tier': 'forged' },
        }],
      },
    ],
  ])('rejects customer namespace injection from %s facts', (_source, input) => {
    expect(() => assembleFacts(input)).toThrow(/customer namespace/i);
  });
});
