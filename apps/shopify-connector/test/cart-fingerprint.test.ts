import { describe, expect, it } from 'vitest';
import { computeCartFingerprint } from '../src/services/cart-fingerprint.js';

describe('cart fingerprint', () => {
  it('matches the shared Rust/TS canonical hash vector', async () => {
    const fingerprint = await computeCartFingerprint({
      currency: 'USD',
      subtotal: 10000,
      items: [
        {
          lineRef: 'line-1',
          productRef: 'prod-1',
          variantRef: 'var-1',
          quantity: 1,
          unitPrice: 10000,
        },
      ],
    });

    expect(fingerprint).toBe(
      '06e494d2202ed65bf4b8e1ce302b5befbca56e503c4e1cf0a8de60bea029ba0d',
    );
  });

  it('is insensitive to input line order but sensitive to quantity and price', async () => {
    const base = {
      currency: 'USD',
      subtotal: 15000,
      items: [
        { lineRef: 'b', productRef: 'p2', variantRef: 'v2', quantity: 1, unitPrice: 5000 },
        { lineRef: 'a', productRef: 'p1', variantRef: 'v1', quantity: 1, unitPrice: 10000 },
      ],
    };
    const reordered = { ...base, items: [...base.items].reverse() };
    expect(await computeCartFingerprint(base)).toBe(await computeCartFingerprint(reordered));

    const changedQuantity = {
      ...base,
      items: [{ ...base.items[0]!, quantity: 2 }, base.items[1]!],
    };
    expect(await computeCartFingerprint(base)).not.toBe(await computeCartFingerprint(changedQuantity));

    const changedPrice = {
      ...base,
      items: [{ ...base.items[0]!, unitPrice: 4000 }, base.items[1]!],
    };
    expect(await computeCartFingerprint(base)).not.toBe(await computeCartFingerprint(changedPrice));
  });
});
