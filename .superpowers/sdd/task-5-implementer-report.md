# Task 5 Implementer Report

## Scope

- Base: `3a1e5894bb9f3da57909c9119450fc95d7b70337`
- Implemented private automatic and submitted-code-only evaluation.
- Reused one single-program helper for customer facts, historical counts, lifecycle availability,
  currency checks, usage/per-customer caps, projected cost, and budget exhaustion.
- Persisted and signed mode, ordered submitted codes and code diagnostics, normalized request
  digest, route correlation ID, customer/schema identity, request, facts, and ordered decisions.
- Added an opaque reservation prepare/cancel seam with a no-op default and conservative cleanup
  when a coded combination is rejected.
- Did not implement the Task 6 redemption service/coordinator.

## RED evidence

1. Main selection behavior:

   ```text
   pnpm --filter @incentives/api test -- evaluate.test.ts
   evaluate.test.ts: 38 failed
   API suite total: 102 failed, 338 passed
   ```

   The new automatic, coded, privacy, ordering, duplicate normalization, current/future claim,
   combination, and snapshot cases all returned `503` because the untouched service did not
   supply the Task 3 persistence fields and still used the removed inventory-wide conflict path.
   The package script ran all API files despite the filename argument; the additional failures
   were the pre-existing Task 6 sequencing failures and stale earlier-task expectations.

2. Reservation cleanup:

   ```text
   pnpm --filter @incentives/api exec vitest run test/evaluate.test.ts \
     -t "cancels every prepared reservation"
   1 failed, 64 skipped
   ```

   The rejected response was correct, but the cancellation spy received `[]` instead of both
   opaque handles.

## GREEN evidence

```text
pnpm --filter @incentives/api exec vitest run test/evaluate.test.ts
1 file passed; 65 tests passed
```

```text
pnpm --filter @incentives/api exec vitest run \
  test/evaluate.test.ts \
  test/evaluation-integrity.test.ts \
  test/repositories.test.ts
3 files passed; 127 tests passed
```

These runs cover the route correlation handoff, automatic short-circuit spy, tenant/effective
filtering, binary rank ties, normalized claim lookup, diagnostic/decision ordering, no inventory
leakage, combination rejection, snapshot HMAC identity, repository persistence invariants, and
cleanup continuation after a simulated cancellation failure.

## Build, lint, and flow

```text
pnpm --filter @incentives/api lint
PASS
```

```text
pnpm --filter @incentives/api build
FAIL
```

After the Task 5 type fixes, every remaining compiler error is in
`apps/api/src/services/redemption-service.ts`: the pending Task 6 service still reads singular
`programRef`/`effects` fields and does not yet construct bundle `entries`/`requestDigest`.

```text
pnpm --filter @incentives/api exec vitest run test/full-flow.test.ts
1 passed, 9 failed
```

All nine failures occur after successful evaluation, when the pending Task 6 route rejects the old
singular redemption request (including `programRef`) with HTTP `400`. The Task 5 selection
assertions in the flow were updated to one private automatic winner and an empty exhausted result.

```text
git diff --check
PASS
```

## Changed files

- `apps/api/src/services/evaluation-service.ts`
- `apps/api/src/routes/evaluate.ts`
- `apps/api/test/evaluate.test.ts`
- `apps/api/test/full-flow.test.ts`
- `.superpowers/sdd/task-5-implementer-report.md`

Task 3 already supplied the required repository record fields, D1 columns, parser invariants, and
`getPublishedByNormalizedCode` port/adapter, so Task 5 did not duplicate those changes.

## Commit

- This report and the scoped Task 5 changes are committed together as
  `feat(api): select private automatic and coded evaluations`.

## Review

- Read-only closure review: **READY / Approved**
- Findings: no Critical, Important, or Minor Task 5 issues.
- Reviewer independently confirmed 127/127 focused tests, green lint, clean diff check, and that
  the remaining full-flow/build failures are confined to Task 6.

## Concerns

- Task 6 must replace the stale singular redemption service before API build and full-flow can be
  green. This report intentionally does not claim those checks pass.
- The current D1 reservation path is intentionally a no-op. The hook prepares Task 5 orchestration
  and cleanup semantics without claiming a distributed reservation authority.
- `.pnpm-store/` and `CLAUDE.md` remain untouched and untracked.
