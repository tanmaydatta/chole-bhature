import type { VariableDefinition } from '@incentives/contracts';
import { describe, expect, test } from 'vitest';

import { buildEvaluationRequest, type PlaygroundInput } from './request-builder';

const input: PlaygroundInput = {
  currency: 'GBP', customerRef: '', codes: '', context: {}, cart: {}, lines: [
    { lineRef: 'line-a', productRef: 'product-a', quantity: '2', unitPrice: '1250', extensions: {} },
    { lineRef: 'line-b', productRef: 'product-a', quantity: '1', unitPrice: '500', extensions: {} },
  ],
};
const definitions: VariableDefinition[] = [
  { key: 'context.channel', label: 'Channel', source: 'context', type: 'enum', required: true, enumValues: ['web', 'store'] },
  { key: 'context.date', label: 'Date', source: 'context', type: 'date', required: false },
  { key: 'cart.gift', label: 'Gift', source: 'cart', type: 'boolean', required: true },
  { key: 'line_item.weight', label: 'Weight', source: 'line_item', type: 'number', required: true },
  { key: 'customer.tier', label: 'Tier', source: 'customer', type: 'enum', required: true, enumValues: ['gold'] },
];

describe('evaluation basket request builder', () => {
  // Break caught: wrong quantity/minor-unit conversion or unstable line identities changes basket economics.
  test('builds the exact line identities and computed integer subtotal', () => {
    expect(buildEvaluationRequest(input, [])).toEqual({ cart: { currency: 'GBP', subtotal: 3_000,
      items: [
        { lineRef: 'line-a', productRef: 'product-a', quantity: 2, unitPrice: 1_250 },
        { lineRef: 'line-b', productRef: 'product-a', quantity: 1, unitPrice: 500 },
      ],
    } });
  });

  test('keeps stored customer references opaque and splits optional codes without authority fields', () => {
    const result = buildEvaluationRequest({ ...input, customerRef: 'customer/opaque', codes: ' CAP25,other\nmissing ' }, []);
    expect(result.customerRef).toBe('customer/opaque');
    expect(result.codes).toEqual(['CAP25', 'other', 'missing']);
    expect(result).not.toHaveProperty('customer');
    expect(result).not.toHaveProperty('merchantId');
  });

  test('converts only published live extensions including false and zero', () => {
    expect(buildEvaluationRequest({ ...input, context: { channel: 'web', date: '2026-10-14' }, cart: { gift: 'false' },
      lines: input.lines.map(line => ({ ...line, extensions: { weight: '0' } })),
    }, definitions)).toMatchObject({ context: { channel: 'web', date: '2026-10-14' },
      cart: { attributes: { gift: false }, items: [{ attributes: { weight: 0 } }, { attributes: { weight: 0 } }] } });
  });

  test.each([
    ['zero quantity', { lines: [{ ...input.lines[0], quantity: '0' }] }],
    ['fractional price', { lines: [{ ...input.lines[0], unitPrice: '1.5' }] }],
    ['empty quantity', { lines: [{ ...input.lines[0], quantity: '' }] }],
    ['unsafe subtotal', { lines: [{ ...input.lines[0], quantity: '2', unitPrice: '9007199254740991' }] }],
    ['duplicate line identity', { lines: [input.lines[0], { ...input.lines[1], lineRef: 'line-a' }] }],
  ])('rejects %s', (_name, change) => {
    expect(() => buildEvaluationRequest({ ...input, ...change }, [])).toThrow();
  });

  test('rejects required, unknown, enum, boolean and invalid calendar-date live values', () => {
    const valid = { ...input, context: { channel: 'web' }, cart: { gift: 'false' },
      lines: input.lines.map(line => ({ ...line, extensions: { weight: '1' } })),
    };
    const changes: Partial<PlaygroundInput>[] = [
      { context: {} }, { context: { channel: 'foreign' } },
      { context: { channel: 'web', secret: 'unknown' } },
      { context: { channel: 'web', date: '2026-02-30' } }, { cart: { gift: 'yes' } },
      { lines: input.lines },
    ];
    for (const change of changes) expect(() => buildEvaluationRequest({ ...valid, ...change }, definitions)).toThrow();
  });
});
