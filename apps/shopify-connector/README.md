# Shopify Plus connector

Cloudflare Worker that turns a Shopify Plus custom app into a client of the incentives platform.

## What it does

1. `GET /auth/shopify` starts Shopify OAuth.
2. `GET /auth/callback` provisions a Core tenant, publishes the baseline schema, creates one automatic Discount Function node, and registers webhooks.
3. `POST /v1/evaluate` verifies a Shopify session token, calls Core over a service binding, reserves a short-lived budget lease, and returns a signed v2 evaluation.
4. The Checkout UI Extension writes the signed evaluation to the `_incentives_eval` cart attribute.
5. The Rust Discount Function verifies HMAC, expiry, subtotal, currency, and cart fingerprint, then emits an order discount.
6. `orders/paid` verifies the signed payload and commits the redemption atomically.
7. `orders/cancelled` / `refunds/create` are wired for reversal; Core reversal support is still a production follow-up.

## Required bindings and secrets

| Name | Type | Notes |
|---|---|---|
| `CORE` | Service binding | `entrypoint = "CoreOperatorService"` |
| `DB` | D1 | `shopify_installed_shops`, `budget_leases` (Core DB) |
| `SHOPIFY_CLIENT_ID` | var/secret | Shopify app client ID |
| `SHOPIFY_CLIENT_SECRET` | secret | OAuth + webhook HMAC |
| `SHOPIFY_APP_URL` | var | Public connector URL, e.g. `https://shopify.incentives.dev` |
| `SHOPIFY_DISCOUNT_FUNCTION_HANDLE` | var | Defaults to `incentives-discount-fn` |
| `TOKEN_ENCRYPTION_KEY` | secret | 32-byte hex/base64; required in production |
| `SHOPIFY_API_VERSION` | var | Defaults to `2026-07` |
| `OPERATOR_DASHBOARD_URL` | var | Optional link-out from the embedded shell |

```bash
wrangler d1 migrations apply shopify-connector-dev
wrangler secret put SHOPIFY_CLIENT_SECRET
wrangler secret put TOKEN_ENCRYPTION_KEY
wrangler deploy
```

## Shopify app setup

1. Create a custom app in the Shopify Partner/Dev Dashboard.
2. Set the app URL to `SHOPIFY_APP_URL` and the redirect URL to `${SHOPIFY_APP_URL}/auth/callback`.
3. Fill `apps/shopify-connector/shopify.app.toml` (`client_id`, `application_url`, redirect URLs).
4. Enable checkout network access for the app.
5. Deploy both extensions with the Shopify CLI:
   ```bash
   shopify app deploy
   ```
6. In the Shopify checkout editor, place **Incentives Eligible Offers** in the reductions area.

The function handle in `shopify.extension.toml` must match
`SHOPIFY_DISCOUNT_FUNCTION_HANDLE` (default `incentives-discount-fn`).

## Security invariants

- No tenant signing key or API secret is sent to the browser.
- Checkout requests authenticate with a Shopify session token (`aud`, `exp`, `dest`/`iss` checked, D1 status checked).
- The signed payload includes the shop domain, checkout token, cart fingerprint, subtotal, currency, discount, and expiry.
- The function fails closed on any HMAC, expiry, subtotal, currency, or fingerprint mismatch.
- Redemption is idempotent by `shopify_<order.id>` and verifies the order's checkout token, total discounts, and discount application.
- Budget leases are short-lived and expired lazily; commit deletes the lease.

## Local checks

```bash
pnpm --filter @incentives/shopify-connector build
pnpm --filter @incentives/shopify-app test
pnpm --filter @incentives/checkout-offers-ui build
pnpm --filter @incentives/checkout-offers-ui test
cargo test --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml
cargo build --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml --target wasm32-unknown-unknown --release
```

## Known follow-ups

- Full embedded campaign dashboard (the current `/dashboard` page is an App Bridge-verified shell/link-out).
- Native discount-code-box support requires syncing promo/affiliate codes into Shopify's code pool.
- Core cancellation/refund reversal is not yet implemented; the connector reports `reversal_not_supported` instead of claiming success.
- The Rust function uses a day-level expiry guard because `wasm32-unknown-unknown` has no wall clock; the webhook applies a 24-hour grace and commit is the final authority.
- Multi-currency 3-decimal rounding and cart line ID stability need a dev-store validation pass.
