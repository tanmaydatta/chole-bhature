# BE-8 · ProgramCountersDO

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §3.2 (high-contention/flash-sale design) and §5 (DO list). Depends on BE-6 (compiled program config).

## Scope
- `ProgramCountersDO` class (per program, namespaced `program:{merchantId}:{programId}`): `budgetRemaining`, `redemptionsTotal`, per-customer use counts, on the DO's native SQLite storage.
- Atomic decrement-with-cap-check RPC — the DO's single-threaded execution serializes all writes, so decrement #500 succeeds and #501 is atomically rejected.
- On the counter hitting zero, publish an `exhausted` flag to `CONFIG_KV` (key `exhausted:{merchantId}:{programId}`) so Workers can fail-fast without hitting the DO (Spec §3.2) — the gate only ever *rejects* early, never accepts, so the DO stays authoritative.
- A reset/re-arm RPC for cron-driven budget resets (used by BE-16).

## Acceptance criteria
- [ ] Concurrent decrements against a cap of 500 never allow a 501st success.
- [ ] Hitting the cap sets the `CONFIG_KV` `exhausted` flag; a subsequent check of that key short-circuits without a DO round-trip.
- [ ] The reset RPC clears both the DO counters and the KV exhausted flag.
- [ ] A per-customer use-count cap (where configured) is enforced alongside the program-wide budget.
- [ ] A vitest-pool-workers test using `runInDurableObject` proves no oversell under concurrent calls; tests green.

## Technical notes
- DOs are the single writer for counters (binding decision) — no other code path may decrement budget outside this DO.
- Binding name `PROGRAM_COUNTERS_DO` (INFRA-2); DO id derived from `program:{merchantId}:{programId}`.
- A single DO sustains roughly ~1k simple ops/sec (Spec §3.2) — the KV exhausted gate, not DO throughput, is what protects against 50k-shopper stampedes.

## Interfaces
**Consumes:** BE-6 program config (cap/budget fields) to initialize a counter's starting state; INFRA-2 `PROGRAM_COUNTERS_DO` binding + `CONFIG_KV`.
**Produces:** the `ProgramCountersDO` decrement/cap-check RPC and the `exhausted:{merchantId}:{programId}` KV flag contract — consumed by BE-10 (fast-path rejection read), BE-11 (authoritative decrement on redemption), BE-16 (reset RPC), QA-1/QA-3 (concurrency/load targets).

## Out of scope
- Reserve-then-commit / sharded-counter scale-up paths (named-but-deferred post-MVP, Spec §3.2).
- Wallet balances (BE-9, a separate DO).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
