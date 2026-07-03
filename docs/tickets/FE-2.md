# FE-2 · Programs CRUD wired to real API

## Context
Spec §8 — reuse the demo's flows and condition builder, wire them to the real backend. Depends on FE-1 (client/auth) and BE-6 (programs API).

## Scope
- Programs list/detail/create/edit screens for all 4 types (`pages/{promo,affiliate,referral,loyalty}`, `pages/ProgramDetail.tsx`) call BE-6's `/v1/programs` via FE-1's `api-client` instead of the in-memory mock.
- Condition builder (`components/builder/ConditionBuilder.tsx`) posts/reads the `ConditionGroup` shape from `packages/engine` types, with unchanged UI/UX from the demo.

## Acceptance criteria
- [ ] All 4 program types can be created, edited, and viewed end-to-end against the real API (no mock-store fallback).
- [ ] The condition builder round-trips a `ConditionGroup` (incl. one level of nested groups) through create/edit without data loss.
- [ ] Existing demo component tests for these screens pass against the real client (network layer mocked, not the store).
- [ ] Tests green.

## Technical notes
- Reuses the demo's flows unchanged (Spec §8) — a data-layer swap, not a redesign.
- Program type-specific fields must match BE-6's JSON-config contract per type.

## Interfaces
**Consumes:** FE-1 `api-client` + auth guard; BE-6 `/v1/programs` CRUD + `/v1/variables`/`/v1/event-defs` (for the builder's variable list); BE-3 shared types (`Program`, `ConditionGroup`, `Reward`).
**Produces:** the real-data Programs screens — the wiring pattern FE-5/FE-7 follow for their own screens.

## Out of scope
- Dedicated Variables/Events screens (FE-3).
- Affiliate codes panel (FE-5) — FE-2 only covers affiliate *program* config, not code generation/CSV.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
