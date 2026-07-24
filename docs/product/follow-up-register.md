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
| `GAP-026` | Approved; implementation plan ready | Evaluation exposes unrelated Promo inventory, automatic mode can return several decisions, coded mode does not isolate submitted codes, code ownership is not publication-race-safe, and the singular-program redemption request cannot atomically commit a valid coded stack. | Implement the clean-break `codes[]` contract, automatic zero-or-one selection, coded-only resolution, deterministic priority, compatible coded stacking, race-safe tenant code claims, and provider-neutral atomic bundle redemption. See the [design](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md) and [implementation plan](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md). |

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
| `GAP-011` | Open | Promo detail shows active and draft revision numbers but not their differences. | Add a pre-publication comparison for metadata, conditions, reward order/effects, fallback, limits, schedule, and stacking. |
| `GAP-012` | Open | Historical Promo revisions are persisted but unavailable in operator contracts/UI. | Add read-only revision history with configuration inspection and active/draft markers. |
| `GAP-013` | Deferred by design | Only one editable draft exists for a logical Promo. | Keep one draft for the first client. Revisit only if parallel proposal/approval workflows justify branching semantics. |
| `GAP-014` | Open | A new Promo silently starts with the complete sample configuration before the user chooses the example action. | Start blank/minimal or require an explicit template choice. |
| `GAP-015` | Open | `productRef` is an opaque technical value with no merchant catalog lookup, mapping help, or integration-specific validation. | Preserve the canonical opaque reference, but add connector/catalog mapping and a searchable selector once an integration is chosen. |
| `GAP-023` | Open | Percentage-discount authoring exposes integer basis points, so a client must enter `2000` instead of `20%`. | Present a percentage control with clear bounds and decimal precision, convert to exact basis points at the UI/contract boundary, and continue using integer basis points internally to avoid floating-point money errors. Do not conflate basis points with Loyalty points. |
| `GAP-025` | Open | Promo detail does not show whether the Promo is automatic or code-triggered, and a manual Promo does not show its configured code. An operator therefore cannot review this critical activation setting before publishing. | Show an explicit application mode and the configured manual code on draft, active, and revision-comparison surfaces. Treat the business code as tenant configuration rather than a secret credential, while continuing to exclude API credentials and token material. |

## Approved follow-on designs and deferred modules

| ID | Status | Finding | Disposition |
|---|---|---|---|
| `GAP-016` | Design consolidated; implementation plan pending | Free shipping needs optional campaign budget/per-order cap, authoritative shipping inputs, concurrency-safe reservations, final commit, and cost-based reversal. | Implement as a separate follow-on after Gate C. See [Free-Shipping Budget Authority, Reservations, and Reversals](../superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md). |
| `GAP-017` | Deferred | Event definitions exist in the demo/configuration model, but no production event-ingestion, mapping, or dispatch runtime exists. | Future runtime keeps event definition, integration mapping, and module binding separate. Events may trigger Loyalty earning, Referral qualification, Affiliate attribution/commission, analytics, or reversal adapters. |
| `GAP-018` | Deferred | Loyalty has future configuration contracts but no runtime wallet/accrual ledger or configurable asset catalog. | Let merchants bind a published event to earning rules and configure terminology such as Points, Credits, Miles, Stars, or Cashback through a wallet asset catalog. |
| `GAP-019` | Deferred | Affiliate and Referral have conditional-reward configuration contracts but no production authoring/runtime, attribution, settlement, or fulfilment. | Implement module-specific runtimes against the shared typed condition/reward structures when a client requires them. |
| `GAP-020` | Deferred | Initial Admin/Operator/Viewer permissions are extensible in code, but there is no custom-role editor. | Keep permission checks action-based and deny-by-default; add stored role composition/UI when a real client needs custom roles. |
| `GAP-021` | Deferred until integration choice | Shopify and other platforms do not universally expose authoritative merchant-incurred shipping/carrier cost or historical product cost in the same payload. | Keep canonical cost facts separate. Connector mappings may use platform fields, merchant metadata, ERP/3PL enrichment, or the explicit reversal API without changing Core callsites. |
| `GAP-022` | Open | Public API failures return a correlation ID in the response, but handled exceptions are not explicitly emitted as structured logs with that ID. A client-visible ID therefore does not reliably locate the underlying failure in Cloudflare logs, even with 100% log sampling. | Add sanitized structured logging at the public API error boundary with the correlation ID, route, method, canonical error code/status, merchant and credential identifiers when known, and safe exception diagnostics. Never log authorization values, credential tokens, request bodies, customer attributes, invitation or magic-link tokens, activation grants, or recovery codes. Add verification that the logged ID matches the response header and error body. |
| `GAP-024` | Deferred pending wallet runtime | The live Promo reward selector supports commerce discounts and free shipping only. A client cannot yet configure a conditional promotion that grants a Loyalty asset such as Points, Credits, Miles, Stars, or Cashback. Future Loyalty and wallet-accrual contracts exist, but they are explicitly configuration-only and have no production ledger, fulfilment runtime, or live operator routes. | Build the provider-neutral wallet/accrual ledger and fulfilment port before enabling publication. Then allow eligible program modules, including Promo when the business case is “buy/do X, receive loyalty value,” to select a configured wallet asset and emit an exact accrual effect without coupling Promo callsites to the Loyalty implementation. Merchant terminology comes from the asset catalog. |

## Resolved during staging verification

| ID | Status | Finding | Resolution |
|---|---|---|---|
| `GAP-R01` | Done | Invitation creation failed strict RPC validation because Operator Web sent an extra top-level correlation id. | Fixed, merged in PR #7, deployed, and manually retested through delivery, acceptance, and fresh sign-in. |
| `GAP-R02` | Done | Staging deployments did not initially persist the desired diagnostic logs. | API, Identity, and Operator Web were redeployed with 100% staging log sampling. |

## Scope decision

Gate C continues against the originally approved behavior: free shipping may be
created without a monetary budget. `GAP-001` will be fixed and retested inside
Gate C. The larger financial authority in `GAP-016` does not silently expand
Gate C and receives its own implementation plan, branch, verification, and
status.
