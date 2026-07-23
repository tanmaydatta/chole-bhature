# Product Current State and Roadmap

**Updated:** 2026-07-23

**Status:** Active — Gate C staging verification in progress

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
| Current activity | Finish manual staging verification of the live Operator platform |
| Current product-code baseline | PR #8 merge commit `e15cbba` on `dev` |
| Current deployment gap | PR #8 is merged, but Operator Web must be redeployed before the free-shipping regression can be retested |
| Current blocker | No product-code blocker is known; staging verification is waiting for the user-run Operator Web deployment and manual continuation |
| Gate C finish line | Free-shipping create/publish/reload, tenant isolation, evaluation, redemption, idempotent retry, and exhaustion all pass |
| Next plan work | Close Gate C evidence, write the approved financial-authority implementation plan, then continue the Production Operator Platform plan from Task 10 |

## Source-of-truth map

Use this page for current sequencing and status. Follow its links for detail:

| Need | Source |
|---|---|
| Current state and next work | This page |
| Every known gap, resolved incident, and deferred capability | [Repository](./follow-up-register.md) · [Notion](https://app.notion.com/p/Product-Follow-up-Register-3a6e5c7c2b8e81cebe96de50b64f3bbd) |
| Current staging evidence | [Repository](../testing/staging-activation-run-2026-07-21.md) · [Notion](https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489) |
| Repeatable manual procedure | [Repository](../testing/gate-c-manual-test.md) · [Notion](https://app.notion.com/p/3a3e5c7c2b8e8155aa10c869b97b7e5a) |
| Active delivery plan | [Repository](../superpowers/plans/2026-07-19-production-operator-platform.md) · [Notion](https://app.notion.com/p/Production-Operator-Platform-and-Integration-Harness-Implementation-Plan-3a2e5c7c2b8e8191ba1ff65dd30752b3) |
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
  stored customer attributes, evaluation decision snapshots, and atomic
  idempotent Promo redemption.
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

## Current work

PR #8 fixed the no-budget free-shipping editor path and is merged into `dev`.
It added:

- explicit **Add budget** and **Remove budget** controls;
- field-specific budget validation;
- explicit free-shipping/monetary-budget conflict guidance; and
- regression coverage proving a no-budget free-shipping request omits
  `budget`.

The immediate sequence is:

1. The user deploys Operator Web from current `dev`.
2. Repeat the no-budget free-shipping create, publish, and hard-refresh case.
3. Complete the remaining tenant-isolation checks.
4. Complete evaluation, redemption, idempotent-retry, and exhaustion checks.
5. Update the staging report, follow-up register, active plans, this page, and
   their Notion mirrors with the final Gate C result.

No assistant-run Cloudflare mutation is permitted. The assistant supplies one
command at a time; the user runs every deployment, migration, secret, domain,
or other Cloudflare write.

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
connector. The canonical contracts, connector conformance boundary, typed
customer/context schema, conditional rewards, and provider-neutral financial
authority are designed to remain common across those integrations.

## Known gaps and deferred work

The [Product Follow-up Register](./follow-up-register.md) is authoritative and
must be updated whenever a finding changes state. It currently preserves:

- client-readiness UX gaps, including signed-in identity/scope, demo data on
  Overview, and live-page styling;
- member passkeys/MFA and safer invitation account handoff;
- schema deprecation, stale impact state, and lifecycle presentation;
- Promo active-vs-draft comparison, revision history, deliberate single-draft
  semantics, silent sample seeding, and catalog mapping for `productRef`;
- the complete approved free-shipping financial-authority design;
- future event ingestion/mapping and event-triggered Loyalty, Referral, and
  Affiliate behavior;
- Loyalty wallet terminology and asset-catalog work;
- Affiliate/Referral production runtimes;
- custom role composition; and
- integration-specific incurred-cost mapping.

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
