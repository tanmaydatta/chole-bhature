import { test, expect } from '@playwright/test';

import { runGapScenario } from '../../src/gap-scenario.js';
import { assertRunDisposed, withScenarioRun } from '../../src/scenario-run.js';

test('GAP-030/031: exact authoring, evaluation, signed redemption and retry', async () => {
  const result = await withScenarioRun(runGapScenario);
  expect(result.expected.totalDiscount).toBe(3_000);
  expect(result.expected.discountedMerchandiseSubtotal).toBe(7_001);
  expect(result.evaluationId).toBeTruthy();
  expect(result.redemptionId).toBeTruthy();
  await assertRunDisposed(result.runId);
});

test('two independent run-scoped scenarios execute concurrently without tenant cross-talk', async () => {
  const [first, second] = await Promise.all([
    withScenarioRun(runGapScenario), withScenarioRun(runGapScenario),
  ]);
  expect(first.runId).not.toBe(second.runId);
  expect(first.merchantId).not.toBe(second.merchantId);
  expect(first.evaluationId).not.toBe(second.evaluationId);
  expect(first.redemptionId).not.toBe(second.redemptionId);
  expect(first.expected.totalDiscount).toBe(3_000);
  expect(second.expected.totalDiscount).toBe(3_000);
  expect(first.expected.discountAllocations[0]?.programRef).toContain(first.runId);
  expect(second.expected.discountAllocations[0]?.programRef).toContain(second.runId);
  await Promise.all([assertRunDisposed(first.runId), assertRunDisposed(second.runId)]);
});

test('a failed scenario still disposes only its recorded tenant', async () => {
  let runId: Awaited<ReturnType<typeof runGapScenario>>['runId'] | undefined;
  await expect(withScenarioRun(async ctx => {
    runId = ctx.manifest.runId;
    await ctx.operator.request('GET', '/operator/v1/session');
    const { executeRecipe } = await import('../../src/execution.js');
    await executeRecipe(ctx, 'add-merchant', { name: 'Expected failure cleanup shop' });
    throw new Error('intentional scenario failure');
  })).rejects.toThrow('intentional scenario failure');
  expect(runId).toBeDefined();
  await assertRunDisposed(runId!);
});
