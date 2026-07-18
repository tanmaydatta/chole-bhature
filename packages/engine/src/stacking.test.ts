import { describe, expect, test } from 'vitest';

import type { ConflictCandidate } from './index.js';
import { resolveDecisionConflicts } from './index.js';

const lowerPriority: ConflictCandidate = {
  programRef: 'lower-priority',
  programType: 'promo',
  outcome: 'qualified',
  effects: [{ type: 'free_shipping' }],
  reasonCodes: [],
  commitRequired: true,
  eligible: true,
  priority: 10,
  stackable: false,
};

const higherPriority: ConflictCandidate = {
  ...lowerPriority,
  programRef: 'higher-priority',
  priority: 20,
};

describe('resolveDecisionConflicts', () => {
  test('resolves non-stacking qualified decisions deterministically', () => {
    expect(resolveDecisionConflicts([lowerPriority, higherPriority])).toEqual([
      expect.objectContaining({
        programRef: higherPriority.programRef,
        outcome: 'qualified',
      }),
      expect.objectContaining({
        programRef: lowerPriority.programRef,
        outcome: 'conflict',
        reasonCodes: ['STACKING_CONFLICT'],
        commitRequired: false,
        eligible: false,
      }),
    ]);
  });

  test('retains mutually stackable qualified decisions ordered by program reference', () => {
    const stackableB: ConflictCandidate = {
      ...lowerPriority,
      programRef: 'program-b',
      priority: 5,
      stackable: true,
    };
    const stackableA: ConflictCandidate = {
      ...stackableB,
      programRef: 'program-a',
    };

    expect(resolveDecisionConflicts([stackableB, stackableA])).toEqual([
      stackableA,
      stackableB,
    ]);
  });

  test('orders opaque program references by locale-independent code units', () => {
    const accented: ConflictCandidate = {
      ...lowerPriority,
      programRef: 'program-é',
      priority: 5,
      stackable: true,
    };
    const ascii: ConflictCandidate = {
      ...accented,
      programRef: 'program-z',
    };

    expect(resolveDecisionConflicts([accented, ascii])).toEqual([
      ascii,
      accented,
    ]);
  });

  test('retains decisions that were not qualified', () => {
    const notQualified: ConflictCandidate = {
      ...lowerPriority,
      programRef: 'not-qualified',
      outcome: 'not_qualified',
      effects: [],
      reasonCodes: ['MINIMUM_CART_NOT_MET'],
      commitRequired: false,
      eligible: false,
      priority: 30,
    };

    expect(resolveDecisionConflicts([lowerPriority, notQualified])).toEqual([
      notQualified,
      lowerPriority,
    ]);
  });
});
