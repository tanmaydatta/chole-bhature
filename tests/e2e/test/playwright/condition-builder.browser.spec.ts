import { test, expect } from '../support/promo-fixtures.js';
import { executeRecipe } from '../../src/execution.js';

test('browser authors complex conditions with react-querybuilder, nesting, and live message templates', async ({
  browser,
  promoScenario,
}) => {
  const runId = await promoScenario.run(async (ctx) => {
    const merchant = await promoScenario.merchant(ctx);

    // Register a custom enum variable so we have enum, number, and boolean types
    await executeRecipe(ctx, 'add-schema', {
      slug: 'tier_def',
      definition: {
        key: 'customer.tier',
        label: 'Tier',
        source: 'customer',
        type: 'enum',
        enumValues: ['gold', 'silver', 'bronze'],
        required: false,
      },
    });

    const context = await browser.newContext({
      storageState: promoScenario.storageState(ctx),
    });

    try {
      if (promoScenario.selectMerchant) {
        const selected = await context.request.post(
          `${ctx.target.operatorOrigin}/operator/v1/platform/merchant-selection`,
          {
            data: { merchantId: merchant.merchantId },
            headers: { origin: ctx.target.operatorOrigin },
          }
        );
        expect(selected.status()).toBe(204);
      }

      const page = await context.newPage();
      await page.goto(`${ctx.target.operatorOrigin}/promo/new`);
      await expect(
        page.getByRole('heading', { name: 'Create Promo', exact: true })
      ).toBeVisible();

      // Basics
      const promoId = `rqb-promo-${Date.now()}`;
      await page.getByLabel('External reference', { exact: true }).fill(promoId);
      await page
        .getByLabel('Promo name', { exact: true })
        .fill('RQB Condition Builder Promo');

      // Locate Eligibility section
      const eligibility = page.getByRole('region', {
        name: 'Eligibility',
        exact: true,
      });
      await expect(eligibility).toBeVisible();

      // Root combinator selector (ALL / ANY)
      const rootMatch = eligibility.getByLabel('Condition group match root', {
        exact: true,
      });
      await expect(rootMatch).toBeVisible();
      await expect(rootMatch).toHaveValue('ALL');
      await rootMatch.selectOption('ANY');
      await expect(rootMatch).toHaveValue('ANY');
      await rootMatch.selectOption('ALL');

      // Add a root condition via VariablePicker
      await eligibility
        .getByText('＋ Add condition', { exact: true })
        .first()
        .click();
      const picker = eligibility.locator('.condition-builder-wrapper');
      await expect(picker.getByPlaceholder(/Search variables/i)).toBeVisible();

      // Pick cart.subtotal
      await picker.getByText('cart.subtotal', { exact: true }).click();

      // Verify origin chip icon is present
      const fieldSelector = eligibility.getByRole('button', {
        name: 'field selector',
      });
      await expect(fieldSelector).toBeVisible();
      await expect(fieldSelector).toContainText('cart.subtotal');

      // Operator defaults to gte for number; change to between
      const operatorSelect = eligibility
        .getByLabel('operator', { exact: true })
        .first();
      await operatorSelect.selectOption('between');

      // Verify dual inputs for between operator
      const minInput = eligibility
        .getByLabel('minimum value', { exact: true })
        .first();
      const maxInput = eligibility
        .getByLabel('maximum value', { exact: true })
        .first();
      await expect(minInput).toBeVisible();
      await expect(maxInput).toBeVisible();
      await minInput.fill('20');
      await maxInput.fill('100');

      // Open message editor for condition
      await eligibility
        .getByRole('button', { name: 'Add custom message', exact: true })
        .click();
      const msgInput = eligibility.getByRole('textbox', {
        name: /message template/i,
      });
      await expect(msgInput).toBeVisible();
      await msgInput.fill(
        'Cart must be between {{ 20 | money }} and {{ 100 | money }}'
      );

      // Verify live preview renders token interpolation
      await expect(eligibility.getByText(/preview/i)).toBeVisible();

      // Add nested group
      await eligibility
        .getByRole('button', {
          name: '＋ Add nested group (AND / OR)',
          exact: true,
        })
        .first()
        .click();
      const nestedGroup = eligibility.getByLabel(
        'Condition group match group 1',
        { exact: true }
      );
      await expect(nestedGroup).toBeVisible();
      await nestedGroup.selectOption('ANY');

      // Add condition inside nested group
      const addConditionBtns = eligibility.getByText('＋ Add condition', {
        exact: true,
      });
      // The nested group's add condition button is the second one
      await addConditionBtns.nth(1).click();
      await eligibility.getByText('customer.tier', { exact: true }).click();

      // Verify enum field value editor
      const enumValSelect = eligibility
        .getByLabel('value', { exact: true })
        .last();
      await expect(enumValSelect).toBeVisible();
      await enumValSelect.selectOption('gold');

      // Fill remaining required reward fields to save draft
      await page
        .getByLabel('Rule name', { exact: true })
        .first()
        .fill('Default discount');
      await page
        .getByLabel('Reward type', { exact: true })
        .first()
        .selectOption('order_discount_fixed');
      await page.getByLabel('Currency', { exact: true }).first().fill('GBP');
      await page.getByLabel('Minor units', { exact: true }).first().fill('500');

      // Save draft
      const saveBtn = page.getByRole('button', {
        name: 'Save draft',
        exact: true,
      });
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();

      // Verify navigation to promo detail page with saved status
      await expect(
        page.getByRole('heading', {
          name: 'RQB Condition Builder Promo',
          exact: false,
        })
      ).toBeVisible();
      await expect(page.getByText('Draft revision 1')).toBeVisible();

      // Verify serialized conditions on detail page
      await expect(page.getByText(/cart\.subtotal/)).toBeVisible();
      await expect(page.getByText(/customer\.tier/)).toBeVisible();
    } finally {
      await context.close();
    }
    return ctx.manifest.runId;
  });

  await promoScenario.assertDisposed(runId);
});
