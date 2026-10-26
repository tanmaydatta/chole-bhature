import { OperatorProgramViewSchema } from '@incentives/contracts';
import type { Locator, Page } from '@playwright/test';
import { test, expect, type PromoAccountDisplay } from '../support/promo-fixtures.js';

import { executeRecipe } from '../../src/execution.js';
import { cappedPromo } from '../../src/gap-scenario.js';

function relativeLuminance(color: string) {
  const channels = color.match(/[\d.]+/g)?.map(Number) ?? [];
  expect(channels).toHaveLength(3);
  const [red, green, blue] = channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

async function expectReadableOverviewAction(page: Page, theme: 'light' | 'dark') {
  const html = page.locator('html');
  if (await html.getAttribute('data-theme') !== theme) {
    await page.getByTitle('Toggle light / dark', { exact: true }).click();
  }
  await expect(html).toHaveAttribute('data-theme', theme);
  const colors = await page.getByRole('link', { name: 'View promos', exact: true }).evaluate(element => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  const luminances = [relativeLuminance(colors.foreground), relativeLuminance(colors.background)];
  const contrast = (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
  console.log(`overview-contrast theme=${theme}; foreground=${colors.foreground}; background=${colors.background}; ratio=${contrast}`);
  expect(contrast, `View promos text contrast in ${theme} theme`).toBeGreaterThanOrEqual(4.5);
}

// Catches unreadable owned actions, escaping panels and inaccessible native keyboard paths.
async function tabTo(page: Page, target: Locator, backwards = false) {
  for (let tabs = 0; tabs < 100 && !await target.evaluate(element => element === document.activeElement); tabs++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
  const focus = await target.evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth) };
  });
  expect(focus.visible).toBe(true);
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
}

async function expectPromoPresentation(page: Page, surface: 'list' | 'detail', id: string) {
  const originalViewport = page.viewportSize();
  const originalTheme = await page.locator('html').getAttribute('data-theme');
  const main = page.getByRole('main');
  const status = main.getByRole('combobox', { name: 'Status', exact: true });
  const originalFilter = surface === 'list' ? await status.inputValue() : undefined;
  const ratios: number[] = [];
  try {
    for (const theme of ['light', 'dark'] as const) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await page.getByTitle('Toggle light / dark', { exact: true }).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (surface === 'detail') {
        await page.getByRole('button', { name: 'Publish revision', exact: true }).click();
        await expect(main.getByRole('region', { name: 'Review publication', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const summary = main.getByText('Exact reward details', { exact: true }).first();
        await tabTo(page, summary);
        await page.keyboard.press('Enter');
        await expect(main.getByRole('region', { name: 'Exact reward JSON', exact: true }).first()).toBeVisible();
      }
      const controls = main.locator('a, button, select, summary');
      for (const control of await controls.all()) {
        if (!await control.isVisible() || await control.isDisabled()) continue;
        const colors = await control.evaluate(element => {
          const foreground = getComputedStyle(element).color;
          let background = 'rgba(0, 0, 0, 0)';
          for (let node: Element | null = element; node && background === 'rgba(0, 0, 0, 0)'; node = node.parentElement) {
            background = getComputedStyle(node).backgroundColor;
          }
          return { foreground, background };
        });
        const luminances = [relativeLuminance(colors.foreground), relativeLuminance(colors.background)];
        const ratio = (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
        ratios.push(ratio);
        expect.soft(ratio, `${surface} ${theme} owned text contrast`).toBeGreaterThanOrEqual(4.5);
      }
      const scroller = surface === 'list' ? main.getByRole('region', { name: 'Promo table', exact: true })
        : main.getByRole('region', { name: 'Configuration', exact: true });
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 });
        const allocation = await main.boundingBox();
        expect(allocation).not.toBeNull();
        const padding = await main.evaluate(element => {
          const style = getComputedStyle(element);
          return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
        });
        for (const owned of [main.locator('[aria-labelledby="promo-title"]'), scroller,
          ...await controls.all(), ...await main.getByRole('region', { name: 'Review publication', exact: true }).all(),
          ...await main.getByRole('region', { name: 'Exact reward JSON', exact: true }).all()]) {
          if (!await owned.isVisible()) continue;
          // Table content remains intentionally wider inside its owned scroller.
          if (surface === 'list' && await owned.evaluate(element => element.closest('table') !== null)) continue;
          const bounds = await owned.boundingBox();
          expect(bounds).not.toBeNull();
          expect.soft(bounds!.x, `${surface} ${theme} ${width} owned left`).toBeGreaterThanOrEqual(allocation!.x + padding.left - 1);
          expect.soft(bounds!.x + bounds!.width, `${surface} ${theme} ${width} owned right`).toBeLessThanOrEqual(Math.min(width, allocation!.x + allocation!.width - padding.right) + 1);
        }
        if (width === 375) {
          const overflow = surface === 'list' ? scroller : main.getByRole('region', { name: 'Exact reward JSON', exact: true }).first();
          await tabTo(page, overflow);
          expect(await overflow.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
          const before = await overflow.evaluate(element => element.scrollLeft);
          await page.keyboard.press('ArrowRight');
          await expect.poll(() => overflow.evaluate(element => element.scrollLeft)).toBeGreaterThan(before);
        }
      }
      if (originalViewport) await page.setViewportSize(originalViewport);
      if (surface === 'list') {
        await tabTo(page, status);
        await page.keyboard.press('Home');
        await page.keyboard.press('d');
        await page.keyboard.press('Enter');
        await expect(status).toHaveValue('draft');
        await tabTo(page, scroller);
        const link = main.getByRole('link', { name: `${id} Capped percentage`, exact: true });
        await tabTo(page, link);
        await expect(link).toHaveAttribute('href', `/promo/${encodeURIComponent(id)}`);
        await page.keyboard.press('Shift+Tab');
        const row = main.getByRole('row').filter({ has: page.getByRole('link', { name: `${id} Capped percentage`, exact: true }) });
        await expect(row).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(`${new URL(page.url()).origin}/promo/${encodeURIComponent(id)}`);
        await page.goBack();
        await expect(status).toBeVisible();
      } else {
        const confirm = main.getByRole('button', { name: 'Confirm publish', exact: true });
        await tabTo(page, confirm);
        await page.keyboard.press('Tab');
        const cancel = main.getByRole('button', { name: 'Cancel publication', exact: true });
        await expect(cancel).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(confirm).toBeFocused();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect(main.getByRole('region', { name: 'Review publication', exact: true })).toHaveCount(0);
        const summary = main.getByText('Exact reward details', { exact: true }).first();
        await tabTo(page, summary);
        const json = main.getByRole('region', { name: 'Exact reward JSON', exact: true }).first();
        await expect(json).toBeVisible();
        await tabTo(page, json);
        await page.keyboard.press('Shift+Tab');
        await expect(summary).toBeFocused();
        await page.keyboard.press('Enter');
      }
    }
    console.log(`promo-${surface} themes=light,dark; min_control_contrast=${Math.min(...ratios)}; owned_widths=1280,375; native_keyboard=true; fixed_shell_excluded=true`);
  } finally {
    if (originalViewport) await page.setViewportSize(originalViewport);
    if (surface === 'list' && originalFilter !== undefined) await status.selectOption(originalFilter);
    if (await page.locator('html').getAttribute('data-theme') !== originalTheme) {
      await page.getByTitle('Toggle light / dark', { exact: true }).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', originalTheme!);
    expect(page.viewportSize()).toEqual(originalViewport);
  }
}

// Scope measurements to controls owned by the editor, excluding shared condition widgets.
async function expectPromoEditorPresentation(page: Page, theme: 'light' | 'dark', editing: boolean) {
  const originalViewport = page.viewportSize();
  const main = page.getByRole('main');
  const labels = ['External reference', 'Promo name', 'Automatic', 'Code-triggered', 'Code',
    'Rule name', 'Reward type', 'Product reference', 'Discount percentage',
    'Maximum discount currency', 'Maximum discount minor units', 'Currency', 'Minor units',
    'Fallback name', 'Fallback type', 'Budget currency', 'Budget minor units',
    'Usage cap', 'Per customer cap', 'Start date', 'End date', 'Priority', 'Stackable'];
  const controls = labels.map(label => main.getByLabel(label, { exact: true }));
  const actions = main.getByRole('button').filter({ hasText: /^(Save draft|Use complete authoring example|Add reward rule|Add fallback reward|Add budget|Remove budget|Move up|Move down|Remove rule|Remove fallback|Add maximum discount|Remove maximum discount)$/u });
  const frame = await main.evaluate(element => {
    const style = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.color = 'var(--ink)';
    probe.style.backgroundColor = 'var(--bg)';
    element.append(probe);
    const expected = getComputedStyle(probe);
    const result = { foreground: style.color, background: style.backgroundColor,
      ink: expected.color, surface: expected.backgroundColor };
    probe.remove();
    return result;
  });
  expect.soft(frame.background, `${theme} editor themed frame`).toBe(frame.surface);
  expect.soft(frame.foreground, `${theme} editor themed text`).toBe(frame.ink);
  const ratios: number[] = [];
  for (const locator of [...controls, actions]) {
    for (const control of await locator.all()) {
      if (await control.isDisabled()) continue;
      const colors = await control.evaluate(element => {
        const style = getComputedStyle(element);
        let background = style.backgroundColor;
        for (let parent = element.parentElement; background === 'rgba(0, 0, 0, 0)' && parent; parent = parent.parentElement) {
          background = getComputedStyle(parent).backgroundColor;
        }
        return { foreground: style.color, background: background === 'rgba(0, 0, 0, 0)' ? 'rgb(255, 255, 255)' : background };
      });
      const luminances = [relativeLuminance(colors.foreground), relativeLuminance(colors.background)];
      const ratio = (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
      ratios.push(ratio);
      expect.soft(ratio, `${theme} editor control/action contrast`).toBeGreaterThanOrEqual(4.5);
    }
  }
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locator of [...controls, actions]) {
      for (const control of await locator.all()) {
        const bounds = await control.boundingBox();
        expect.soft(bounds, `${theme} ${width}px editor control has bounds`).not.toBeNull();
        if (bounds) {
          expect.soft(bounds.x, `${theme} ${width}px editor control left`).toBeGreaterThanOrEqual(0);
          expect.soft(bounds.x + bounds.width, `${theme} ${width}px editor control right`).toBeLessThanOrEqual(width);
        }
      }
    }
    const usage = await main.getByLabel('Usage cap', { exact: true }).boundingBox();
    const customer = await main.getByLabel('Per customer cap', { exact: true }).boundingBox();
    expect(usage).not.toBeNull();
    expect(customer).not.toBeNull();
    if (width === 375) expect.soft(customer!.y, 'mobile limit fields stack').toBeGreaterThan(usage!.y);
    else expect.soft(customer!.y, 'desktop limit fields share a row').toBe(usage!.y);
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
  // Create retains focus on the example action; edit starts at the document.
  // Reach the name through native keyboard traversal in either case.
  const name = main.getByLabel('Promo name', { exact: true });
  const unfocused = await name.evaluate(element => getComputedStyle(element).outlineStyle);
  for (let tabs = 0; tabs < 30 && !await name.evaluate(element => element === document.activeElement); tabs++) {
    await page.keyboard.press(editing ? 'Tab' : 'Shift+Tab');
  }
  await expect(name).toBeFocused();
  const focus = await name.evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth), color: style.outlineColor };
  });
  expect(focus.visible).toBe(true);
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(focus.style).not.toBe(unfocused);
  await page.keyboard.press('Tab');
  const trigger = main.getByRole('radio', { name: editing ? 'Code-triggered' : 'Automatic', exact: true });
  await expect(trigger).toBeFocused();
  if (!editing) {
    await page.keyboard.press('ArrowRight');
    await expect(main.getByRole('radio', { name: 'Code-triggered', exact: true })).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(trigger).toBeChecked();
  }
  const rewardType = main.getByLabel('Reward type', { exact: true }).first();
  if (await rewardType.count()) {
    for (let tabs = 0; tabs < 80 && !await rewardType.evaluate(element => element === document.activeElement); tabs++) {
      await page.keyboard.press('Tab');
    }
    await expect(rewardType).toBeFocused();
    const selected = await rewardType.inputValue();
    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Escape');
    await expect(rewardType).toHaveValue(selected);
  }
  if (editing) {
    const stackable = main.getByRole('checkbox', { name: 'Stackable', exact: true });
    for (let tabs = 0; tabs < 80 && !await stackable.evaluate(element => element === document.activeElement); tabs++) {
      await page.keyboard.press('Tab');
    }
    await expect(stackable).toBeFocused();
    await expect(stackable).toBeChecked();
    await page.keyboard.press('Space');
    await expect(stackable).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(stackable).toBeChecked();
  }
  for (const section of ['Basics', 'Eligibility', 'Ordered reward rules', 'Limits, schedule, and stacking']) {
    await expect(main.getByRole('region', { name: section, exact: true })).toBeVisible();
  }
  console.log(`promo-editor theme=${theme}; mode=${editing ? 'edit' : 'create'}; min_control_contrast=${Math.min(...ratios)}; widths=1280,375; tab_focus=true; native_controls=true`);
}

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
      await page.goto(`${ctx.target.operatorOrigin}/`);
      const expectOverview = async () => {
        await expectAccount(page, expected);
        await expect(page.getByRole('heading', { name: 'Overview metrics aren’t available yet', exact: true })).toBeVisible();
        await expect(page.getByText('Analytics are not available yet. View your promos to manage existing programs.', { exact: true })).toBeVisible();
        await expect(page.getByText('Demo data', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('table')).toHaveCount(0);
        await expect(page.getByText(/Active programs|Redemptions \(30d\)|Incentive spend|8,412|\$42,180|\$65,000|64%|SUMMER15/)).toHaveCount(0);
        await expect(page.getByRole('button', { name: /New program/i })).toHaveCount(0);
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'View promos', exact: true })).toHaveAttribute('href', '/promo');
        await expect(page.getByRole('link', { name: 'New promo', exact: true })).toHaveAttribute('href', '/promo/new');
      };
      await expectOverview();
      await page.reload();
      await expectOverview();
      await expectReadableOverviewAction(page, 'light');
      await expectReadableOverviewAction(page, 'dark');
      await page.getByRole('link', { name: 'New promo', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Create Promo', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Use complete authoring example', exact: true }).click();
      await expectPromoEditorPresentation(page, 'dark', false);
      await page.goto(`${ctx.target.operatorOrigin}/promo/${encodeURIComponent(id)}/edit`);
      await expect(page.getByRole('heading', { name: 'Edit Promo draft', exact: true })).toBeVisible();
      await expectPromoEditorPresentation(page, 'dark', true);
      await page.goto(`${ctx.target.operatorOrigin}/`);
      await page.getByTitle('Toggle light / dark', { exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await page.getByRole('link', { name: 'View promos', exact: true }).click();
      await expect(page).toHaveURL(`${ctx.target.operatorOrigin}/promo`);
      await expectAccount(page, expected);
      await expect(page.getByRole('cell', { name: `${id} Capped percentage`, exact: true })).toBeVisible();
      console.log('overview-journey unavailable=true; reload=true; live_promo_navigation=true; owned_promo_visible=true');
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
      await expectPromoPresentation(page, 'list', id);
      await page.getByRole('link', { name: 'New promo', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Create Promo', exact: true })).toBeVisible();
      await expectAccount(page, expected);
      await page.getByRole('button', { name: 'Use complete authoring example', exact: true }).click();
      await expectPromoEditorPresentation(page, 'light', false);
      await page.goto(`${ctx.target.operatorOrigin}/promo/${encodeURIComponent(id)}/edit`);
      await expect(page.getByRole('heading', { name: 'Edit Promo draft' })).toBeVisible();
      await expectAccount(page, expected);
      const percentage = page.getByLabel('Discount percentage');
      await expectPromoEditorPresentation(page, 'light', true);
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
      await expectPromoPresentation(page, 'detail', id);
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
      await expect(page.getByRole('region', { name: 'Review publication', exact: true }).getByRole('heading',
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
