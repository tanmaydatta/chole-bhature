import type { IncentiveDecision } from '@incentives/contracts';

export interface ConflictCandidate extends IncentiveDecision {
  programType: 'promo';
  priority: number;
  stackable: boolean;
}

export interface RankedProgram {
  priority: number;
  programRef: string;
}

export function compareProgramRank(
  left: RankedProgram,
  right: RankedProgram,
): number {
  const priorityOrder = right.priority - left.priority;
  if (priorityOrder !== 0) return priorityOrder;
  if (left.programRef < right.programRef) return -1;
  if (left.programRef > right.programRef) return 1;
  return 0;
}

export function selectAutomaticDecision(
  candidates: readonly ConflictCandidate[],
): ConflictCandidate[] {
  const winner = [...candidates]
    .sort(compareProgramRank)
    .find(candidate => candidate.outcome === 'qualified');
  return winner === undefined ? [] : [winner];
}

export function selectCodedDecisionCombination(
  candidates: readonly ConflictCandidate[],
): {
  decisions: ConflictCandidate[];
  rejectedProgramRefs: string[];
} {
  const qualified = candidates
    .filter(candidate => candidate.outcome === 'qualified')
    .sort(compareProgramRank);
  if (qualified.length <= 1 || qualified.every(candidate => candidate.stackable)) {
    return { decisions: qualified, rejectedProgramRefs: [] };
  }
  return {
    decisions: [],
    rejectedProgramRefs: qualified.map(candidate => candidate.programRef),
  };
}
