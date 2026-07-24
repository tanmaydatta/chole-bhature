# Product Current State and Roadmap

**Updated:** 2026-07-24

**Status:** Active — clean-break correction and Task 10 review remediation
verified locally; reviewed merge and owner-run staging evidence pending

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
| Overall phase | Production Operator Platform, Delivery Gate C |
| Current activity | Complete reviewed integration, then have the owner run the protected cutover and manually verify the clean-break Promo selection and atomic bundle correction |
| Current product-code baseline | PR #8 merge commit `e15cbba` on `dev` |
| Local feature state | Promo-selection plan Tasks 1–9 and Task 10 review remediation are implemented and verified locally; protected rollout tooling, migration prechecks, compatibility proof, and recovery guidance are prepared; merge and staging evidence remain open |
| Current deployment gap | The new migration/API/operator build is not deployed; staging still runs the historical singular selection/redemption contract |
| Current blocker | Owner-controlled staging deployment and the 12 documented selection/bundle/tenant/log cases have not run |
| Gate C finish line | Merge by reviewed PR, execute the protected owner-run cutover one command at a time, pass all manual cases, and close remaining tenant/security evidence |
| Next plan work | Close Gate C, then write the approved free-shipping financial-authority implementation plan |

## Source-of-truth map

Use this page for current sequencing and status. Follow its links for detail:

| Need | Source |
|---|---|
| Current state and next work | This page |
| Every known gap, resolved incident, and deferred capability | [Repository](./follow-up-register.md) · [Notion](https://app.notion.com/p/Product-Follow-up-Register-3a6e5c7c2b8e81cebe96de50b64f3bbd) |
| Current staging evidence | [Repository](../testing/staging-activation-run-2026-07-21.md) · [Notion](https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489) |
| Protected Task 10 cutover and recovery | [Repository](../testing/task10-staging-cutover.md) |
| Repeatable manual procedure | [Repository](../testing/gate-c-manual-test.md) · [Notion](https://app.notion.com/p/3a3e5c7c2b8e8155aa10c869b97b7e5a) |
| Active delivery plan | [Repository](../superpowers/plans/2026-07-19-production-operator-platform.md) · [Notion](https://app.notion.com/p/Production-Operator-Platform-and-Integration-Harness-Implementation-Plan-3a2e5c7c2b8e8191ba1ff65dd30752b3) |
| Approved Promo selection and atomic-redemption design | [Repository](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Design-Spec-3a6e5c7c2b8e81549b6adc7f3d096455) |
| Next implementation plan | [Repository](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Implementation-Plan-3a7e5c7c2b8e811791dee0d21803c8e2) |
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
  Product-D1 identity confirmation, count-only migration/precheck queries,
  private export, API/Operator deployment status, and cutover write markers.
  The child environment is fail-closed and deployment status accepts only
  canonical, unique Cloudflare version UUIDs. Protected Worker rollback is
  deliberately disabled pending reviewed safe preflight/API tooling; recovery
  is containment plus a forward fix. These operations are prepared, not
  executed.

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

## Current work

Staging proved the existing credential, schema, customer, Promo lifecycle,
redemption-idempotency, and cap behavior. It also exposed a deeper product
contract problem in the deployed build: unrelated Promo outcomes, ambiguous
automatic stacking, and singular child selection at redemption. This work is
the next clean-break runtime correction before any client commerce integration
is allowed to depend on that old boundary.

The approved behavior is recorded in the
[Promo Selection, Code Stacking, and Atomic Redemption design](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md).
Its
[plan](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md)
is `In progress`: Tasks 1–9 and Task 10 review remediation are implemented and
verified locally. The public request uses `codes[]`; automatic evaluation returns zero
or one private winner; coded evaluation returns submitted-code diagnostics;
compatible coded Promos can combine; the signed ordered set commits through a
provider-neutral atomic coordinator; D1 is its initial adapter; and sanitized
failure logs carry the client-visible correlation ID.

Task 10 review remediation has added a migration-equivalent count-only legacy
redemption guard, a proof that pre-`0006` column-list inserts remain accepted
but bypass the new ledgers, and the
[protected staging cutover/recovery guide](../testing/task10-staging-cutover.md).
Every protected remote action uses generated mode-`0600` configuration,
authenticates and confirms Product D1 without printing IDs, and emits only
allowlisted summaries. The design is not marked implemented because the
reviewed merge, owner-controlled staging cutover, and manual evidence remain
incomplete.

The immediate sequence is:

1. Merge the locally verified Task 10 review-remediation candidate through a
   reviewed PR into `dev`; never push directly to `dev`.
2. Confirm the merged source and protected-runner revision before staging.
3. The account owner follows the protected cutover guide one command at a
   time: continuous quiet window, Product-D1 confirmation/prechecks/export,
   forward-only migration, pre-deployment health, API deployment, and Operator
   deployment. Identity is not part of this cutover.
4. Repeat the documented automatic, coded, stacking, bundle-idempotency, and
   concurrency cases with fresh references.
5. Complete the remaining tenant-isolation and security closeout checks.
6. Reconcile the staging report, follow-up register, active plans, this page,
   and their Notion mirrors with the final Gate C result.

No assistant-run Cloudflare mutation is permitted. The assistant supplies one
command at a time; the account owner runs every deployment, migration, secret,
domain, or other Cloudflare write. External deployment scope is local/staging
only until separately approved; no production rollout is implied.

## What happens after Gate C

### 1. Close the current verification milestone

- Record the final pass/fail evidence without secrets or personal data.
- Mark the no-budget free-shipping editor gap Done if the staging retest
  passes.
- Resolve or explicitly defer any new finding.
- Update the Production Operator Platform and staging-activation status.

### 2. Turn the approved financial design into an implementation plan

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

### 3. Continue the active Production Operator Platform plan

Unless the financial-authority plan exposes a prerequisite that blocks the
existing plan, continue in this order:

1. Task 10 — Evaluation Playground.
2. Task 11 — public-contract CLI simulator.
3. Task 12 — cross-service audit, safe observability, and retention.
4. Task 13 — isolated deployments, CI/CD, smoke tests, and operator
   documentation.
5. Final acceptance and repository/Notion status synchronization.

### 4. Choose the first commerce integration

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
  error event is locatable by the correlation ID returned to a client.

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
