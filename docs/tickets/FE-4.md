# FE-4 · API-keys + billing screens

## Context
Spec §8 (API-key management screen) and §10 (billing gates access). Depends on FE-1 (client/auth), BE-5 (API-key endpoints), BE-7 (billing).

## Scope
- API-keys screen: create/reveal-once/list-masked/rotate, wired to BE-5.
- Billing/plan screen: shows current plan/trial/`billing_status`, links to Stripe Checkout/portal, wired to BE-7.

## Acceptance criteria
- [ ] API-keys screen supports create (secret shown once), list (masked), rotate.
- [ ] Billing screen reflects live `billing_status` and links to Stripe for plan changes/trial start.
- [ ] A merchant with inactive billing sees a clear gated state (per BE-7's access gate) rather than a silent failure.
- [ ] Tests green.

## Technical notes
- The "reveal once" UX must not persist the secret key in any client-side store beyond the initial reveal render.

## Interfaces
**Consumes:** FE-1 `api-client`; BE-5 `/v1/api-keys` endpoints; BE-7 billing endpoints + `billing_status`.
**Produces:** the API-keys + billing screens (terminal in the dependency graph — no dependents).

## Out of scope
- Rate-limit configuration UI (not user-tunable in MVP, per BE-2/BE-5).
- Plan-tier comparison/marketing content beyond what's needed to subscribe.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
