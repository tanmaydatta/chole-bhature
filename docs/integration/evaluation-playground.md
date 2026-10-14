# Evaluate a basket in the Playground

Use the Evaluation Playground to check published Promo decisions and exact merchandise discounts for an anonymous shopper or a stored customer before integrating a checkout.

## Before you begin

- Sign in to the operator dashboard with `evaluations:run` and `schemas:read`. The existing Admin, Operator and Viewer roles have these permissions.
- If you use ROOT access, select the intended client through **Clients**. The ROOT banner identifies the selected client.
- Publish a schema in **Variables**. To receive a selected Promo, publish its revision in **Promo Codes**.
- For stored-customer evaluation, create the customer beforehand. Supply its exact reference; customer attributes remain server-owned.

## Steps

1. **Open Evaluation Playground in the sidebar.** The page loads the selected client's published live fields. If no schema exists, publish one in **Variables**, then click **Reload published schema**.

2. **Enter the basket's currency and lines.** Use unique, stable line references, product references, positive integer quantities and nonnegative unit prices in minor units. For GBP, enter `1250` for £12.50. The request subtotal is calculated from quantity × unit price across all lines.

3. **Complete required published fields.** Enter context, cart and line fields with the displayed types and choices. Leave optional fields empty to omit them. The page does not edit stored customer attributes.

4. **Choose the shopper and selection mode.** Leave **Customer reference (optional)** empty for anonymous evaluation, or enter an existing exact reference. Leave **Promo codes (optional)** empty for automatic selection, or enter up to ten distinct codes separated by commas or newlines for coded selection.

5. **Click Evaluate and inspect the result.** Check each returned Promo's outcome, revision, selected reward rule, reasons and effects. Check exact per-Promo and per-line allocations, total discount, discounted merchandise subtotal, schema/customer versions and expiry. Coded evaluation also shows input-aligned code diagnostics.

6. **Change an input and evaluate again.** Editing a field clears the prior result. A response from an older request cannot become the result for the edited basket. Published revisions govern evaluation; an unpublished draft does not replace the active revision.

## Verify it worked

For a GBP basket with quantity `2` and unit price `5000`, a selected 25% order discount capped at `1500` contributes exactly `1500` minor units. The original merchandise subtotal is `10000`, total discount is `1500`, and discounted merchandise subtotal is `8500`. A selected free-shipping Promo contributes no merchandise discount.

The response facts come from the existing evaluation and pricing services. Evaluation persists its normal signed decision snapshot. It does not redeem rewards or spend budgets or usage counters. Merchandise totals exclude tax, shipping charges and payment totals; the Playground supplies no redemption or commit action or route.

A missing published schema produces a safe not-found response and the publication prerequisite message. Missing customers and invalid published live values return safe not-found or validation errors; private dependency details remain hidden.

For local automated verification, run these commands from the repository root with the pinned tooling and Chromium already installed:

```sh
pnpm build
CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local
```

The browser scenarios use real disposable local Workers, a fresh ROOT browser context and normal merchant selection. They verify exact outcomes, published revisions, edited-input invalidation and zero run-owned rows after disposal. Core Workers/D1 tests separately verify snapshot signatures and unchanged budgets, counters and redemption rows. These local checks do not constitute a staging deployment or staging acceptance.

Code references:

- Request and response authority: [canonical evaluation contracts](../../packages/contracts/src/evaluation.ts).
- Evaluation persistence and pricing: [evaluation service](../../apps/api/src/services/evaluation-service.ts).
- Browser boundary: [Playground BFF route](../../apps/operator-web/src/routes/playground.ts).
- Local browser verification: [Playground scenarios](../../tests/e2e/test/playwright/playground.browser.spec.ts).
- Persistence verification: [Core RPC tests](../../apps/api/test/operator-evaluation.test.ts).

## Related

- [End-to-end test workspace](../../tests/e2e/README.md)
- [Product Current State and Roadmap](../product/current-state-and-roadmap.md)
