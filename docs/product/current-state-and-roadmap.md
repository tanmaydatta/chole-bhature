# Product Current State and Roadmap

**Updated:** 2026-07-29

**Status:** Active — Gate C complete; preparing the approved Promo price
breakdown and optional percentage-cap correction

**Notion mirror:** https://app.notion.com/p/Product-Current-State-and-Roadmap-3a6e5c7c2b8e81f6b412c45a2bc7b344

This is the canonical operational answer to:

- What have we built?
- What is deployed and verified?
- What are we doing now?
- What happens next?

It is intentionally short. Detailed requirements remain in their plans and
specifications, test evidence remains in dated run reports, and every open or
deferred issue remains in the
[Product Follow-up Register](./follow-up-register.md).

## At a glance

| Question | Current answer |
|---|---|
| Overall phase | Post-Gate-C client-readiness corrections |
| Current activity | Design and plan `GAP-030` and `GAP-031` |
| Current repository baseline | PR #11 merge commit `6de1d80` on `dev`; it follows the PR #10 product-code baseline with documentation-only status reconciliation |
| Current product-code baseline | PR #10 merge commit `1ebc5fe` |
| Local feature state | Promo-selection clean break is implemented, verified, independently reviewed, merged, migrated, deployed, and fully staging-verified |
| Current deployment gap | None for the Task 10 correction; migration `0006`, API, and Operator Web staging rollout completed and health checks passed |
| Current blocker | None |
| Gate C finish line | Complete — all mandatory clean-break selection, redemption, tenant-isolation, concurrency, and observability cases passed |
| Next plan work | Implement the approved Promo price breakdown and optional percentage cap; complete the approved free-shipping financial-authority plan/work; then resume the Evaluation Playground |

## Source-of-truth map

Use this page for current sequencing and status. Follow its links for detail:

| Need | Source |
|---|---|
| Current state and next work | This page |
| Every known gap, resolved incident, and deferred capability | [Repository](./follow-up-register.md) · [Notion](https://app.notion.com/p/Product-Follow-up-Register-3a6e5c7c2b8e81cebe96de50b64f3bbd) |
| Current staging evidence | [Repository](../testing/staging-activation-run-2026-07-21.md) · [Notion](https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489) |
| Protected Task 10 cutover and recovery | [Repository](../testing/task10-staging-cutover.md) · [Notion](https://app.notion.com/p/Task-10-protected-staging-cutover-and-recovery-3a7e5c7c2b8e817f9c0cf0acab3e8c2e) |
| Repeatable manual procedure | [Repository](../testing/gate-c-manual-test.md) · [Notion](https://app.notion.com/p/3a3e5c7c2b8e8155aa10c869b97b7e5a) |
| Active delivery plan | [Repository](../superpowers/plans/2026-07-19-production-operator-platform.md) · [Notion](https://app.notion.com/p/Production-Operator-Platform-and-Integration-Harness-Implementation-Plan-3a2e5c7c2b8e8191ba1ff65dd30752b3) |
| Approved Promo selection and atomic-redemption design | [Repository](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Design-Spec-3a6e5c7c2b8e81549b6adc7f3d096455) |
| Current correction implementation plan | [Repository](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Implementation-Plan-3a7e5c7c2b8e811791dee0d21803c8e2) |
| Approved free-shipping financial design | [Repository](../superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md) · [Notion](https://app.notion.com/p/Free-Shipping-Budget-Authority-Reservations-and-Reversals-Design-Spec-3a6e5c7c2b8e81f49c6ecbf878d7d48c) |
| All implementation plans and their statuses | [Notion Plans index](https://app.notion.com/p/Plans-390e5c7c2b8e8165b7f7d77392eab088) |

When these documents disagree about what is happening now, update this page
and the affected source document in the same change. Do not erase historical
test observations to make the current state look cleaner.

## What is built

### Completed foundations

- The static dashboard demo and its detail/edit extensions are complete. It
  remains a separate mock-data product-discovery surface.
- The integration-ready foundation is complete: canonical typed contracts,
  pure evaluation engine, module extension point, and connector conformance
  boundary.
- The persistent Core runtime is complete: D1-backed schema publication,
  stored customer attributes, private automatic/coded evaluation snapshots, and
  provider-neutral atomic/idempotent Promo bundle redemption. D1 is the initial
  atomic coordinator adapter because all current counters and ledger state live
  in one database.
- Ordered conditional reward rules are complete for Promo. Reusable
  configuration contracts exist for Affiliate, Referral, and Loyalty, but
  their production runtimes are deliberately deferred.

### Production Operator Platform delivered so far

- Tasks 1–9 and Delivery Gates A/B are implemented.
- Core API, Identity, and Operator Web are separate Workers.
- Product and Auth data use separate D1 databases.
- Operator Web is a database-free BFF using service bindings.
- Public signup is disabled. Root activation/recovery, employee invitations,
  tenant memberships, action-based Admin/Operator/Viewer permissions, and
  merchant credentials exist.
- Schema, exact customer, and immutable Promo revision workflows are connected
  to live tenant-scoped staging data.
- Staging uses `api.staging.wastd.dev` and
  `operator.staging.wastd.dev`; Identity remains private.
- API, Identity, and Operator Web persist staging logs at 100% sampling.
- Task 10 staging operations now have a protected runner boundary for
  Product-D1 identity confirmation, count-only migration/precheck queries, a
  read-only Time Travel bookmark, API/Operator deployment status, and cutover
  write markers. The child environment is fail-closed and deployment status
  accepts only canonical, unique Cloudflare version UUIDs. The runner exposes
  neither D1 restore nor Worker rollback. Normal recovery is containment plus
  a forward fix; the canonical guide also records the tightly controlled
  exceptional Time Travel restore sequence. The owner used this boundary to
  complete the protected prechecks, migration, and staging cutover; no restore
  or rollback was needed.

## What is verified in staging

The dated run report contains the full evidence. The following has passed
manually:

- root activation, recovery-code handoff, passkey enrollment, and passkey
  sign-in;
- client provisioning and root client switching;
- Admin, Operator, and Viewer invitations, delivery, acceptance, isolated
  sign-in, navigation restrictions, and backend authorization;
- schema authoring, impact preview, publication, and immutable published
  snapshot behavior;
- exact customer creation, typed updates, cross-session persistence,
  optimistic concurrency conflicts, and recovery;
- Promo revision 1 and revision 2 authoring/publication, ordered reward
  persistence, hard-refresh durability, pause, resume, and irreversible end.
- no-budget free-shipping Promo creation, publication, and hard-refresh
  durability;
- staging credential creation and authenticated schema reads;
- automatic evaluation, redemption, exact idempotent retry, changed-retry
  conflict, second redemption, and per-customer exhaustion; and
- manual-code draft persistence plus missing, incorrect, and correct code
  evaluation behavior.
- protected Product-D1 prechecks, migration `0006`, API deployment, Operator
  deployment, and post-deployment health;
- fresh-tenant automatic zero-or-one selection, including deterministic
  Priority failover and an empty result when no automatic Promo is available;
  and
- coded selection normalization/trim/case handling, duplicate collapse,
  invalid-code diagnostics, deterministic decision order, and suppression of
  automatic Promos in coded mode (`SELECT-CODE-01`); and
- mixed valid/invalid stackable coded selection, including input-aligned
  diagnostics that isolate the invalid code without removing either valid
  priority-ordered decision (`SELECT-CODE-02`); and
- single non-stackable coded selection, including one qualified decision and
  one matching selected diagnostic (`SELECT-CODE-03`); and
- atomic rejection of an incompatible multi-code combination while preserving
  independent invalid-code diagnostics (`SELECT-CODE-04`).
- atomic two-Promo redemption with deterministic VIP20 → GATEC15 entry order,
  plus an identical idempotent retry returning the same committed redemption
  (`REDEEM-BUNDLE-01`).
- changed-order reuse of the committed bundle's idempotency key returning a
  non-retryable `VERSION_CONFLICT` with matching header/body correlation IDs
  (`REDEEM-BUNDLE-02`).
- atomic rollback of an earlier valid bundle entry when a later entry's budget
  was exhausted, followed by proof that the first entry's budget remained
  available (`REDEEM-BUNDLE-03`); and
- submitted-code tenant isolation: Beta received an opaque invalid-code result
  for an Alpha-only code without an Alpha Promo reference, while Alpha selected
  its own qualified Promo (`TENANT-API-01`); and
- correlation-log discoverability: the client-visible correlation ID
  `2f6dffe6-d497-43f1-a088-f29df0a3f015` located the matching sanitized
  `api_request_failed` event for the expected `POST /v1/redemptions`
  `VERSION_CONFLICT`, including safe merchant/credential identifiers and no
  secret or request payload (`OBS-API-01`).

## Current work

Staging proved the existing credential, schema, customer, Promo lifecycle,
redemption-idempotency, and cap behavior. It also exposed a deeper product
contract problem in the historical build: unrelated Promo outcomes, ambiguous
automatic stacking, and singular child selection at redemption. The
clean-break correction is now migrated, deployed, and fully verified in
staging.

The approved behavior is recorded in the
[Promo Selection, Code Stacking, and Atomic Redemption design](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md).
Its
[plan](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md)
is `Done`: Tasks 1–9 and Task 10 review remediation are implemented, verified
locally and in staging, merged, migrated, and deployed. The public request
uses `codes[]`; automatic evaluation returns zero or one private winner; coded
evaluation returns submitted-code diagnostics; compatible coded Promos can
combine; the signed ordered set commits through a provider-neutral atomic
coordinator; D1 is its initial adapter; and sanitized failure logs carry the
client-visible correlation ID.

Task 10 review remediation added a migration-equivalent count-only legacy
redemption guard, a proof that pre-`0006` column-list inserts remain accepted
but bypass the new ledgers, and the
[protected staging cutover/recovery guide](../testing/task10-staging-cutover.md).
Every protected remote action uses generated mode-`0600` configuration,
authenticates and confirms Product D1 without printing IDs, and emits only
allowlisted summaries. The owner executed the protected prechecks, captured the
pre-migration Time Travel bookmark, applied migration `0006`, deployed API and
Operator Web, and passed pre/post-deployment health checks. Identity was not
part of this cutover. The complete mandatory manual evidence set passed.

The immediate sequence is:

1. Completed: PR #10 merged the locally verified Task 10 rollout candidate
   into `dev` as product commit `1ebc5fe`; no direct push to `dev` was used.
2. Completed: the owner ran the protected Product-D1 prechecks, captured the
   recovery bookmark, applied migration `0006`, deployed API and Operator Web,
   and passed health checks.
3. Completed: fresh-tenant automatic selection, `SELECT-CODE-01` through
   `SELECT-CODE-04`, and `REDEEM-BUNDLE-01` through `REDEEM-BUNDLE-03`
   passed.
4. Completed: `TENANT-API-01` proved submitted-code tenant isolation with
   distinct Alpha and Beta credentials.
5. Completed: automated concurrency coverage remained green.
6. Completed: `OBS-API-01` located the expected sanitized
   `VERSION_CONFLICT` event by the exact client-visible correlation ID.
7. Completed: the final Gate C result was reconciled across the staging report,
   follow-up register, active plans, this page, and their Notion mirrors.

No assistant-run Cloudflare mutation is permitted. The assistant supplies one
command at a time; the account owner runs every deployment, migration, secret,
domain, or other Cloudflare write. External deployment scope is local/staging
only until separately approved; no production rollout is implied.

## What happens after Gate C

### 1. Gate C verification milestone — complete

- The final evidence was recorded without secrets or personal data.
- The no-budget free-shipping editor gap is Done.
- Every finding is resolved or explicitly tracked in the follow-up register.
- The Production Operator Platform and staging-activation status are
  reconciled.

### 2. Add authoritative Promo pricing before the Playground

The approved minimal Voucherify-parity correction is deliberately smaller than
building a broad campaign-management clone:

- return the original merchandise subtotal, exact discount contributed by
  each selected Promo/reward rule, total discount, discounted subtotal, and
  line identity for line-item allocations;
- extract one pure pricing calculator and use its exact result for evaluation
  output, budget/cap checks, the signed decision snapshot, redemption, and
  audit/reversal evidence;
- use integer minor units and document deterministic ordering, capping, and
  rounding;
- add an optional exact-currency maximum monetary discount to percentage order
  and line-item rewards; and
- keep the response explicitly scoped to merchandise pricing rather than
  claiming a final tax/shipping/payment total.

Free shipping must not report a fictional monetary saving. Its price breakdown
is added only when the authoritative shipping quote and reservation flow below
exists.

Bulk unique-code pools, new-price discounts, free products, BOGO/bundles,
dynamic formulas, reusable catalog collections, recurring schedules, and
richer stacking policies are recorded as deliberately deferred in `GAP-032`.
They remain extension points and become implementation work only when a client
case justifies them.

Create a focused design and implementation plan for `GAP-030` and `GAP-031`
after Gate C. Implement and verify that plan before resuming the Evaluation
Playground.

### 3. Turn the approved free-shipping financial design into an implementation plan

Create a separate plan under the Notion Plans page for the approved
free-shipping financial authority. The implementation must preserve:

- optional campaign budget and optional per-order cap;
- client-supplied authoritative shipping quote and incurred-cost facts;
- exact-currency behavior with no conversion;
- full-waiver-or-no-waiver semantics;
- configurable reservation TTL, defaulting to 15 minutes;
- concurrency-safe reserve, commit, expiry, late-commit, and reversal flows;
- correctness even when alarm/TTL infrastructure is delayed or unavailable;
- append-only financial audit evidence and idempotency;
- explicit reversal API plus future event-to-reversal mapping;
- provider-neutral ports so Cloudflare Durable Objects/SQLite can be replaced
  without changing domain callsites.

The future distributed free-shipping authority implements the same
`AtomicRedemptionCoordinator` port and stable failure semantics as the current
D1 adapter. Budget and per-order cap stay optional; the client supplies actual
shipping cost; the decision is a full waiver or none; reservation TTL is
configurable with a 15-minute default; expiry and recovery are treated as money;
and currency must match exactly with no conversion. Event-driven reversals and
future event-triggered incentives remain planned work.

This plan is created after Gate C so the current verification result remains
clear. Its execution does not silently expand Gate C.

### 4. Continue the active Production Operator Platform plan

After the approved Promo financial corrections above, continue in this order:

1. Task 10 — Evaluation Playground.
2. Task 11 — public-contract CLI simulator.
3. Task 12 — cross-service audit, safe observability, and retention.
4. Task 13 — isolated deployments, CI/CD, smoke tests, and operator
   documentation.
5. Final acceptance and repository/Notion status synchronization.

### 5. Choose the first commerce integration

Only after the shared platform reaches its acceptance gate—or a real client
creates a justified earlier constraint—choose Shopify or a manual/custom
connector. That choice remains uncommitted. The canonical contracts, connector
conformance boundary, typed customer/context schema, conditional rewards, and
provider-neutral financial authority are designed to remain common across
those integrations.

## Known gaps and deferred work

The [Product Follow-up Register](./follow-up-register.md) is authoritative and
must be updated whenever a finding changes state. It currently preserves:

- client-readiness UX gaps, including signed-in identity/scope, demo data on
  Overview, and live-page styling;
- member passkeys/MFA and safer invitation account handoff;
- schema deprecation, stale impact state, and lifecycle presentation;
- Promo active-vs-draft full comparison, revision history/rollback, deliberate
  single-draft semantics, and catalog mapping for `productRef`;
- client-facing percentage entry instead of exposing internal basis points;
- the complete approved free-shipping financial-authority design;
- future event ingestion/mapping and event-triggered Loyalty, Referral, and
  Affiliate behavior;
- Loyalty wallet terminology, asset-catalog work, and the ability for an
  eligible conditional Promo to grant a configured wallet asset once the
  production accrual ledger and fulfilment port exist;
- Affiliate/Referral production runtimes;
- custom role composition;
- integration-specific incurred-cost mapping; and
- staging verification that the now-implemented sanitized structured public-API
  error event is locatable by the correlation ID returned to a client;
- authoritative client-facing Promo price calculation and per-Promo/line
  allocation;
- optional maximum monetary caps for percentage rewards; and
- deliberately deferred Voucherify breadth rather than speculative expansion
  before a first-client requirement exists.

Nothing in those categories should be considered forgotten merely because it
does not block the current Gate C test.

## Update policy

Update this page:

- after a merge changes the current baseline;
- after a staging or production deployment changes what is live;
- after a manual gate changes status;
- when the next planned milestone changes; and
- when an approved design becomes a plan, starts implementation, completes, or
  is killed.

Every update must keep the repository and Notion copies content-equivalent.
Use concrete statuses: `Todo`, `In progress`, `Blocked`, `Done`, `Deferred`, or
`Killed`.
