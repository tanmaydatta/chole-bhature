import { OperatorProgramViewSchema } from '@incentives/contracts';
import { test, expect } from '@playwright/test';

import { executeRecipe } from '../../src/execution.js';
import { cappedPromo } from '../../src/gap-scenario.js';
import { requireOperatorStorageState } from '../../src/operator-client.js';
import { assertRunDisposed, withScenarioRun } from '../../src/scenario-run.js';

test('browser authors and persists the exact capped Promo, then publishes it', async ({ browser }) => {
  const runId = await withScenarioRun(async ctx => {
    const merchant = await executeRecipe(ctx, 'add-merchant', {
      name: 'Browser authoring shop',
    }) as { merchantId: string };
    await executeRecipe(ctx, 'add-schema', { slug: 'browser_marker', definition: {
      key: 'context.placeholder', label: 'Browser marker', source: 'context',
      type: 'string', required: false,
    } });
    const draft = await executeRecipe(ctx, 'add-promo', {
      slug: 'browser_cap', program: cappedPromo(),
    }) as { configuration: { id: string } };
    const id = draft.configuration.id;
    const context = await browser.newContext({
      storageState: requireOperatorStorageState(process.env),
    });
    try {
      const selected = await context.request.post(
        `${ctx.target.operatorOrigin}/operator/v1/platform/merchant-selection`,
        { data: { merchantId: merchant.merchantId },
          headers: { origin: ctx.target.operatorOrigin } },
      );
      expect(selected.status()).toBe(204);
      const page = await context.newPage();
      await page.goto(`${ctx.target.operatorOrigin}/promo/${encodeURIComponent(id)}/edit`);
      await expect(page.getByRole('heading', { name: 'Edit Promo draft' })).toBeVisible();
      const maximum = page.getByLabel('Maximum discount minor units');
      await expect(maximum).toHaveValue('1500');
      await maximum.fill('1600');
      await maximum.fill('1500');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page).toHaveURL(new RegExp(`/promo/${encodeURIComponent(id)}$`, 'u'));
      await expect(page.getByText('25% off order (maximum GBP 15.00)')).toBeVisible();
      await page.reload();
      await expect(page.getByText('25% off order (maximum GBP 15.00)')).toBeVisible();
      const persisted = OperatorProgramViewSchema.parse(await ctx.operator.request(
        'GET', `/operator/v1/programs/${encodeURIComponent(id)}`,
      ));
      expect(persisted.configuration.rewardRules[0]?.reward).toMatchObject({
        calculation: 'percent', basisPoints: 2_500,
        maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
      });
      await page.getByRole('button', { name: 'Publish revision' }).click();
      await expect(page.getByRole('dialog').getByRole('heading',
        { name: 'Review publication' })).toBeVisible();
      await page.getByRole('button', { name: 'Confirm publish' }).click();
      await expect(page.getByText('Active revision 1')).toBeVisible();
      const published = OperatorProgramViewSchema.parse(await ctx.operator.request(
        'GET', `/operator/v1/programs/${encodeURIComponent(id)}`,
      ));
      expect(published.lifecycle.status).toBe('active');
      expect(published.activeConfiguration?.rewardRules[0]?.reward).toMatchObject({
        calculation: 'percent', basisPoints: 2_500,
        maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
      });
    } finally {
      await context.close();
    }
    return ctx.manifest.runId;
  });
  await assertRunDisposed(runId);
});
