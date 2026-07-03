# QA-1 · Concurrency & idempotency suite

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §3.1 (vitest-pool-workers), §13 (eval/redeem correctness is the hard part), §3.2 (flash-sale scenario). Depends on BE-8, BE-9, BE-11.

## Scope
- vitest-pool-workers concurrency suite covering: cap races (no oversell at #500/#501, per the reference scenario), wallet double-spend, retry storms (idempotency under repeated calls), flash-sale burst behavior (exhausted gate) — using isolated per-test storage / DO-eviction helpers.

## Acceptance criteria
- [ ] A test drives concurrent redemptions at a 500-cap program and asserts exactly 500 succeed, #501+ rejected.
- [ ] A test drives concurrent wallet credit/debit calls and asserts no lost updates / no double-spend.
- [ ] A test replays the same order id / event id many times concurrently and asserts single application (idempotency under retry storms).
- [ ] A test simulates the KV exhausted-gate fast path and asserts it never accepts once set (reject-only gate).
- [ ] Each test runs against isolated per-test storage (no cross-test DO state leakage); suite green (`pnpm test`).

## Technical notes
- Uses `runInDurableObject` / DO-eviction helpers from `@cloudflare/vitest-pool-workers` (Spec §3.1) — the official Workers testing integration, not ad hoc mocking of DO behavior.
- This suite becomes the correctness baseline QA-3 (load test) and BE-18 (reliability pass) build on.

## Interfaces
**Consumes:** BE-8 `ProgramCountersDO`; BE-9 `CustomerWalletDO`; BE-11 `/v1/redemptions`.
**Produces:** the concurrency/idempotency regression suite — referenced by BE-18 (reliability pass) and QA-3 (load test) as the correctness baseline before scaling up.

## Out of scope
- Load/throughput testing at real scale (QA-3, on staging with k6).
- E2E across the full storefront (QA-2).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
