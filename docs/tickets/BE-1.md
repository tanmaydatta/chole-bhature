# BE-1 · D1 schema + Drizzle + migrations

## Context
Spec §5 data model. This is the relational foundation every subsequent M1/M2 ticket reads or writes. Depends on INFRA-2's D1 binding.

## Scope
- Drizzle schema (`apps/api/src/db/schema.ts`) for every table in Spec §5: `merchants`, `api_keys`, `programs` (+ type-specific config JSON column), `variables`, `event_defs`, `codes`, `customers` (+ attributes), `redemptions`, `wallet_transactions`, `program_stats`. All merchant-scoped tables carry `merchant_id` (Spec §3 multi-tenancy rule).
- drizzle-kit migration generation wired to `wrangler d1 migrations apply` across the dev/staging/prod envs from INFRA-2.
- A per-request Drizzle instance factory and a documented `batch()` helper for multi-statement atomicity (D1 has no interactive transactions).

## Acceptance criteria
- [ ] Schema covers all 9 tables from Spec §5, each merchant-scoped table carrying `merchant_id`.
- [ ] `drizzle-kit generate` produces a migration; `wrangler d1 migrations apply --env dev` runs clean on a fresh D1 database.
- [ ] A `batch()` helper exists and is documented for any write needing atomicity across statements.
- [ ] A test suite (vitest-pool-workers against a local D1) round-trips insert/read for every table; tests green (`pnpm test`).

## Technical notes
- D1 has NO interactive transactions — use `batch()`; one Drizzle instance per request (binding decision — avoid module-level singletons that leak across isolates).
- `programs` holds common relational columns (id, merchant_id, type, status, name) plus a JSON config column for type-specific fields (Spec §7); the JSON shape is validated by BE-3's zod schemas, not by D1.
- `codes` serves both affiliate and referral programs (Spec §5: "codes (affiliate/referral)").
- `redemptions` and `wallet_transactions` are append-only ledgers (inserts only) — the DO layer (BE-8/BE-9) is the source of truth for live counters/balances; D1 is history.

## Interfaces
**Consumes:** INFRA-2 `DB` (D1) binding + wrangler migrations tooling.
**Produces:** the Drizzle schema/types for all 9 tables, the per-request `db` factory, and the `batch()` helper — consumed by BE-2 (`api_keys`), BE-4 (`merchants`), BE-6 (`programs`/`variables`/`event_defs`), BE-9 (`wallet_transactions`), BE-11 (`redemptions`), BE-13 (`customers`), BE-14 (`codes`), BE-17 (`program_stats`).

## Out of scope
- Any HTTP layer (BE-2).
- DO-side atomic counters/wallet balances (BE-8, BE-9) — D1 only holds the relational/ledger side.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
