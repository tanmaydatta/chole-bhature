# Phase 0 · Client Demo — Design Spec

**Date:** 2026-07-06
**Status:** Approved design → ready for tickets
**Relationship:** Phase 0 is a thin, single-engineer slice of the MVP (`docs/superpowers/specs/2026-07-01-incentives-engine-mvp-design.md`), which this spec treats as **Phase 1**. Phase 0 ships one promo campaign end-to-end on the real backend; Phase 1 builds on top without rework.
**Builds on:** the validated demo in `demo/` (dashboard UI + the pure logic in `demo/src/lib/{conditions,interpolate,rewards,types}.ts`).

---

## 1. Purpose & the three capabilities

Goal: one promo campaign working end-to-end on the **real backend**, showable to a single client, built by **one engineer**.

| # | Capability | Surface | Endpoint(s) |
|---|---|---|---|
| 1 | Client's **user** sees a list of promos | Reference storefront "Current offers" page | `GET /v1/promos` |
| 2 | Client's **user** enters a code at checkout → gets the discount | Storefront checkout | `POST /v1/evaluate` (price it) → `POST /v1/redemptions` (commit it) |
| 3 | **Client** does CRUD on promos | Dashboard promo screens | `/v1/programs` (POST/GET/PATCH/DELETE) |

## 2. Design principle

Phase 0 is a **real backend that Phase 1 keeps building on** — not a throwaway demo. Extensibility comes from **stable API contracts and the monorepo layout**, not from building the hot-path early. Every endpoint ships with its Phase 1 request/response shape; Phase 1 swaps internals (Durable Objects, KV, real auth, more program types) behind those contracts with zero change to the storefront or dashboard.

## 3. Architecture (the real slice)

- pnpm monorepo, identical to Phase 1 layout: `apps/api` (Hono on Workers), `apps/dashboard` (the current `demo/`, ported), `apps/reference-store` (new storefront), `packages/engine` (the demo's pure logic + zod).
- `packages/engine` is lifted from `demo/src/lib` and is **100% reused by Phase 1** — Phase 0 completes it outright.
- Database: **D1 + Drizzle**. No Durable Objects, no KV, no Queues in Phase 0.
- Deploy: **ONE Workers env + ONE D1**, `wrangler deploy` → a real URL to show the client. No dev/staging/prod matrix, no CI (those are Phase 1's INFRA-2/3).
- Single hardcoded merchant, no login/multi-tenancy — but every table carries `merchant_id`, and the API has a "current merchant" resolver that Phase 1 replaces with real auth.

## 4. API access gate (single-merchant lockdown)

A Hono middleware validates a **static token** on every request and resolves it to the single merchant; no valid token → 401. Two token kinds mirror Phase 1's publishable/secret split:

| Token | Storage | Guards | Used by |
|---|---|---|---|
| Secret token | Workers secret | Writes — program CRUD + `POST /v1/redemptions` | Dashboard + server calls |
| Publishable token | Workers secret | Reads — `GET /v1/promos` + `POST /v1/evaluate` | Storefront in the browser |

**Honest limitation:** the publishable token, and in this demo the dashboard's secret token, ship in client bundles — so this is an access gate, not a hardened secrecy boundary. Phase 1's hashed/rotatable D1-backed API keys + dashboard session login (BE-2/BE-4/BE-5) replace it via the same middleware seam and the same publishable/secret split → drop-in.

## 5. Data model + contracts (the stable interfaces)

- D1 tables in Phase 0: `programs` (id, `merchant_id`, `type='promo'`, status, name, JSON config, plus counter columns `budget_remaining` and `usage_count`, and cap columns `max_uses`/budget) and `redemptions` (append-only ledger) with a unique constraint on `(merchant_id, order_id)` for idempotency. Plus one seeded `merchants` row. JSON config shape validated by the engine's zod schema — identical to Phase 1.
- `GET /v1/promos` → publicly-listable active promos (name, description, reward summary, whether a code is required), gated by a `listed` flag on the promo so secret-code promos don't leak.
- `POST /v1/evaluate` → inputs `{ customerRef?, cartContext, code? }` → applicable promo discount + interpolated message (reuses `renderMessage`). Read-only.
- `POST /v1/redemptions` → inputs `{ orderId, programId or code, amounts }` → idempotent by `orderId`, writes the ledger. Same contract Phase 1 hardens with the DO.

## 6. Atomic caps without a Durable Object

D1 is SQLite; DB writes are serialized, so a single conditional `UPDATE` is atomic and cannot oversell under concurrency.

```sql
UPDATE programs
   SET usage_count = usage_count + 1
 WHERE id = ?1 AND merchant_id = ?2
   AND (budget_remaining IS NULL OR budget_remaining >= ?3)   -- discount amount
   AND (max_uses        IS NULL OR usage_count < max_uses)
```

If `rowsAffected == 0` → promo exhausted → reject (checkout re-prices). Idempotency is D1-native: unique `(merchant_id, order_id)` on `redemptions`; the counter `UPDATE` + ledger `INSERT` run in one Drizzle `batch()` so they commit together.

`ProgramCountersDO` (Phase 1 / BE-8) stays deferred — it is the **SCALE upgrade** (edge-fast counters, the flash-sale "first 500 of 50k concurrent" scenario, ~1k+ ops/sec), **not** the correctness mechanism. Because `/v1/redemptions` keeps the same contract, Phase 1 swaps the D1 conditional-update internals for the DO with zero change to storefront/dashboard.

## 7. Explicitly deferred to Phase 1

Dashboard auth, API keys, real multi-tenancy, Stripe billing; Durable Objects, KV, Queues, atomic caps at scale; wallet, events; affiliate / referral / loyalty program types; observability, CI matrix, analytics.

## 8. The 8 M0 tickets (new milestone `M0 · Client Demo`, sequenced before M1)

| Ticket | Scope (thin slice) | Seeds Phase 1 | Est (days) |
|---|---|---|---|
| P0-1 | Monorepo scaffold + one Workers/D1 env + `wrangler deploy` | INFRA-1, INFRA-2 | 4 |
| P0-2 | D1 schema: `programs` (+ counter/cap columns) + `redemptions` (unique order_id) + seed merchant | BE-1 | 2 |
| P0-3 | `packages/engine` port (completes it) | BE-3 | 3 |
| P0-4 | Hono API skeleton + static-token gate (publishable/secret), single-tenant | BE-2 | 3 |
| P0-5 | Promo CRUD API + `GET /v1/promos` list (listed flag) | BE-6 | 3 |
| P0-6 | `POST /v1/evaluate` + `POST /v1/redemptions` (D1 ledger + atomic conditional-update caps + idempotency), promo-only | BE-10, BE-11 | 5 |
| P0-7 | Dashboard: `api-client` (token auth, no login) + promo CRUD screens on real API | FE-1, FE-2 | 5 |
| P0-8 | Reference storefront: offers list + checkout code entry + redeem | FE-6 | 4 |

Total ≈ 29 dev-days; one engineer → strictly sequential, ~5–6 weeks wall-clock. Build/dependency order: P0-1 → P0-2 → P0-3 → P0-4 → P0-5 → P0-6 → P0-7 → P0-8.

## 9. How this reshapes the board (plan, not yet executed here)

- Add a new milestone option `M0 · Client Demo`, ordered before `M1 · Foundation`.
- Create the 8 `P0-*` tickets in the Notion board + local `docs/tickets/P0-*.md` mirror, with estimates, dependencies, and `Order` values preceding M1.
- The existing 34 tickets are reframed as **Phase 1**; the ~7 tickets seeded by Phase 0 (INFRA-1/2, BE-1/2/3/6/10/11, FE-1/2/6) get a one-line scope note ("core delivered in Phase 0; remaining scope = …"). BE-3 (engine port) is effectively completed by P0-3.

## 10. Success criteria (definition of done, Phase 0)

1. Client opens the deployed dashboard and creates/edits/views/deletes a promo against the live API.
2. The storefront lists currently-listed promos via `GET /v1/promos`.
3. A shopper enters a code at checkout, `evaluate` returns the discount + message, `redemptions` commits it idempotently and the ledger records it.
4. A capped promo correctly rejects once exhausted (atomic conditional update), and checkout re-prices.
5. The API rejects any request lacking a valid token.
6. `pnpm -r build` + tests green; deployed to a shareable URL.

## 11. Acceptance in plain language (for non-technical sign-off)

This restates the technical checklist in §10 as things you can watch happen in a live demo — no jargon. If you can see each of these in front of the client, Phase 0 is done and ready to approve.

- [ ] **1. You create an offer.** In the dashboard (a normal web page), you create a promo — e.g. *"SUMMER15 — 15% off orders over $50"* — then edit it and delete a test one. Your changes are saved on a real server, so they are still there after a refresh.
- [ ] **2. A shopper sees your public offers.** On the demo storefront, a customer sees the list of current offers you chose to make public. Offers meant to be secret (code-only) do **not** appear in that list.
- [ ] **3. A shopper uses a code and sees the discount.** At checkout the customer enters the code, and the right discount and message appear (e.g. *"You saved $9"* or *"Add $12 more to qualify"*).
- [ ] **4. The discount is applied once, for real.** When the order is placed, the discount is committed and recorded a single time — even if the browser stutters and retries, it is never double-counted.
- [ ] **5. A limited offer runs out safely.** If you cap an offer (e.g. *"first 100 orders"*), once it is used up the next shopper is told it is no longer available and the price returns to normal — the system never gives away more than the limit.
- [ ] **6. Only you can manage it.** Access is locked with a key tied to your account. Someone on the internet without that key cannot read or change your offers.
- [ ] **7. It is on a real, shareable link.** Everything above runs at a real web address you can open live in front of the client — not just on a developer's laptop.

**Not included yet (coming in Phase 1):** signing in with a username/password, billing/payments, the affiliate / referral / loyalty offer types, and hardening for very high traffic. Phase 0 deliberately keeps these out so the one promo flow can be shown quickly — but nothing here is throwaway: Phase 1 builds directly on it.
