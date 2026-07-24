# Task 6 Implementer Report

## Scope

- Base: `3c73f80f6cddcda79edfa5738122c25fef1c122a`
- Branch: `feat/promo-selection-code-stacking`
- Added a provider-neutral `AtomicRedemptionCoordinator` port and a D1-backed adapter.
- Replaced singular redemption with strict selected-bundle redemption.
- Committed ordered child entries, counters, spend, guards, and idempotency state in one D1 batch.
- Preserved exact-retry convergence and stable terminal outcomes while rejecting key reuse,
  changed selection order, and changed request content.
- Bound every selected child to the signed evaluation snapshot, active revision, current lifecycle,
  currency, usage, per-customer cap, and budget authority.
- Kept provider-specific D1 and Cloudflare types out of the port and service.
- Did not modify Task 5 selection behavior or its stale public-output expectations.

## Architecture

`apps/api/src/redemption/atomic-redemption-coordinator.ts` is the provider-neutral boundary used by
the redemption service. It contains repository-domain request/result types and documents the
future durable prepare/release/authorize/finalize/recovery semantics without importing Cloudflare
or D1 APIs.

`apps/api/src/redemption/d1-atomic-redemption-coordinator.ts` owns D1 transaction mechanics:

- acquires a pending operation row keyed by merchant and idempotency key;
- classifies exact retries, terminal retries, external-order conflicts, and key-reuse conflicts;
- verifies the evaluation signature, expiry, unique selected decisions, snapshot identity, active
  revision, lifecycle, currency, counters, usage caps, per-customer caps, and budget;
- batches conditional counter/spend updates, change-count guards, legacy mirrors, the bundle
  header, ordered child entries, operation commit, and guard cleanup atomically;
- reconciles uncertain outcomes from the committed bundle before returning unavailable;
- persists deterministic domain failures as terminal operation outcomes; and
- returns public success only after the batch commits and the stored bundle can be signed.

The service parses only the Task 6 bundle shape, computes an order-sensitive SHA-256 request digest,
validates internal signing configuration separately from caller input, and maps coordinator results
to stable HTTP/API errors. Routes pass the correlation ID and request context supplies the concrete
D1 coordinator.

## TDD RED evidence

The exact package command first failed inside the sandbox because the test harness could not bind
its local loopback port or write Wrangler logs. The approved rerun reached Vitest and failed as
expected because the new D1 coordinator module did not exist and the old service still required
singular redemption input.

After adding the port and an intentionally non-functional D1 stub:

```text
pnpm --filter @incentives/api exec vitest run test/redemptions.test.ts
24 tests: 14 failed, 10 passed
```

The 14 failures were Task 6 behavior failures: the D1 adapter returned unavailable instead of
committing/retrying/conflicting and the untouched service still implemented singular redemption.

The first real implementation reduced the suite to two failures. Both key-reuse cases returned
`503` because operation acquisition checked for a missing twin lookup before classifying the
populated mismatching operation. Reordering that classification produced 24/24 passing tests.

Two full-flow cases then reported `EXHAUSTED` instead of `VERSION_CONFLICT`. Separating revision
identity validation from lifecycle availability made both targeted cases pass. A third flow used a
hand-written legacy header that bypassed the new entry authority; converting the fixture to the
normal publication path made that targeted case pass.

The final scope review added an invalid-signing-configuration regression:

```text
pnpm --filter @incentives/api exec vitest run test/redemptions.test.ts \
  -t "returns retryable unavailable when redemption signing configuration is invalid"
1 failed, 24 skipped
```

The service initially misclassified an internal Zod configuration error as caller input (`400`).
Moving strict request parsing outside the internal configuration/error boundary fixed the
classification.

## GREEN evidence

```text
pnpm --filter @incentives/api exec vitest run test/redemptions.test.ts
1 file passed; 24 tests passed
```

```text
pnpm --filter @incentives/api exec vitest run \
  test/redemptions.test.ts \
  test/repositories.test.ts \
  test/full-flow.test.ts
3 files passed; 91 tests passed
```

The final signing-configuration regression also passed after the classification fix:

```text
pnpm --filter @incentives/api exec vitest run test/redemptions.test.ts \
  -t "returns retryable unavailable when redemption signing configuration is invalid"
1 passed, 24 skipped
```

The focused coverage includes both a reference in-memory coordinator contract and the D1 adapter,
strict removal of `programRef`, empty selection, single and multi-child ordered commits, exact
retry, key/order/content conflicts, concurrent convergence, concurrent usage/budget/per-customer
enforcement, expired and tampered decisions, every-child validation, forced final-child rollback,
entry-trigger batch abort, terminal result mapping, migrated entry accounting, and receipt HMAC
failure after adding, removing, mutating, or reordering children.

## Exact package command and known unrelated failures

```text
pnpm --filter @incentives/api test -- \
  redemptions.test.ts repositories.test.ts full-flow.test.ts
14 files: 411 passed, 7 failed
```

The package script preserves the literal `--` and runs all API test files, so it also exercised
stale Task 5 assertions outside Task 6. All three requested Task 6 files passed. The seven
unchanged failures are:

- `apps/api/test/programs.test.ts`
  - `PATCH is a full canonical replacement that removes omitted optional fields`
- `apps/api/test/program-revisions.test.ts`
  - `enforces scheduled start/end boundaries as time advances without weakening pause`
  - `keeps natural end irreversible when a replacement revision is published later`
  - `rejects pause after the active revision has effectively ended`
  - `keeps prior natural end irreversible after pause and a longer replacement`
  - `pauses and resumes an active Promo, then makes end irreversible`
  - `does not let publishing a replacement silently resume a paused or ended Promo`

Those tests still expect unavailable automatic candidates in public evaluation output, which
conflicts with Task 5's private-selection requirement. They were deliberately not changed in this
Task 6 commit.

A final attempt to rerun the three focused files after the isolated configuration fix was denied
for elevated execution by policy; the sandbox retry again failed before Vitest with the same
loopback/Wrangler `EPERM`. No bypass was attempted. The evidence therefore consists of the earlier
91/91 focused run plus the final isolated 1/1 regression run.

## Build, lint, and static checks

Fresh checks after the final code change:

```text
pnpm --filter @incentives/api build
PASS

pnpm --filter @incentives/api lint
PASS

git diff --check
PASS
```

Provider-boundary and obsolete-API scans were also clean:

```text
rg "D1Database|DurableObject|Cloudflare|cloudflare:" \
  apps/api/src/redemption/atomic-redemption-coordinator.ts \
  apps/api/src/services/redemption-service.ts
no matches

rg "commitAtomically|AtomicRedemptionCommit" apps/api/src apps/api/test
no matches
```

## Changed files

- `apps/api/src/app.ts`
- `apps/api/src/env.ts`
- `apps/api/src/errors.ts`
- `apps/api/src/redemption/atomic-redemption-coordinator.ts`
- `apps/api/src/redemption/d1-atomic-redemption-coordinator.ts`
- `apps/api/src/repositories/d1-repositories.ts`
- `apps/api/src/repositories/types.ts`
- `apps/api/src/routes/redemptions.ts`
- `apps/api/src/services/redemption-service.ts`
- `apps/api/test/full-flow.test.ts`
- `apps/api/test/redemptions.test.ts`
- `apps/api/test/repositories.test.ts`
- `.superpowers/sdd/task-6-implementer-report.md`

The redemption suite was intentionally rewritten from the obsolete singular request contract to
the bundle contract and coordinator contract. Three repository tests for the removed
`commitAtomically` API were deleted; their transaction/idempotency behavior is covered against the
new D1 coordinator. Repository round-trip and migrated-legacy coverage remains.

## Commit

- Subject: `feat(api): commit selected promos as atomic bundles`
- Identity: this report is included in that implementation commit; its immutable SHA is recorded
  in the parent handoff because a commit cannot contain its own final SHA.

## Caveats

- Redeeming an evaluation after its selected program gets a different active revision returns
  `VERSION_CONFLICT`, even when the prior revision would now be lifecycle-inactive. Revision
  identity is intentionally checked before lifecycle availability.
- Unexpected or uncertain D1 failures remain pending/retryable and reconcile committed state before
  reporting unavailable; they are not converted into terminal business failures.
- No Cloudflare remote write or deployment was performed.
- `.pnpm-store/`, `CLAUDE.md`, and `.superpowers/sdd/progress.md` remain untouched.
