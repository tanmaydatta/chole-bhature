import {
  RedemptionRequestSchema,
  type RedemptionResponse,
} from '@incentives/contracts';
import { z } from 'zod';

import type { Env } from '../env.js';
import {
  DecisionExpiredError,
  ExhaustedError,
  NotFoundError,
  NothingToCommitError,
  RedemptionUnavailableError,
  VersionConflictError,
} from '../errors.js';
import { canonicalJson } from '../json.js';
import type { AtomicRedemptionCoordinator } from '../redemption/atomic-redemption-coordinator.js';
import type { Repositories } from '../repositories/types.js';

const SigningSecretSchema = z.string().min(16).max(4_096);
const encoder = new TextEncoder();

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export function createRedemptionService(
  repositories: Repositories,
  coordinator: AtomicRedemptionCoordinator,
  env: Env,
) {
  return {
    async redeem(
      merchantId: string,
      input: unknown,
      correlationId: string,
    ): Promise<RedemptionResponse> {
      const request = RedemptionRequestSchema.parse(input);
      try {
        SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET);
        const evaluation = await repositories.decisions.get(
          merchantId,
          request.evaluationId,
        );
        if (evaluation === null) throw new NotFoundError('Evaluation decision not found');

        const requestDigest = await sha256(canonicalJson({
          kind: 'redemption_bundle_v1',
          merchantId,
          evaluationId: request.evaluationId,
          externalOrderRef: request.externalOrderRef,
          idempotencyKey: request.idempotencyKey,
          selected: evaluation.decisions.map(decision => ({
            programRef: decision.programRef,
            programRevision: decision.programRevision,
            rewardRuleRef: decision.rewardRuleRef,
            effects: decision.effects,
          })),
        }));
        const result = await coordinator.commitBundle({
          merchantId,
          evaluation,
          externalOrderRef: request.externalOrderRef,
          idempotencyKey: request.idempotencyKey,
          requestDigest,
          correlationId,
          committedAt: new Date().toISOString(),
        });

        switch (result.kind) {
          case 'committed':
          case 'exact_retry':
            return result.bundle.result;
          case 'conflict':
            throw new VersionConflictError();
          case 'exhausted':
            throw new ExhaustedError();
          case 'unavailable':
            throw new RedemptionUnavailableError();
          case 'terminal_retry':
            switch (result.code) {
              case 'NOTHING_TO_COMMIT':
                throw new NothingToCommitError();
              case 'DECISION_EXPIRED':
                throw new DecisionExpiredError();
              case 'INVALID_DECISION':
                throw new VersionConflictError('The evaluation decision is invalid');
              case 'PROGRAM_UNAVAILABLE':
              case 'PER_CUSTOMER_CAP_EXHAUSTED':
              case 'BUDGET_EXHAUSTED':
                throw new ExhaustedError();
            }
        }
      } catch (error) {
        if (
          error instanceof DecisionExpiredError
          || error instanceof ExhaustedError
          || error instanceof NotFoundError
          || error instanceof NothingToCommitError
          || error instanceof RedemptionUnavailableError
          || error instanceof VersionConflictError
        ) throw error;
        throw new RedemptionUnavailableError();
      }
    },
  };
}
