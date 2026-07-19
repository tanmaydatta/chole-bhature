import {
  RedemptionResponseSchema,
  type CommerceReward,
  type PromoProgram,
  type RedemptionRequest,
  type RedemptionResponse,
} from '@incentives/contracts';
import { z } from 'zod';

import type { Env } from '../env.js';
import {
  DecisionExpiredError,
  ExhaustedError,
  NotFoundError,
  VersionConflictError,
} from '../errors.js';
import { canonicalJson } from '../json.js';
import type {
  AtomicRedemptionCommit,
  EvaluationDecisionRecord,
  RedemptionCreate,
  RedemptionIntegrityVerifiers,
  Repositories,
} from '../repositories/types.js';
import {
  projectedDiscountMinorUnits,
  verifyDecisionIntegrity,
} from './evaluation-service.js';
import {
  signRedemptionReceipt,
  verifyRedemptionReceipt,
} from './redemption-receipt.js';

const SigningSecretSchema = z.string().min(16).max(4_096);

function sameRedemption(left: RedemptionCreate, right: RedemptionCreate): boolean {
  return left.redemptionId === right.redemptionId;
}

function matchesRetry(existing: RedemptionCreate, request: RedemptionRequest): boolean {
  return existing.evaluationId === request.evaluationId
    && existing.result.programRef === request.programRef
    && (request.externalOrderRef === undefined
      || existing.externalOrderRef === request.externalOrderRef)
    && (request.idempotencyKey === undefined
      || existing.idempotencyKey === request.idempotencyKey);
}

async function verifiedDecision(
  repositories: Repositories,
  merchantId: string,
  evaluationId: string,
  verifyIntegrity: RedemptionIntegrityVerifiers['verifyDecision'],
  missingIsCorruption: boolean,
): Promise<EvaluationDecisionRecord> {
  const record = await repositories.decisions.get(merchantId, evaluationId);
  if (record === null) {
    if (missingIsCorruption) throw new Error('Committed redemption decision is missing');
    throw new NotFoundError('Evaluation decision not found');
  }
  if (!(await verifyIntegrity(record))) {
    throw new Error('Decision snapshot integrity verification failed');
  }
  return record;
}

function committedDecision(record: EvaluationDecisionRecord, programRef: string) {
  const matches = record.decisions.filter(decision => (
    decision.programRef === programRef
    && decision.outcome === 'qualified'
    && decision.commitRequired
  ));
  if (matches.length !== 1) {
    throw new Error('Committed redemption has no matching qualified decision');
  }
  return matches[0]!;
}

async function validateCommittedRedemption(
  repositories: Repositories,
  merchantId: string,
  existing: RedemptionCreate,
  verifyIntegrity: RedemptionIntegrityVerifiers['verifyDecision'],
): Promise<void> {
  const record = await verifiedDecision(
    repositories,
    merchantId,
    existing.evaluationId,
    verifyIntegrity,
    true,
  );
  const decision = committedDecision(record, existing.result.programRef);
  const discountMinorUnits = projectedDiscountMinorUnits(decision.effects, record.request.cart);
  if (
    decision.rewardRuleRef === undefined
    || existing.result.rewardRuleRef !== decision.rewardRuleRef
    || canonicalJson(existing.result.effects) !== canonicalJson(decision.effects)
    || existing.currency !== record.request.cart.currency
    || existing.discountMinorUnits !== discountMinorUnits
  ) {
    throw new Error('Committed redemption does not match its signed decision');
  }
}

async function findExisting(
  repositories: Repositories,
  merchantId: string,
  request: RedemptionRequest,
  verifyIntegrity: RedemptionIntegrityVerifiers,
): Promise<RedemptionCreate | null> {
  const [byOrder, byKey] = await Promise.all([
    request.externalOrderRef === undefined
      ? Promise.resolve(null)
      : repositories.redemptions.getByExternalOrderRef(
        merchantId,
        request.externalOrderRef,
        verifyIntegrity.verifyReceipt,
      ),
    request.idempotencyKey === undefined
      ? Promise.resolve(null)
      : repositories.redemptions.getByIdempotencyKey(
        merchantId,
        request.idempotencyKey,
        verifyIntegrity.verifyReceipt,
      ),
  ]);
  const candidates = [byOrder, byKey].filter(
    (candidate): candidate is RedemptionCreate => candidate !== null,
  ).filter((candidate, index, all) => (
    all.findIndex(other => sameRedemption(candidate, other)) === index
  ));
  await Promise.all(candidates.map(candidate => validateCommittedRedemption(
    repositories,
    merchantId,
    candidate,
    verifyIntegrity.verifyDecision,
  )));
  if (byOrder !== null && byKey !== null && !sameRedemption(byOrder, byKey)) {
    throw new VersionConflictError();
  }
  const existing = byOrder ?? byKey;
  if (existing !== null && !matchesRetry(existing, request)) {
    throw new VersionConflictError();
  }
  return existing;
}

function selectedDecision(record: EvaluationDecisionRecord, programRef: string) {
  const matches = record.decisions.filter(decision => decision.programRef === programRef);
  if (
    matches.length !== 1
    || matches[0]?.outcome !== 'qualified'
    || !matches[0].commitRequired
    || matches[0].rewardRuleRef === undefined
  ) {
    throw new VersionConflictError('The evaluation has no selected committable decision');
  }
  return { ...matches[0], rewardRuleRef: matches[0].rewardRuleRef };
}

function rewardByRef(program: PromoProgram, rewardRuleRef: string): CommerceReward {
  const matches = [
    ...program.rewardRules
      .filter(rule => rule.id === rewardRuleRef)
      .map(rule => rule.reward),
    ...(program.fallbackReward?.id === rewardRuleRef
      ? [program.fallbackReward.reward]
      : []),
  ];
  if (matches.length !== 1) {
    throw new VersionConflictError('The selected reward rule changed after evaluation');
  }
  return matches[0]!;
}

function snapshotProgram(record: EvaluationDecisionRecord, programRef: string): PromoProgram {
  const matches = record.facts.programs.filter(program => program.programRef === programRef);
  if (matches.length !== 1) {
    throw new VersionConflictError('The signed program snapshot is missing or ambiguous');
  }
  return matches[0]!.config;
}

export function createRedemptionService(repositories: Repositories, env: Env) {
  return {
    async redeem(
      merchantId: string,
      request: RedemptionRequest,
    ): Promise<RedemptionResponse> {
      try {
        const signingSecret = SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET);
        const verifyIntegrity: RedemptionIntegrityVerifiers = {
          verifyDecision: record => verifyDecisionIntegrity(record, signingSecret),
          verifyReceipt: receipt => verifyRedemptionReceipt(receipt, signingSecret),
        };
        const existing = await findExisting(repositories, merchantId, request, verifyIntegrity);
        if (existing !== null) return existing.result;

        const record = await verifiedDecision(
          repositories,
          merchantId,
          request.evaluationId,
          verifyIntegrity.verifyDecision,
          false,
        );
        if (Date.parse(record.expiresAt) <= Date.now()) throw new DecisionExpiredError();

        const decision = selectedDecision(record, request.programRef);
        const snapshotReward = rewardByRef(
          snapshotProgram(record, request.programRef),
          decision.rewardRuleRef,
        );
        if (canonicalJson(decision.effects) !== canonicalJson([snapshotReward])) {
          throw new VersionConflictError('The signed selected reward does not match its rule');
        }
        const program = await repositories.programs.get(merchantId, request.programRef);
        if (program === null || program.program.status !== 'active') throw new ExhaustedError();
        const currentReward = rewardByRef(program.program, decision.rewardRuleRef);
        if (canonicalJson(decision.effects) !== canonicalJson([currentReward])) {
          throw new VersionConflictError('The program reward changed after evaluation');
        }
        const cartCurrency = record.request.cart.currency;
        if (
          ('amount' in currentReward
            && currentReward.amount.currency !== cartCurrency)
          || (program.program.budget !== undefined
            && program.program.budget.currency !== cartCurrency)
        ) {
          throw new VersionConflictError('The program currency changed after evaluation');
        }
        const discountMinorUnits = projectedDiscountMinorUnits(
          decision.effects,
          record.request.cart,
        );

        if (program.program.perCustomerCap !== undefined) {
          if (record.customerRef === undefined) {
            throw new VersionConflictError('A customer is required for this redemption');
          }
          const count = await repositories.redemptions.countCommittedForCustomerProgram(
            merchantId,
            record.customerRef,
            request.programRef,
            verifyIntegrity,
          );
          if (count >= program.program.perCustomerCap) throw new ExhaustedError();
        }

        const result = RedemptionResponseSchema.parse({
          redemptionId: crypto.randomUUID(),
          evaluationId: request.evaluationId,
          programRef: request.programRef,
          rewardRuleRef: decision.rewardRuleRef,
          ...(request.externalOrderRef === undefined
            ? {}
            : { externalOrderRef: request.externalOrderRef }),
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
          status: 'committed',
          effects: decision.effects,
        });
        const unsignedCommit = {
          redemptionId: result.redemptionId,
          merchantId,
          ...(request.externalOrderRef === undefined
            ? {}
            : { externalOrderRef: request.externalOrderRef }),
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
          evaluationId: request.evaluationId,
          result,
          discountMinorUnits,
          currency: cartCurrency,
          createdAt: new Date().toISOString(),
          programId: program.id,
          programRef: request.programRef,
          expectedProgram: program.program,
          ...(record.customerRef === undefined ? {} : { customerRef: record.customerRef }),
          ...(program.program.perCustomerCap === undefined
            ? {}
            : { perCustomerCap: program.program.perCustomerCap }),
        } satisfies Omit<AtomicRedemptionCommit, 'receiptIntegrityHash'>;
        const commit: AtomicRedemptionCommit = {
          ...unsignedCommit,
          receiptIntegrityHash: await signRedemptionReceipt(unsignedCommit, signingSecret),
        };

        try {
          if (await repositories.redemptions.commitAtomically(commit)) return result;
        } catch (error) {
          const raced = await findExisting(repositories, merchantId, request, verifyIntegrity);
          if (raced !== null) return raced.result;
          throw error;
        }
        const raced = await findExisting(repositories, merchantId, request, verifyIntegrity);
        if (raced !== null) return raced.result;
        await repositories.programs.get(merchantId, request.programRef);
        throw new ExhaustedError();
      } catch (error) {
        if (
          error instanceof DecisionExpiredError
          || error instanceof ExhaustedError
          || error instanceof NotFoundError
          || error instanceof VersionConflictError
        ) {
          throw error;
        }
        throw new Error('Redemption pipeline failed', { cause: error });
      }
    },
  };
}
