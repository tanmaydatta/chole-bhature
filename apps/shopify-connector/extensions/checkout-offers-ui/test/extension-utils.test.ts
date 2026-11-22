import { describe, expect, it } from 'vitest';
import type { EvaluationResponse } from '@incentives/contracts';
import {
  buildEvaluationRequest,
  cartChangeFingerprint,
  cartItems,
  formatMoney,
  hasPositiveDiscount,
  qualifiedOffers,
  rejectedCodeOutcome,
  progressOffers,
  type ShopifyCartLine,
} from '../src/extension-utils.js';

const lines: ShopifyCartLine[] = [
  {
    id: 'gid://shopify/CartLine/1',
    quantity: 2,
    cost: {
      totalAmount: { amount: 50, currencyCode: 'USD' },
    },
    merchandise: {
      id: 'gid://shopify/ProductVariant/1',
      product: { id: 'gid://shopify/Product/1' },
    },
  },
];

function evaluation(overrides: Partial<EvaluationResponse> = {}): EvaluationResponse {
  return {
    evaluationId: 'eval-1',
    schemaVersion: 1,
    expiresAt: '2026-11-23T00:00:00.000Z',
    decisions: [],
    priceBreakdown: {
      currency: 'USD',
      originalMerchandiseSubtotal: 5000,
      discountAllocations: [],
      totalDiscount: 1000,
      discountedMerchandiseSubtotal: 4000,
    },
    ...overrides,
  };
}

describe('checkout extension utilities', () => {
  it('maps Shopify cart lines to the platform cart shape', () => {
    expect(cartItems(lines)).toEqual([
      {
        lineRef: 'gid://shopify/CartLine/1',
        productRef: 'gid://shopify/Product/1',
        variantRef: 'gid://shopify/ProductVariant/1',
        quantity: 2,
        unitPrice: 2500,
      },
    ]);
  });

  it('builds an evaluation request with minor units and codes', () => {
    expect(buildEvaluationRequest(lines, { amount: 50, currencyCode: 'USD' }, ['SAVE10'])).toEqual({
      cart: {
        currency: 'USD',
        subtotal: 5000,
        items: [
          {
            lineRef: 'gid://shopify/CartLine/1',
            productRef: 'gid://shopify/Product/1',
            variantRef: 'gid://shopify/ProductVariant/1',
            quantity: 2,
            unitPrice: 2500,
          },
        ],
      },
      codes: ['SAVE10'],
      includeCandidateOffers: true,
    });
  });

  it('changes the cart fingerprint when a line or quantity changes', () => {
    const base = cartChangeFingerprint(lines);
    expect(cartChangeFingerprint([{ ...lines[0]!, quantity: 1 }])).not.toBe(base);
    expect(cartChangeFingerprint([...lines, { ...lines[0]!, id: 'gid://shopify/CartLine/2' }])).not.toBe(base);
  });

  it('requires both a positive discount and a server-signed payload', () => {
    expect(hasPositiveDiscount(evaluation())).toBe(false);
    expect(hasPositiveDiscount(evaluation({ signedEvaluation: undefined }))).toBe(false);
    expect(
      hasPositiveDiscount(
        evaluation({
          signedEvaluation: {
            evaluationId: 'eval-1',
            cartId: 'chk-1',
            subtotalMinorUnits: 5000,
            currency: 'USD',
            discountMinorUnits: 1000,
            signature: 'a'.repeat(64),
          },
        }),
      ),
    ).toBe(true);
  });

  it('detects a rejected code result', () => {
    const response = evaluation({
      codeResults: [
        {
          code: 'BADCODE',
          normalizedCode: 'BADCODE',
          outcome: 'invalid_code',
          reasonCodes: ['INVALID_PROMO_CODE'],
        },
      ],
    });
    expect(rejectedCodeOutcome(response, 'badcode')).toBe(true);
    expect(rejectedCodeOutcome(response, 'goodcode')).toBe(false);
  });

  it('splits qualified and progress offers', () => {
    const offers = [
      { programRef: 'a', name: 'A', qualified: true, estimatedDiscountMinorUnits: 100 },
      { programRef: 'b', name: 'B', qualified: false, estimatedDiscountMinorUnits: 0, progress: { current: 100, target: 200, shortfall: 100 } },
      { programRef: 'c', name: 'C', qualified: false, estimatedDiscountMinorUnits: 0 },
    ];
    expect(qualifiedOffers(offers).map(offer => offer.programRef)).toEqual(['a']);
    expect(progressOffers(offers).map(offer => offer.programRef)).toEqual(['b']);
  });

  it('formats minor units as store currency', () => {
    expect(formatMoney(1500, 'USD')).toContain('15.00');
    expect(formatMoney(1500, 'JPY')).toBeTruthy();
  });
});
