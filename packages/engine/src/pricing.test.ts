import type { Cart, IncentiveDecision } from '@incentives/contracts';
import { describe, expect, test } from 'vitest';

import { calculateMerchandisePriceBreakdown } from './pricing.js';

const cart: Cart = {
  currency: 'GBP',
  subtotal: 10_001,
  items: [
    { lineRef: 'line-a-1', productRef: 'product-a', quantity: 1, unitPrice: 4_001 },
    { lineRef: 'line-a-2', productRef: 'product-a', quantity: 2, unitPrice: 1_500 },
    { lineRef: 'line-b-1', productRef: 'product-b', quantity: 1, unitPrice: 3_000 },
  ],
};

function qualified(
  programRef: string,
  rewardRuleRef: string,
  effect: IncentiveDecision['effects'][number],
): IncentiveDecision {
  return {
    programRef,
    programRevision: 1,
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef,
    effects: [effect],
    reasonCodes: [],
    commitRequired: true,
  };
}

describe('calculateMerchandisePriceBreakdown', () => {
  test('floors percentage minor units and applies an exact-currency maximum', () => {
    const result = calculateMerchandisePriceBreakdown(cart, [qualified(
      'third-off',
      'third-off-rule',
      {
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 3_333,
        maximumDiscountAmount: { currency: 'GBP', minorUnits: 2_000 },
      },
    )]);

    expect(result).toEqual({
      currency: 'GBP',
      originalMerchandiseSubtotal: 10_001,
      discountAllocations: [{
        programRef: 'third-off',
        programRevision: 1,
        rewardRuleRef: 'third-off-rule',
        discountMinorUnits: 2_000,
      }],
      totalDiscount: 2_000,
      discountedMerchandiseSubtotal: 8_001,
    });
  });

  test('keeps duplicate-product line allocations distinct and caps them in cart order', () => {
    const result = calculateMerchandisePriceBreakdown(cart, [qualified(
      'product-a-quarter-off',
      'product-a-rule',
      {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'percent',
        basisPoints: 2_500,
        maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
      },
    )]);

    expect(result.discountAllocations).toEqual([{
      programRef: 'product-a-quarter-off',
      programRevision: 1,
      rewardRuleRef: 'product-a-rule',
      discountMinorUnits: 1_500,
      lineAllocations: [
        { lineRef: 'line-a-1', discountMinorUnits: 1_000 },
        { lineRef: 'line-a-2', discountMinorUnits: 500 },
      ],
    }]);
  });

  test('preserves selected Promo order and caps the aggregate at the merchandise subtotal', () => {
    const result = calculateMerchandisePriceBreakdown(cart, [
      qualified('line-first', 'line-rule', {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'percent',
        basisPoints: 2_500,
        maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
      }),
      qualified('fixed-second', 'fixed-rule', {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 9_500 },
      }),
    ]);

    expect(result.discountAllocations.map(allocation => ({
      programRef: allocation.programRef,
      discountMinorUnits: allocation.discountMinorUnits,
    }))).toEqual([
      { programRef: 'line-first', discountMinorUnits: 1_500 },
      { programRef: 'fixed-second', discountMinorUnits: 8_501 },
    ]);
    expect(result.totalDiscount).toBe(10_001);
    expect(result.discountedMerchandiseSubtotal).toBe(0);
  });

  test('does not let stacked line discounts consume non-matching merchandise', () => {
    const result = calculateMerchandisePriceBreakdown(cart, [
      qualified('line-first', 'line-first-rule', {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'percent',
        basisPoints: 8_000,
      }),
      qualified('line-second', 'line-second-rule', {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'percent',
        basisPoints: 8_000,
      }),
    ]);

    expect(result.discountAllocations).toEqual([{
      programRef: 'line-first',
      programRevision: 1,
      rewardRuleRef: 'line-first-rule',
      discountMinorUnits: 5_600,
      lineAllocations: [
        { lineRef: 'line-a-1', discountMinorUnits: 3_200 },
        { lineRef: 'line-a-2', discountMinorUnits: 2_400 },
      ],
    }, {
      programRef: 'line-second',
      programRevision: 1,
      rewardRuleRef: 'line-second-rule',
      discountMinorUnits: 1_401,
      lineAllocations: [
        { lineRef: 'line-a-1', discountMinorUnits: 801 },
        { lineRef: 'line-a-2', discountMinorUnits: 600 },
      ],
    }]);
    expect(result.totalDiscount).toBe(7_001);
    expect(result.discountedMerchandiseSubtotal).toBe(3_000);
  });

  test('allocates fixed line discounts per quantity without exceeding each line value', () => {
    const result = calculateMerchandisePriceBreakdown(cart, [qualified(
      'fixed-lines',
      'fixed-line-rule',
      {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 2_000 },
      },
    )]);

    expect(result.discountAllocations[0]).toEqual({
      programRef: 'fixed-lines',
      programRevision: 1,
      rewardRuleRef: 'fixed-line-rule',
      discountMinorUnits: 5_000,
      lineAllocations: [
        { lineRef: 'line-a-1', discountMinorUnits: 2_000 },
        { lineRef: 'line-a-2', discountMinorUnits: 3_000 },
      ],
    });
  });

  test('does not invent a monetary value for free shipping or non-qualified decisions', () => {
    const freeShipping = qualified('shipping', 'shipping-rule', { type: 'free_shipping' });
    const unavailable: IncentiveDecision = {
      ...qualified('ignored', 'ignored-rule', {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 1_000 },
      }),
      outcome: 'unavailable',
      effects: [],
      commitRequired: false,
    };

    expect(calculateMerchandisePriceBreakdown(cart, [freeShipping, unavailable])).toEqual({
      currency: 'GBP',
      originalMerchandiseSubtotal: 10_001,
      discountAllocations: [],
      totalDiscount: 0,
      discountedMerchandiseSubtotal: 10_001,
    });
  });

  test('rejects a monetary reward whose currency differs from the cart', () => {
    expect(() => calculateMerchandisePriceBreakdown(cart, [qualified(
      'wrong-currency',
      'wrong-currency-rule',
      {
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 1_000,
        maximumDiscountAmount: { currency: 'USD', minorUnits: 500 },
      },
    )])).toThrow('Discount currency must match the cart currency');
  });
});
