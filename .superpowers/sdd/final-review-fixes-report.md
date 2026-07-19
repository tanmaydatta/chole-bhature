# Conditional Reward Rules — Final Review Fixes Report

**Reviewed head:** `964803a`

**Findings contract:** `.superpowers/sdd/final-review-findings.md`

**Scope:** Four Important findings only; no push, Notion mutation, UI implementation,
future runtime expansion, D1 migration, or legacy reader.

## Outcome and finding map

### 1. Authenticated committed redemption receipt

**Root cause.** The signed evaluation authenticated the set of decisions, but the bare
public `RedemptionResponse` stored in `result_json` was unsigned. Retry and history
logic used its `programRef` to choose a qualified decision. Two programs with the same
rule ID, effect, currency, and projected cost could therefore be interchanged by
editing only `result_json.programRef`. Historical counting authenticated the decision
HMAC but did not authenticate the redemption row's currency or projected discount.

**Fix.** `result_json` now stores a strict repository-internal envelope:

```json
{
  "version": 1,
  "result": { "public": "RedemptionResponse remains unchanged" },
  "receiptIntegrityHash": "64 lowercase HMAC-SHA256 hex characters"
}
```

There is deliberately no bare-response/legacy branch. The receipt HMAC uses the
service-owned `DECISION_SIGNING_SECRET`, a `redemption_receipt_v1` domain separator,
and canonical JSON. Its payload binds:

- merchant ID;
- redemption, evaluation, program, and selected reward-rule references;
- selected effects;
- external-order and idempotency identifiers;
- projected discount minor units and currency;
- committed status and creation time.

The repository's internal `RedemptionCreate` carries `receiptIntegrityHash`.
`RedemptionReceiptIntegrityVerifier` is required by both direct identifier lookups,
and `RedemptionIntegrityVerifiers` supplies both receipt and decision verification to
historical counting. Thus retries authenticate the receipt before selecting a signed
decision, while counting authenticates every candidate receipt and its evaluation
snapshot before matching or excluding it. The service still performs its existing
decision/effect/currency/projected-cost comparisons after verification.

Atomic commit remains a two-statement D1 batch. Its per-customer SQL guard now reads
`$.result.programRef` from the envelope; the verified pre-count and the SQL count keep
the existing race-safe cap behavior. There are no column or table changes.

Regression coverage includes:

- cross-program reassignment between two identical qualified Promos;
- receipt effect and reward-rule tampering;
- historical stored-currency corruption;
- historical stored-discount corruption;
- schema-valid receipt-signature corruption;
- direct retry decision-HMAC and relational corruption;
- public response stability plus strict internal-envelope shape.

### 2. Reference protection for every persisted program status

**Root cause.** Four schema mutation CAS subqueries and
`listReferencedVariableKeys()` filtered programs to `draft` and `active`, even though
`scheduled`, `paused`, and `ended` rows remain canonical stored configuration.

**Fix.** Removed status filtering from all four SQL reference guards and from the
repository scan. Tenant filtering remains unchanged. Service and direct repository
tests now use a variable referenced only by a reward-rule condition and cover `draft`,
`scheduled`, `active`, `paused`, and `ended`. Metadata-only edits and schema lifecycle
selection remain unchanged.

### 3. Stable no-match runtime message

**Root cause.** HTTP decision stabilization applied the generic not-qualified fallback
when the Promo module emitted `NO_REWARD_RULE_MATCHED` without a message.

**Fix.** A not-qualified decision containing `NO_REWARD_RULE_MATCHED` now receives the
exact stable message `No reward rule matched.`. The existing condition-specific global
eligibility message remains authoritative for eligibility failures. The HTTP test now
asserts the exact reason/message pair; the canonical fixture and runtime API example
already contained the required text and remain aligned.

### 4. Truthful design delivery scope

Reworded the Operator UI section as an amended follow-on delivery. Removed the shared
reward-rule editor and Promo Operator UI integration from Included scope and added it
to Deferred/follow-on scope with the existing Operator UI plan link. Runtime status
remains “implemented and locally verified; Operator UI deferred.”

## TDD evidence

### Baseline

Command:

```text
pnpm --filter @incentives/api test -- redemptions.test.ts repositories.test.ts schemas.test.ts evaluate.test.ts
```

Result before new tests: exit `0`; `8` files passed, `300` tests passed.

### RED

The same command after tests and before production edits exited `1`:

```text
Test Files  4 failed | 4 passed (8)
Tests       16 failed | 301 passed (317)
```

Exact production-gap failures were:

- stored envelope expected but bare public result found: 3 parameterized failures;
- identical-Promo reassignment expected `503`, received `200`;
- historical stored currency and projected discount expected `503`, received `200`;
- reward-rule-only references absent for scheduled/paused/ended: 3 repository failures;
- schema API rename/delete allowed scheduled/paused/ended: 3 failures;
- repository CAS rename/delete allowed scheduled/paused/ended: 3 failures;
- no-match expected `No reward rule matched.`, received the generic eligibility text.

The receipt-signature corruption test was also introduced in the RED wave; envelope
absence was already proven by the three storage assertions. Its final mutation uses a
schema-valid 64-hex replacement so GREEN exercises HMAC verification, not parsing.

### GREEN

Focused command after implementation: exit `0`:

```text
Test Files  8 passed (8)
Tests       317 passed (317)
```

The final full API command repeated the same result: `8/8` files and `317/317` tests.

## Files changed

- `apps/api/src/services/redemption-receipt.ts` — canonical receipt payload and
  HMAC sign/verify.
- `apps/api/src/services/redemption-service.ts` — verifier construction, retry
  authentication, signed commit construction.
- `apps/api/src/services/evaluation-service.ts` — authenticated history verifier pair
  and stable no-match message.
- `apps/api/src/repositories/types.ts` — signed receipt record and verifier interfaces.
- `apps/api/src/repositories/d1-repositories.ts` — strict envelope serialization,
  verified reads/history, envelope JSON path, all-status reference scans/CAS guards.
- `apps/api/test/redemptions.test.ts` — envelope, exploit, row/signature corruption.
- `apps/api/test/repositories.test.ts` — signed fixtures, verifier-path and all-status
  reference coverage.
- `apps/api/test/schemas.test.ts` — service/repository mutation protection for all five
  statuses using reward-rule-only references.
- `apps/api/test/evaluate.test.ts` — exact no-match message and signed history fixtures.
- `docs/superpowers/specs/2026-07-19-conditional-reward-rules-design.md` — corrected
  UI delivery scope.

## Verification matrix

All commands ran from the designated integration worktree.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0; lockfile already up to date |
| focused API RED | exit 1; 16 expected failures, 301 pass |
| focused API GREEN | exit 0; 317 pass |
| `pnpm --filter @incentives/api test` | exit 0; 317 pass |
| `pnpm --filter @incentives/api test:full-flow` | exit 0; 2 pass |
| `pnpm --filter @incentives/api build` | exit 0 |
| `pnpm --filter @incentives/api lint` | exit 0 |
| `pnpm --filter @incentives/contracts test` | exit 0; 86 pass |
| `pnpm --filter @incentives/contracts build` | exit 0 |
| `pnpm --filter @incentives/contracts lint` | exit 0 |
| `pnpm --filter @incentives/api db:check` | exit 0; `Everything's fine` |
| `pnpm test` | exit 0; 714 total workspace tests pass |
| `pnpm build` | exit 0 |
| `pnpm lint` | exit 0; two pre-existing dashboard Fast Refresh warnings only |
| `git diff --check` | exit 0, no output |

`pnpm install --frozen-lockfile` emitted a non-fatal pnpm metadata-fetch warning after
reporting the workspace already up to date; the command exited `0` and did not change
the lockfile.

## Audits

- `git diff --exit-code -- apps/api/migrations apps/api/src/db/schema.ts`: exit `0`,
  proving no migration or table metadata diff.
- Stale Promo reward-read audit found only nested `rewardRules[].reward` /
  `fallbackReward.reward` uses and documentation examples; no production top-level
  Promo reward read or compatibility alias exists.
- Repository audit finds no remaining `referenced_program.status` or
  `inArray(programs.status, ...)` restriction.
- `result_json` program extraction now occurs only at `$.result.programRef` in the
  atomic cap guard; readers require the strict v1 envelope.
- No live route was widened and no Affiliate, Referral, or Loyalty runtime was added.
- No UI code, push, or Notion write was performed.

## Self-review

- Receipt authentication happens before retry matching and before historical
  inclusion/exclusion.
- The signed payload covers every field named in the finding and uses a domain
  separator; relational/public identifier equality is still checked during parsing.
- The signed evaluation is still independently authenticated and matched exactly by
  program, selected rule, and canonical effects.
- Corruption continues through the existing generic retryable `503
  EVALUATION_UNAVAILABLE` boundary; request/version conflicts retain `409` behavior.
- Public `RedemptionResponse` and D1 columns are unchanged.
- The atomic counter/ledger batch and current program/cap/budget comparisons are
  unchanged apart from the envelope JSON path.
- Program reference protection is merchant-scoped and status-independent without
  altering draft-versus-published schema selection.
- No-match stabilization is reason-specific and does not replace global eligibility
  messages.
- Documentation now matches the implemented runtime/deferred UI boundary.

## Concerns

No blocking concern. Expected environmental noise is limited to the non-fatal pnpm
metadata-fetch warning and the two known dashboard Fast Refresh lint warnings noted
above.
