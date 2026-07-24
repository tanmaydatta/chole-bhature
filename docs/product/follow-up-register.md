# Product Follow-up Register

**Updated:** 2026-07-24

**Status:** Active

**Notion mirror:** https://app.notion.com/p/Product-Follow-up-Register-3a6e5c7c2b8e81cebe96de50b64f3bbd

**Evidence source:** [Staging activation run](../testing/staging-activation-run-2026-07-21.md)

This register keeps client-readiness gaps discovered during Plan 3 staging
verification separate from the factual test record. A finding remains here
until it is resolved, deliberately deferred with a target, or killed with a
recorded reason.

## Gate C blockers

| ID | Status | Finding | Disposition |
|---|---|---|---|
| `GAP-001` | Done | The Promo editor could not remove an existing/sample budget, so a no-budget free-shipping Promo could not be saved. Validation was generic rather than identifying the budget field or the free-shipping conflict. | PR #8 merged the explicit Add/Remove budget actions, budget field errors, pre-submit free-shipping conflict guidance, and regression coverage into `dev`. The fix was deployed and the free-shipping create/publish/hard-refresh case passed in staging. |
| `GAP-002` | Open decision | Deprecating a published definition marks the definition row deprecated but does not immediately create or display the next draft schema. | Prefer creating visible draft version 2 immediately; otherwise specify and clearly render the lazy-draft lifecycle. Reverify after the decision. |
| `GAP-026` | In progress — implemented locally; staging evidence pending | The deployed staging build exposes unrelated Promo inventory, permits ambiguous automatic stacking, and cannot atomically commit a valid coded stack. | Tasks 1–9 implement the clean-break `codes[]` contract, automatic zero-or-one selection, coded-only diagnostics, deterministic priority, compatible coded stacking, race-safe tenant code claims, and provider-neutral atomic bundle redemption. D1 is the initial adapter. Keep the design status **Approved; implementation plan ready** until Task 10 owner-controlled staging cases pass. See the [design](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md) and [implementation plan](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md). |

## Client-readiness UX and operator gaps

| ID | Status | Finding | Disposition |
|---|---|---|---|
| `GAP-003` | Open | The authenticated shell does not identify the signed-in user, role, authentication method, or selected client. | Add an account/scope indicator before client use. |
| `GAP-004` | Open | Overview statistics and program rows are hard-coded demo fixtures and can look like real tenant data. | Replace with live tenant-scoped data or an unambiguous empty state. |
| `GAP-005` | Open | Live Variables, Customers, Promo forms, and detail pages use largely unstyled native controls even though the application shell stylesheet is present. | Bring live pages onto the established dashboard components before client use. |
| `GAP-006` | Deferred | Invited employees cannot enroll or manage passkeys; the shared sign-in page still offers a passkey action that is currently root-only. | Make the current action explicitly root-only, then implement member passkeys/MFA as a separate security follow-up. |
| `GAP-007` | Open | Consuming an invitation in a browser that already has a different active session redirects without a clear acceptance/handoff message and leaves the existing session active. | Require or guide a clean account handoff and show which invited identity was accepted without exposing the token. |
| `GAP-008` | Open | Customers returns a generic `NOT_FOUND` error before a first schema is published. | Show a prerequisite empty state and link authorized users to Variables. |
| `GAP-009` | Open | Successful schema publication leaves an already-open impact panel visible with stale counts and duplicated warnings. | Clear impact/removal state after publication. |
| `GAP-010` | Open | Variables can display editable definitions as `Draft` even when their schema version is published. | Return and render the persisted definition/version lifecycle rather than inferring it from editability. |
| `GAP-011` | Open | Promo detail now distinguishes active/draft identity and shows trigger/code/stacking/priority before publication, but it does not provide a full configuration diff. | Add an active-versus-draft comparison for metadata, conditions, reward order/effects, fallback, limits, schedule, and stacking. |
| `GAP-012` | Open | Historical Promo revisions are persisted but unavailable in operator contracts/UI, and there is no rollback workflow. | Add read-only revision history with configuration inspection and active/draft markers, then design explicit rollback semantics. |
| `GAP-013` | Deferred by design | Only one editable draft exists for a logical Promo. | Keep one draft for the first client. Revisit only if parallel proposal/approval workflows justify branching semantics. |
| `GAP-014` | Done in local code; staging verification pending | A new Promo silently started with the complete sample configuration before the user chose the example action. | Task 8 now starts from an intentional minimal draft and loads the full example only through the explicit **Use complete authoring example** action. Dashboard regression coverage passes locally. |
| `GAP-015` | Open | `productRef` is an opaque technical value with no merchant catalog lookup, mapping help, or integration-specific validation. | Preserve the canonical opaque reference, but add connector/catalog mapping and a searchable selector once an integration is chosen. |
| `GAP-023` | Open | Percentage-discount authoring exposes integer basis points, so a client must enter `2000` instead of `20%`. | Present a percentage control with clear bounds and decimal precision, convert to exact basis points at the UI/contract boundary, and continue using integer basis points internally to avoid floating-point money errors. Do not conflate basis points with Loyalty points. |
| `GAP-025` | Done in local code; staging verification pending | Promo detail did not show whether the Promo was automatic or code-triggered, and an operator could not review its configured code before publishing. | Task 8 now shows application mode, authorized code visibility, stacking, priority, active/draft revision identity, and explicit publication review. Dashboard and operator-contract regressions pass locally. Business codes remain permission-protected tenant configuration, not credential secrets. |

## Approved follow-on designs and deferred modules

| ID | Status | Finding | Disposition |
|---|---|---|---|
| `GAP-016` | Design consolidated; implementation plan pending | Free shipping needs optional campaign budget/per-order cap, authoritative shipping inputs, concurrency-safe reservations, final commit, expiry/failure recovery, and cost-based reversal. | Implement the same provider-neutral atomic coordinator port through a future distributed adapter. Budgets/caps remain optional; the client supplies actual shipping cost; the result is a full waiver or none; reservation TTL is configurable with a 15-minute default; expiry/recovery are money; and currency must match with no conversion. Event-driven reversals remain planned. See [Free-Shipping Budget Authority, Reservations, and Reversals](../superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md). |
| `GAP-017` | Deferred | Event definitions exist in the demo/configuration model, but no production event-ingestion, mapping, or dispatch runtime exists. | Future runtime keeps event definition, integration mapping, and module binding separate. Events may trigger Loyalty earning, Referral qualification, Affiliate attribution/commission, analytics, or reversal adapters; event-triggered Loyalty remains explicitly future work. |
| `GAP-018` | Deferred | Loyalty has future configuration contracts but no runtime wallet/accrual ledger or configurable asset catalog. | Let merchants bind a published event to earning rules and configure terminology such as Points, Credits, Miles, Stars, or Cashback through a wallet asset catalog. |
| `GAP-019` | Deferred | Affiliate and Referral have conditional-reward configuration contracts but no production authoring/runtime, attribution, settlement, or fulfilment. | Implement module-specific runtimes against the shared typed condition/reward structures when a client requires them. |
| `GAP-020` | Deferred | Initial Admin/Operator/Viewer permissions are extensible in code, but there is no custom-role editor. | Keep permission checks action-based and deny-by-default; add stored role composition/UI when a real client needs custom roles. |
| `GAP-021` | Deferred until integration choice | Shopify and other platforms do not universally expose authoritative merchant-incurred shipping/carrier cost or historical product cost in the same payload. | Keep canonical cost facts separate. Connector mappings may use platform fields, merchant metadata, ERP/3PL enrichment, or the explicit reversal API without changing Core callsites. |
| `GAP-022` | Done in local code; staging lookup pending | Public API failures returned a correlation ID but handled exceptions were not emitted as structured logs with that ID. | Task 7 added centralized sanitized `api_request_failed` events. Focused API tests prove the response header, error body, signed snapshot where applicable, and log share one ID, while credentials, submitted codes, request bodies, customer data, identifiers, SQL, and stacks remain absent. `OBS-API-01` still verifies discoverability after owner-controlled staging deployment. |
| `GAP-024` | Deferred pending wallet runtime | The live Promo reward selector supports commerce discounts and free shipping only. A client cannot yet configure a conditional promotion that grants a Loyalty asset such as Points, Credits, Miles, Stars, or Cashback. Future Loyalty and wallet-accrual contracts exist, but they are explicitly configuration-only and have no production ledger, fulfilment runtime, or live operator routes. | Build the provider-neutral wallet/accrual ledger and fulfilment port before enabling publication. Then allow eligible program modules, including Promo when the business case is “buy/do X, receive loyalty value,” to select a configured wallet asset and emit an exact accrual effect without coupling Promo callsites to the Loyalty implementation. Merchant terminology comes from the asset catalog. |

## Resolved during staging verification

| ID | Status | Finding | Resolution |
|---|---|---|---|
| `GAP-R01` | Done | Invitation creation failed strict RPC validation because Operator Web sent an extra top-level correlation id. | Fixed, merged in PR #7, deployed, and manually retested through delivery, acceptance, and fresh sign-in. |
| `GAP-R02` | Done | Staging deployments did not initially persist the desired diagnostic logs. | API, Identity, and Operator Web were redeployed with 100% staging log sampling. |

## Scope decision

Gate C continues against the originally approved behavior: free shipping may be
created without a monetary budget. `GAP-001` is fixed and passed its staging
retest. The larger financial authority in `GAP-016` does not silently expand
Gate C and receives its own implementation plan, branch, verification, and
status. Shopify/manual integration remains uncommitted.
