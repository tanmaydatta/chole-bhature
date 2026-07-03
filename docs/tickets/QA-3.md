# QA-3 · Load / flash-sale test

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §3.2 (flash-sale reference scenario: 50k concurrent shoppers). **Cut candidate if team = 2** (binding decision) — check before starting whether this ticket is still in scope. Depends on BE-8, BE-11, INFRA-2.

## Scope
- k6 load test on staging: a 50k-shopper burst against a capped promo, asserting exhausted-gate behavior and measuring DO latency.

## Acceptance criteria
- [ ] A k6 script simulates a 50k-shopper burst against a capped program on staging.
- [ ] Results confirm no oversell (cap holds) and the KV exhausted gate short-circuits the bulk of rejected requests without DO round-trips.
- [ ] DO latency/throughput characteristics are captured in a report.

## Technical notes
Scope-level for now; builds on QA-1's correctness baseline at load — if cut, QA-1's concurrency suite remains the only pre-ship evidence of cap correctness.

## Interfaces
**Consumes:** BE-8 `ProgramCountersDO` + exhausted gate; BE-11 `/v1/redemptions`; INFRA-2 staging environment.
**Produces:** the load-test report — informs BE-18's reliability pass and any post-MVP sharded-counter decision (Spec §3.2).

## Out of scope
- Production load testing (staging only).
- Implementing the post-MVP scale-up paths themselves (reserve-then-commit, sharded counters) — this ticket only measures against the MVP design.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
