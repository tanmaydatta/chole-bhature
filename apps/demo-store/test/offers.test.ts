import { describe, expect, it } from 'vitest';
import {
  DEMO_CUSTOMERS,
  cartFromItems,
  evaluateDemo,
  type CartLineInput,
} from '../src/shared/demo.js';
import { buildOffersView } from '../src/shared/offers.js';

function evaluationFor(items: CartLineInput[], codes: string[] = []) {
  return evaluateDemo({
    cart: cartFromItems(items),
    customer: DEMO_CUSTOMERS.new,
    codes,
  });
}

describe('offers view', () => {
  it('renders applied savings from the authoritative discount allocations', () => {
    const evaluation = evaluationFor([
      { itemId: 'chole-bhature', quantity: 1 },
      { itemId: 'paneer-tikka', quantity: 1 },
      { itemId: 'dal-makhani', quantity: 1 },
    ]);
    const view = buildOffersView(evaluation);

    expect(view.applied).toHaveLength(1);
    expect(view.applied[0]).toMatchObject({
      programRef: 'feast-20',
      savingsMinorUnits: 11_940,
    });
    expect(view.applied[0]?.savingsMinorUnits).toBe(view.totalSavingsMinorUnits);
    expect(view.candidates.find(offer => offer.programRef === 'paneer-15')?.status)
      .toBe('outranked');
    expect(view.candidates.find(offer => offer.programRef === 'big-basket')?.status)
      .toBe('progress');
  });

  it('shows a code exactly once with its allocation', () => {
    const evaluation = evaluationFor([{ itemId: 'chole-bhature', quantity: 1 }], ['WELCOME50']);
    const view = buildOffersView(evaluation);

    expect(view.applied).toHaveLength(0);
    expect(view.codes).toEqual([
      {
        code: 'WELCOME50',
        normalizedCode: 'WELCOME50',
        outcome: 'selected',
        applied: true,
        label: 'Applied',
        savingsMinorUnits: 5_000,
      },
    ]);
    const visibleSavings = [...view.applied, ...view.codes]
      .reduce((sum, offer) => sum + offer.savingsMinorUnits, 0);
    expect(visibleSavings).toBe(view.totalSavingsMinorUnits);
  });

  it('marks free delivery without inventing a merchandise saving', () => {
    const evaluation = evaluationFor([
      { itemId: 'chole-bhature', quantity: 1 },
      { itemId: 'butter-naan', quantity: 1 },
      { itemId: 'masala-chai', quantity: 1 },
    ]);
    const view = buildOffersView(evaluation);

    expect(view.applied).toHaveLength(1);
    expect(view.applied[0]).toMatchObject({
      programRef: 'free-delivery',
      freeShipping: true,
      savingsMinorUnits: 0,
    });
    expect(view.totalSavingsMinorUnits).toBe(0);
  });

  it('explains paused auto offers while a code is active', () => {
    const evaluation = evaluationFor([
      { itemId: 'chole-bhature', quantity: 1 },
      { itemId: 'paneer-tikka', quantity: 1 },
      { itemId: 'dal-makhani', quantity: 1 },
    ], ['NOPE']);
    const view = buildOffersView(evaluation);

    expect(view.codes[0]).toMatchObject({
      applied: false,
      label: 'Code not recognised',
    });
    expect(view.candidates.find(offer => offer.programRef === 'feast-20')).toMatchObject({
      status: 'paused',
      note: 'Auto offers pause while a code is active',
    });
  });

  it('labels locked VIP offers', () => {
    const evaluation = evaluationFor([{ itemId: 'chole-bhature', quantity: 1 }]);
    const view = buildOffersView(evaluation);
    expect(view.candidates.find(offer => offer.programRef === 'vip-15')?.note)
      .toBe('VIP customers only');
  });
});
