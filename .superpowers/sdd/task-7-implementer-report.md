# Task 7 Implementer Report

## Scope

- Base: `9352ebfd46562aee1f9cac317a8bc8ff0a482f58`
- Branch: `feat/promo-selection-code-stacking`
- Added one typed, JSON structured `api_request_failed` event at the centralized
  public API error boundary.
- Restricted event fields to canonical route/method/code/status/retryability,
  correlation ID, authenticated merchant/credential IDs, and a typed dependency
  category.
- Rejected unsafe or oversized caller-supplied correlation IDs before they can
  reach responses, snapshots, coordinator input, or logs.
- Preserved one correlation ID across the response header, response error body,
  evaluation snapshot, redemption coordinator input, and failure event.
- Classified only known dependency boundaries as `d1`, `decision_integrity`, or
  `atomic_redemption`; unknown and mixed failures omit the dependency field.
- Did not log arbitrary errors, causes, stacks, authorization material, tokens,
  promo codes, customer references/attributes, or request bodies.
- Did not perform Cloudflare writes, deployments, migrations, or secret changes.

The evaluation and redemption routes already passed
`context.get('correlationId')` into their services, so no route-file change was
needed. Task 7 instead closed the missing error-log propagation and added typed
dependency attribution at the service boundaries that know the failure source.

## TDD RED evidence

The first approved run after adding the structured-log assertions reached
Vitest and failed for the expected missing behavior:

```text
pnpm --filter @incentives/api test -- app.test.ts evaluate.test.ts redemptions.test.ts
3 failed, 433 passed
```

All three failures expected one `console.error` event and received none.

Review then required strict inbound correlation validation and evidence-based
dependency categories rather than inferring every evaluation `503` as D1. The
new regression run failed exactly at those boundaries:

```text
pnpm --filter @incentives/api test -- app.test.ts evaluate.test.ts redemptions.test.ts
8 failed, 430 passed
```

Those failures covered:

- replacement of a correlation ID containing unsafe characters;
- replacement of an oversized correlation ID;
- `decision_integrity` for missing and weak decision-signing secrets;
- omission of dependency attribution for four invalid evaluation-TTL cases;
  and
- `decision_integrity` for invalid redemption signing configuration.

An intermediate run after dependency typing had three existing service-level
failures (`435 passed, 3 failed`) because a D1 wrapper changed the historically
asserted service error message/cause. A typed `EvaluationPipelineError`
preserved that service contract while exposing only the safe dependency
category to the centralized logger.

## GREEN evidence

Fresh final focused verification after the last code change:

```text
pnpm --filter @incentives/api test -- app.test.ts evaluate.test.ts redemptions.test.ts
14 test files passed; 438 tests passed
```

The coverage proves:

- exactly one canonical request-failure event at the public error boundary;
- response header/body/log correlation identity;
- evaluation snapshot and redemption bundle correlation propagation;
- strict safe-character and length validation for inbound correlation IDs;
- allowlisted structured fields only;
- exclusion of authorization material, token suffixes, promo codes, customer
  references/attributes, cart/context bodies, idempotency/order identifiers,
  and private dependency messages;
- `d1` attribution for a known repository failure;
- `decision_integrity` attribution for signing configuration/integrity failures;
- `atomic_redemption` attribution for coordinator failure; and
- no guessed dependency field for invalid TTL or unknown/mixed failures.

## Build and static checks

The first build exposed a TypeScript-only subclass declaration mismatch:

```text
pnpm --filter @incentives/api build
FAIL: RedemptionUnavailableError dependency optionality did not match ApiFailure
```

After correcting the declaration, the focused suite was rerun and the final
build completed successfully:

```text
pnpm --filter @incentives/api build
PASS
```

```text
git diff --check
PASS
```

## Changed files

- `apps/api/src/app.ts`
- `apps/api/src/errors.ts`
- `apps/api/src/observability.ts`
- `apps/api/src/services/evaluation-service.ts`
- `apps/api/src/services/redemption-service.ts`
- `apps/api/test/app.test.ts`
- `apps/api/test/evaluate.test.ts`
- `apps/api/test/redemptions.test.ts`
- `.superpowers/sdd/task-7-implementer-report.md`

## Commit

- Implementation:
  `665e986b9a866dc986e54fc9a723713bbc5f4b27`
  (`fix(api): correlate and sanitize runtime failure logs`)

## Concerns and intentional boundaries

- `countCommittedForCustomerProgram` currently combines D1 access with
  historical decision-integrity verification. Until that port returns a typed
  end-to-end failure, Task 7 intentionally omits `dependency` for failures from
  this mixed operation rather than falsely labeling them `d1`.
- Pre-existing reservation-cleanup diagnostics are separate internal failure
  events required by Task 5. The new canonical `api_request_failed` event is
  emitted exactly once at the public API boundary and never receives arbitrary
  error objects.
- `.pnpm-store/` and `CLAUDE.md` remain untouched and untracked.

## Review follow-up: repository dependency boundary

Review found that the initial evaluation-service wrapper labeled every failure
from a repository method as `d1`, including persisted-data parsing and injected
application failures. The follow-up moves attribution to the concrete D1
adapter boundary:

- `RepositoryDependencyError` is a provider-neutral typed repository error
  carrying only the safe dependency category and its internal cause.
- The D1 adapter wraps only awaited D1/Drizzle query and insert driver calls for
  published-schema lookup, customer lookup, active-program listing,
  published-code lookup, and decision creation.
- Request parsing, stored-row decoding, program/schema/customer validation,
  decision validation, and canonicalization remain outside the driver wrapper.
- The evaluation service preserves a typed repository dependency failure as
  `d1`; all other evaluation application failures remain dependency-unknown and
  therefore omit the field from the public failure event.
- The logger projects its input into the exact `ApiFailureLog` shape before
  serialization, so runtime-only extra properties cannot leak.

Strict RED evidence for the review follow-up:

```text
pnpm --filter @incentives/api exec vitest run test/app.test.ts test/evaluate.test.ts test/redemptions.test.ts test/repositories.test.ts
4 test files; 200 tests; 196 passed, 4 failed
```

The four failures proved the missing boundaries: runtime extra-field leakage,
false `d1` attribution for an injected application failure, false `d1`
attribution for corrupt persisted program data, and missing typed attribution
for an actual D1 insert failure.

Fresh GREEN verification after the boundary correction:

```text
pnpm --filter @incentives/api exec vitest run test/app.test.ts test/evaluate.test.ts test/redemptions.test.ts test/repositories.test.ts
4 test files passed; 200 tests passed
```

```text
pnpm --filter @incentives/api exec vitest run
14 test files passed; 442 tests passed
```

```text
pnpm --filter @incentives/api build
PASS
```

```text
pnpm --filter @incentives/api lint
PASS
```

```text
git diff --check
PASS
```

Additional review-follow-up files:

- `apps/api/src/repositories/types.ts`
- `apps/api/src/repositories/d1-repositories.ts`
- `apps/api/test/repositories.test.ts`
