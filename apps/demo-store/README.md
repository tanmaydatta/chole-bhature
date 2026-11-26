# Demo storefront

A single-restaurant food-ordering demo for the incentives platform.

## What it shows

- Cart-based promotion evaluation.
- Public auto-apply offers with tier progress.
- Promo code entry (`WELCOME50`, `FEAST10`).
- Line-item offer on Paneer Tikka.
- Free-delivery offer.
- Customer targeting: new / regular / VIP.
- Demo checkout and redemption confirmation.

It does **not** process real payments, delivery, taxes, or multi-restaurant carts.

## Run locally

```bash
# UI (http://127.0.0.1:5178)
pnpm --filter @incentives/demo-store dev

# API (http://127.0.0.1:8788), in a second terminal
pnpm --filter @incentives/demo-store dev:worker
```

Vite proxies `/api` to the Worker. The default `DEMO_USE_CORE=false` uses the
self-contained demo evaluator in `src/shared/demo.ts`, so the UI works without a
full Core stack.

To use the real Core API, deploy the app with:

- `DEMO_USE_CORE=true`
- `DEMO_TENANT_ID` for a seeded demo tenant
- a `CORE` service binding with `entrypoint = "CoreOperatorService"`

## Build / test

```bash
pnpm --filter @incentives/demo-store build
pnpm --filter @incentives/demo-store test
pnpm --filter @incentives/demo-store lint
```

## Demo offers

| Offer | Trigger | Reward |
|---|---|---|
| VIP 15% | customer tag `vip` | 15% off order |
| Feast 20% | subtotal ≥ ₹499 | 20% off, max ₹150 |
| Big basket | subtotal ≥ ₹999 | ₹200 off |
| Free delivery | subtotal ≥ ₹199 | delivery fee waived |
| Paneer 15% | Paneer Tikka in cart | 15% off line item |
| WELCOME50 | new customer + code | ₹50 off |
| FEAST10 | any cart + code | 10% off |

## Deploy

`wrangler.toml` serves the Vite build through Cloudflare static assets and the
BFF through the Worker. Set the Core service binding and demo vars, then:

```bash
pnpm --filter @incentives/demo-store build
pnpm --filter @incentives/demo-store deploy
```
