import { E2eRunInspectionSchema } from '@incentives/contracts';
import { z } from 'zod';

import type { Env } from '../env.js';
import { createRepositories } from '../repositories/d1-repositories.js';
import { verifyDecisionIntegrity } from './evaluation-service.js';
import { createProductE2eLifecycle, type ProductE2eIdentity } from './e2e-lifecycle.js';
import { verifyRedemptionReceipt } from './redemption-receipt.js';

const QuerySchema = z.object({
  evaluationId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  programRefs: z.array(z.string().min(1).max(200)).min(1).max(4),
}).strict();
export type E2eInspectionQuery = z.infer<typeof QuerySchema>;

export async function inspectProductE2eRun(
  env: Env,
  identity: ProductE2eIdentity,
  rawQuery: E2eInspectionQuery,
) {
  const claim = await createProductE2eLifecycle(env).preview(identity);
  if (claim.status !== 'active') throw new Error('Disposed E2E tenant cannot be inspected');
  const query = QuerySchema.parse(rawQuery);
  if (!query.idempotencyKey.startsWith(`${identity.runId}_`)
    || new Set(query.programRefs).size !== query.programRefs.length
    || query.programRefs.some(ref => !ref.startsWith(`${identity.runId}_`))) {
    throw new Error('Inspection identifiers must use the E2E run namespace');
  }
  const repositories = createRepositories(env);
  const decision = await repositories.decisions.get(identity.merchantId, query.evaluationId);
  if (!decision || !decision.priceBreakdown
    || (decision.customerRef && !decision.customerRef.startsWith(`${identity.runId}_`))) {
    throw new Error('E2E evaluation is absent or outside the run namespace');
  }
  const secret = z.string().min(16).parse(env.DECISION_SIGNING_SECRET);
  if (!(await verifyDecisionIntegrity(decision, secret))) {
    throw new Error('E2E evaluation integrity verification failed');
  }
  const redemption = await repositories.redemptions.getByIdempotencyKey(
    identity.merchantId, query.idempotencyKey,
    receipt => verifyRedemptionReceipt(receipt, secret),
  );
  if (!redemption || redemption.evaluationId !== query.evaluationId
    || redemption.externalOrderRef !== redemption.result.externalOrderRef
    || !redemption.externalOrderRef.startsWith(`${identity.runId}_`)
    || redemption.result.redemptionId !== redemption.redemptionId) {
    throw new Error('E2E redemption is absent or outside the run namespace');
  }
  const actualRefs = redemption.entries.map(entry => entry.programRef);
  if (actualRefs.length !== query.programRefs.length
    || actualRefs.some((ref, index) => ref !== query.programRefs[index])) {
    throw new Error('E2E redemption entries do not match requested programs');
  }
  const counters = await Promise.all(query.programRefs.map(async programRef => {
    const value = await repositories.programs.getCounters(identity.merchantId, programRef);
    if (!value) throw new Error('E2E program counter is absent');
    return { programRef, usageCount: value.usageCount,
      budgetRemaining: value.budgetRemaining ?? null,
      committedSpend: value.committedSpend };
  }));
  return E2eRunInspectionSchema.parse({
    runId: identity.runId,
    merchantId: identity.merchantId,
    evaluation: { evaluationId: decision.evaluationId,
      priceBreakdown: decision.priceBreakdown, integrityVerified: true },
    redemption: { redemptionId: redemption.redemptionId,
      result: redemption.result, receiptIntegrityVerified: true,
      entries: redemption.entries.map(entry => ({
        position: entry.position, programRef: entry.programRef,
        discountMinorUnits: entry.discountMinorUnits,
      })) },
    counters,
  });
}
