import {
  RedemptionRequestSchema,
  RedemptionResponseSchema,
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
  EvaluationDecisionRecord,
  RedemptionCreate,
  Repositories,
} from '../repositories/types.js';
import {
  projectedDiscountMinorUnits,
  verifyDecisionIntegrity,
} from './evaluation-service.js';

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

async function findExisting(
  repositories: Repositories,
  merchantId: string,
  request: RedemptionRequest,
): Promise<RedemptionCreate | null> {
  const [byOrder, byKey] = await Promise.all([
    request.externalOrderRef === undefined
      ? Promise.resolve(null)
      : repositories.redemptions.getByExternalOrderRef(merchantId, request.externalOrderRef),
    request.idempotencyKey === undefined
      ? Promise.resolve(null)
      : repositories.redemptions.getByIdempotencyKey(merchantId, request.idempotencyKey),
  ]);
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
  ) {
    throw new VersionConflictError('The evaluation has no selected committable decision');
  }
  return matches[0];
}

export function createRedemptionService(repositories: Repositories, env: Env) {
  return {
    async redeem(merchantId: string, input: unknown): Promise<RedemptionResponse> {
      const request = RedemptionRequestSchema.parse(input);
      const existing = await findExisting(repositories, merchantId, request);
      if (existing !== null) return existing.result;

      const record = await repositories.decisions.get(merchantId, request.evaluationId);
      if (record === null) throw new NotFoundError('Evaluation decision not found');
      const signingSecret = SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET);
      if (!(await verifyDecisionIntegrity(record, signingSecret))) {
        throw new Error('Decision snapshot integrity verification failed');
      }
      if (Date.parse(record.expiresAt) <= Date.now()) throw new DecisionExpiredError();

      const decision = selectedDecision(record, request.programRef);
      const program = await repositories.programs.get(merchantId, request.programRef);
      if (program === null || program.program.status !== 'active') throw new ExhaustedError();
      if (canonicalJson(decision.effects) !== canonicalJson([program.program.reward])) {
        throw new VersionConflictError('The program reward changed after evaluation');
      }
      const cartCurrency = record.request.cart.currency;
      if (
        ('amount' in program.program.reward
          && program.program.reward.amount.currency !== cartCurrency)
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
          snapshot => verifyDecisionIntegrity(snapshot, signingSecret),
        );
        if (count >= program.program.perCustomerCap) throw new ExhaustedError();
      }

      const result = RedemptionResponseSchema.parse({
        redemptionId: crypto.randomUUID(),
        evaluationId: request.evaluationId,
        programRef: request.programRef,
        ...(request.externalOrderRef === undefined
          ? {}
          : { externalOrderRef: request.externalOrderRef }),
        ...(request.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: request.idempotencyKey }),
        status: 'committed',
        effects: decision.effects,
      });
      const commit = {
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
      };

      try {
        if (await repositories.redemptions.commitAtomically(commit)) return result;
      } catch (error) {
        const raced = await findExisting(repositories, merchantId, request);
        if (raced !== null) return raced.result;
        throw error;
      }
      const raced = await findExisting(repositories, merchantId, request);
      if (raced !== null) return raced.result;
      throw new ExhaustedError();
    },
  };
}
