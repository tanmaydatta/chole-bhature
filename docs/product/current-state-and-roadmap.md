# Product Current State and Roadmap

**Updated:** 2026-10-26

**Status:** Active — Gate C complete; GAP-030/031 and the E2E platform are
merged on `dev`. The separate Secrets Store cutover is deployed and verified
in staging and PR #15 merged into `dev` at
`0c5e5f1a068d942af8f091ab0fc4b7ff8bf44e9d`. No production, API/Core,
or D1 migration is part of that cutover.

**2026-10-26 local list/detail checkpoint — GAP-005:** Live Promo list/detail now
uses themed hierarchy, actions, semantic table and named configuration/review
regions. Native encoded name links, contained table/JSON scrolling and real
keyboard operation retain the existing workflow and permission gates. The
[local proof](../testing/preauth-local-promo.md#promo-list-and-detail-presentation-check--2026-10-26)
records both themes, minimum owned text contrast 5.168555560022562:1 and
owned 1280/375px bounds against the fixed shell's actual allocation. Full
build/lint, 2,404 Vitest cases (316 dashboard) plus nine Node tests and the
existing Admin preauth case passed (19.3s; four resources cleaned and fresh
zero Product/Auth rows). One earlier RED run lacked protected cleanup proof
after a 409 disposal refusal; its retained evidence and limits are recorded
separately. At this local checkpoint the slice was uncommitted with no new CI,
deployment, authenticated staging acceptance or Notion update. Variables,
Customers and excluded shared layouts keep GAP-005 open; full
diff/history/ranked-priority work stays separate.

**2026-10-26 reviewed list/detail candidate:** Independent task and final
reviews approved the bounded presentation snapshot with no blocking source
findings. It is a PR candidate for `dev`; CI completion, merge, deployment,
authenticated staging acceptance and Notion synchronization remain unclaimed.
The earlier disposal 409 and unproved original cleanup remain an operational
concern; the final run's successful inventory proves only its own cleanup.

**2026-10-23 editor slice — GAP-005:** Live Promo create/edit now uses
the established theme, PageHeader, named panels, explicit field/action styles
and visible keyboard focus. Editor-owned fields stack at 375px and actions
wrap; shared condition widgets and the account strip are outside the layout
claim. Focused rendered/permission tests passed 100 cases; the existing Admin
preauth capped-Promo case passed in 17.4s, including light/dark rendered text
contrast of at least 6.287528596095884:1, desktop/mobile bounds and native
keyboard checks. Exact 25%, GBP 1500 cap, draft persistence and active revision
1 remain verified; all four resources were cleaned with fresh zero Product/Auth
rows. The [local editor proof](../testing/preauth-local-promo.md#promo-editor-presentation-check--2026-10-23)
records the measured checks. Full build/lint and 2,396 Vitest cases (308
dashboard) plus nine Node tests passed; the root suite took 86.18s wall.
At that local checkpoint the change was uncommitted. It subsequently merged
through [PR #34](https://github.com/tanmaydatta/chole-bhature/pull/34) at
`8ccbeb3fef2ed05e75036ba0238a763772709266`, tree
`75584a84122912ea1a4e043c3c9111c7499e7322`.
[PR CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39964299545)
passed verify/local-e2e; [post-merge CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/40006960247)
passed verify with PR-only local-e2e skipped. The scoped October 23 roadmap/register
Notion checkpoint was synchronized with original blocks preserved. Editor
deployment and authenticated staging acceptance remain unverified.

**2026-10-14 product slice:** The evaluate-only [Evaluation Playground](../integration/evaluation-playground.md)
is implemented, independently reviewed and merged through
[PR #23](https://github.com/tanmaydatta/chole-bhature/pull/23) at
`1d25ef36d06fb7b44b288bd85c3a92d61999983d`.
Build/lint, 1,805 Vitest cases plus nine Node tests, and all nine headless local
Playwright cases (49.3 seconds) passed. It supports anonymous/stored-customer baskets, published typed
live fields, automatic/coded selection and authoritative merchandise pricing
through the existing private Operator/Core evaluation path. Evaluation saves
the normal signed snapshot; it exposes no redemption or spending action.
The separately approved API/Operator staging rollout passed all seven
applicable headless cases, with two existing local-only skips and zero
failures; all three Playground cases passed. Final inventories confirmed eight
disposed runs, 53 cleaned resources and zero run-owned Product/Auth rows.
Exact versions and evidence limits are in the
[dated staging verification](../testing/evaluation-playground-staging-2026-10-14.md).
Identity, migrations, secrets, production and the demo were unchanged.
This does not complete full Task 10 or Gate D. The E2E
rewrite is parked; the existing managed local suite remains available.
The Notion mirror below describes the dated 2026-10-07 checkpoint. The
verified feature-merge status checkpoint and the separately approved staging
receipt are distinct from that historical whole-page mirror checkpoint.
Release publication synchronizes scoped current-status evidence, not a
wholesale replacement of historical pages.

**2026-10-19 merged product slice — GAP-023:** The live Promo editor now accepts
human percentages for order, line-item, and fallback discounts. Values from
0.01 through 100 with at most two decimal places convert exactly to integer
basis points; invalid text stays visible with accessible guidance and blocks
Save and Retry save. Existing monetary caps and condition authoring are
preserved. Build/lint, 2,306 Vitest cases plus nine Node tests, and the existing
preauthenticated capped-Promo browser case pass locally. The dashboard includes
288 tests and 40 live journey cases. The browser proof checks percentage edits
and edit/reload persistence alongside the exact GBP cap and active revision 1;
all four owned resources were cleaned with zero Product/Auth rows.
[PR #27](https://github.com/tanmaydatta/chole-bhature/pull/27) merged into `dev`
at `60656f42b35f61ed8d075aed7ab567b853243b87`, with the exact tested tree
`451247ff43b4bc08945daaa426de3c41f7366462`. The final local suite passed all
ten cases in 30.2 seconds; [PR CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39267229449)
passed `verify` and all ten headless cases in 58.1 seconds without retries.
[Post-merge CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39268221950)
passed `verify`; `local-e2e` was intentionally skipped on the `dev` push, not
rerun. The paired isolation case now uses fixture Admins and proves both
run-owned Product/Auth inventories zero before retiring capability/member
files. The default full suite still has one global ROOT/passkey bootstrap;
the earlier paired-passkey failure's underlying cause remains unknown.
The editor is now included in the 2026-10-21 Operator deployment below;
authenticated staging verification remains pending. Full Task 10 and Gate D
remain open. This closeout changes status only; the next client-readiness
feature requires a separate file/test plan and approval.

**2026-10-21 deployed product slice — GAP-003:** The separately approved
account/client indicator is merged and deployed to staging Identity/Operator.
Identity owns name/email,
fixed role and validated client name; the strict BFF session display omits the
private session ID. A shared accessible strip covers authenticated shell pages
and full-page Promo editors, with distinct ROOT/no-selection and Test fixture
labels. Full build/lint, 2,369 Vitest cases plus nine Node tests, the exact Admin
preauth case (14.1s) and all ten headless cases (23.4s) pass locally. Real scroll
and hit checks verify headers/editor actions, bottom navigation and separate
demo labeling; owned Product/Auth cleanup passed. [PR #29](https://github.com/tanmaydatta/chole-bhature/pull/29)
merged feature source `84c2fe7` at `57370166bf5975861e29c8248ed922556721b83c`.
[PR #30](https://github.com/tanmaydatta/chole-bhature/pull/30) merged the
Auth-through-`0006` compatibility correction at
`a5d260cd7cf6574951bf081385c1f22fc84dc944`;
[exact-tree CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39581835724)
passed. The limited Identity-first/Operator release passed fresh build,
configuration/privacy, public health/session and exact served-asset checks.
Authenticated account/client and Core RPC/Promo acceptance remain pending;
no login, E2E or fixture writes occurred. The
[dated release record](../testing/account-context-staging-2026-10-21.md)
records versions, provenance and limits. The scoped release status was
synchronized to the existing three Notion pages and readback-verified on
2026-10-21; historical checkpoints and unrelated content were preserved.
The [account contract](../integration/core-contracts.md#operator-account-and-client-display)
records the additive Identity-first, matching BFF/Dashboard contract.
This changes no Core API, migration or secret and does not close Task10/GateD.

**Historical 2026-10-21 local product slice — GAP-004:** Overview now states
“Overview metrics aren’t available yet” instead of showing fabricated metrics
and browser-local program rows. Every admitted reader can open **View promos**;
**New promo** uses the existing `programs:manage` permission. Account/client,
ROOT selection and read/session gates remain intact. Overview has no Demo data
badge; unrelated demo pages remain labeled. No analytics service, data fetch,
program-count claim or contract was added. Build/lint, 2,394 Vitest cases plus
nine Node tests, and the existing Admin preauth browser case passed locally
(15.2s; all four owned resources cleaned, zero Product/Auth rows). The browser
uses the real theme toggle and computed colors to verify at least 4.5:1 text
contrast for **View promos** in both light and dark themes.
The [local Overview proof](../testing/preauth-local-promo.md#overview-unavailable-check--2026-10-21)
records reload and navigation into the real Promo list, with all prior capped
Promo authoring/publication assertions retained. At this local checkpoint,
the slice was uncommitted, not merged, deployed or accepted in staging;
independent local review was complete and publication remained pending.
Scoped local-checkpoint synchronization to the existing roadmap and register
Notion pages was readback-verified.

**2026-10-22 merged and deployed slice — GAP-004:**
[PR #32](https://github.com/tanmaydatta/chole-bhature/pull/32) merged at
`909de21fa82e1af7be809fbc51fed3321b52569d`, tree
`81767a5292c10a3e530b1bd7fbf2ac7b01b9b155`.
[Pre-merge CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39667095606)
passed `verify`/`local-e2e`;
[post-merge CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39750665293)
passed `verify`, with `local-e2e` skipped on the `dev` push. The separately
approved Operator/Dashboard-only release deployed
`1ea858a5-e74c-43bd-b007-750356bc37ea` at 100% traffic. Fresh build,
packaging, unchanged configuration/privacy, health, typed unauthenticated
session and four exact served-asset checks passed. Identity/Core were unchanged;
Core immutable source mapping remains unestablished. Authenticated staging
acceptance was not verified; the documented automation session was expired,
and no new login/auth setup was performed. No fixture, business write or E2E
run occurred. See the
[dated staging record](../testing/overview-staging-2026-10-22.md).
The 2026-10-21 theme/role/reload/owned-Promo browser proof remains local evidence.
The scoped 2026-10-22 release-status update was synchronized to the existing
three Notion pages and independently readback-verified; full
Task 10/Gate D and parked cloud/preauth work remain outside this result.

**2026-10-19 Task11 baseline:** The public-contract
[checkout CLI simulator](../integration/integration-simulator.md) is implemented
from docs PR#24 merge `edda1577b4887128b687053bab3ebc7ce93f9fe2`.
Its separately approved authenticated read-only capabilities marker derives
simulator permission only from explicit server local/staging configuration.
Focused tests, build/lint, 1,864 Vitest cases plus nine Node tests and all ten
headless local Playwright cases pass (26.3 seconds). The real managed-local D1
flow proves accepted/retry/exhaustion/repricing and zero owned rows. ROOT
non-author review is complete. [PR #25](https://github.com/tanmaydatta/chole-bhature/pull/25)
merged into `dev` at `13d7259b6d2a9ffa9df2990e10b4d13c0ee51c31` after PR CI.
[PR #26](https://github.com/tanmaydatta/chole-bhature/pull/26) then merged the
bounded preauthenticated local Promo/control checkpoint at
`04bf1cf5f9eb3a44a2a81340c9f135ab33b72b1d`.
Its preauthenticated proof covers one Promo browser flow; it is not a full-suite
conversion. The 2026-10-21 release includes matching Operator BFF code, but
leaves Core unchanged. Complete CLI/capabilities staging verification and
full Task10/GateD acceptance remain pending and are not claimed.

The dated approved per-PR Cloud E2E checkpoint work was implemented on
`feat/per-pr-cloud-e2e`, based on `origin/dev` commit
`f189f5a2ef53a8999969344338f68a2f1117899b` (cached local reference, not a fresh
remote check). Tasks 1–4, mock-only Task 5a/5b, Task 5d raw-module packaging,
Task 5e non-authorizing diagnostics, Task 6a application CI admission and
bounded local Task 6b exact-D1 bootstrap have accepted local evidence. The
separately approved 2026-10-07 checkpoint guard correction is reviewed and
locally accepted at tested source `9408704`. Scoped re-review of
`3ba5c14..3da30f3` is COMPLIANT / APPROVED: I1–I4/M1 addressed, 0 open
Important findings and no new findings (`checkpoint-fix1-review.md`). On that
source freeze, 337 cloud tests,
1,683 Vitest cases (1,592 main-config plus 91 Identity Node-config), nine
separate Node script tests, build/lint and all five local Playwright
cases pass. The [correction ledger](../testing/per-pr-cloud-e2e.md#checkpoint-lifecycle-and-creation-correction-2026-10-07)
records lifecycle/readback persistence, irreversible post-create quarantine,
client-wide creation reservations and the adopted token-name boundary.
The mock controller still stops at the unresolved Operator graph; public
Worker writes refuse with zero transport calls. No Cloudflare stack has
been deployed or tested: automatic per-PR
Cloudflare writes are disabled, and no live pilot has run.

**Notion mirror:** https://app.notion.com/p/Product-Current-State-and-Roadmap-3a6e5c7c2b8e81f6b412c45a2bc7b344

**Scoped mirror checkpoint (2026-10-19):** GAP-023/PR #27 merged status and the
distinct PR/post-merge CI results are synchronized to the existing Notion page.
This is a scoped status update; the historical whole-page checkpoint below and
all unrelated content remain unchanged.

**Scoped mirror checkpoint (2026-10-21):** GAP-003/PR #29, compatibility
PR #30 and the limited Identity/Operator release status are synchronized to
the existing three matching Notion pages with verified readback. This is a
scoped status update, not whole-page mirror equality; unrelated content and
the historical checkpoints below are preserved.

**Mirror state (2026-10-07):** The reviewed nonsecret accumulated-checkpoint
summary is synchronized to the existing roadmap, design, plan and Plans
index. It identifies tested source `9408704`, scoped review
`3ba5c14..3da30f3` and local closure `3c04e95`. Complete whole-page readback
equality passed with all other content and all 17 ordered native child
URLs/titles/active metadata preserved and independently verified by root;
the [checkpoint publication ledger](../testing/per-pr-cloud-e2e.md#reviewed-local-checkpoint-publication-2026-10-07)
records the bounded scope and provenance. The 2026-10-06 bootstrap publication
at `07af8ed`/`4d6df6a`/`3ba5c14` and earlier publications remain dated history.
The clarification draft remains unsent; its body and wholesale local evidence
were not published. This publication closes no live-pilot or full-plan gate.

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
| Overall phase | Post-Gate-C client readiness; evaluate-only Playground merged and verified in staging |
| Current activity | GAP-005 Promo list/detail polish is locally verified and independently reviewed as a PR candidate for `dev`; editor polish merged through PR #34. Variables, Customers and excluded shared layouts remain open. Authenticated staging Overview/Promo acceptance remains pending; E2E rewrite/cloud provisioning remain parked. |
| Current repository baseline | PR #34 merge `8ccbeb3fef2ed05e75036ba0238a763772709266`, tree `75584a84122912ea1a4e043c3c9111c7499e7322`, is the list/detail slice's base. PR CI `39964299545` passed verify/local-e2e; post-merge `40006960247` passed verify with local-e2e skipped. The new working slice has no CI result. |
| Current product-code baseline | Editor PR #34 is merged after GAP-004 PR #32, GAP-003 PR #29 and compatibility PR #30. Only PR #32's source has the recorded October 22 Operator deployment proof; Identity/Core were unchanged in that release. Complete simulator/capabilities acceptance remains unproved. |
| Local feature state | The reviewed list/detail candidate passes build/lint, 2,404 Vitest plus nine Node tests and the Admin preauth case (19.3s), including both themes, owned 375px containment, native keyboard and final four-resource/zero-row cleanup. An earlier failed disposal remains explicitly unproved. The editor's 2,396 Vitest plus nine Node tests and 17.4s browser run are dated evidence for merged PR #34. GAP-003/004/023 staging acceptance and full Task10/GateD remain open. Cloud checkpoint proof remains dated local evidence with public Worker writes refused before transport. |
| Latest recorded deployment | The October 22 record has Operator `1ea858a5-e74c-43bd-b007-750356bc37ea`, unchanged Identity `ac888e12-3685-49c0-a981-02a0aaea38c6` and unchanged Core `e38ee573-5a56-444e-9707-ab6f73cb1490` at 100% staging traffic. Current deployment was not queried for this local slice. Core immutable source mapping remains unestablished. |
| Current release decision | The 2026-10-22 Operator-only release passed public health/privacy/session/asset checks. Authenticated staging acceptance was not verified; the documented automation session was expired, and no new login/auth setup was performed. No fixture/business write or E2E run occurred. Full Task 10/Gate D and production acceptance remain open. |
| Gate C finish line | Complete — all mandatory clean-break selection, redemption, tenant-isolation, concurrency, and observability cases passed |
| Next plan work | Publish the reviewed GAP-005 list/detail candidate into a PR against `dev` and inspect CI. Merge, deployment and authenticated staging acceptance are subsequent checkpoints. Variables, Customers, excluded shared layouts, full simulator/capabilities and Task10/GateD remain open. |

## Source-of-truth map

Use this page for current sequencing and status. Follow its links for detail:

| Need | Source |
|---|---|
| Current state and next work | This page |
| Every known gap, resolved incident, and deferred capability | [Repository](./follow-up-register.md) · [Notion](https://app.notion.com/p/Product-Follow-up-Register-3a6e5c7c2b8e81cebe96de50b64f3bbd) |
| Gate C staging evidence | [Repository](../testing/staging-activation-run-2026-07-21.md) · [Notion](https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489) |
| GAP-030/031 staging E2E evidence | [Repository](../testing/gap-030-031-e2e.md) |
| Protected Task 10 cutover and recovery | [Repository](../testing/task10-staging-cutover.md) · [Notion](https://app.notion.com/p/Task-10-protected-staging-cutover-and-recovery-3a7e5c7c2b8e817f9c0cf0acab3e8c2e) |
| Repeatable manual procedure | [Repository](../testing/gate-c-manual-test.md) · [Notion](https://app.notion.com/p/3a3e5c7c2b8e8155aa10c869b97b7e5a) |
| GAP-030/031 local and staging E2E procedure | [Repository](../testing/gap-030-031-e2e.md) |
| Active delivery plan | [Repository](../superpowers/plans/2026-07-19-production-operator-platform.md) · [Notion](https://app.notion.com/p/Production-Operator-Platform-and-Integration-Harness-Implementation-Plan-3a2e5c7c2b8e8191ba1ff65dd30752b3) |
| Approved Promo selection and atomic-redemption design | [Repository](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Design-Spec-3a6e5c7c2b8e81549b6adc7f3d096455) |
| Current correction implementation plan | [Repository](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md) · [Notion](https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Implementation-Plan-3a7e5c7c2b8e811791dee0d21803c8e2) |
| Approved free-shipping financial design | [Repository](../superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md) · [Notion](https://app.notion.com/p/Free-Shipping-Budget-Authority-Reservations-and-Reversals-Design-Spec-3a6e5c7c2b8e81f49c6ecbf878d7d48c) |
| Per-PR Cloud E2E design and implementation plan | [Repository design](../superpowers/specs/2026-09-29-per-pr-cloud-e2e-design.md) · [Notion design](https://app.notion.com/p/Per-PR-Cloud-E2E-Design-Spec-3ebe5c7c2b8e8186866ef1e158bfd880) · [Repository plan](../superpowers/plans/2026-09-30-per-pr-cloud-e2e.md) · [Notion plan](https://app.notion.com/p/Per-PR-Cloud-E2E-Implementation-Plan-3ebe5c7c2b8e81229ee0d8a0acb2d309) |
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
- The evaluate-only Playground is implemented and verified in staging at `/playground`, with
  `evaluations:run` authorization, typed published live fields, exact discount
  allocations and code diagnostics. Its local browser evidence uses ROOT and
  normal client selection; member role authorization and signed snapshot
  persistence are verified at the BFF/Core boundaries. Three ROOT browser
  scenarios also passed in staging; this does not close full Task 10.
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

The [2026-10-22 Overview release](../testing/overview-staging-2026-10-22.md)
adds public deployment/configuration/privacy/health/session/asset evidence for
the new Operator source. It adds no authenticated Overview or Promo browser
acceptance; the documented automation session was expired, and no new
login/auth setup was performed.

The [2026-10-21 limited rollout](../testing/account-context-staging-2026-10-21.md)
adds public health/privacy/session and exact asset checks for deployed
Identity/Operator source. It adds no authenticated product/browser acceptance;
the earlier staging cases below remain dated evidence.

The [2026-10-14 evaluate-only staging record](../testing/evaluation-playground-staging-2026-10-14.md)
adds the three Playground browser cases and repeats the existing applicable
API/Promo suite: seven passed, two local-only skips, zero failures. All eight
run inventories ended with zero Product/Auth owned rows. Browser authority is
ROOT; member sign-in/email/passkey acceptance is not claimed by this run.

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
- the 2026-09-28 E2E rollout: Product migration-ledger repair for `0007`
  after its exact nullable `price_breakdown_json` `TEXT` schema was confirmed,
  followed by Product migration `0008`; Auth migrations `0005` and `0006`;
  and API, private Identity, and Operator Web deployments;
- root passkey sign-in followed by the staging Playwright suite: 4 passed, 1
  local-only test skipped, in 29.3 seconds. The passed tests exercised exact
  GAP-030/031 authoring, evaluation, signed redemption and retry; concurrent
  run-scoped tenant isolation; failed-run disposal; and real-browser Promo
  authoring, persistence, and publication. Each cleanup assertion found zero
  run-owned rows in both Product and Auth D1; and
- interactive entry of `AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, and
  `OPERATOR_SELECTION_SECRET`. A noninteractive secret put was immediately
  replaced interactively and is not accepted as a safe secret-upload method.
- the 2026-09-29 Secrets Store cutover: the existing account store was reused;
  all four staging entries were active at Workers scope; Identity deployed 100%
  to `b247bae5-d34a-4e4a-ab21-5874089e1d3a`; and Operator Web deployed 100%
  to `9e9c9580-b915-4200-befb-502cdda750c0`. The source was PR #15 head
  `df05d8d`, and PR #15 merged into `dev` at
  `0c5e5f1a068d942af8f091ab0fc4b7ff8bf44e9d`; the old per-Worker secrets
  remain retained;
- a live root session and read-only capability handshake passed after that
  cutover; the complete staging Playwright suite had **4 passed, 1 local-only skipped, 0 failed** in **32.0 seconds**. Scenario-level cleanup asserted
  zero run-owned rows in both Product and Auth; the cumulative final inventory
  found zero active or disposing claims in both, with 10 disposed claims and
  10 audit rows in each.

The detailed automated evidence and its boundaries are in the
[GAP-030/031 automated end-to-end verification](../testing/gap-030-031-e2e.md).
PR #14 merged into `dev` at
[`b524c32b98652cfcadb75c7af2f234cf33495f6b`](https://github.com/tanmaydatta/chole-bhature/commit/b524c32b98652cfcadb75c7af2f234cf33495f6b)
after its CI `verify` check passed. The 2026-09-28 record does not state Worker
version IDs or claim a headed staging run or manual email-delivery verification.
The 2026-09-29 cutover likewise does not verify email delivery or a headed run.

## Current work

The approved GAP-005 list/detail presentation slice is locally verified and
independently reviewed as a PR candidate for `dev`. Its
[local proof](../testing/preauth-local-promo.md#promo-list-and-detail-presentation-check--2026-10-26)
covers owned theme/contrast, containment, native keyboard operation and the
persisted capped-Promo journey, with failed-run cleanup limits retained.
The earlier editor slice merged through PR #34 with the distinct PR/post-merge
CI results above; its scoped October 23 Notion checkpoint is synchronized.
Variables, Customers and excluded shared layouts keep GAP-005 open. No new
CI, deployment, authenticated staging acceptance or mirror update is claimed
for the list/detail slice.

Next priority is a bounded full-demo plan (author/publish → evaluate → redeem
→ retry → cap exhaustion/reprice), pending explicit implementation approval.

GAP-003 and the Identity compatibility correction are merged and deployed
under the limited 2026-10-21 release. GAP-023 editor code is included in the
Operator build. Public checks passed; authenticated account/client, Core RPC
and Promo acceptance remain pending. GAP-004 is merged through PR #32 and
deployed in the Operator-only 2026-10-22 release. Public verification passed;
authenticated Overview/Promo acceptance remains pending. It adds no analytics
capability. See the [staging record](../testing/overview-staging-2026-10-22.md)
and the distinct [local Overview proof](../testing/preauth-local-promo.md#overview-unavailable-check--2026-10-21).

The [public-contract checkout CLI](../integration/integration-simulator.md) and its
approved canonical read-only capabilities prerequisite are already merged
through PR #25. The CLI validates published
fixtures before customer updates, maps canonical merchandise pricing, commits
before fake capture, verifies retry and reprices real capacity exhaustion.
Only public contracts/connector-kit are runtime dependencies. Local preseed and
cleanup use existing run-owned fixtures; there is no new E2E/auth framework.
No staging/provider writes were part of that implementation checkpoint. The
2026-10-21 Operator release includes its BFF changes; Core stays unchanged,
and the complete simulator/capabilities staging contract is not accepted.

The previously delivered evaluate-only Playground is described
in [Evaluate a basket in the Playground](../integration/evaluation-playground.md).
The existing evaluation service and calculator remain authoritative. Stored
customer attributes are resolved by Core, request bodies carry no merchant or
actor authority, and input changes invalidate results. Local verification and
independent ROOT review are complete. The approved publication checkpoint is a
merged feature PR #23, followed by separately approved two-Worker deployment
and seven applicable headless staging passes. Its matching docs PR#24 is now
merged, and four scoped existing Notion status paragraphs were synchronized.
Full Task 10, Gate D, production and cloud provisioning remain outside the slice.

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

The Gate C sequence completed as follows:

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

The authoritative merchandise-pricing correction adds a single calculator;
required stable line identities; ordered per-Promo and per-line allocations;
optional exact-currency percentage maximums; signed evaluation and redemption
evidence; atomic per-Promo ledger/budget amounts; historical version-2
redemption compatibility; and operator cap authoring/detail display. Focused
contract, calculator, module, connector, dashboard, API, repository, and real
Worker/D1 full-flow tests are the acceptance boundary. The 2026-09-28 staging
result covers the E2E scenarios described above; it does not claim Worker
version IDs, a headed staging run, or email-delivery verification.

The approved staging-only Secrets Store cutover is complete: the existing store
was reused, four Workers-scope entries were activated, and reviewed Identity and
Operator Web source deployed and passed its scoped E2E verification. It did not
include database migrations, Core deployment, production, or unrelated
resources. Old per-Worker secrets remain pending separately reviewed cleanup.

The approved [per-PR Cloud E2E design](../superpowers/specs/2026-09-29-per-pr-cloud-e2e-design.md)
and [implementation plan](../superpowers/plans/2026-09-30-per-pr-cloud-e2e.md)
preserve manual staging and exclude fork pull requests. Tasks 1–3 are verified
locally: the 5-test Playwright baseline ran in 24.4 seconds, the trusted
run-identity boundary rejects forks and stale heads, and the controller-side
artifact boundary verifies only a bounded untrusted bundle. Task 4 added
reviewed exact-identity inventory and fail-closed client guards. The dated
2026-10-02 mock-only Task 5a/5b amendments/controller passed 83 local cloud
tests and kept public Worker create/update/delete/subdomain calls
disabled before transport. The mock controller drives separate Beta IDs,
fixed request plans, disabled/readback and token-exclusive Access gates; it
stops after a pure API code plan at the unresolved Operator gate. Durable mock
token and Access create intents plus correlated ID checkpoints remove future-ID
preseeding, and all three role receipts rotate together after each identity
checkpoint. Their run/role reservation canonicalizes the trusted key within
one local evidence-store object and
process; it is not store CAS or cross-process coordination. Mock D1 cleanup
is observed only before a Worker exists; unresolved graphs remain inventoried.
Failed Auth pre-create reads or intents leave proven Product independently
cleanable; an ambiguous Auth POST retains only that uncertain D1 target when
there is no Worker graph. Changed IDs or failed deletes are never called clean.
The controller keeps session registration and raw cleanup private, so forged
or copied session objects cannot authorize provider calls.
The later accepted local slices include Task 5d raw-module packaging and its
metadata correction; Task 5e diagnostic comparisons that always remain
unsupported; Task 6a CI admission/cookie/service consistency; and bounded
Task 6b exact-D1 bootstrap with immutable target/deadline and irreversible
clock observations. Accepted tested source `07af8ed` passed 322 cloud tests,
1,592 Vitest plus nine Node, eight real D1/runner and five local Playwright
cases (22.6 s); those are historical 2026-10-06 results.
The 2026-10-07 accumulated review found four Important exported-client/
discovery gaps. Their approved correction now passes 337 cloud tests and
fresh complete project/build/lint plus five local Playwright cases (23.4 s);
independent scoped re-review of `3ba5c14..3da30f3` is COMPLIANT / APPROVED,
with I1–I4/M1 addressed, 0 open Important and no new findings. Root accepted
tested source `9408704`; documentation-only closure reruns no unchanged
suite. It preserves terminal stages,
checkpoints legitimate transitions, fences ordinary mutation by lifecycle,
poisons ambiguous Access/token POST outcomes, reserves same-client creation
before awaits and validates the adopted token name/body before POST.
M2 long tar names, M3 partial extraction residue, M4 object-order false refusal
and M5 sanitized operation/stage diagnostics remain explicitly deferred in the
[current correction ledger](../testing/per-pr-cloud-e2e.md#checkpoint-lifecycle-and-creation-correction-2026-10-07).
The [public-API feasibility ledger](../testing/per-pr-cloud-e2e.md#worker-api-feasibility-public-documentation-2026-09-30)
records unresolved first-route, service-binding, Access, assets and audit
requirements. No Cloudflare resource was created, no
disposable-stack pilot has run, and no deployment, full cloud suite, or
automatic per-PR Cloudflare write is claimed.

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

Free shipping must not report a fictional monetary saving. The merchandise
breakdown reports zero discount for that effect; a shipping-specific price
breakdown remains deferred until the authoritative shipping quote and
reservation flow below exists.

Bulk unique-code pools, new-price discounts, free products, BOGO/bundles,
dynamic formulas, reusable catalog collections, recurring schedules, and
richer stacking policies are recorded as deliberately deferred in `GAP-032`.
They remain extension points and become implementation work only when a client
case justifies them.

The focused `GAP-030`/`GAP-031` implementation merged as PR #13 and uses the
[executable end-to-end plan](../testing/gap-030-031-e2e.md). The E2E platform
source was deployed and verified in staging on 2026-09-28, and PR #14 merged
into `dev` at `b524c32b98652cfcadb75c7af2f234cf33495f6b`. The separate
Cloudflare Secrets Store cutover then deployed to staging from PR #15 head
`df05d8d` on 2026-09-29: it reused the existing store, activated four
Workers-scope entries, deployed Identity and Operator Web, and passed the
read-only root/capability gate plus 4 passed, 1 local-only skipped, and 0
failed staging Playwright tests in 32.0 seconds. PR #15 then merged into `dev`
at `0c5e5f1a068d942af8f091ab0fc4b7ff8bf44e9d`; Bitwarden remains the source
of truth and old per-Worker secrets remain retained.

### 3. Implement approved per-PR Cloud E2E execution

The approved design uses a trusted controller and isolated, disposable
Cloudflare resources for same-repository pull requests; it does not repurpose
manual staging. Tasks 1–4, mock-only Task 5a/5b, Task 5d/5e and bounded local
Task 6a/6b are implemented and locally accepted. The current checkpoint guard
correction is reviewed and locally accepted at tested source `9408704`, with
0 open Important/no new findings in scoped range `3ba5c14..3da30f3`.
Worker writes remain blocked and the design is not deployed or automatic.

The remaining milestones are, in order:

1. separately authorized provider clarification/prerequisite work and any
   eventual adoption; local acceptance supplies no automatic progression;
2. a separately approved protected two-stack infrastructure pilot resolving
   Beta recovery, provider response shapes, assets, service-binding remapping,
   and no code exposure before Access;
3. remaining deployed Task 6b authenticated configuration, exact graph and
   remote D1 atomicity certification; local runtime admission/bootstrap is
   already implemented;
4. a real HTTPS passkey/full-suite pilot;
5. failure and cancellation cleanup, including independent reconciliation and
   janitor behavior; and
6. a protected every-push workflow only after the full pilot security matrix
   passes. Fork pull requests remain excluded.

### 4. Turn the approved free-shipping financial design into an implementation plan

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

1. Task 10 — the evaluate-only Playground slice is merged and verified in staging;
   broader historical Task 10 scope remains open, with no redemption controls
   authorized by this slice.
2. Task 11 — public-contract CLI simulator merged through PR #25; matching
   Operator BFF code shipped on 2026-10-21 with Core unchanged. Complete
   staging verification and the full Gate D comparison remain pending.
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

- authenticated staging acceptance of the deployed signed-in identity/scope
  indicator and merged/deployed unavailable Overview, plus live-page styling;
- member passkeys/MFA and safer invitation account handoff;
- schema deprecation, stale impact state, and lifecycle presentation;
- Promo active-vs-draft full comparison, revision history/rollback, deliberate
  single-draft semantics, and catalog mapping for `productRef`;
- authenticated staging verification of the deployed GAP-023 percentage editor;
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
- authoritative Promo price calculation and per-Promo/line allocation, merged
  in PR #13 and exercised by the 2026-09-28 staging E2E run; and
- optional maximum monetary caps for percentage rewards, merged in PR #13 and
  exercised by the 2026-09-28 staging E2E run; and
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

Repository updates awaiting an authorized Notion export must state the mirror
lag explicitly; reconcile the copies before claiming them synchronized.
Use concrete statuses: `Todo`, `In progress`, `Blocked`, `Done`, `Deferred`, or
`Killed`.
