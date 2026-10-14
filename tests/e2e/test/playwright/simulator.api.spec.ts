import { CustomerRecordSchema, OperatorProgramViewSchema, PromoProgramSchema } from '@incentives/contracts';
import { runScenario } from '@incentives/integration-simulator';
import { expect, test } from '@playwright/test';

import { loadTarget, runScoped, type RunId } from '../../src/config.js';
import { executeRecipe } from '../../src/execution.js';
import { recordResource } from '../../src/manifest.js';
import { assertRunDisposed, withScenarioRun } from '../../src/scenario-run.js';

test('public CLI simulator: actual local-D1 accepted/retry/cap exhaustion and repricing with zero owned rows', async () => {
  // Refuse remote setup before authentication, manifest creation or disposal inventory.
  test.skip(loadTarget(process.env).kind !== 'local', 'Simulator real-D1 fixture is local-only');
  let runId: RunId | undefined;
  const failures: unknown[] = [];
  try {
    await withScenarioRun(async ctx => {
      runId = ctx.manifest.runId;
      const merchant = await executeRecipe(ctx, 'add-merchant', { name: 'CLI simulator local shop' }) as { merchantId: string };
      const schema = await executeRecipe(ctx, 'add-schema', { slug: 'tier', definition: {
        key: 'customer.placeholder', label: 'Stored tier', source: 'customer', type: 'enum', enumValues: ['gold', 'silver'], required: false,
      } }) as { definition: { definition: { key: string } } };
      await executeRecipe(ctx, 'add-customer', { slug: 'buyer', attributes: {} });
      const key = await executeRecipe(ctx, 'create-api-credential', { slug: 'simulator', kind: 'secret',
        scopes: ['schema:read', 'customers:write', 'evaluations:write', 'redemptions:write'] }) as { token: string };
      const product = runScoped(runId, 'same_product');
      const condition = { match: 'ALL' as const, conditions: [{ id: 'positive-cart', variable: 'cart.subtotal', operator: 'gte' as const, value: 0 }] };
      const base = { id: 'placeholder', type: 'promo', status: 'draft', autoApply: false, code: 'PLACEHOLDER', stackable: true,
        eligibility: condition, budget: { currency: 'GBP', minorUnits: 5_000 }, usageCap: 1 };
      await executeRecipe(ctx, 'add-promo', { slug: 'quarter', program: PromoProgramSchema.parse({ ...base, name: 'Capped quarter', priority: 20,
        rewardRules: [{ id: 'capped', name: 'Capped quarter', conditions: condition, reward: { type: 'order_discount', calculation: 'percent',
          basisPoints: 2_500, maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 } } }] }) });
      await executeRecipe(ctx, 'add-promo', { slug: 'line', program: PromoProgramSchema.parse({ ...base, name: 'Per unit', priority: 10,
        rewardRules: [{ id: 'per-unit', name: 'Per matching unit', conditions: condition,
          reward: { type: 'line_item_discount', productRef: product, calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 500 } } }] }) });
      for (const slug of ['quarter', 'line']) await executeRecipe(ctx, 'publish-promo', { slug });
      const quarter = runScoped(runId, 'quarter'); const line = runScoped(runId, 'line');
      for (const ref of [quarter, line]) {
        const published = OperatorProgramViewSchema.parse(await ctx.operator.request('GET', `/operator/v1/programs/${encodeURIComponent(ref)}`));
        expect(published.lifecycle.status).toBe('active'); expect(published.activeConfiguration?.usageCap).toBe(1);
      }
      const customerRef = runScoped(runId, 'buyer'); const tierKey = schema.definition.definition.key.slice('customer.'.length);
      const result = await runScenario({ origin: ctx.target.apiOrigin, environment: 'local', secretKey: key.token,
        schemaVersion: 1, fixture: [{ programRef: quarter, programRevision: 1, rewardRuleRef: 'capped' },
          { programRef: line, programRevision: 1, rewardRuleRef: 'per-unit' }],
        customer: { shopper_id: customerRef, profile: { [tierKey]: 'gold' } }, updatedProfile: { [tierKey]: 'silver' },
        cart: { currency: 'GBP', total_pence: 10_001, items: [
          { line_id: runScoped(runId, 'a'), sku: product, count: 1, unit_pence: 4_001 },
          { line_id: runScoped(runId, 'b'), sku: product, count: 2, unit_pence: 1_500 },
          { line_id: runScoped(runId, 'c'), sku: runScoped(runId, 'other_product'), count: 1, unit_pence: 3_000 },
        ] }, context: {}, codes: [quarter.toUpperCase(), line.toUpperCase()],
        order: { order_id: runScoped(runId, 'order'), retry_key: runScoped(runId, 'attempt') },
      });
      for (const [slug, evaluation] of [['preflight', result.preflightEvaluation], ['first', result.evaluation], ['stale', result.staleEvaluation], ['repriced', result.repricedEvaluation]] as const) {
        recordResource(ctx.manifest, { kind: 'evaluation', id: evaluation.evaluationId, ownerRunId: runId,
          merchantId: merchant.merchantId, label: runScoped(runId, slug) });
      }
      recordResource(ctx.manifest, { kind: 'redemption', id: result.redemption.redemptionId, ownerRunId: runId,
        merchantId: merchant.merchantId, label: runScoped(runId, 'redemption') }); await ctx.save();
      expect(result.customerVersions).toEqual([2, 3]);
      expect(result.evaluation.priceBreakdown).toEqual({ currency: 'GBP', originalMerchandiseSubtotal: 10_001,
        discountAllocations: [{ programRef: quarter, programRevision: 1, rewardRuleRef: 'capped', discountMinorUnits: 1_500 },
          { programRef: line, programRevision: 1, rewardRuleRef: 'per-unit', discountMinorUnits: 1_500,
            lineAllocations: [{ lineRef: runScoped(runId, 'a'), discountMinorUnits: 500 }, { lineRef: runScoped(runId, 'b'), discountMinorUnits: 1_000 }] }],
        totalDiscount: 3_000, discountedMerchandiseSubtotal: 7_001 });
      expect(result.retry).toEqual(result.redemption);
      expect(result.applied.total_pence).toBe(7_001); expect(result.repriced.total_pence).toBe(10_001);
      expect(result.captures).toEqual([{ order_id: runScoped(runId, 'order'), currency: 'GBP', merchandise_total_pence: 7_001 }]);
      expect(result.trace.find(entry => entry.phase === 'exhausted')).toEqual({ phase: 'exhausted', status: 409, code: 'USAGE_CAP_EXHAUSTED' });
      expect(result.repricedEvaluation.decisions).toEqual([]);
      expect(CustomerRecordSchema.parse(await ctx.operator.request('GET', `/operator/v1/customers/${encodeURIComponent(customerRef)}`))).toMatchObject({
        externalRef: customerRef, version: 3, attributes: { [tierKey]: 'silver' },
      });
    });
  } catch (error) { failures.push(error); }
  if (runId) try { await assertRunDisposed(runId); } catch (error) { failures.push(error); }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Simulator scenario and disposal failed');
});
