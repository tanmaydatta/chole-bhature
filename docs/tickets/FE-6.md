# FE-6 · Reference storefront

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §9 (reference integration) and §3.2 (redeem-before-capture rule). This is the phase's E2E proof and future sales-demo seed. Depends on BE-10, BE-11, BE-12, BE-13.

## Scope
- `apps/reference-store`: a minimal cart UI — calls evaluate on cart change, redeems before capturing payment at checkout, fires an event on order completion, displays wallet balance.
- Demonstrates the exact integration order Spec §3.2 mandates (redeem before payment capture, not after).

## Acceptance criteria
- [ ] Full loop works end-to-end against the live API: evaluate → discount/message shown → redeem (before "payment") → event fires → wallet balance updates.
- [ ] Checkout re-prices on a redemption rejection (exhausted program) instead of proceeding with a stale discount (Spec §3.2 UX rule).
- [ ] Serves as the E2E proof/demo referenced by QA-2 and DOCS-2.
- [ ] Tests green.

## Technical notes
Scope-level for now; refresh with BE-10/BE-11/BE-12/BE-13's finalized request/response contracts before starting.

## Interfaces
**Consumes:** BE-10 `/v1/evaluate`, BE-11 `/v1/redemptions`, BE-12 `/v1/events`, BE-13 customers/wallet endpoints (contracts to be confirmed against final implementations).
**Produces:** the reference storefront — consumed by QA-2 (E2E suite drives it) and DOCS-2 (integration guide's worked example).

## Out of scope
- Production-grade storefront features (this is a minimal proof, not a sales-ready demo).
- Platform connectors (Shopify/Woo) — explicitly deferred (Spec §2).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
