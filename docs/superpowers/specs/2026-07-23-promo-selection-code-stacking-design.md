# Promo Selection, Code Stacking, and Atomic Redemption — Design Spec

**Date:** 2026-07-23

**Status:** Approved; implementation plan ready

**Implementation plan:** [Repository](../plans/2026-07-24-promo-selection-code-stacking.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Implementation-Plan-3a7e5c7c2b8e811791dee0d21803c8e2)

**Notion mirror:** https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Design-Spec-3a6e5c7c2b8e81549b6adc7f3d096455

**Sequence:** Plan 3 behavior correction discovered during Gate C staging verification

**Builds on:**

- `docs/superpowers/specs/2026-07-18-integration-ready-incentives-core-design.md`
- `docs/superpowers/specs/2026-07-19-conditional-reward-rules-design.md`
- `docs/superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md`
- `docs/integration/core-contracts.md`
- `docs/integration/runtime-api.md`

## 1. Purpose

Gate C staging verification exposed three related product problems:

1. an evaluation without a code publicly returns decisions for every active
   Promo, including unrelated failures;
2. an evaluation with one code still evaluates and returns unrelated automatic
   and coded Promos; and
3. the current boolean `stackable` behavior can select several programs without
   defining a safe, atomic way to commit the resulting set.

The client-facing behavior should instead match the two ways a customer
encounters a promotion:

- **Automatic:** the platform selects one best eligible automatic Promo.
- **Coded:** the platform evaluates only the codes the customer submitted and
  may combine multiple explicitly stackable coded Promos.

This design makes the evaluation mode explicit from the request shape, keeps
unrelated program inventory private, removes ambiguous stacking configuration,
and commits a multi-Promo result as one all-or-nothing redemption bundle.

The change is intentionally a clean break before a client integration depends
on the current contract.

This selection policy governs Promo decisions. Future Affiliate, Referral, and
Loyalty triggers retain their own module contracts; adding them to the same
runtime envelope must not silently subject them to Promo winner selection.

## 2. Product decisions

The approved behavior is:

1. `POST /v1/evaluate` remains the single evaluation endpoint.
2. Omitting `codes`, or supplying an empty array, selects automatic mode.
3. A non-empty `codes` array selects coded mode and suppresses automatic Promos.
4. Automatic mode publicly returns at most one qualified Promo.
5. Configured integer priority is the only winner-ranking policy.
6. Immutable `programRef` ascending order is the deterministic tie-breaker.
7. Automatic Promos are never stackable.
8. Only coded Promos may be configured as stackable.
9. Multiple valid stackable codes may combine.
10. An invalid or ineligible code does not block other valid stackable codes.
11. If more than one code qualifies and any qualifying Promo is non-stackable,
    the entire qualified combination is rejected with no effects.
12. Selected coded effects are ordered by priority and then `programRef`, not
    by the order in which the customer typed the codes.
13. A redemption commits the complete selected evaluation or none of it.
14. Codes are trimmed and compared case-insensitively.
15. Codes are unique per client across published Promos whose effective
    schedules overlap.
16. Code reuse is allowed after the previous Promo has ended and cannot resume.
17. The request field `code` is replaced by `codes`.
18. At most ten distinct normalized codes may be evaluated at once.
19. Duplicate normalized codes are collapsed.
20. `stackingGroup` is removed.

No automatic “greatest monetary value” ranking is introduced. Comparing
percentages, fixed amounts, free shipping, future Loyalty awards, currencies,
and line-item scopes would require assumptions that are neither universal nor
merchant-controlled. Priority remains explicit and predictable.

## 3. Promo configuration contract

Promo configuration becomes a strict discriminated union.

### Automatic Promo

```ts
interface AutomaticPromoTrigger {
  autoApply: true;
  stackable: false;
}
```

An automatic Promo:

- has no code;
- cannot be stackable; and
- participates only in automatic evaluation.

### Coded Promo

```ts
interface CodedPromoTrigger {
  autoApply: false;
  code: string;
  stackable: boolean;
}
```

A coded Promo:

- requires one normalized non-empty code;
- participates only when that code is submitted; and
- exposes stacking as an explicit merchant choice.

The stored program contract no longer contains `stackingGroup`.

Server-side validation rejects every impossible combination, including:

- `autoApply: true` with a code;
- `autoApply: true` with `stackable: true`;
- `autoApply: false` without a code; and
- any retained `stackingGroup` field.

The UI is not the authority for these invariants.

## 4. Code normalization and uniqueness

### Normalization

For matching and uniqueness, Core:

1. removes leading and trailing Unicode whitespace;
2. converts the result with Unicode Default Case Conversion to uppercase,
   without locale-sensitive rules or compatibility/fuzzy normalization;
3. rejects the result unless it contains 1–128 Unicode code points; and
4. stores a normalized lookup value separately from the merchant-facing
   display value.

For example, `GATEC15`, `gatec15`, and ` GATEC15 ` identify the same code.
Normalization does not perform fuzzy matching or remove internal punctuation.

The exact conversion and length counting must be implemented in shared domain
code and pinned by contract fixtures, including non-ASCII and case-expanding
characters, so JavaScript, SQL, and any future adapter do not invent different
code identities.

### Uniqueness interval

One client cannot publish two coded Promos with the same normalized code when
their effective schedules overlap.

Published Promos that can still become effective reserve their interval,
including active, paused, and future scheduled Promos. An ended Promo releases
its claim because it cannot resume. Drafts may temporarily conflict so a
merchant can edit safely, but publication must fail with a precise conflict
that identifies the existing Promo.

The persistence adapter must claim the code interval atomically. A separate
“check then insert” sequence is not sufficient because two concurrent publish
requests could both pass the check. The first D1 adapter should use one
conditional write or transactional batch whose success depends on the absence
of an overlapping claim.

## 5. Evaluation request

The clean-break request contract is:

```json
{
  "codes": ["GATEC15", "VIP20"],
  "customerRef": "customer-1",
  "cart": {
    "currency": "GBP",
    "subtotal": 12500,
    "items": []
  },
  "context": {
    "channel": "web"
  }
}
```

Rules:

- `codes` is optional.
- Missing `codes` and `codes: []` are equivalent automatic requests.
- A non-empty array is a coded request.
- Normalization and deduplication occur before the ten-code limit is applied.
- More than ten distinct normalized codes returns `INVALID_REQUEST`.
- The singular `code` field is unknown and rejected.
- Existing schema validation for customer, cart, line-item, and context values
  remains unchanged.

The normalized evaluation snapshot records:

- evaluation mode;
- distinct submitted normalized codes in first-occurrence order;
- customer and schema versions;
- exact selected program revisions and reward rules;
- selected effects;
- decision expiry;
- request digest; and
- correlation ID.

The signed decision material covers all identity-bearing snapshot fields so a
caller cannot add, remove, or reorder selected effects before redemption.

## 6. Automatic evaluation

Automatic evaluation uses the following algorithm:

1. Load published Promos that are effective, automatic, and tenant-scoped.
2. Sort by descending configured priority.
3. Break equal priorities by ascending immutable `programRef` using the shared
   binary string comparator, not database-locale collation.
4. Evaluate candidates in that deterministic order.
5. Stop at the first qualified, available candidate.
6. Return its decision as the only public decision.
7. Return an empty `decisions` array when no candidate qualifies.

A higher-priority candidate that is ineligible, exhausted, unavailable, or has
no matching reward rule does not prevent a lower-priority candidate from
winning.

Public output never includes the rejected candidates. Their sanitized
evaluation traces remain available internally for debugging and audit.

Automatic responses do not contain `codeResults`.

## 7. Coded evaluation

Coded evaluation:

1. suppresses all automatic Promos;
2. resolves only the submitted distinct normalized codes;
3. evaluates the one published Promo claimed by each resolved code;
4. produces one `codeResults` entry per distinct code in first-occurrence input
   order; and
5. builds `decisions` only from the qualified combination the integration is
   allowed to apply.

An unresolved code returns `invalid_code` without revealing program inventory.
A resolved code may return the existing stable program outcomes, such as
`not_qualified`, `unavailable`, or `exhausted`.

### Combination rules

- Zero qualified codes produces no decisions.
- One qualified code produces one decision whether its Promo is stackable or
  non-stackable.
- Two or more qualified codes combine only when every qualified Promo is
  stackable.
- If any member of a multi-code qualified set is non-stackable, every qualified
  member receives `CODE_COMBINATION_NOT_ALLOWED` and `decisions` is empty.
- Invalid, ineligible, unavailable, and exhausted codes do not participate in
  the stacking check and do not block otherwise valid stackable codes.

After the combination check, selected decisions are sorted by descending
priority and then ascending `programRef` with the same shared binary string
comparator. This order is authoritative for effect presentation and the
redemption bundle. Customer input order affects only the diagnostic
`codeResults` ordering.

Availability checks that create an evaluation-time reservation, including the
free-shipping authority, happen before the final qualified set is returned. If
the final stacking check rejects that set, Core cancels every reservation it
created for the rejected combination. A failed cancellation may keep funds
conservatively locked until durable recovery completes, but the rejected
evaluation contains no applicable effects and cannot be redeemed.

## 8. Evaluation response

`decisions` is the authoritative list of effects an integration may apply.
`codeResults` explains only the codes the caller submitted.

Example coded response:

```json
{
  "evaluationId": "evaluation-123",
  "customerRef": "customer-1",
  "customerVersion": 3,
  "schemaVersion": 1,
  "expiresAt": "2026-07-23T20:15:00.000Z",
  "decisions": [
    {
      "programRef": "vip-shipping",
      "programRevision": 2,
      "programType": "promo",
      "outcome": "qualified",
      "rewardRuleRef": "free-shipping",
      "effects": [{ "type": "free_shipping" }],
      "reasonCodes": [],
      "commitRequired": true,
      "eligible": true
    }
  ],
  "codeResults": [
    {
      "code": "VIP20",
      "outcome": "selected",
      "programRef": "vip-shipping",
      "reasonCodes": []
    },
    {
      "code": "UNKNOWN",
      "outcome": "invalid_code",
      "reasonCodes": ["INVALID_PROMO_CODE"]
    }
  ]
}
```

The API echoes only normalized forms of codes the caller already supplied. It
does not return codes belonging to unrelated programs.

For a stacking conflict, `decisions` is empty and each otherwise-qualified
conflicting `codeResults` entry contains:

```json
{
  "outcome": "combination_rejected",
  "reasonCodes": ["CODE_COMBINATION_NOT_ALLOWED"]
}
```

Non-qualified code results retain their own outcome; they are not rewritten as
combination failures.

## 9. Operator authoring and revisions

The Promo editor makes trigger mode explicit:

- **Automatic** hides and clears Code and forces stacking off.
- **Code-triggered** requires Code and exposes the stackable choice.

Switching a coded draft to automatic displays a destructive-field warning
before clearing its code and stacking selection. The server still rejects an
invalid automatic-plus-stackable payload if a client bypasses the UI.

Published program revisions are immutable:

- Edit creates or resumes one next draft revision.
- The active revision continues serving while the draft is edited.
- Publishing atomically activates the draft and retires the previously active
  revision.
- A published code or stacking change therefore never mutates the revision
  currently serving an in-flight evaluation.
- The existing product currently supports one draft revision per logical
  program; multiple parallel drafts remain a documented follow-up rather than
  being introduced here.

The detail page and pre-publication review must show:

- Automatic or Code-triggered mode;
- the code for an authorized operator;
- Stackable: Yes or No;
- configured priority;
- active revision and draft revision when both exist; and
- the code-conflict publication error, when applicable.

Historical revision comparison and rollback remain separate operator-UX work
already recorded by Gate C testing. This change must not make that gap worse.

## 10. Redemption contract

The singular-program redemption request is replaced by a bundle request:

```json
{
  "evaluationId": "evaluation-123",
  "externalOrderRef": "order-456",
  "idempotencyKey": "checkout-789"
}
```

The caller does not submit `programRef`. Core obtains the complete selected set
from the immutable evaluation snapshot.

Before authorizing the bundle, Core validates:

- tenant and credential ownership;
- evaluation integrity and expiry;
- external-order and idempotency identity;
- the exact selected program revisions and reward rules;
- current lifecycle rules;
- usage and per-customer caps for every selected program;
- budget or reservation authority for every selected monetary effect; and
- any module-specific finalization inputs.

The free-shipping quote, reservation, late-claim, currency, pause/end, and final
waiver rules remain governed by the free-shipping budget-authority design.

An evaluation with no selected committable decisions returns
`NOTHING_TO_COMMIT`.

## 11. Atomic bundle semantics

From the integration's perspective, a redemption is all-or-nothing:

- all selected effects are authorized, or none are;
- no successful response is returned until the complete bundle is durably
  authorized;
- a final cap or budget failure for any selected program rejects the bundle;
- rejected bundles create no committed usage or customer-visible effects; and
- infrastructure uncertainty never instructs the caller to apply a partial
  result.

Successful response:

```json
{
  "redemptionId": "redemption-123",
  "evaluationId": "evaluation-123",
  "externalOrderRef": "order-456",
  "status": "committed",
  "entries": [
    {
      "programRef": "promo-a",
      "programRevision": 4,
      "rewardRuleRef": "rule-a",
      "effects": []
    },
    {
      "programRef": "promo-b",
      "programRevision": 2,
      "rewardRuleRef": "rule-b",
      "effects": []
    }
  ],
  "idempotencyKey": "checkout-789"
}
```

One bundle-level redemption ID owns ordered, immutable child entries.
Commit-time idempotency and external-order identity begin at the bundle
boundary. Reporting and later reversal policy may still operate on the
individual child entries when a refund or incurred-cost event affects only one
effect.

## 12. Atomic-redemption port and adapters

Application callsites depend on one provider-neutral port:

```ts
interface AtomicRedemptionCoordinator {
  commitBundle(
    input: CommitRedemptionBundleInput
  ): Promise<CommitRedemptionBundleResult>;

  getBundle(
    input: GetRedemptionBundleInput
  ): Promise<RedemptionBundle | null>;
}
```

The port exposes domain values, opaque references, and stable domain errors. It
does not expose D1 statements, Durable Object stubs, SQLite rows, Cloudflare
RPC types, alarms, or workflow APIs.

### Initial D1 adapter

While all selected counters and redemptions are authoritative in one D1
database, the adapter uses one atomic transaction or transactional batch to:

1. conditionally recheck every cap and budget;
2. insert the bundle and child entries;
3. increment every selected program and customer counter; and
4. record the idempotency result.

Any failed condition rolls back the entire operation.

### Future distributed budget-authority adapter

The free-shipping design deliberately places contentious budget authority
behind a Durable Object adapter. D1 therefore cannot provide a literal database
transaction across future budget authorities.

The distributed implementation must preserve the same external semantics with
a durable prepare/authorize/finalize protocol:

1. persist a bundle intent;
2. idempotently prepare and lock every selected authority claim;
3. if any preparation fails, reject the bundle and release every prepared
   claim;
4. after every claim is secured, durably mark the bundle authorized;
5. only then allow a successful response;
6. idempotently finalize each prepared claim; and
7. recover unfinished release or finalization work after crashes.

A failed release may temporarily keep funds conservatively locked, but it
cannot create a customer grant or overspend. Once a bundle is durably
authorized, failed finalization is retryable internal recovery work because the
funds were already secured.

Prepared claims must not expire independently while a live bundle intent owns
them. The coordinator and authority adapters need explicit ownership,
heartbeats or durable deadlines, and recovery rules rather than relying on a
best-effort timer. Exact failure-state and timeout mechanics belong in the
free-shipping authority implementation plan, but the public redemption port and
callsite remain unchanged.

This is externally atomic authorization, not a false claim of a distributed
ACID transaction.

## 13. Idempotency and concurrency

Idempotency applies to the whole bundle.

- An exact retry returns the original successful or terminal rejected result.
- The request digest binds tenant, evaluation, external order, and normalized
  finalization inputs.
- Reusing an idempotency key with a different digest returns
  `VERSION_CONFLICT`.
- Reusing an external order for a different committed evaluation returns
  `VERSION_CONFLICT`.
- Concurrent exact requests converge on one bundle.
- Concurrent different requests cannot consume the same remaining cap or
  budget twice.
- Child program entries cannot be committed independently through the public
  commit endpoint.

Retryability is explicit:

- malformed requests, expired decisions, stacking conflicts, cap exhaustion,
  and budget exhaustion are non-retryable without a new evaluation or changed
  business state;
- infrastructure failures whose outcome is known not to have committed are
  retryable; and
- an uncertain infrastructure response is resolved by retrying the same
  idempotency key, never by inventing a new one.

## 14. Internal traces and public privacy

Every evaluation produces sanitized internal candidate traces with:

- correlation ID and evaluation ID;
- tenant and program references;
- mode;
- priority and deterministic rank;
- lifecycle and rule-selection outcome;
- cap, budget, and conflict reason codes;
- whether the candidate was selected; and
- duration and dependency failure category.

Traces must not contain:

- bearer credentials or secrets;
- raw customer attributes;
- raw full request bodies;
- unrelated merchant-facing Promo codes; or
- unbounded error objects from dependencies.

Customer references use the existing safe reference or digest policy.

Public automatic responses reveal only the selected decision. Public coded
responses reveal only results for submitted codes. Internal rejected
candidates remain queryable through observability, not through the integration
response.

The same correlation ID must propagate through the operator Worker, identity
Worker, Core service, module evaluation, persistence adapter, and structured
Cloudflare logs. The missing correlation ID observed in the staging evaluation
failure logs is a tracked defect and is in scope for the observability part of
implementation.

## 15. Error model

The implementation adds or standardizes:

| Code | Meaning | Retryable |
|---|---|---|
| `INVALID_REQUEST` | Invalid `codes` shape, limit, or strict-union payload | No |
| `INVALID_PROMO_CODE` | Submitted normalized code has no effective Promo | No |
| `PROMO_CODE_CONFLICT` | Publication overlaps another claim for this client/code | No |
| `CODE_COMBINATION_NOT_ALLOWED` | Several codes qualify but at least one is non-stackable | No |
| `NOTHING_TO_COMMIT` | Evaluation contains no selected committable decision | No |
| `VERSION_CONFLICT` | Idempotency, external-order, evaluation, or revision identity conflicts | No |
| `DECISION_EXPIRED` | Evaluation can no longer be committed | No |
| `BUDGET_EXHAUSTED` | Complete bundle cannot obtain required budget | No |
| `USAGE_CAP_EXHAUSTED` | Complete bundle cannot obtain required usage capacity | No |
| `PER_CUSTOMER_CAP_EXHAUSTED` | Complete bundle cannot obtain customer capacity | No |
| `REDEMPTION_UNAVAILABLE` | Coordinator cannot safely determine or complete the operation | Yes |

Resolved coded-program failures continue to use their existing stable decision
outcomes and reason codes where applicable.

## 16. Data and migration

The implementation plan must account for:

- normalized code and display code storage;
- effective schedule claims for code uniqueness;
- removal of `stackingGroup`;
- strict trigger-mode storage;
- evaluation mode and submitted-code snapshot fields;
- bundle redemption and ordered child-entry tables;
- bundle-level idempotency and request digests; and
- structured trace fields.

Because this is pre-client staging, no compatibility endpoint or dual request
shape is required. Existing staging configurations are migrated once:

- automatic Promos clear code, force `stackable: false`, and remove
  `stackingGroup`;
- coded Promos retain their display code, create its normalized lookup value,
  and retain their boolean stackable choice;
- conflicting published staging codes must be resolved before the uniqueness
  constraint becomes authoritative; and
- old singular-program redemption records remain readable for audit but are
  not emitted by the new contract.

The migration must fail loudly on an ambiguous or invalid legacy record rather
than silently inventing product intent.

## 17. Verification strategy

### Contract tests

- strict Automatic/Coded Promo union;
- removal of `stackingGroup`;
- rejection of singular `code` evaluation requests;
- normalization, deduplication, and ten-distinct-code limit;
- stable case-folding fixtures; and
- bundle redemption request and response schemas.

### Selection tests

- automatic mode selects only the highest-ranked qualified Promo;
- equal-priority selection is deterministic by `programRef`;
- a failed higher-priority candidate permits a lower candidate to win;
- no qualified automatic candidate returns an empty decision list;
- automatic responses expose no rejected candidates or code results;
- coded mode never evaluates automatic Promos;
- coded mode evaluates only submitted codes;
- invalid and ineligible codes do not block valid stackable codes;
- one qualified non-stackable code succeeds;
- a multi-qualified set containing a non-stackable code rejects completely;
- qualified stackable decisions use priority plus `programRef` ordering; and
- duplicate normalized codes are evaluated once.

### Publication tests

- code matching is client-scoped;
- concurrent overlapping claims cannot both publish;
- paused and scheduled overlaps conflict;
- non-overlapping scheduled intervals may reuse a code;
- an ended Promo releases the code;
- a draft may conflict but cannot publish; and
- editing a published Promo creates a new revision without mutating the active
  revision.

### Redemption tests

- one automatic winner commits;
- several selected coded Promos commit as one bundle;
- final failure of any child produces no committed child;
- transactional rollback leaves all counters unchanged;
- concurrent requests cannot overspend or exceed caps;
- exact idempotent retry returns the same bundle;
- changed reuse of a key or order conflicts;
- an empty selection cannot commit;
- expired evaluation cannot commit; and
- provider-adapter contract tests prove identical stable results for supported
  D1 and future distributed implementations.

### Operator tests

- Automatic mode clears and hides code/stacking;
- Code-triggered mode requires a code and exposes stacking;
- switching mode displays the destructive-field warning;
- active and draft revisions remain distinguishable;
- pre-publication review shows trigger, code, stacking, and priority;
- code-conflict publication error is understandable; and
- an unauthorized role cannot read codes or modify trigger configuration.

### Manual staging verification

The non-technical and developer staging guides will include repeatable cases
for:

1. automatic highest-priority selection;
2. automatic fallback to a lower-priority qualified Promo;
3. no unrelated public decisions;
4. correct, incorrect, duplicate, and case-varied codes;
5. mixed valid and invalid stackable codes;
6. non-stackable combination rejection;
7. atomic multi-code redemption;
8. exact and conflicting idempotent retries;
9. cap and budget concurrency; and
10. tenant isolation.

Each run records expected and actual output, correlation IDs, and any product
or observability gap in the staging activation record and follow-up register.

## 18. Documentation and rollout

Implementation updates must remain synchronized across:

- this design and its implementation plan;
- `docs/integration/core-contracts.md`;
- `docs/integration/runtime-api.md`;
- generated or maintained OpenAPI documentation;
- operator help text;
- local and staging manual-test guides;
- `docs/product/current-state-and-roadmap.md`;
- `docs/product/follow-up-register.md`; and
- their Notion mirrors under the Plans hierarchy where applicable.

Rollout order:

1. land contracts and persistence migration;
2. migrate and validate staging Promo configuration;
3. deploy Core before exposing the matching dashboard build;
4. deploy operator changes;
5. create new scoped staging credentials if the API surface requires it;
6. run automated verification;
7. execute the documented manual staging cases; and
8. only then mark the corresponding plan tasks done.

## 19. Explicit non-goals

This delivery does not add:

- automatic greatest-value calculation;
- partial application of a multi-code qualified set;
- stacking for automatic Promos;
- stacking groups;
- multiple parallel drafts;
- full revision diff/history/rollback UI;
- Loyalty points as a Promo reward;
- currency conversion;
- fuzzy code matching; or
- a compatibility period for singular `code` requests.

Loyalty award effects, operator revision history, multiple drafts, and broader
event-triggered incentives remain recorded follow-up work.

## 20. Acceptance criteria

The design is implemented when:

1. an automatic evaluation returns zero or one selected decision and no
   unrelated public failures;
2. a coded evaluation considers only submitted codes and never automatic
   Promos;
3. code normalization, limits, client scoping, and publication uniqueness are
   deterministic and race-safe;
4. automatic Promos cannot be stackable;
5. valid stackable coded Promos may combine while an incompatible qualified set
   yields no effects;
6. selected effects are ordered by priority and `programRef`;
7. one redemption request commits the complete evaluation atomically from the
   caller's perspective;
8. exact retries are idempotent and changed retries conflict;
9. public responses do not disclose unrelated Promo inventory or codes;
10. correlation IDs reach every internal trace and Cloudflare error log;
11. automated and documented manual tests pass in staging; and
12. repository and Notion documentation accurately reflect the deployed
    behavior and remaining gaps.
