import type {
  EvaluationDecisionRecord,
  RedemptionBundleCreate,
} from '../repositories/types.js';

export interface CommitRedemptionBundleInput {
  merchantId: string;
  evaluation: EvaluationDecisionRecord;
  externalOrderRef: string;
  idempotencyKey: string;
  requestDigest: string;
  correlationId: string;
  committedAt: string;
}

export type ExhaustionReasonCode =
  | 'USAGE_CAP_EXHAUSTED'
  | 'PER_CUSTOMER_CAP_EXHAUSTED'
  | 'BUDGET_EXHAUSTED';

export type TerminalRedemptionErrorCode =
  | 'NOTHING_TO_COMMIT'
  | 'DECISION_EXPIRED'
  | 'INVALID_DECISION'
  | 'PROGRAM_UNAVAILABLE'
  | ExhaustionReasonCode;

export type CommitRedemptionBundleResult =
  | { kind: 'committed'; bundle: RedemptionBundleCreate }
  | { kind: 'exact_retry'; bundle: RedemptionBundleCreate }
  | {
    kind: 'terminal_retry';
    code: TerminalRedemptionErrorCode;
    retryable: false;
  }
  | { kind: 'conflict' }
  | { kind: 'exhausted'; reasonCode: ExhaustionReasonCode }
  | { kind: 'unavailable'; retryable: true };

/**
 * Provider-neutral atomic authorization boundary for a complete redemption bundle.
 *
 * A future distributed implementation must durably prepare every authority claim,
 * release every prepared claim when authorization fails, mark the bundle authorized
 * before returning success, and idempotently finalize or recover unfinished work.
 * Stable terminal failures and exact retries must survive coordinator restarts.
 */
export interface AtomicRedemptionCoordinator {
  commitBundle(
    input: CommitRedemptionBundleInput,
  ): Promise<CommitRedemptionBundleResult>;
  getBundle(input: {
    merchantId: string;
    idempotencyKey: string;
  }): Promise<RedemptionBundleCreate | null>;
}
