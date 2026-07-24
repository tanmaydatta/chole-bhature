import { describe, expect, test } from 'vitest';

import type { ConflictCandidate, RankedProgram } from './index.js';
import {
  compareProgramRank,
  selectAutomaticDecision,
  selectCodedDecisionCombination,
} from './index.js';

const qualifiedDecision: ConflictCandidate = {
  programRef: 'promo-a',
  programRevision: 1,
  programType: 'promo',
  outcome: 'qualified',
  effects: [{ type: 'free_shipping' }],
  reasonCodes: [],
  commitRequired: true,
  eligible: true,
  priority: 10,
  stackable: false,
};

function qualified(
  overrides: Partial<ConflictCandidate> = {},
): ConflictCandidate {
  return { ...qualifiedDecision, ...overrides };
}

function notQualified(
  overrides: Partial<ConflictCandidate> = {},
): ConflictCandidate {
  return {
    ...qualifiedDecision,
    outcome: 'not_qualified',
    effects: [],
    reasonCodes: ['MINIMUM_CART_NOT_MET'],
    commitRequired: false,
    eligible: false,
    ...overrides,
  };
}

function invalidCode(
  overrides: Partial<ConflictCandidate> = {},
): ConflictCandidate {
  return {
    ...qualifiedDecision,
    outcome: 'invalid_code',
    effects: [],
    reasonCodes: ['INVALID_PROMO_CODE'],
    commitRequired: false,
    eligible: false,
    ...overrides,
  };
}

describe('compareProgramRank', () => {
  test('orders higher priorities first', () => {
    expect(compareProgramRank(
      { priority: 20, programRef: 'promo-z' },
      { priority: 10, programRef: 'promo-a' },
    )).toBeLessThan(0);
  });

  test('uses ascending binary program-reference order for equal priorities', () => {
    expect(compareProgramRank(
      { priority: 10, programRef: 'promo-a' },
      { priority: 10, programRef: 'promo-b' },
    )).toBeLessThan(0);

    const ranked: RankedProgram[] = [
      { priority: 10, programRef: 'promo-é' },
      { priority: 10, programRef: 'promo-z' },
    ];
    expect(ranked.sort(compareProgramRank).map(({ programRef }) => programRef))
      .toEqual(['promo-z', 'promo-é']);
  });
});

describe('selectAutomaticDecision', () => {
  test('returns only the highest-ranked qualified Promo decision', () => {
    expect(selectAutomaticDecision([
      notQualified({ priority: 30, programRef: 'promo-a' }),
      qualified({ priority: 20, programRef: 'promo-b' }),
      qualified({ priority: 10, programRef: 'promo-c' }),
    ])).toEqual([
      expect.objectContaining({ programRef: 'promo-b' }),
    ]);
  });

  test('returns no decisions when no Promo candidate qualifies', () => {
    expect(selectAutomaticDecision([
      notQualified({ programRef: 'promo-a' }),
      invalidCode({ programRef: 'promo-b' }),
    ])).toEqual([]);
  });
});

describe('selectCodedDecisionCombination', () => {
  test('returns an empty selection when no coded Promo qualifies', () => {
    expect(selectCodedDecisionCombination([
      notQualified({ programRef: 'promo-a' }),
      invalidCode({ programRef: 'promo-b' }),
    ])).toEqual({
      decisions: [],
      rejectedProgramRefs: [],
    });
  });

  test('selects one qualified non-stackable coded Promo', () => {
    const decision = qualified({
      programRef: 'promo-a',
      stackable: false,
    });

    expect(selectCodedDecisionCombination([decision])).toEqual({
      decisions: [decision],
      rejectedProgramRefs: [],
    });
  });

  test('selects several stackable coded Promos in deterministic rank order', () => {
    const lowerPriority = qualified({
      programRef: 'promo-a',
      priority: 10,
      stackable: true,
    });
    const equalPriorityB = qualified({
      programRef: 'promo-b',
      priority: 20,
      stackable: true,
    });
    const equalPriorityA = qualified({
      programRef: 'promo-a',
      priority: 20,
      stackable: true,
    });

    expect(selectCodedDecisionCombination([
      lowerPriority,
      equalPriorityB,
      equalPriorityA,
    ])).toEqual({
      decisions: [equalPriorityA, equalPriorityB, lowerPriority],
      rejectedProgramRefs: [],
    });
  });

  test('identifies every qualified Promo when a coded combination is not allowed', () => {
    expect(selectCodedDecisionCombination([
      qualified({ programRef: 'a', stackable: true }),
      qualified({ programRef: 'b', stackable: false }),
      invalidCode({ programRef: 'c' }),
    ])).toEqual({
      decisions: [],
      rejectedProgramRefs: ['a', 'b'],
    });
  });

  test('does not let non-qualified decisions participate in a coded conflict', () => {
    const first = qualified({ programRef: 'a', stackable: true });
    const second = qualified({ programRef: 'b', stackable: true });

    expect(selectCodedDecisionCombination([
      first,
      notQualified({ programRef: 'c', stackable: false }),
      second,
    ])).toEqual({
      decisions: [first, second],
      rejectedProgramRefs: [],
    });
  });
});
