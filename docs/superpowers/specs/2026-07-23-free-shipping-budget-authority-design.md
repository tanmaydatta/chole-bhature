# Free-Shipping Budget Authority, Reservations, and Reversals — Design Spec

**Date:** 2026-07-23

**Status:** Approved decisions consolidated for final review; implementation plan pending

**Notion mirror:** https://app.notion.com/p/Free-Shipping-Budget-Authority-Reservations-and-Reversals-Design-Spec-3a6e5c7c2b8e81f49c6ecbf878d7d48c

**Sequence:** Plan 3 financial-correctness follow-on discovered during Gate C staging verification

**Builds on:**

- `docs/superpowers/specs/2026-07-19-production-operator-platform-design.md`
- `docs/superpowers/specs/2026-07-19-conditional-reward-rules-design.md`
- `docs/integration/core-contracts.md`
- `docs/integration/runtime-api.md`

## 1. Purpose

Free shipping currently has no authoritative monetary input, so it cannot safely
participate in a campaign budget. The platform also commits redemptions only at
the end of the evaluation flow, which permits concurrent checkouts to observe
the same remaining budget.

This design adds a production-safe, integration-neutral money authority that:

1. accepts an authoritative shipping quote during evaluation;
2. reserves the full promised waiver for a short configurable period;
3. commits the final waiver atomically without overspending;
4. records the customer-facing waiver separately from merchant-incurred costs;
5. restores budget from a finalized, explicit reversal request;
6. remains correct through retries, expired reservations, Worker restarts,
   delayed timers, and partial infrastructure outages;
7. hides Cloudflare-specific implementation behind stable ports so another
   persistence technology can replace it without changing application
   callsites; and
8. leaves a typed path for future Shopify/manual event mappings and
   event-triggered Loyalty, Referral, and Affiliate rules.

The first delivery exposes an explicit reversal API. A generic event-ingestion
runtime remains future work and will call the same internal reversal use case.

## 2. Financial terminology

The platform must not overload one field named `shippingCost`.

| Term | Meaning | Supplied by |
|---|---|---|
| Eligible shipping charge | The customer-facing shipping amount before this Promo is applied | Integration during evaluation |
| Promised waiver | The amount the decision promises to waive, after the optional per-order cap | Core |
| Final waived amount | The customer-facing amount actually waived at checkout completion | Integration plus Core |
| Merchant shipping cost incurred | The merchant's actual carrier/fulfilment cost after final cancellation/refund outcomes | Integration during reversal |
| Merchant product cost incurred | The merchant's actual cost of products that remain economically consumed | Integration during reversal; unused by free shipping |
| Campaign budget | The maximum recognized spend for the logical Promo | Merchant configuration |
| Available budget | Campaign budget minus committed recognized spend minus active reservations | Budget authority |

All money uses integer minor units plus an ISO currency. The platform performs
no currency conversion. Every amount used by one financial operation must match
the Promo budget currency exactly.

The initial reservation is based on the customer-facing waiver because that is
the maximum amount the Promo has promised. A later reversal may restore the
unincurred portion according to the Promo's published reversal policy. Granting
remains full-or-none even when a later finalized reconciliation restores only
part of the accounting amount.

## 3. Merchant-visible configuration

The Promo editor adds a free-shipping financial section:

- **Campaign budget:** optional money amount.
- **Per-order shipping cap:** optional money amount.
- **Reservation expiry:** duration, default 15 minutes.
- **Reversal accounting:** for free shipping, the initial supported policy is
  `release_unincurred_shipping`.

Rules:

- With no per-order cap, an eligible order receives the full shipping waiver.
- With a cap, the waiver is `min(eligibleShippingCharge, perOrderCap)`.
- With no campaign budget, the authority still records reservations,
  commitments, and reversals but does not reject for campaign exhaustion.
- Campaign budget and per-order cap, when present, use the same currency.
- Reservation expiry has safe product limits defined in contracts; it is not an
  arbitrary unbounded duration.
- A revision may change future reservation policy, but existing reservations
  remain bound to the exact policy snapshot under which they were created.

The UI describes the reservation window as a checkout hold, not a guaranteed
discount after expiry.

## 4. Evaluation inputs and identity

Whenever evaluation can reserve money, the request requires:

- `checkoutRef`: a stable reference for the current checkout/session;
- `idempotencyKey`: stable for one exact evaluation attempt;
- authoritative eligible shipping charge and currency; and
- the ordinary typed customer, cart, line-item, and context inputs.

Identity rules:

- Repeating the same idempotency key with byte-equivalent normalized input
  returns the original result.
- Reusing the key with different normalized input returns
  `IDEMPOTENCY_CONFLICT`.
- A new evaluation for the same merchant, logical Promo, and checkout
  atomically supersedes the previous active reservation.
- A committed reservation cannot be superseded.
- Reservation identity records the logical Promo, exact revision, selected
  reward rule, checkout, customer reference digest, quote, cap, promised waiver,
  currency, and policy version.

The integration must not generate a new idempotency key merely because it did
not receive the previous response.

## 5. Reservation and commit semantics

### Evaluation

For each selected free-shipping reward:

1. Core calculates the promised waiver from the quote and optional cap.
2. Core asks the budget authority to reserve the full promised waiver.
3. The authority serializes the operation with all other reservations and
   commits for that logical Promo.
4. If the full amount is unavailable, evaluation returns a structured
   non-grant/exhaustion result. It never offers a smaller waiver merely because
   the campaign is nearly exhausted.
5. If reserved, the decision contains an opaque reservation reference and
   expiry. The signed decision snapshot covers both.

### Commit before expiry

The integration submits the final customer-facing shipping amount and currency.

- If the final waiver is lower, the authority commits the lower amount and
  releases the difference atomically.
- If it is equal, the authority commits the reservation.
- If it is higher, the authority atomically attempts to top up the reservation.
  When the full top-up is unavailable, it commits nothing and returns
  `BUDGET_EXHAUSTED`.
- Currency mismatch fails closed.
- The original per-order cap remains authoritative; repricing cannot exceed it.

### Commit after expiry

An expired reservation no longer locks funds. A late commit performs one fresh
atomic full claim:

- the logical Promo must currently permit new grants;
- the exact committed amount must fit the original cap/policy snapshot; and
- the full campaign amount must be available.

Success records `commitMode: "late_fresh_claim"`. Failure records nothing
financially and returns a structured non-retryable exhaustion/lifecycle error.

## 6. Promo lifecycle interaction

- **Pause** and **end** stop new reservations.
- Unexpired reservations created before pause/end may still commit.
- An existing reservation remains bound to its original published revision even
  if another revision becomes active.
- A late fresh claim after expiry is allowed only while the logical Promo
  currently accepts new grants.
- Ending a Promo does not silently erase active reservations.
- Operations receives a separate audited **void outstanding reservations**
  command for emergency response. It is never a side effect of ordinary
  lifecycle changes.

## 7. Reservation state machine

```text
reserved ──commit────────> committed
    │
    ├──expiry observation> expired ──late fresh claim──> committed
    ├──client cancel─────> cancelled
    ├──new evaluation────> superseded
    └──operator void─────> voided
```

Only `reserved` locks money.

Every transition and idempotent replay is performed in one authority
transaction and appends an immutable ledger event. Invalid transitions fail
without changing balances:

- committed cannot be cancelled, superseded, expired, or voided;
- terminal states cannot be committed except the explicit expired late-claim
  path;
- a replay of a successful operation returns its original response;
- the same idempotency key with a different request digest conflicts.

For a finite budget, the invariant is:

```text
campaign limit =
  committed recognized spend
  + active reserved spend
  + available spend
```

No response may claim a grant unless this invariant was durably committed.

## 8. Authoritative storage and portability

### Chosen Cloudflare adapter

One Durable Object instance owns one logical Promo's budget pool and uses its
SQLite storage as the authoritative reservation and spend ledger.

This serialization boundary is selected because budget operations are
contentious compare-and-update operations. Product D1 remains the source for
merchant configuration, customers, programs, decisions, and reporting
projections; it is not the financial source of truth.

The Durable Object stores at least:

- budget configuration version and currency;
- latest observed authority time;
- idempotency records and request digests;
- reservations and their immutable policy snapshots;
- committed redemptions;
- reversal records;
- immutable ledger entries; and
- projection checkpoints.

### Stable application ports

Application code depends on focused interfaces in a neutral workspace package:

```ts
interface BudgetReservationAuthority {
  reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult>;
  commit(input: CommitBudgetInput): Promise<CommitBudgetResult>;
  cancel(input: CancelReservationInput): Promise<CancelReservationResult>;
  getReservation(
    input: GetReservationInput
  ): Promise<BudgetReservation | null>;
}

interface RedemptionReversalAuthority {
  reverse(input: ReverseRedemptionInput): Promise<ReverseRedemptionResult>;
}

interface BudgetConfigurationAuthority {
  activate(input: ActivateBudgetInput): Promise<BudgetSnapshot>;
  update(input: UpdateBudgetInput): Promise<BudgetSnapshot>;
}

interface BudgetLedgerReader {
  getSnapshot(input: GetBudgetSnapshotInput): Promise<BudgetSnapshot>;
  listEntries(input: ListBudgetEntriesInput): Promise<BudgetLedgerPage>;
}
```

The interfaces expose domain values, stable errors, and opaque references only.
They do not expose Durable Object stubs, D1 types, Cloudflare RPC objects, SQLite
rows, or alarm APIs.

The initial adapter maps these calls to Durable Object RPC. A future Postgres,
FoundationDB, or other transactional adapter can replace it through dependency
composition without changing evaluation services, redemption services, public
routes, module code, or commerce connectors.

## 9. Expiry and failure correctness

Correctness never depends on a timer firing.

- Every reserve, commit, cancel, read, configuration, and reversal operation
  checks persisted expiry against authority time before calculating balances.
- Alarms may eagerly mark expired rows and refresh projections, but an absent,
  delayed, duplicated, or restarted alarm cannot leave expired money locked or
  make it spendable twice.
- The authority persists `latestObservedAt` and uses
  `max(platformNow, latestObservedAt)` so a backward wall-clock adjustment
  cannot resurrect a reservation.
- Storage/RPC uncertainty fails closed. Core does not guess that a reservation
  succeeded and does not fall back to a non-atomic D1 counter.
- A client timeout is resolved by retrying the same idempotency key or querying
  the reservation; it is not resolved by issuing a new financial operation.
- Product D1 projection lag affects dashboards only, never financial decisions.
- Reconciliation jobs compare projection checkpoints with authority ledger
  sequence numbers and can rebuild projections from immutable entries.
- Corrupt currency, negative amounts, impossible balance invariants, or unknown
  policy versions quarantine the operation and return a safe internal error.

The per-Promo authority deliberately favors correctness over unlimited
single-Promo throughput. A different sharding design requires a new proof that
preserves one atomic budget invariant.

## 10. Explicit reversal API

The first integration contract exposes an explicit, idempotent reversal command
instead of requiring a generic event runtime.

Preferred route:

```text
POST /v1/redemptions/{redemptionRef}/reverse
```

Example request:

```json
{
  "idempotencyKey": "refund-987-final",
  "externalOrderRef": "order-123",
  "occurredAt": "2026-07-23T10:00:00Z",
  "reason": "order_refunded",
  "costsFinal": true,
  "incurredCosts": {
    "shipping": {
      "currency": "GBP",
      "minorUnits": 0
    },
    "products": {
      "currency": "GBP",
      "minorUnits": 1200
    }
  }
}
```

Contract rules:

- The integration should persist `redemptionRef` returned by commit.
- `externalOrderRef` is required as a correlation cross-check and is not trusted
  as a tenant identifier.
- A guarded lookup by merchant, order, and program may be added for integrations
  that cannot retain `redemptionRef`; ambiguous matches return a conflict rather
  than reversing several redemptions silently.
- The client submits finalized factual costs, not a requested reversal amount.
- `costsFinal` must be true. Provisional carrier estimates do not release money.
- Currency must match the committed redemption.
- Missing, invalid, or irrelevant facts fail closed.
- The original redemption remains immutable. Reversal appends a compensating
  ledger entry linked to it.
- Total restored money can never exceed the original committed recognized
  spend.
- Reusing an idempotency key with the same body returns the original reversal;
  changing the body conflicts.
- A later correction to facts is a separately designed, audited adjustment
  operation. It cannot masquerade as a retry.

### Initial free-shipping reversal policy

`release_unincurred_shipping` reads only the canonical
`incurredCosts.shipping` field:

```text
retained recognized spend =
  min(original committed waiver, finalized shipping cost incurred)

restored budget =
  original committed waiver - retained recognized spend - already restored
```

Examples:

- £10 waived; cancellation finalized before any shipping cost: restore £10.
- £10 waived; finalized shipping cost £6: retain £6, restore £4.
- £10 waived; finalized shipping cost £12: retain £10, restore £0.

`incurredCosts.products` is deliberately ignored by a free-shipping Promo. It
exists in the canonical request for future cashback, Affiliate, Referral, and
other cost-accounted modules. A module may read only cost categories declared
by its published policy.

The reversal response reports original committed spend, this restored amount,
cumulative restored amount, retained recognized spend, currency, ledger
reference, and idempotent replay status.

## 11. Security, audit, and operations

- Reversal requires a secret merchant credential with an explicit
  `redemptions:reverse` permission/scope.
- Browser publishable credentials cannot call it.
- Merchant identity comes from the credential, never the request body.
- Requests are size-limited, schema-validated, rate-limited, and correlated.
- Audit records contain references, reason, policy version, amount summaries,
  actor/credential reference, and correlation id. They exclude credentials and
  unrelated customer attributes.
- Root may inspect and perform an audited manual adjustment only through a
  separate operations capability with a mandatory reason.
- Dashboards display gross committed spend, restored spend, and net recognized
  spend separately.
- Alerts cover invariant failures, repeated conflicts, authority unavailability,
  projection lag, and abnormal reversal volume.

## 12. Future event definitions and module bindings

Events remain valuable for asynchronous facts, but they are not the financial
authority and do not replace command APIs that require an immediate result.

The future model has three separate versioned concepts:

1. **Event definition** — a merchant-defined, published typed fact such as
   `order.completed`, `subscription.renewed`, or `review.submitted`.
2. **Integration mapping** — translates a Shopify/manual payload into that
   published event shape and canonical semantic fields.
3. **Module binding** — tells a Loyalty, Referral, Affiliate, or other program
   what to do when a published event arrives.

Example Loyalty authoring flow:

```text
When event: order.completed
If: event.order_total >= 10000 AND customer.tier = "gold"
Award: 10 <configured wallet asset units>
Limit: once per external order
```

The same normalized event may:

- award a Loyalty asset;
- qualify a Referral;
- create Affiliate attribution or commission eligibility; and
- update analytics.

Each binding deduplicates with `(eventId, programRef, programRevision, ruleRef)`
so one event may intentionally affect several programs but cannot repeat one
rule's effect.

The Event Definition UI lets a merchant define keys, types, required fields,
descriptions, and versions. The integration-mapping UI maps source paths to
those typed fields. Module authoring then selects a published event and exposes
only its compatible typed fields to conditions and reward calculations.

For reversal, a future refund/cost event adapter will validate and map its
payload into the exact `ReverseRedemptionInput` above, then call
`RedemptionReversalAuthority.reverse`. It will not implement separate financial
logic.

## 13. Shopify and manual integration fit

The canonical contracts work with both integration styles:

- A manual integration calls evaluate/reserve, commit, and reverse directly.
- A Shopify adapter receives Shopify webhooks, verifies and deduplicates them,
  enriches data when required, and calls the same application ports.

Shopify distinguishes customer-facing shipping prices/refunds from fulfilment
records. Its standard order data can provide order identity and shipping charge
facts, and inventory data can expose current unit cost with additional scope.
Standard fulfilment data does not universally provide the merchant's actual
carrier invoice, and current inventory unit cost is not necessarily historical
cost of goods for an order.

Therefore the Shopify adapter may obtain actual incurred costs from:

- an appropriate Shopify field when it is authoritative for that merchant;
- a merchant metafield;
- a fulfilment/carrier or ERP integration; or
- an explicit client-supplied reversal call.

The mapping UI must label field semantics and types. It must never imply that a
Shopify shipping-line price is the merchant's carrier cost or silently map
current inventory unit cost as historical product cost.

## 14. Initial delivery scope

Included:

- neutral contracts and authority ports;
- Durable Object + SQLite authority adapter;
- Core binding and composition;
- free-shipping quote input;
- optional campaign budget and optional per-order cap;
- configurable reservation expiry with 15-minute default;
- reserve, supersede, cancel, commit, expiry, late-claim, and void behavior;
- explicit finalized reversal API;
- gross/restored/net ledger projection;
- operator UI configuration and ledger visibility;
- tests for invariants, concurrency, replay, currency, lifecycle, expiry, and
  infrastructure failures; and
- local/staging manual procedures.

Deferred:

- generic event ingestion and mapping runtime;
- Loyalty/Referral/Affiliate runtime actions;
- Shopify connector implementation;
- foreign-exchange conversion;
- arbitrary merchant-written reversal formulas;
- provisional or continuously corrected cost reconciliation;
- multiple editable drafts or visual revision diff/history improvements; and
- production deployment.

## 15. Acceptance criteria

The delivery is complete only when:

1. concurrent evaluations cannot reserve more than one finite Promo budget;
2. the same evaluation/commit/reversal request is safely replayable;
3. different input under one idempotency key conflicts;
4. a new checkout evaluation supersedes only its prior active reservation;
5. lower and higher final shipping amounts release/top up atomically;
6. expired holds stop locking funds without relying on alarms;
7. late commit grants all or nothing using current availability;
8. pause/end and revision changes honor the approved reservation lifecycle;
9. currency mismatch and authority uncertainty fail closed;
10. finite-budget invariants survive restarts and injected failures;
11. finalized reversal restores no more than the policy permits;
12. free shipping cannot read product cost as its reversal basis;
13. reporting can be rebuilt from immutable authority ledger entries;
14. application tests use the neutral ports without Cloudflare types;
15. a second in-memory or test adapter passes the same conformance suite;
16. local and staging manual guides demonstrate reserve, commit, expiry,
    exhaustion, reversal, and idempotent replay; and
17. repository and Notion copies are synchronized and read back.
