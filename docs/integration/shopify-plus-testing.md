# Shopify Plus integration — verification runbook

This is the repeatable path to validate the integration on a real Shopify store.

## 0. Local gates

```bash
pnpm -r build
pnpm -r test
pnpm --filter @incentives/shopify-app test
pnpm --filter @incentives/checkout-offers-ui build
pnpm --filter @incentives/checkout-offers-ui test
cargo test --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml
cargo build --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml --target wasm32-unknown-unknown --release
```

## 1. Shopify environment

1. Create a development store (enable Plus features if the checkout target requires them).
2. Create a custom app in the Dev Dashboard.
3. Set:
   - App URL: `https://<staging-connector>`
   - Redirect URL: `https://<staging-connector>/auth/callback`
4. Enable **Checkout network access** for the app.
5. Fill `apps/shopify-connector/shopify.app.toml` with the real `client_id` and staging URL.
6. Deploy the checkout extension and function with `shopify app deploy`.

## 2. Connector staging

Deploy the Worker with:

- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET` (secret)
- `SHOPIFY_APP_URL=https://<staging-connector>`
- `SHOPIFY_DISCOUNT_FUNCTION_HANDLE=incentives-discount-fn`
- `TOKEN_ENCRYPTION_KEY` (secret)
- `CORE` service binding to `incentives-api` with `entrypoint = "CoreOperatorService"`

Apply migrations:

```bash
wrangler d1 migrations apply shopify-connector-dev
# and the Core API D1 migrations, including 0010_budget_leases.sql
```

## 3. Install

1. Install the app on the dev store.
2. Confirm `/onboarding?shop=<store>` shows `active`.
3. Confirm the automatic discount node exists in Shopify Admin.
4. Add **Incentives Eligible Offers** in the checkout editor (reductions area).

## 4. Create a test promo

Create an auto-apply promo in Core with:

- a fixed or percentage order discount,
- a budget,
- a subtotal threshold (for the progress bar),
- active status.

## 5. Checkout checklist

Use the **Bogus Gateway** / test payment mode.

- [ ] Cart below threshold: progress bar shows the shortfall.
- [ ] Cart above threshold: offer shows as applied.
- [ ] `_incentives_eval` attribute appears on the cart.
- [ ] The function applies the expected discount.
- [ ] Pay: order is created and `orders/paid` is delivered.
- [ ] Connector logs `status: committed`; Core budget decreases once.
- [ ] Re-deliver `orders/paid` with `shopify app webhook trigger --topic orders/paid`: no double-spend.
- [ ] Change the cart quantity before paying: discount is re-evaluated or removed; no stale discount is applied.
- [ ] Force budget exhaustion: offer is removed, a notice is shown, and full-price payment is still possible.

## 6. Webhook-only checks

```bash
shopify app webhook trigger --topic orders/paid
shopify app webhook trigger --topic orders/cancelled
shopify app webhook trigger --topic refunds/create
```

Expected:

- `orders/paid` commits once.
- cancel/refund currently returns `reversal_not_supported` until Core reversal lands.
- unknown shop returns `200 skipped`, not 404.

## 7. Failure diagnosis

| Symptom | Check |
|---|---|
| No offer | session token, CORS, `network_access`, `/v1/evaluate` logs |
| Offer visible but no discount | function fingerprint parity (`cost.totalAmount` vs function input), signed payload, metafield secret |
| Discount applied but no redemption | webhook HMAC, `checkout_token`, `total_discounts`, `discount_applications` |
| Budget not decremented | Core `commitRedemption`, lease deletion, D1 migration 0010 |
| Reinstall duplicates discount | `automatic_discount_id` reuse, `provisioning_id` stability |

## 8. Known gaps

- Fingerprint field parity must be confirmed on a real line-discounted cart.
- Core cancellation/refund reversal is not implemented.
- Full embedded dashboard is a shell/link-out.
- Native Shopify code-box entry needs code-pool sync.
