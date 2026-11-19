import { describe, expect, it } from 'vitest';
import {
  CandidateOfferProgressSchema,
  CandidateOfferSchema,
  EvaluationRequestSchema,
  EvaluationResponseSchema,
} from './evaluation.js';

describe('CandidateOffer contracts', () => {
  it('validates a candidate offer with progress', () => {
    const parsed = CandidateOfferSchema.parse({
      programRef: 'tier-20',
      name: '20% off large carts',
      qualified: false,
      estimatedDiscountMinorUnits: 2000,
      progress: { current: 8000, target: 10000, shortfall: 2000 },
    });
    expect(parsed.qualified).toBe(false);
    expect(parsed.progress?.shortfall).toBe(2000);
  });

  it('validates a candidate offer without progress', () => {
    const parsed = CandidateOfferSchema.parse({
      programRef: 'tier-10',
      name: '10% off',
      qualified: true,
      estimatedDiscountMinorUnits: 1000,
    });
    expect(parsed.qualified).toBe(true);
    expect(parsed.progress).toBeUndefined();
  });

  it('accepts includeCandidateOffers and 24h ttl in request schema', () => {
    const req = EvaluationRequestSchema.parse({
      cart: { currency: 'USD', subtotal: 10000, items: [] },
      includeCandidateOffers: true,
      ttlSeconds: 86400,
    });
    expect(req.includeCandidateOffers).toBe(true);
    expect(req.ttlSeconds).toBe(86400);
  });

  it('rejects ttlSeconds out of range', () => {
    expect(() => EvaluationRequestSchema.parse({
      cart: { currency: 'USD', subtotal: 10000, items: [] },
      ttlSeconds: 59,
    })).toThrow();

    expect(() => EvaluationRequestSchema.parse({
      cart: { currency: 'USD', subtotal: 10000, items: [] },
      ttlSeconds: 86401,
    })).toThrow();
  });

  it('validates candidateOffers in response schema', () => {
    const res = EvaluationResponseSchema.parse({
      evaluationId: 'eval-1',
      schemaVersion: 1,
      expiresAt: '2026-11-19T00:00:00.000Z',
      decisions: [],
      priceBreakdown: {
        currency: 'USD',
        originalMerchandiseSubtotal: 10000,
        discountAllocations: [],
        totalDiscount: 0,
        discountedMerchandiseSubtotal: 10000,
      },
      candidateOffers: [
        {
          programRef: 'tier-20',
          name: '20% off large carts',
          qualified: false,
          estimatedDiscountMinorUnits: 2000,
          progress: { current: 8000, target: 10000, shortfall: 2000 },
        },
      ],
    });
    expect(res.candidateOffers).toHaveLength(1);
    expect(res.candidateOffers?.[0]?.name).toBe('20% off large carts');
  });
});
