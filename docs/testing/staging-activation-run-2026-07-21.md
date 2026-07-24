# Staging activation run — 2026-07-21

**Status:** In progress — Tasks 1–9 of the Promo-selection correction are
implemented and verified locally, but the owner-controlled staging
migration/deployment and every new Task 10 manual case remain unrun

**Notion:** https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489

**Follow-up register:** [Product follow-up register](../product/follow-up-register.md)

## Environment

- API health: Pass (`GET /v1/health` returned 200 with `{ "status": "ok" }`)
- Operator origin: Pass (dashboard loaded over HTTPS)
- Identity exposure: Pass (private Worker was not publicly reachable)
- Product/Auth migrations: Pass (no pending migrations after activation)
- Persisted Worker logs: Pass (API, Identity, and Operator Web redeployed with 100% staging log sampling)

## Completed manual checks

- Root activation grant exchange: Pass
- Root passkey registration and sign-in: Pass
- Recovery codes displayed and stored by the operator: Pass; values not recorded
- Client provisioning: Pass for two active staging clients
- Root client selection and refresh persistence: Pass for both clients
- Client-admin invitation creation and delivery: Pass
- Client-admin invitation acceptance: Pass
- Client-admin magic-link sign-in in a fresh browser profile: Pass
- Client-admin scope: Pass (no Root access banner or platform Clients navigation)
- Client-admin viewer onboarding: Pass (invitation delivered, accepted, membership active, and magic-link sign-in completed in an isolated browser)
- Viewer navigation and controls: Pass (schema and Promo reads available; customer, team, credential, platform-client, and mutation controls absent)
- Viewer protected routes: Pass (`/customers`, `/settings/team`, `/settings/credentials`, and `/platform/clients` denied)
- Viewer backend mutation enforcement: Pass (schema publication attempt returned HTTP 403 with `FORBIDDEN`)
- Client-admin Operator onboarding: Pass (invitation delivered, accepted, membership active, and magic-link sign-in completed in an isolated browser)
- Operator navigation and controls: Pass (schema, customer, and Promo management available; team, credential, and platform-client controls absent)
- Operator protected routes: Pass (`/settings/team`, `/settings/credentials`, and `/platform/clients` denied)
- Operator backend authorization: Pass (credential read attempt returned HTTP 403 with `FORBIDDEN`)
- Client schema authoring: Pass (required `customer.tier` and `context.channel` enum definitions saved in draft version 1)
- Client schema impact preview: Pass (stored-customer and referenced-program counts shown; required live-context warning shown for `context.channel`)
- Client schema publication: Pass (published version 1 persisted with both definitions)
- Published-definition deprecation safety: Partial (the published snapshot remained unchanged and the working list hid `context.channel`, but no draft version 2 was created)
- Exact customer lookup and creation: Pass (`gate-c-customer` returned the exact not-found state, then persisted a typed Tier value at version 1)
- Customer cross-session update and persistence: Pass (an authorized second session loaded the same record, saved a new typed value, and advanced the version)
- Customer stale-write protection: Pass (a stale authorized session received `VERSION_CONFLICT`, did not overwrite the canonical value, and exposed the refresh action)
- Customer conflict recovery and durable reload: Pass (refresh and subsequent hard-refresh returned the current canonical version and Tier)
- Promo revision 1 authoring: Pass (`gate-c-promo` persisted the complete typed/nested example with two ordered conditional rewards and a fallback)
- Promo revision 1 publication: Pass (draft revision 1 published as active revision 1)
- Promo revision 1 durable reload: Pass (hard-refresh preserved the external reference, reward order/effects, nested customer condition, fallback, limits, and active revision)
- Promo revision 2 authoring: Pass (the fixed logical reference produced draft revision 2 beside active revision 1; reward order changed and line-item fixed became line-item percent)
- Promo revision 2 publication and reload: Pass (revision 2 became active and retained the changed name, order, effect, conditions, and fallback after hard refresh)
- Promo lifecycle transitions: Pass (active revision 2 paused, resumed, and ended irreversibly; every state survived hard refresh and exposed only the valid next actions)
- Free-shipping Promo authoring retest: Pass (`gate-c-free-shipping-retest` saved without a monetary budget, published as active revision 1, and retained its conditioned `free_shipping` effect after hard refresh)
- Staging API credential creation: Pass (a staging secret credential was created with schema-read, evaluation-write, and redemption-write scopes; plaintext was handled only in the tester shell)
- Credential-authenticated published-schema read: Pass (published version 1 returned the expected required `customer.tier` and `context.channel` enum definitions)
- Auto-apply evaluation: Pass (the active free-shipping Promo qualified without a request `code`; the ended Promo returned unavailable)
- Redemption commit: Pass (the qualified free-shipping decision committed with a unique external-order reference and idempotency key)
- Redemption idempotent retry: Pass (an identical retry returned the same committed redemption rather than creating another use)
- Redemption idempotency conflict: Pass (reusing the same idempotency key with a different external-order reference returned HTTP 409 `VERSION_CONFLICT`, non-retryable)
- Evaluation before second commit: Pass (with one committed use and a per-customer cap of 2, a later evaluation still qualified because evaluations do not consume the cap)
- Second redemption commit: Pass (a new evaluation plus new external-order and idempotency identifiers committed the second use)
- Per-customer exhaustion: Pass (the next evaluation returned `exhausted`, no effects, `eligible: false`, `commitRequired: false`, and `PER_CUSTOMER_CAP_EXHAUSTED`)
- Manual-code draft persistence: Pass (`gate-c-manual-code` retained code-triggered mode and code `GATEC15` after a hard refresh and reopening the draft editor)
- Manual-code evaluation without a code: Pass for the current contract (the manual Promo returned `invalid_code`)
- Manual-code evaluation with an incorrect code: Pass for the current contract (the manual Promo remained `invalid_code`)
- Manual-code evaluation with the correct code: Pass (the manual Promo qualified and returned the configured 20% order-discount effect)
- Product-selection acceptance: Fail for the desired client contract (each response also exposed unrelated automatic/coded Promo outcomes, and the current redemption request commits one caller-selected program rather than a signed selected bundle)

The product-selection failure above is historical evidence from the deployed
2026-07-21 build, not the current local contract. Tasks 1–9 now implement the
clean-break `codes[]` request, private automatic/coded selection, ordered atomic
bundle redemption, structured failure logs, and explicit operator trigger
review locally. No staging pass is claimed until Task 10 is deployed and run by
the account owner.

## Schema deprecation discrepancy

- Manual expectation: deprecating `context.channel` after publishing version 1 creates draft version 2 while published version 1 remains unchanged.
- Observed UI: `context.channel` disappeared from the working list, but the page reported no draft and published version 1.
- Read-only remote D1 verification: schema version 1 remained published and its immutable snapshot still contained both `customer.tier` and `context.channel`; the version-1 `context.channel` definition row was marked `deprecated`; `customer.tier` remained `published`; no version-2 schema row existed.
- Database-write verification for diagnosis: zero rows written.
- Current implementation behavior: deprecation is stored immediately on the definition row, while the next draft is created lazily by a later authoring mutation.
- Follow-up decision: either create draft version 2 immediately when a published definition is deprecated, or explicitly specify and represent the lazy-deprecation model in the UI and manual guide. The immediate-draft model is recommended because it makes the unpublished working change and its publish lifecycle visible.

## Free-shipping authoring incident

- Affected flow: create `gate-c-free-shipping` from the live operator UI with one conditioned free-shipping reward, no fallback, and no monetary budget.
- Expected: clearing Budget currency and Budget minor units removes the optional budget and enables **Save draft**.
- Actual: Budget currency became blank, Budget minor units became `0`, and the editor continued to show **Complete every required field and ensure each conditional rule has a condition.**
- Root cause: each Budget input change always writes a `budget` object. Emptying the controls never sets `budget` to `undefined`, and the editor provides no explicit **Remove budget** action. The resulting empty-currency/zero-value budget fails client-side contract validation; a retained valid monetary budget would separately conflict with free shipping.
- Test result: Fail. The free-shipping create/publish/reload portion of `PROMO-02` is blocked through the client-facing UI.
- Required fix: represent “no budget” explicitly in the editor, allow an existing/default budget to be removed atomically, show field-specific validation, and add a browser-level regression covering a no-budget free-shipping save.
- Local resolution: implemented explicit **Add budget**/**Remove budget** actions, field-specific invalid-budget feedback, pre-submit free-shipping/budget conflict guidance, and a regression that verifies the saved request omits `budget`.
- Retest status: Pass after PR #8 was merged into `dev` and the API and
  Operator Web staging Workers were redeployed. A fresh conditioned
  free-shipping Promo saved with no budget, published as active revision 1,
  and survived a hard refresh with the canonical effect intact.

## Invitation incident

- Result before fix: Fail
- Safe response: HTTP 400, `INVALID_REQUEST`, non-retryable
- Correlation: `3d718b24-0ed9-4801-b5e5-a00f458f4f9d`
- Reproduction: the failure remained after correcting the recipient email
- Boundary evidence: Operator Web accepted the browser body and invoked Identity; Identity rejected the create-invitation RPC before invitation processing
- Root cause: an extra top-level `correlationId` violated strict `IdentityCreateInvitationRequestSchema`; the valid correlation ID already belonged inside `input`
- Code resolution: Merged in PR #7 and deployed to API, Identity, and Operator Web staging Workers
- Retest result: Pass; the invitation was created, delivered, accepted, and used for a fresh client-admin sign-in

## Evaluation observability incident

- Affected flow: credential-authenticated `POST /v1/evaluate`.
- Safe response: HTTP 503, `EVALUATION_UNAVAILABLE`, retryable, with the same
  correlation ID in the response body and `x-correlation-id` header.
- Confirmed runtime cause: `incentives-api-staging` had no
  `DECISION_SIGNING_SECRET`; credential generation and schema reads do not
  require that separate decision-integrity secret.
- Historical observability finding: the public API error boundary converted handled
  exceptions into safe canonical responses but did not explicitly emit a
  sanitized structured error log. The returned correlation ID therefore does
  not reliably locate the underlying exception in persisted Worker logs.
- Local code resolution: Task 7 added the centralized sanitized
  `api_request_failed` event and tests proving that the response header, error
  body, signed evaluation snapshot, and log event share the correlation ID.
  Tests also reject Authorization values, credentials, submitted codes, request
  bodies, customer attributes, decision/order/key identifiers, SQL details,
  and dependency stacks from production logs. `GAP-022` is fixed in code but
  awaits the Task 10 staging lookup in `OBS-API-01`.
- Runtime resolution: a fresh `DECISION_SIGNING_SECRET` was generated locally,
  uploaded to the staging API Worker as a secret, and the same
  credential-authenticated evaluation then succeeded.

## Promo selection and atomic-redemption discrepancy

- Affected flows: automatic evaluation, coded evaluation, compatible code
  stacking, and redemption commit.
- Observed automatic behavior: the response included decisions for every
  active Promo, including unrelated unavailable/exhausted programs.
- Observed coded behavior: missing and incorrect codes correctly produced
  `invalid_code`, and the configured code correctly qualified, but all three
  responses still included unrelated Promo decisions.
- Commit mismatch: `POST /v1/redemptions` requires a caller-selected
  `programRef`, so it cannot commit a complete signed stack as one operation.
- Product decision: automatic evaluation privately considers only automatic
  candidates and returns zero or one winner; coded evaluation suppresses
  automatic candidates and resolves only submitted distinct normalized codes;
  compatible coded Promos may stack; and redemption commits the complete signed
  selected bundle atomically.
- Local implementation status: Tasks 1–9 of `GAP-026` are implemented and
  focused verification passes. The design remains **Approved; implementation
  plan ready**, and the plan remains **In progress**, because owner-controlled
  staging deployment and manual evidence do not yet exist. See the
  [design](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md)
  and [plan](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md).
- Retest requirement: after a reviewed merge and user-controlled staging
  migration/deployment, repeat automatic zero-or-one selection, missing/wrong/
  correct code isolation, mixed stackability, bundle idempotency, cap/budget
  concurrency, and tenant-isolation cases with fresh identifiers.

## UX follow-ups

- The authenticated dashboard does not identify the signed-in user. Add an account indicator that shows the current user's email, role, and selected client so operators can verify which session and scope they are using.
- Overview statistics and program rows are still hard-coded demo fixtures rather than staging data. Replace them with live tenant-scoped data or a clear empty state before client use; do not show fabricated codes, redemptions, or spend in the client operator product.
- The live Variables surface is functional but uses largely unstyled native table and button elements. The application stylesheet is loaded—the shell is styled—but the live operator pages need the established dashboard component styling before client use.
- The shared sign-in form offers “Sign in with passkey,” but passkey enrollment and management are currently root-only by design. Until member passkeys are implemented, label or present this action as root-only so invited employees are not given a misleading option.
- Opening Customers before the client has published its first variable schema produces a generic `NOT_FOUND` error with a retry action. Replace this with a prerequisite empty state that explains that a schema must be published and links authorized users to Variables.
- Publishing a schema does not clear the previously opened impact panel, leaving stale pre-publication counts and a duplicated warning alongside the new canonical version. Clear impact/removal state after successful publication.
- The Variables Lifecycle column labels editable, unreferenced client definitions as `Draft` even after their schema version is published. Expose and render the persisted definition/version lifecycle rather than inferring it from `readOnly` and `referenced` flags.
- Deprecating a published definition with no existing draft marks its definition row deprecated without creating a visible next draft. This hides the definition from authoring while the published schema still contains it, leaving operators unable to see or publish the pending schema change. Create and display the next draft immediately, or make the lazy state explicit.
- Promo detail shows active and draft revision numbers but provides no comparison between their configurations. Add a pre-publication review that highlights changed metadata, conditions, reward order/effects, fallback, limits, schedule, and stacking.
- Historical Promo revisions are retained in Product D1 with author/publication metadata, but the current operator contracts and UI expose only the active and single draft pointers. Add a read-only revision history with configuration inspection and clear active/draft markers before client use.
- The Promo lifecycle intentionally permits only one next draft per logical external reference. Keep this simple model for the first client unless parallel proposal/approval workflows become a demonstrated requirement; multiple named drafts would require explicit branching, ownership, comparison, and publish-selection semantics.
- A brand-new Promo editor was already populated with the complete sample configuration before the user selected **Use complete authoring example**. Task 8 now starts from an intentional minimal draft and makes the complete example an explicit action; staging verification remains pending.
- The Promo budget controls originally could not express the optional “no budget” state after a budget existed. PR #8 added explicit budget enable/remove controls and field-level errors, and the staging retest passed.
- `productRef` is an opaque technical value with no catalog lookup or integration mapping help. Keep the canonical reference but add a connector-backed selector/validation when the first commerce integration is chosen.
- Percentage reward fields expose internal basis points (`2000` for `20%`). Render a client-facing percentage control and perform the exact basis-point conversion at the boundary.
- Promo detail omitted both application mode and the configured manual code. Task 8 now shows Automatic/Code-triggered mode, authorized code visibility, stacking, priority, active/draft revision identity, and an explicit pre-publication review; staging verification remains pending.
- The live Promo selector cannot grant a Loyalty wallet asset. Future contracts can represent wallet accrual, but production publication must wait for a real ledger/fulfilment runtime; afterward, conditional Promos should be able to grant a merchant-configured Points/Credits/Miles/Stars/Cashback asset without coupling Promo to a specific Loyalty implementation.
- Accepting an invitation in a browser with another active account consumes the invitation and redirects without explaining the accepted identity or account handoff. Require or guide an isolated handoff and show an explicit success state.

The maintained identifiers, statuses, dispositions, and longer-term module
deferrals are in the linked Product follow-up register.

## Scope decision after the free-shipping finding

- Gate C retains the originally approved no-budget free-shipping behavior.
- The immediate Gate C fix is limited to representing and saving an optional absent budget, with field-specific validation.
- Optional free-shipping campaign budget, per-order cap, authoritative shipping costs, reservations, final commit, reversal, and provider-neutral storage are a separate follow-on design:
  `docs/superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md`.
- That approved follow-on keeps budget and per-order cap optional, requires the
  client to supply actual shipping cost, permits a full waiver or none, uses a
  configurable reservation TTL defaulting to 15 minutes, treats
  expiry/failure recovery as money, and requires exact currency with no
  conversion. It will implement the same provider-neutral atomic coordinator
  port through a distributed adapter. Event-driven reversals and future
  event-triggered incentives remain planned, not implemented.
- Future event definitions/mappings and event-triggered Loyalty, Referral, and Affiliate behavior are preserved in that design but do not block Gate C.

## Remaining manual continuation

1. Finish Task 10 verification and review for the locally implemented
   `GAP-026` correction, then merge it through a PR into `dev`.
2. Have the account owner apply the reviewed staging migration/deployments one command
   at a time.
3. Repeat the automatic, coded, stacking, atomic-bundle, idempotency, and
   concurrency cases with fresh identifiers.
4. Complete the remaining tenant-isolation and security closeout checks.
5. Reconcile the canonical manual procedure, current-state roadmap, follow-up
   register, active plans, and their Notion mirrors with the final result.

External scope remains local/staging until separately approved. No production
deployment is authorized, and Shopify/manual commerce integration remains
uncommitted.

## Evidence policy

Do not add recipient addresses, secrets, cookies, links containing tokens, activation grants, or recovery-code text.
