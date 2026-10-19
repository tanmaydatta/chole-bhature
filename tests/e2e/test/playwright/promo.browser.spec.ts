import { OperatorProgramViewSchema } from '@incentives/contracts';
import type { Page } from '@playwright/test';
import { test, expect, type PromoAccountDisplay } from '../support/promo-fixtures.js';

import { executeRecipe } from '../../src/execution.js';
import { cappedPromo } from '../../src/gap-scenario.js';

async function expectAccount(page: Page, expected: PromoAccountDisplay) {
  const account = page.getByRole('region', { name: 'Account context', exact: true });
  await expect(account).toBeVisible();
  await expect(account.getByText(expected.clientName, { exact: true })).toBeVisible();
  await expect(account.getByText(expected.role === 'root' ? 'ROOT' : 'Admin', { exact: true })).toBeVisible();
  await expect(account.getByText(expected.role === 'root' ? 'Passkey' : 'Test fixture', { exact: true })).toBeVisible();
  if (expected.role === 'admin') {
    await expect(account.getByText(expected.name, { exact: true })).toBeVisible();
    await expect(account.getByText(expected.email, { exact: true })).toBeVisible();
  }
}

async function expectShellActionsAfterScroll(page: Page, surface: 'list' | 'detail') {
  await page.getByRole('main').hover();
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => page.evaluate(() => Math.max(window.scrollY,
    ...Array.from(document.querySelectorAll('*'), element => element.scrollTop)))).toBeGreaterThan(0);
  const action = page.getByRole('button', { name: 'Sign out', exact: true });
  const layout = await action.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const account = document.querySelector('[aria-label="Account context"]')!.getBoundingClientRect();
    return { scroll: Math.round(Math.max(window.scrollY,
      ...Array.from(document.querySelectorAll('*'), node => node.scrollTop))), accountBottom: Math.round(account.bottom),
      actionTop: Math.round(rect.top), usable: hit !== null && element.contains(hit) };
  });
  console.log(`account-layout surface=${surface}; scroll_px=${layout.scroll}; account_bottom_px=${layout.accountBottom}; action_top_px=${layout.actionTop}; usable=${layout.usable}`);
  expect(layout.usable).toBe(true);
  const title = page.getByRole('banner').getByRole('heading');
  await expect(title).toBeVisible();
  expect(await title.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit !== null && element.contains(hit);
  })).toBe(true);
  const sidebar = page.getByRole('complementary');
  const bottomLink = sidebar.getByRole('link').last();
  await bottomLink.scrollIntoViewIfNeeded();
  await bottomLink.click({ trial: true });
  await page.getByRole('main').evaluate(element => {
    for (let parent: Element | null = element; parent; parent = parent.parentElement) parent.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

test('browser authors and persists the exact capped Promo, then publishes it', async ({ browser, promoScenario }) => {
  const runId = await promoScenario.run(async ctx => {
    const merchant = await promoScenario.merchant(ctx);
    await executeRecipe(ctx, 'add-schema', { slug: 'browser_marker', definition: {
      key: 'context.placeholder', label: 'Browser marker', source: 'context',
      type: 'string', required: false,
    } });
    const draft = await executeRecipe(ctx, 'add-promo', {
      slug: 'browser_cap', program: cappedPromo(),
    }) as { configuration: { id: string } };
    const id = draft.configuration.id;
    const context = await browser.newContext({
      storageState: promoScenario.storageState(ctx),
    });
    try {
      if (promoScenario.selectMerchant) {
        const selected = await context.request.post(
        `${ctx.target.operatorOrigin}/operator/v1/platform/merchant-selection`,
        { data: { merchantId: merchant.merchantId },
          headers: { origin: ctx.target.operatorOrigin } },
      );
        expect(selected.status()).toBe(204);
      }
      const page = await context.newPage();
      const expected = promoScenario.accountDisplay(ctx);
      await page.goto(`${ctx.target.operatorOrigin}/affiliates/new`);
      await expectAccount(page, expected);
      const demo = page.getByText('Demo data', { exact: true });
      await expect(demo).toBeVisible();
      const demoUsable = () => demo.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit !== null && element.contains(hit);
      });
      expect(await demoUsable()).toBe(true);
      await page.getByLabel('Program name', { exact: true }).hover();
      await page.mouse.wheel(0, 1000);
      await expect.poll(() => page.evaluate(() => Math.max(window.scrollY,
        ...Array.from(document.querySelectorAll('*'), element => element.scrollTop)))).toBeGreaterThan(0);
      expect(await demoUsable()).toBe(true);
      await expectAccount(page, expected);
      await page.getByRole('button', { name: 'Continue →', exact: true }).click({ trial: true });
      await page.getByRole('button', { name: 'Cancel', exact: true }).click({ trial: true });
      console.log('account-layout surface=demo; badge_uncovered=true; editor_actions_usable=true');
      await page.goto(`${ctx.target.operatorOrigin}/promo`);
      await expectAccount(page, expected);
      await expect(page.getByRole('link', { name: 'New promo', exact: true })).toBeVisible();
      await expectShellActionsAfterScroll(page, 'list');
      await page.getByRole('link', { name: 'New promo', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Create Promo', exact: true })).toBeVisible();
      await expectAccount(page, expected);
      await page.goto(`${ctx.target.operatorOrigin}/promo/${encodeURIComponent(id)}/edit`);
      await expect(page.getByRole('heading', { name: 'Edit Promo draft' })).toBeVisible();
      await expectAccount(page, expected);
      const percentage = page.getByLabel('Discount percentage');
      await expect(percentage).toHaveValue('25');
      await percentage.fill('12.34');
      await expect(percentage).toHaveValue('12.34');
      await percentage.fill('25');
      const maximum = page.getByLabel('Maximum discount minor units');
      await expect(maximum).toHaveValue('1500');
      await maximum.fill('1600');
      await maximum.fill('1500');
      await page.getByRole('button', { name: 'Save draft' }).click();
      await expect(page).toHaveURL(new RegExp(`/promo/${encodeURIComponent(id)}$`, 'u'));
      await expect(page.getByText('25% off order (maximum GBP 15.00)')).toBeVisible();
      await expectAccount(page, expected);
      await expectShellActionsAfterScroll(page, 'detail');
      await page.reload();
      await expectAccount(page, expected);
      await expect(page.getByText('25% off order (maximum GBP 15.00)')).toBeVisible();
      await page.getByRole('link', { name: 'Edit Promo' }).click();
      await expect(page.getByLabel('Discount percentage')).toHaveValue('25');
      await expect(page.getByLabel('Maximum discount minor units')).toHaveValue('1500');
      await page.reload();
      await expectAccount(page, expected);
      await expect(page.getByLabel('Discount percentage')).toHaveValue('25');
      await page.getByRole('button', { name: 'Save draft' }).click();
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
  await promoScenario.assertDisposed(runId);
});
