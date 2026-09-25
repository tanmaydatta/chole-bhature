import assert from 'node:assert/strict';

import { E2eRunInspectionSchema, EvaluationResponseSchema, OperatorProgramViewSchema,
  PromoProgramSchema, RedemptionResponseSchema,
  type PromoProgram } from '@incentives/contracts';

import { runScoped, type RunId } from './config.js';
import { executeRecipe, type RecipeContext } from './execution.js';
import { recordResource } from './manifest.js';
import { ApiFailure, PublicApiClient } from './operator-client.js';

export function gapCart(runId: RunId) {
  return { currency: 'GBP', subtotal: 10_001, items: [
    { lineRef: runScoped(runId, 'duplicate_line_1'),
      productRef: runScoped(runId, 'duplicate_product'), quantity: 1, unitPrice: 4_001 },
    { lineRef: runScoped(runId, 'duplicate_line_2'),
      productRef: runScoped(runId, 'duplicate_product'), quantity: 2, unitPrice: 1_500 },
    { lineRef: runScoped(runId, 'other_line'),
      productRef: runScoped(runId, 'other_product'), quantity: 1, unitPrice: 3_000 },
  ] };
}

export function expectedGapBreakdown(runId: RunId, cappedRef: string, lineRef: string) {
  return { currency: 'GBP', originalMerchandiseSubtotal: 10_001,
    discountAllocations: [
      { programRef: cappedRef, programRevision: 1,
        rewardRuleRef: 'capped-quarter', discountMinorUnits: 1_500 },
      { programRef: lineRef, programRevision: 1,
        rewardRuleRef: 'five-per-unit', discountMinorUnits: 1_500,
        lineAllocations: [
          { lineRef: runScoped(runId, 'duplicate_line_1'), discountMinorUnits: 500 },
          { lineRef: runScoped(runId, 'duplicate_line_2'), discountMinorUnits: 1_000 },
        ] },
    ], totalDiscount: 3_000, discountedMerchandiseSubtotal: 7_001 };
}

function condition(id: string) {
  return { match: 'ALL' as const, conditions: [{ id,
    variable: 'cart.subtotal', operator: 'gte' as const, value: 0 }] };
}

export function cappedPromo(): PromoProgram {
  return PromoProgramSchema.parse({
    id: 'placeholder', type: 'promo', name: 'Capped percentage', status: 'draft',
    autoApply: false, code: 'PLACEHOLDER', stackable: true, priority: 20,
    eligibility: condition('eligible-cart'),
    rewardRules: [{ id: 'capped-quarter', name: 'Capped quarter off',
      conditions: condition('positive-cart'), reward: {
        type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
        maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
      } }], budget: { currency: 'GBP', minorUnits: 5_000 },
  });
}

function linePromo(runId: RunId): PromoProgram {
  return PromoProgramSchema.parse({
    id: 'placeholder', type: 'promo', name: 'Duplicate line fixed', status: 'draft',
    autoApply: false, code: 'PLACEHOLDER', stackable: true, priority: 10,
    eligibility: condition('eligible-cart'),
    rewardRules: [{ id: 'five-per-unit', name: 'Five pounds per matching unit',
      conditions: condition('positive-cart'), reward: {
        type: 'line_item_discount', productRef: runScoped(runId, 'duplicate_product'),
        calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 500 },
      } }], budget: { currency: 'GBP', minorUnits: 5_000 },
  });
}

export async function runGapScenario(ctx: RecipeContext) {
  const runId = ctx.manifest.runId;
  const provisioned = await executeRecipe(ctx, 'add-merchant', { name: 'GAP pricing shop' });
  const merchantId = (provisioned as { merchantId: string }).merchantId;
  await executeRecipe(ctx, 'add-schema', { slug: 'price_marker', definition: {
    key: 'context.placeholder', label: 'Price marker', source: 'context',
    type: 'string', required: false,
  } });
  const customerRef = runScoped(runId, 'buyer');
  await executeRecipe(ctx, 'add-customer', { slug: 'buyer', attributes: {} });
  const publishable = await executeRecipe(ctx, 'create-api-credential', {
    slug: 'evaluate', kind: 'publishable', scopes: ['evaluations:write'],
    allowedOrigins: [ctx.target.operatorOrigin],
  }) as { token: string };
  const secret = await executeRecipe(ctx, 'create-api-credential', {
    slug: 'redeem', kind: 'secret', scopes: ['redemptions:write'],
  }) as { token: string };
  await executeRecipe(ctx, 'add-promo', { slug: 'capped', program: cappedPromo() });
  await executeRecipe(ctx, 'add-promo', { slug: 'line', program: linePromo(runId) });
  await executeRecipe(ctx, 'publish-promo', { slug: 'capped' });
  await executeRecipe(ctx, 'publish-promo', { slug: 'line' });
  const cappedRef = runScoped(runId, 'capped');
  const lineRef = runScoped(runId, 'line');
  const authored = await Promise.all([cappedRef, lineRef].map(async id =>
    OperatorProgramViewSchema.parse(await ctx.operator.request('GET',
      `/operator/v1/programs/${encodeURIComponent(id)}`))));
  assert.deepEqual(authored.map(view => [view.configuration.id, view.lifecycle.status]), [
    [cappedRef, 'active'], [lineRef, 'active'],
  ]);
  assert.deepEqual(authored[0]?.activeConfiguration?.rewardRules[0]?.reward, {
    type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
    maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
  });
  assert.deepEqual(authored[1]?.activeConfiguration?.rewardRules[0]?.reward, {
    type: 'line_item_discount', productRef: runScoped(runId, 'duplicate_product'),
    calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 500 },
  });
  const expected = expectedGapBreakdown(runId, cappedRef, lineRef);
  const evaluationClient = await PublicApiClient.withToken(ctx.target, publishable.token);
  const redemptionClient = await PublicApiClient.withToken(ctx.target, secret.token);
  try {
    const evaluation = EvaluationResponseSchema.parse(await evaluationClient.post('/v1/evaluate', {
      customerRef, codes: [cappedRef.toUpperCase(), lineRef.toUpperCase()],
      cart: gapCart(runId), context: {},
    }));
    assert.deepEqual(evaluation.decisions.map(decision => decision.programRef), [cappedRef, lineRef]);
    assert.deepEqual(evaluation.priceBreakdown, expected);
    recordResource(ctx.manifest, { kind: 'evaluation', id: evaluation.evaluationId,
      ownerRunId: runId, merchantId, label: runScoped(runId, 'evaluation') });
    await ctx.save();
    const idempotencyKey = runScoped(runId, 'attempt');
    const request = { evaluationId: evaluation.evaluationId,
      externalOrderRef: runScoped(runId, 'order'), idempotencyKey };
    const redemption = RedemptionResponseSchema.parse(await redemptionClient.post(
      '/v1/redemptions', request,
    ));
    assert.equal(redemption.evaluationId, evaluation.evaluationId);
    assert.deepEqual(redemption.priceBreakdown, expected);
    assert.deepEqual(redemption.entries.map(entry => [entry.programRef, entry.rewardRuleRef]), [
      [cappedRef, 'capped-quarter'], [lineRef, 'five-per-unit'],
    ]);
    recordResource(ctx.manifest, { kind: 'redemption', id: redemption.redemptionId,
      ownerRunId: runId, merchantId, label: runScoped(runId, 'redemption') });
    await ctx.save();
    const retry = RedemptionResponseSchema.parse(await redemptionClient.post(
      '/v1/redemptions', request,
    ));
    assert.deepEqual(retry, redemption);
    await assert.rejects(redemptionClient.post('/v1/redemptions', {
      ...request, externalOrderRef: runScoped(runId, 'changed_order'),
    }), error => error instanceof ApiFailure && error.status === 409
      && error.code === 'VERSION_CONFLICT');
    if (ctx.target.kind === 'staging' || process.env.E2E_MANAGED_LOCAL_STACK === '1') {
      if (!ctx.getOrCreateProof) throw new Error('Staging run proof is unavailable');
      const inspection = E2eRunInspectionSchema.parse(await ctx.operator.request(
        'POST', `/operator/v1/platform/e2e-runs/${runId}/inspect`,
        { proof: await ctx.getOrCreateProof(), evaluationId: evaluation.evaluationId,
          idempotencyKey, programRefs: [cappedRef, lineRef] },
      ));
      assert.equal(inspection.merchantId, merchantId);
      assert.deepEqual(inspection.evaluation.priceBreakdown, expected);
      assert.equal(inspection.evaluation.integrityVerified, true);
      assert.deepEqual(inspection.redemption.result, redemption);
      assert.equal(inspection.redemption.receiptIntegrityVerified, true);
      assert.deepEqual(inspection.redemption.entries, [
        { position: 0, programRef: cappedRef, discountMinorUnits: 1_500 },
        { position: 1, programRef: lineRef, discountMinorUnits: 1_500 },
      ]);
      assert.deepEqual(inspection.counters, [
        { programRef: cappedRef, usageCount: 1, budgetRemaining: 3_500,
          committedSpend: 1_500 },
        { programRef: lineRef, usageCount: 1, budgetRemaining: 3_500,
          committedSpend: 1_500 },
      ]);
    }
    return { runId, merchantId, evaluationId: evaluation.evaluationId,
      redemptionId: redemption.redemptionId, expected };
  } finally {
    await evaluationClient.close();
    await redemptionClient.close();
  }
}
