import type { IncentiveDecision } from '@incentives/contracts';

export interface ConflictCandidate extends IncentiveDecision {
  priority: number;
  stackable: boolean;
  stackingGroup?: string;
}

function byPriorityThenProgramRef(
  left: ConflictCandidate,
  right: ConflictCandidate,
): number {
  const priorityOrder = right.priority - left.priority;
  if (priorityOrder !== 0) return priorityOrder;
  if (left.programRef < right.programRef) return -1;
  if (left.programRef > right.programRef) return 1;
  return 0;
}

export function resolveDecisionConflicts(
  decisions: readonly ConflictCandidate[],
): ConflictCandidate[] {
  const sorted = [...decisions].sort(byPriorityThenProgramRef);
  let hasQualifiedWinner = false;
  let allQualifiedWinnersAreStackable = true;

  return sorted.map((decision) => {
    if (decision.outcome !== 'qualified') return decision;

    if (!hasQualifiedWinner) {
      hasQualifiedWinner = true;
      allQualifiedWinnersAreStackable = decision.stackable;
      return decision;
    }

    if (decision.stackable && allQualifiedWinnersAreStackable) return decision;

    return {
      ...decision,
      outcome: 'conflict',
      reasonCodes: ['STACKING_CONFLICT'],
      commitRequired: false,
      eligible: false,
    };
  });
}
