# BE-6 · Program/variables/events CRUD APIs + KV cache
> **Phase 0 (M0):** Phase 0 (**P0-5**) delivers promo CRUD + `GET /v1/promos`. Remaining Phase 1 scope: variables + events CRUD, the other 3 program types, and the KV compiled-config cache + invalidation.

## Context
Spec §7 (four program types), §5 (`programs`/`variables`/`event_defs` tables), and §6 ("compiled to an evaluable form cached in KV"). Depends on BE-2 (Hono/auth) and BE-3 (engine types/schemas).

## Scope
- `/v1/programs` CRUD supporting all 4 types (promo/affiliate/referral/loyalty), type-specific config validated by BE-3's zod schemas, persisted into BE-1's `programs` table (JSON config column).
- `/v1/variables` CRUD (`variables` table) and `/v1/event-defs` CRUD (`event_defs` table).
- On any program/variable/event-def write, recompile the merchant's evaluable config into `CONFIG_KV["config:{merchantId}"]`, invalidating the previous entry — this KV blob is what `evaluate` (BE-10) reads instead of hitting D1.

## Acceptance criteria
- [ ] CRUD works for all 4 program types, with type-specific fields round-tripping through create/edit/get.
- [ ] Variables and event-defs CRUD persist and list correctly, scoped by `merchant_id`.
- [ ] A write updates `CONFIG_KV["config:{merchantId}"]` within the same request — stale KV is never served after a save completes.
- [ ] Only secret-key or session-authenticated requests can write (publishable-key writes rejected), enforced via BE-2's key-kind gating.
- [ ] Tests green covering CRUD + cache invalidation for each program type.

## Technical notes
- Program config splits into common relational columns (BE-1) plus a JSON blob for type-specific fields (Spec §7: promo caps, affiliate code settings, referral priority fields, loyalty accrual rules).
- `CONFIG_KV["config:{merchantId}"]` is a single JSON blob per merchant containing all active programs' evaluable condition groups + reward config — one key per merchant, not per program, for simple invalidation.
- Loyalty programs never stack (Spec §6 fixed rule) — validate this at write time so invalid config can't reach `evaluate`.

## Interfaces
**Consumes:** BE-2 Hono app + auth/key-kind gating; BE-3 zod schemas + types (`Program`, `ConditionGroup`, `Reward`, `EventDef`); BE-1 `programs`/`variables`/`event_defs` tables; INFRA-2 `CONFIG_KV` binding.
**Produces:** `/v1/programs`, `/v1/variables`, `/v1/event-defs` CRUD endpoints, and the `CONFIG_KV["config:{merchantId}"]` compiled-config contract — consumed by BE-8 (program cap/budget init), BE-10 (evaluate reads), BE-14 (affiliate program config), BE-15 (referral program config), FE-2/FE-3 (dashboard screens).

## Out of scope
- Runtime evaluation against the compiled config (BE-10).
- Code generation/storage for affiliate/referral (BE-14).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
