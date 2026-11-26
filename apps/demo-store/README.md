# Demo storefront

A single-restaurant food-ordering demo for the incentives platform.

## What it shows

- Cart-based promotion evaluation.
- One auto-apply offer per cart, chosen by program priority — the same rule
  Core applies.
- Candidate offers with tier progress for offers that are close to unlocking.
- Promo code entry. A code replaces auto-apply offers, exactly like Core's
  coded evaluation mode.
- Line-item and free-delivery rewards.
- Customer targeting: new / regular / VIP.
- Checkout that commits a redemption and returns the discount breakdown.

It does **not** process real payments, delivery, taxes, or multi-restaurant
carts, and it does not claim to.

## Runtime modes

| Mode | Evaluator | Use |
|---|---|---|
| `local` (default) | Bundled evaluator in `src/shared/demo.ts` | UI work without a Core stack |
| `core` | Real `/v1/evaluate` + `/v1/redemptions` | Proving the platform loop |

The bundled evaluator mirrors Core's selection rules: one qualified auto offer,
coded mode replace auto offers, stackable-code combination, and delivery waived
only by a qualified `free_shipping` decision. It is pinned to the Core semantics
by tests, but it has no budget, exhaustion, or usage-cap logic. The UI labels
the active mode in the header.

In `core` mode the Worker fails closed: if any Core setting is missing or the
Core call fails, the request returns an error instead of silently falling back
or fabricating a redemption.

## Run locally

```bash
# UI gallery (http://127.0.0.1:5178), local evaluator
pnpm --filter @incentives/demo-store dev

# BFF (http://127.0.0.1:8788), in a second terminal
pnpm --filter @incentives/demo-store dev:worker
```

Vite proxies `/api` to the Worker. With no extra configuration the Worker runs
the bundled evaluator.

To run the BFF against Core locally, create `apps/demo-store/.dev.vars`:

```bash
DEMO_MODE=core
DEMO_CORE_URL=http://127.0.0.1:8787
CORE_PUBLISHABLE_KEY=pk_...
CORE_SECRET_KEY=sk_...
```

## Seed a Core tenant

`seed/fixture.json` is the canonical demo tenant: two customer attributes,
three demo customers, and the seven promo programs.

```bash
OPERATOR_URL=https://operator.example.com \
OPERATOR_COOKIE='session=...' \
node apps/demo-store/seed/seed.mjs
```

The operator session decides which merchant is seeded, so use a demo merchant.
The script creates missing variables, publishes the schema, upserts the demo
customers, and publishes the programs. It is idempotent. `pnpm --filter
@incentives/demo-store test` validates the fixture against the contracts and
against the local evaluator's offer table, so the two cannot drift silently.

Then issue:

- a **publishable** credential with `evaluations:write`, and
- a **secret** credential with `redemptions:write`.

and set `DEMO_MODE`, `DEMO_CORE_URL`, `CORE_PUBLISHABLE_KEY`, plus
`wrangler secret put CORE_SECRET_KEY`.

## Demo offers

| Offer | Trigger | Reward |
|---|---|---|
| Big basket | subtotal ≥ ₹999 | ₹200 off |
| Feast 20% | subtotal ≥ ₹499 | 20% off, max ₹150 |
| VIP 15% | `customer.is_vip` | 15% off |
| Paneer 15% | Paneer Tikka in cart | 15% off line item |
| Free delivery | subtotal ≥ ₹199 | delivery fee waived |
| `WELCOME50` | code + first order | ₹50 off |
| `FEAST10` | code | 10% off |

Only the highest-priority qualified auto offer applies. For example, a ₹999+
cart gets Big basket, not Feast 20%; entering `FEAST10` pauses both.

## Security

The BFF is intentionally unauthenticated so a public demo link works. Before
deploying in `core` mode:

- point it at a budget-limited demo merchant,
- keep `CORE_SECRET_KEY` in a Worker secret, never in the bundle,
- set `DEMO_CHECKOUT_ENABLED=false` when you only want offer evaluation,
- rotate the credentials after the demo.

## Build / test

```bash
pnpm --filter @incentives/demo-store build
pnpm --filter @incentives/demo-store test
pnpm --filter @incentives/demo-store lint
```

## Deploy

`wrangler.toml` serves the Vite build through Cloudflare static assets and the
BFF through the Worker.

```bash
pnpm --filter @incentives/demo-store build
pnpm --filter @incentives/demo-store deploy
```
