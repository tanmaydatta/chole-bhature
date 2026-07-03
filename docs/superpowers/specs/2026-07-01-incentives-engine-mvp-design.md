# Incentives Engine MVP — Design Spec (platform-agnostic, Cloudflare)

**Date:** 2026-07-01
**Status:** Approved design → ready for implementation plan
**Supersedes direction:** the Shopify-integration exploration. The MVP is **platform-agnostic**: merchants integrate our HTTP API into their own storefront/checkout. (Shopify/Woo connectors are a later phase.)
**Builds on:** the validated demo in `demo/` (dashboard UI, condition builder, and the pure logic in `demo/src/lib/{conditions,interpolate,rewards,codes,types}.ts` — reused server-side).

---

## 1. Purpose & thesis

An **API-first incentives engine on Cloudflare (Workers + D1 + Durable Objects)**. Merchants configure **promo / affiliate / referral / loyalty** programs in our dashboard and drive them through a small HTTP API (+ a thin browser JS snippet). We own the runtime: **eligibility evaluation, redemption, wallet/ledger, events, billing**.

**Target:** a **3-month build** with 2–3 AI-assisted engineers. **Deliverable = build-complete + a reference sample storefront that exercises the full loop end-to-end.** It is explicitly **not** yet battle-tested with live merchants — real-merchant integration/sales/hardening is the *next* phase.

## 2. Scope

**In**
- Cloudflare backend (Workers API) + the four runtime endpoints + engine.
- The dashboard (ported from the demo) wired to a real backend.
- All four program types at MVP depth.
- API-key auth, multi-tenancy, Stripe billing, observability, API docs.
- A **reference sample storefront** proving E2E.

**Out (deferred)**
- Platform connectors (Shopify/Woo/etc.), multi-language SDK suite, outbound webhooks, advanced analytics/A-B, fraud beyond caps, multi-currency/i18n, SSO/roles/multi-seat, self-serve signup polish, SOC 2 (posture only), usage-metered billing.

**"Prod-ready" for this phase** = build-complete + reference integration passing E2E + a reliability pass (idempotency, retries, rate limits, tenant isolation) + observability. Production hardening under real merchant traffic continues next phase.

## 3. Architecture (Cloudflare)

| Concern | Primitive |
|---|---|
| HTTP API (edge, global, low-latency) | **Workers** |
| Dashboard SPA hosting | **Workers static assets** (reuse the demo build) |
| Relational data (programs, config, codes, customers, ledger/history) | **D1** |
| Atomic hot state (budget/usage counters, wallet balances, redemption idempotency) | **Durable Objects** |
| Compiled-config / hot read cache | **KV** |
| Async processing (event fulfillment, reward crediting) | **Queues** |
| Expiry, budget resets, scheduled jobs | **Cron Triggers** |
| Billing | **Stripe** (external, called from Workers) |

**Data-ownership rule (critical):** for any consistency-sensitive datum, one source of truth. **Durable Objects own** atomic counters + wallet balances (single-writer, no double-spend). **D1 owns** the relational record + append-only ledger/history (queryable, for dashboard/reporting). When both touch a datum (e.g. wallet), the DO holds the live balance and D1 holds the transaction ledger written alongside.

**Multi-tenancy:** single D1 with `merchant_id` scoping for MVP (per-merchant D1 sharding deferred — accepted "D1 now, migrate later"). DO instances are namespaced per entity (e.g. `program:{merchantId}:{programId}`, `wallet:{merchantId}:{customerId}`).

### 3.1 Tech stack (pinned)

TypeScript (strict) everywhere, one **pnpm-workspaces monorepo**:

```
apps/api              Workers API (Hono) + Durable Object classes
apps/dashboard        the current demo/ frontend, ported to the real API
apps/reference-store  sample storefront (E2E proof / future sales demo)
packages/engine       pure logic lifted from demo/src/lib (conditions,
                      interpolate, rewards, codes, types) + zod schemas —
                      shared by API and dashboard
```

| Layer | Choice | Notes |
|---|---|---|
| API framework | **Hono** on Workers + **zod** validation | Standard Workers router; middleware for API-key auth + rate limiting |
| Database | **D1 + Drizzle ORM** (drizzle-kit migrations via wrangler) | Cloudflare's highlighted ORM pairing for D1; type-safe schema. D1 has no interactive transactions — use `batch()` for multi-statement atomicity; one Drizzle instance per request |
| Hot state | **Durable Objects** (native SQLite storage API) | Plain DO classes in `apps/api` |
| Cache / async / jobs | **KV / Queues / Cron** native bindings | No extra infra |
| Dashboard | **React 19 + Vite + Tailwind + Zustand + React Router** | The existing demo stack, carried over |
| Dashboard auth | **better-auth** (email+password, sessions), native D1 adapter | First-class D1 support; avoids hand-rolled crypto. API keys separate, hashed in D1 |
| Billing | **Stripe** official SDK (fetch HTTP client) | Works on Workers |
| Testing | **Vitest** + `@cloudflare/vitest-pool-workers` (API/DO/D1 tests run inside workerd with isolated per-test storage, `runInDurableObject`, DO-eviction helpers) + RTL for the dashboard | The official Workers testing integration — used for the DO cap/idempotency concurrency tests |
| Tooling / deploy | **Wrangler** (dev, migrations, deploy); dev → staging → prod environments; GitHub Actions / Workers Builds CI | |

### 3.2 High-contention & flash sales

Reference scenario: *"50% off for the first 500 orders"* with ~50k concurrent shoppers.

- **Reads never touch the counter.** `evaluate` is stateless — it reads program config + an availability flag from KV / per-isolate cache, and scales horizontally on Workers. The `ProgramCountersDO` is only ever hit by `redemptions`.
- **The DO is the single arbiter.** All redemptions for a program serialize through its single-threaded DO: decrement #500 succeeds, #501 is atomically rejected. Overselling is structurally impossible.
- **Fail-fast exhausted gate (MVP).** When the counter hits zero, the DO publishes an `exhausted` flag to KV, and each Worker isolate caches it after its first rejection; subsequent redeems short-circuit at the Worker layer without touching the DO. The gate only *rejects* early — it never accepts — so the DO remains authoritative. A single DO sustains roughly ~1k simple ops/sec; the gate keeps stampede overflow at the edge as cheap O(1) rejections.
- **The UX race + integration rule.** `evaluate` is a read; a shopper can be shown the discount and lose it while typing card details. `redemptions` is the authoritative moment: merchants MUST call it **before capturing payment** — on rejection, checkout re-prices ("offer just sold out") instead of charging a discounted amount with no budget behind it. The reference integration demonstrates this ordering.
- **Post-MVP scale-up paths (named, deferred):** *reserve-then-commit* — `evaluate` places a TTL hold (DO decrement + alarm-based expiry back into the pool), `redemptions` confirms it (ticketing-style, for flash-sale merchants); *sharded counters* — split very large caps across N shard DOs routed by customer hash, for sustained thousands of *accepted* writes/sec.

## 4. Public API surface

Auth: **API keys** per merchant — a **publishable key** (client-side, `evaluate` + wallet-read only) and a **secret key** (server-side: `redemptions`, `events`, customer writes). All over HTTPS; per-key rate limiting.

- **`POST /v1/evaluate`** — inputs: `customerRef` + attributes, cart/context variables (`basket_value`, `items_in_basket`, `category`, …), optional entered `code`. Returns: applicable discounts/rewards (per program, respecting stacking), available wallet credit, and **resolved messages** (incl. interpolated "add $12 more…"). Read-only, fast, edge. Publishable-key allowed.
- **`POST /v1/redemptions`** — called when an order is committed. Inputs: order id, applied program(s)/code(s), amounts, customerRef. Effects: **atomic** budget/usage decrement (DO) + cap enforcement + append redemption to D1 ledger. **Idempotent by order id.** Secret key.
- **`POST /v1/events`** — inputs: event name (`order_completed`, …) + payload (defined variables). Effects: loyalty accrual + referral attribution via Queue → fulfillment (credits wallet). **Idempotent by event id.** Secret key.
- **`POST /v1/customers`** (upsert) — customerRef + user attributes (for user-attribute conditions, wallet, referral identity). Secret key.
- **`GET /v1/customers/{ref}/wallet`** — balance + recent transactions. Publishable (read) / secret.

Idempotency: `redemptions` keyed by order id, `events` by event id; retries are safe. Every mutating call returns a stable result for a repeated key.

## 5. Data model

**D1 (relational, `merchant_id`-scoped):** `merchants`, `api_keys`, `programs` (+ type-specific config JSON), `variables`, `event_defs`, `codes` (affiliate/referral), `customers` (+ attributes), `redemptions` (ledger), `wallet_transactions` (ledger), `program_stats` (rollups for dashboard).

**Durable Objects:**
- `ProgramCountersDO` (per program) — `budgetRemaining`, `redemptionsTotal`, per-customer use counts; atomic decrement with cap check; rejects when exhausted.
- `CustomerWalletDO` (per merchant+customer) — live balance; idempotent credit/debit; writes a mirroring row to `wallet_transactions`.
- Redemption/event idempotency — dedupe keys stored in the relevant DO (or a small dedicated DO) so retries don't double-apply.

**KV:** compiled/evaluable program config per merchant (fast read in `evaluate`), invalidated on program change.

## 6. Condition & rewards engine

Reuse and server-port the demo's tested logic (`lib/conditions`, `lib/interpolate`, `lib/rewards`, `lib/types`):
- **Variables, 3 origins:** *user attributes* (merchant-supplied via `/customers`), *dynamic/context* (per-request in `evaluate`), *system* (budget/counts/dates, from DO/engine).
- **Conditions:** match ALL/ANY + rows (variable/operator/value) + one level of nested groups; compiled to an evaluable form cached in KV; first-failing-condition drives the message.
- **Error messages:** per-condition → per-variable default → program fallback → system default; `{{ }}` interpolation (e.g. `add {{ 50 − basket_value | money }} more`).
- **Rewards:** percent / fixed / free_shipping / points / credit. **Stacking** per program flags; **loyalty never stacks** (fixed rule).

## 7. The four program types (runtime behavior)

- **Promo** — coded or auto-apply; `evaluate` returns the discount if conditions pass; `redemptions` enforces budget/usage caps (DO).
- **Affiliate** — unique-code batch generation + **CSV download** (we own it now); each code carries the program's eligibility/discount; per-code attribution recorded on `redemptions`.
- **Referral** — code/link → **referee** reward surfaced in `evaluate`; **referrer** wallet credit on the referee's qualifying `event`; **attribute-based priority** selection (engine picks the first matching program; customer never chooses).
- **Loyalty** — `events` (e.g. `order_completed`) → accrue points/credit to the customer **wallet**; wallet redeemed via `evaluate`/`redemptions`; **no stacking**.

## 8. Dashboard

Port the existing demo SPA to the real backend/API (it already contains the flows, condition builder, affiliate codes panel, referral priority, detail/edit, theming). Add:
- **Merchant auth** for the dashboard — **better-auth** (email+password, sessions; native D1 adapter); **single-seat** for MVP. Distinct from API keys.
- **API-key management** screen (create/reveal/rotate publishable + secret keys).
- Real-data **analytics-lite** (redemptions, incentive spend, wallet issued) from `program_stats`.
- Everything reads/writes the real API instead of the in-memory mock store.

## 9. Reference integration

A **minimal sample storefront** (small React/HTML cart) that calls `evaluate` → shows discount + messages, `redemptions` on checkout, `events` on order, and displays wallet balance. It is the E2E proof for this phase and the seed of the future sales demo. Ships with a short **integration guide** in the API docs.

## 10. Billing

**Stripe**: 1–2 flat subscription plans + a trial. No usage metering for MVP (flat plans). Billing state gates dashboard/API access.

## 11. Cross-cutting: reliability, security, observability

- **Reliability:** idempotency keys on all mutations; Queue retries with backoff for fulfillment; DO single-writer for all counters/wallet; rate limiting per API key.
- **Security:** secret keys never exposed client-side; publishable key limited to read/evaluate; strict `merchant_id` tenant isolation on every query; input validation; secrets in Workers secrets.
- **Observability:** Workers logs + Sentry + basic alerts + health checks; structured request logging with merchant/program ids.

## 12. Phasing (3 months, 2–3 eng AI-assisted)

- **Month 1 — Spine + config:** CF app (Workers/D1/DO/KV/Queues), multi-tenant + API keys + dashboard auth, dashboard-on-real-backend (all 4 types config + variables/conditions storage), Stripe billing, docs skeleton. **Milestone:** configure a program in the dashboard → persists; authed API responds.
- **Month 2 — The runtime (crux):** `evaluate` + `redemptions` + `events` + `customers` + wallet; condition-engine eval; all 4 types producing real effects; DO atomic caps + idempotency. **Milestone:** via API — cart evaluates → discount returned → redeem decrements budget → event accrues loyalty → referral credits the referrer.
- **Month 3 — Reference integration + hardening:** sample storefront full loop; affiliate CSV; referral priority; analytics-lite; reliability pass (retries, rate limits, idempotency/race edge cases, tenant isolation), observability, complete API docs. **Milestone:** build-complete; E2E proven; ready for real integrations next phase.

## 13. Risks & mitigations

- **Eval/redeem is checkout-critical** — correctness (double-spend, idempotency, cap races) is the hard part → DO single-writer + idempotency keys from day 1; test concurrency explicitly.
- **Condition-engine scope creep** → cap MVP conditions to what the demo's builder already models; don't expand the expression language.
- **"Prod-ready" ambiguity** → this phase = build-complete + reference E2E + reliability pass; real-traffic hardening is next phase (set expectation).
- **D1 10 GB/DB** → single DB now; per-merchant sharding or Postgres-via-Hyperdrive later (accepted).
- **Timeline is tight** for a from-scratch runtime → the demo's UI + tested pure-logic libs are a genuine head start; protect Month 2 (the runtime) from scope additions.

## 14. Success criteria (definition of done, build phase)

1. A merchant can sign in, create + configure all four program types, and manage API keys.
2. The reference storefront runs the full loop against the live API: evaluate → discount + message → redeem (caps enforced) → event → loyalty/referral wallet credit.
3. Budget/usage caps hold under concurrent redemptions (no double-spend).
4. Idempotent redemptions/events (safe retries).
5. Billing gates access; observability + API docs in place.
6. `npm run build` + full test suite green; reliability pass complete.

## 15. Open questions
None blocking. (Tech stack, repo layout, and dashboard auth are pinned in §3.1 — verified against current Cloudflare guidance 2026-07-03; flat billing plan tiers can be finalized during build.)
