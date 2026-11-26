import type {
  CandidateOffer,
  CodeEvaluationResult,
  EvaluationResponse,
} from '@incentives/contracts';
import { offerName } from './demo.js';

export interface AppliedOffer {
  programRef: string;
  name: string;
  savingsMinorUnits: number;
  freeShipping: boolean;
}

export interface CodeOfferView {
  code: string;
  normalizedCode: string;
  outcome: CodeEvaluationResult['outcome'];
  applied: boolean;
  label: string;
  savingsMinorUnits: number;
}

export interface CandidateOfferView {
  programRef: string;
  name: string;
  status: 'paused' | 'outranked' | 'progress' | 'locked';
  estimatedDiscountMinorUnits: number;
  progress?: CandidateOffer['progress'];
  note: string;
}

export interface OffersView {
  applied: AppliedOffer[];
  codes: CodeOfferView[];
  candidates: CandidateOfferView[];
  totalSavingsMinorUnits: number;
}

const CODE_LABELS: Record<CodeEvaluationResult['outcome'], string> = {
  selected: 'Applied',
  invalid_code: 'Code not recognised',
  not_qualified: 'Not eligible for this order',
  unavailable: 'Code unavailable',
  exhausted: 'Fully redeemed',
  combination_rejected: 'Cannot be combined',
};

function candidateNote(offer: CandidateOffer, codedMode: boolean): string {
  if (offer.qualified) {
    return codedMode
      ? 'Auto offers pause while a code is active'
      : 'A higher-priority offer is applied';
  }
  if (offer.programRef === 'vip-15') return 'VIP customers only';
  if (offer.programRef === 'paneer-15') return 'Add Paneer Tikka to unlock';
  if (offer.progress) return 'Add more to unlock';
  return 'Not available for this cart';
}

/**
 * The single source of truth for the offer UI: applied amounts come from
 * `priceBreakdown.discountAllocations`, never from per-offer estimates.
 */
export function buildOffersView(evaluation: EvaluationResponse): OffersView {
  const qualified = evaluation.decisions.filter(
    decision => decision.outcome === 'qualified',
  );
  const allocationByRef = new Map(
    evaluation.priceBreakdown.discountAllocations.map(allocation => (
      [allocation.programRef, allocation.discountMinorUnits]
    )),
  );

  const codeResults = evaluation.codeResults ?? [];
  const codedMode = codeResults.length > 0;
  // Selected codes render in their own section so their savings are not double-counted.
  const selectedCodeRefs = new Set(
    codeResults.flatMap(result => (
      result.outcome === 'selected' && result.programRef !== undefined
        ? [result.programRef]
        : []
    )),
  );

  const applied: AppliedOffer[] = qualified
    .filter(decision => !selectedCodeRefs.has(decision.programRef))
    .map(decision => ({
      programRef: decision.programRef,
      name: offerName(decision.programRef),
      savingsMinorUnits: allocationByRef.get(decision.programRef) ?? 0,
      freeShipping: decision.effects.some(effect => effect.type === 'free_shipping'),
    }));

  const appliedRefs = new Set(applied.map(offer => offer.programRef));

  const codes: CodeOfferView[] = codeResults.map(result => ({
    code: result.code,
    normalizedCode: result.normalizedCode,
    outcome: result.outcome,
    applied: result.outcome === 'selected',
    label: CODE_LABELS[result.outcome],
    savingsMinorUnits: result.programRef === undefined
      ? 0
      : allocationByRef.get(result.programRef) ?? 0,
  }));

  const candidates: CandidateOfferView[] = (evaluation.candidateOffers ?? [])
    .filter(offer => !appliedRefs.has(offer.programRef))
    .map(offer => ({
      programRef: offer.programRef,
      name: offer.name,
      status: offer.qualified
        ? codedMode
          ? 'paused'
          : 'outranked'
        : offer.progress
          ? 'progress'
          : 'locked',
      estimatedDiscountMinorUnits: offer.estimatedDiscountMinorUnits,
      ...(offer.progress === undefined ? {} : { progress: offer.progress }),
      note: candidateNote(offer, codedMode),
    }));

  return {
    applied,
    codes,
    candidates,
    totalSavingsMinorUnits: evaluation.priceBreakdown.totalDiscount,
  };
}
