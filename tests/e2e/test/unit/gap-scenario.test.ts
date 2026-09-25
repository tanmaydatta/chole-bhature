import { describe, expect, test } from 'vitest';

import { expectedGapBreakdown, gapCart } from '../../src/gap-scenario.js';

describe('GAP-030/031 fixture', () => {
  test('locks the hand-derived capped plus duplicate-line allocations', () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const breakdown = expectedGapBreakdown(runId, 'capped-program', 'line-program');
    expect(breakdown.discountAllocations).toEqual([
      { programRef: 'capped-program', programRevision: 1,
        rewardRuleRef: 'capped-quarter', discountMinorUnits: 1500 },
      { programRef: 'line-program', programRevision: 1,
        rewardRuleRef: 'five-per-unit', discountMinorUnits: 1500,
        lineAllocations: [
          { lineRef: `${runId}_duplicate_line_1`, discountMinorUnits: 500 },
          { lineRef: `${runId}_duplicate_line_2`, discountMinorUnits: 1000 },
        ] },
    ]);
    expect(breakdown.totalDiscount).toBe(3000);
    expect(breakdown.discountedMerchandiseSubtotal).toBe(7001);
    expect(gapCart(runId).items.map(item => item.productRef)).toEqual([
      `${runId}_duplicate_product`, `${runId}_duplicate_product`, `${runId}_other_product`,
    ]);
  });
});
