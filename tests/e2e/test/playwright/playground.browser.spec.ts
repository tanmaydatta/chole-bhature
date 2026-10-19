import { EvaluationResponseSchema, OperatorProgramViewSchema, PromoProgramSchema, type PromoProgram } from '@incentives/contracts';
import { test, expect, type Browser, type Page } from '@playwright/test';

import { runScoped, type RunId } from '../../src/config.js';
import { executeRecipe, type RecipeContext } from '../../src/execution.js';
import { recordResource } from '../../src/manifest.js';
import { requireOperatorStorageState } from '../../src/operator-client.js';
import { assertRunDisposed, withScenarioRun } from '../../src/scenario-run.js';

const condition = { match: 'ALL' as const, conditions: [{ id: 'basket-positive',
  variable: 'cart.subtotal', operator: 'gte' as const, value: 0 }] };
function promo(reward: PromoProgram['rewardRules'][number]['reward'], automatic = false, priority = 10): PromoProgram {
  return PromoProgramSchema.parse({ id: 'placeholder', name: 'Playground offer', type: 'promo', status: 'draft',
    autoApply: automatic, ...(automatic ? {} : { code: 'PLACEHOLDER' }), stackable: !automatic, priority,
    eligibility: condition, rewardRules: [{ id: 'basket-reward', name: 'Basket reward', conditions: condition, reward }],
    ...(reward.type === 'free_shipping' ? {} : { budget: { currency: 'GBP', minorUnits: 5_000 }, usageCap: 2 }),
  });
}
const cappedReward = { type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
  maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 } } as const;

// Each scenario owns a fresh browser context and run; disposal inventory is asserted after failures too.
async function scenario(browser: Browser, name: string, body: (page: Page, ctx: RecipeContext, merchantId: string) => Promise<void>) {
  let runId: RunId | undefined;
  const failures: unknown[] = [];
  try {
    await withScenarioRun(async ctx => {
      runId = ctx.manifest.runId;
      const merchant = await executeRecipe(ctx, 'add-merchant', { name }) as { merchantId: string };
      const context = await browser.newContext({ storageState: requireOperatorStorageState(process.env) });
      try {
        const selected = await context.request.post(`${ctx.target.operatorOrigin}/operator/v1/platform/merchant-selection`, {
          data: { merchantId: merchant.merchantId }, headers: { origin: ctx.target.operatorOrigin },
        });
        expect(selected.status()).toBe(204);
        await body(await context.newPage(), ctx, merchant.merchantId);
      } finally { await context.close(); }
    });
  } catch (error) { failures.push(error); }
  if (runId) {
    try { await assertRunDisposed(runId); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Playground scenario and disposal verification failed');
}
async function evaluate(page: Page, ctx: RecipeContext, merchantId: string, slug: string) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/operator/v1/playground/evaluate'
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
  const completed = await response;
  expect(completed.status()).toBe(200);
  const result = EvaluationResponseSchema.parse(await completed.json());
  recordResource(ctx.manifest, { kind: 'evaluation', id: result.evaluationId, ownerRunId: ctx.manifest.runId,
    merchantId, label: runScoped(ctx.manifest.runId, slug) });
  await ctx.save();
  await expect(page.getByRole('heading', { name: 'Evaluation results' })).toBeVisible();
  return result;
}
async function fillLine(page: Page, index: number, lineRef: string, productRef: string, quantity: string, unitPrice: string) {
  await page.getByLabel(`Line reference ${index}`).fill(lineRef);
  await page.getByLabel(`Product reference ${index}`).fill(productRef);
  await page.getByLabel(`Quantity ${index}`).fill(quantity);
  await page.getByLabel(`Unit price minor units ${index}`).fill(unitPrice);
}

test('Playground evaluates anonymous/stored baskets using published revisions and clears edited results', async ({ browser }) => {
  await scenario(browser, 'Playground automatic shop', async (page, ctx, merchantId) => {
    await page.goto(`${ctx.target.operatorOrigin}/playground`);
    await expect(page.getByText(/Publish a schema/u)).toBeVisible();
    expect(await page.getByRole('button', { name: 'Evaluate', exact: true }).count()).toBe(0);
    const schema = await executeRecipe(ctx, 'add-schema', { slug: 'channel', definition: {
      key: 'context.placeholder', label: 'Channel', source: 'context', type: 'enum', enumValues: ['web', 'store'], required: true,
    } }) as { definition: { definition: { key: string } } };
    await executeRecipe(ctx, 'add-customer', { slug: 'buyer', attributes: {} });
    await executeRecipe(ctx, 'add-promo', { slug: 'automatic', program: promo(cappedReward, true) });
    await executeRecipe(ctx, 'publish-promo', { slug: 'automatic' });
    const ref = runScoped(ctx.manifest.runId, 'automatic');
    const productRef = runScoped(ctx.manifest.runId, 'product');
    await page.getByRole('button', { name: 'Reload published schema' }).click();
    await fillLine(page, 1, runScoped(ctx.manifest.runId, 'line'), productRef, '2', '5000');
    await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(/Channel is required/u);
    await page.getByLabel(`Channel (${schema.definition.definition.key})`).selectOption('web');
    const first = await evaluate(page, ctx, merchantId, 'anonymous_eval');
    expect(first.customerRef).toBeUndefined();
    expect(first.decisions.map(decision => [decision.programRef, decision.programRevision, decision.rewardRuleRef])).toEqual([[ref, 1, 'basket-reward']]);
    expect(first.priceBreakdown).toEqual({ currency: 'GBP', originalMerchandiseSubtotal: 10_000,
      discountAllocations: [{ programRef: ref, programRevision: 1, rewardRuleRef: 'basket-reward', discountMinorUnits: 1_500 }],
      totalDiscount: 1_500, discountedMerchandiseSubtotal: 8_500 });
    await expect(page.getByText('8500 GBP minor units', { exact: true })).toBeVisible();
    await expect(page.getByText('Anonymous customer', { exact: true })).toBeVisible();
    await page.getByLabel('Customer reference (optional)').fill(runScoped(ctx.manifest.runId, 'buyer'));
    await expect(page.getByRole('heading', { name: 'Evaluation results' })).toHaveCount(0);
    const stored = await evaluate(page, ctx, merchantId, 'stored_eval');
    expect(stored.customerVersion).toBe(1);
    expect(stored.priceBreakdown.totalDiscount).toBe(1_500);
    await expect(page.getByText('Customer version 1', { exact: true })).toBeVisible();
    const published = OperatorProgramViewSchema.parse(await ctx.operator.request('GET', `/operator/v1/programs/${encodeURIComponent(ref)}`));
    expect(published.activeConfiguration?.rewardRules[0]?.reward).toEqual(cappedReward);
    const draft = { ...published.configuration, status: 'draft', rewardRules: [{ ...published.configuration.rewardRules[0], reward: {
      ...cappedReward, maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_000 },
    } }] };
    await ctx.operator.request('PUT', `/operator/v1/programs/${encodeURIComponent(ref)}`, draft);
    expect((await evaluate(page, ctx, merchantId, 'draft_ignored_eval')).priceBreakdown.totalDiscount).toBe(1_500);
    await ctx.operator.request('POST', `/operator/v1/programs/${encodeURIComponent(ref)}/publish`, {});
    const revisionTwo = await evaluate(page, ctx, merchantId, 'revision_two_eval');
    expect(revisionTwo.decisions[0]?.programRevision).toBe(2);
    expect(revisionTwo.priceBreakdown.totalDiscount).toBe(1_000);
    await expect(page.getByRole('article', { name: `Promo ${ref}` })).toHaveText(/Revision 2/u);
    await expect(page.getByText('9000 GBP minor units', { exact: true })).toBeVisible();
    // No budget/usage is spent by four evaluations; Core runtime tests prove exact persisted counters and HMAC.
    await page.getByLabel('Unit price minor units 1').fill('2000');
    await expect(page.getByRole('heading', { name: 'Evaluation results' })).toHaveCount(0);
    const smaller = await evaluate(page, ctx, merchantId, 'smaller_eval');
    expect(smaller.priceBreakdown).toMatchObject({ originalMerchandiseSubtotal: 4_000, totalDiscount: 1_000, discountedMerchandiseSubtotal: 3_000 });
    expect(await page.getByRole('button', { name: /redeem|commit/iu }).count()).toBe(0);
    const noCommit = await page.request.post(`${ctx.target.operatorOrigin}/operator/v1/playground/commit`, {
      data: {}, headers: { origin: ctx.target.operatorOrigin },
    });
    expect(noCommit.status()).toBe(404);
  });
});

test('Playground renders exact stacked coded allocations, typed live extensions and code-specific failures', async ({ browser }) => {
  await scenario(browser, 'Playground coded shop', async (page, ctx, merchantId) => {
    const cartField = await executeRecipe(ctx, 'add-schema', { slug: 'gift', definition: {
      key: 'cart.placeholder', label: 'Gift', source: 'cart', type: 'boolean', required: false,
    } }) as { definition: { definition: { key: string } } };
    const lineField = await executeRecipe(ctx, 'add-schema', { slug: 'weight', definition: {
      key: 'line_item.placeholder', label: 'Weight', source: 'line_item', type: 'number', required: false,
    } }) as { definition: { definition: { key: string } } };
    const tier = await executeRecipe(ctx, 'add-schema', { slug: 'tier', definition: {
      key: 'customer.placeholder', label: 'Stored tier', source: 'customer', type: 'enum', enumValues: ['gold', 'silver'], required: false,
    } }) as { definition: { definition: { key: string } } };
    const productRef = runScoped(ctx.manifest.runId, 'product');
    const capRef = runScoped(ctx.manifest.runId, 'capped');
    const lineRef = runScoped(ctx.manifest.runId, 'line_discount');
    const buyer = runScoped(ctx.manifest.runId, 'buyer');
    await executeRecipe(ctx, 'add-customer', { slug: 'buyer', attributes: { [tier.definition.definition.key.slice('customer.'.length)]: 'gold' } });
    await executeRecipe(ctx, 'add-promo', { slug: 'capped', program: promo(cappedReward, false, 20) });
    await executeRecipe(ctx, 'add-promo', { slug: 'line_discount', program: promo({ type: 'line_item_discount', productRef,
      calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 500 } }, false, 10) });
    await executeRecipe(ctx, 'publish-promo', { slug: 'capped' });
    await executeRecipe(ctx, 'publish-promo', { slug: 'line_discount' });
    const cap = OperatorProgramViewSchema.parse(await ctx.operator.request('GET', `/operator/v1/programs/${encodeURIComponent(capRef)}`));
    expect(cap.activeConfiguration?.rewardRules[0]?.reward).toEqual(cappedReward);
    const missing = runScoped(ctx.manifest.runId, 'missing').toUpperCase();
    await page.goto(`${ctx.target.operatorOrigin}/playground`);
    await fillLine(page, 1, runScoped(ctx.manifest.runId, 'basket_a'), productRef, '1', '4001');
    await page.getByRole('button', { name: 'Add line' }).click();
    await fillLine(page, 2, runScoped(ctx.manifest.runId, 'basket_b'), productRef, '2', '1500');
    await page.getByRole('button', { name: 'Add line' }).click();
    await fillLine(page, 3, runScoped(ctx.manifest.runId, 'basket_c'), runScoped(ctx.manifest.runId, 'other_product'), '1', '3000');
    await page.getByLabel(`Gift (${cartField.definition.definition.key})`).selectOption('false');
    await page.getByLabel(`Weight (${lineField.definition.definition.key}) — line 1`).fill('0');
    expect(await page.getByLabel(/Stored tier/u).count()).toBe(0);
    await page.getByLabel('Customer reference (optional)').fill(buyer);
    await page.getByLabel('Promo codes (optional)').fill(`${lineRef.toUpperCase()}, ${missing}, ${capRef.toUpperCase()}`);
    const result = await evaluate(page, ctx, merchantId, 'coded_eval');
    expect(result.schemaVersion).toBe(3);
    expect(result.customerVersion).toBe(1);
    expect(result.decisions.map(decision => decision.programRef)).toEqual([capRef, lineRef]);
    expect(result.priceBreakdown).toEqual({ currency: 'GBP', originalMerchandiseSubtotal: 10_001,
      discountAllocations: [
        { programRef: capRef, programRevision: 1, rewardRuleRef: 'basket-reward', discountMinorUnits: 1_500 },
        { programRef: lineRef, programRevision: 1, rewardRuleRef: 'basket-reward', discountMinorUnits: 1_500,
          lineAllocations: [{ lineRef: runScoped(ctx.manifest.runId, 'basket_a'), discountMinorUnits: 500 },
            { lineRef: runScoped(ctx.manifest.runId, 'basket_b'), discountMinorUnits: 1_000 }] },
      ], totalDiscount: 3_000, discountedMerchandiseSubtotal: 7_001 });
    expect(result.codeResults).toEqual([
      { code: lineRef.toUpperCase(), normalizedCode: lineRef.toUpperCase(), outcome: 'selected', programRef: lineRef, reasonCodes: [] },
      { code: missing, normalizedCode: missing, outcome: 'invalid_code', reasonCodes: ['INVALID_PROMO_CODE'] },
      { code: capRef.toUpperCase(), normalizedCode: capRef.toUpperCase(), outcome: 'selected', programRef: capRef, reasonCodes: [] },
    ]);
    await expect(page.getByText('7001 GBP minor units', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Promo discount allocations' })).toHaveText(new RegExp(`${runScoped(ctx.manifest.runId, 'basket_a')}: 500 minor units`, 'u'));
    await expect(page.getByRole('table', { name: 'Code diagnostics' })).toHaveText(/INVALID_PROMO_CODE/u);
    await page.getByLabel('Promo codes (optional)').fill(missing);
    await expect(page.getByRole('heading', { name: 'Evaluation results' })).toHaveCount(0);
    const empty = await evaluate(page, ctx, merchantId, 'invalid_only_eval');
    expect(empty.decisions).toEqual([]);
    expect(empty.priceBreakdown).toMatchObject({ totalDiscount: 0, discountedMerchandiseSubtotal: 10_001 });
    await expect(page.getByText('No Promo was selected.', { exact: true })).toBeVisible();
  });
});

test('Playground reports free shipping as zero merchandise saving', async ({ browser }) => {
  await scenario(browser, 'Playground shipping shop', async (page, ctx, merchantId) => {
    await executeRecipe(ctx, 'add-schema', { slug: 'marker', definition: {
      key: 'context.placeholder', label: 'Marker', source: 'context', type: 'string', required: false,
    } });
    await executeRecipe(ctx, 'add-promo', { slug: 'shipping', program: promo({ type: 'free_shipping' }, true) });
    await executeRecipe(ctx, 'publish-promo', { slug: 'shipping' });
    await page.goto(`${ctx.target.operatorOrigin}/playground`);
    await fillLine(page, 1, runScoped(ctx.manifest.runId, 'basket'), runScoped(ctx.manifest.runId, 'product'), '1', '1234');
    const result = await evaluate(page, ctx, merchantId, 'shipping_eval');
    expect(result.decisions[0]).toMatchObject({ programRef: runScoped(ctx.manifest.runId, 'shipping'), programRevision: 1,
      outcome: 'qualified', effects: [{ type: 'free_shipping' }] });
    expect(result.priceBreakdown).toEqual({ currency: 'GBP', originalMerchandiseSubtotal: 1_234,
      discountAllocations: [], totalDiscount: 0, discountedMerchandiseSubtotal: 1_234 });
    await expect(page.getByText('0 GBP minor units', { exact: true })).toBeVisible();
    await expect(page.getByText('Free shipping · zero merchandise saving', { exact: true })).toBeVisible();
  });
});
