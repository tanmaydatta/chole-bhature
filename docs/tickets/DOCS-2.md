# DOCS-2 · Integration guide + quickstart

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §9 (integration guide) and §3.2 (redeem-before-capture rule). Depends on FE-6, DOCS-1.

## Scope
- Integration guide + quickstart: how to call evaluate/redeem/events/wallet in the correct order, including the redeem-before-capture rule and idempotency guidance (order id / event id retries).

## Acceptance criteria
- [ ] The guide walks through the same loop FE-6's reference storefront implements, referencing its code as the worked example.
- [ ] Redeem-before-capture is called out explicitly as a MUST, with the Spec §3.2 rationale.
- [ ] Idempotency guidance (safe retry keys) is explicit for redemptions and events.

## Technical notes
Scope-level for now; written against FE-6's final integration pattern and DOCS-1's finalized schemas — refresh both references if either changed materially before starting.

## Interfaces
**Consumes:** FE-6 reference storefront implementation; DOCS-1 API reference content.
**Produces:** the integration guide/quickstart — the final MVP documentation deliverable (Spec §14 definition-of-done item 5).

## Out of scope
- Platform-specific integration guides (Shopify/Woo) — deferred, Spec §2.
- SDK usage guides (no SDK suite in MVP scope).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
