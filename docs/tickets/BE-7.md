# BE-7 · Stripe billing

## Context
Spec §10 — flat plans + trial, billing state gates access. Depends on BE-4 (merchant identity).

## Scope
- Stripe integration (official SDK, fetch HTTP client per Spec §3.1) for 1–2 flat subscription plans plus a trial.
- Webhook handler for subscription lifecycle events (trial started, active, canceled, payment failed) updating a `billing_status` field on the merchant.
- Billing-state gate: dashboard and API access blocked when `billing_status` is not active/trialing.

## Acceptance criteria
- [ ] A merchant can start a trial and subscribe to a flat plan via Stripe Checkout (or equivalent).
- [ ] Webhooks correctly update `billing_status` for: trial started, active, canceled, payment failed.
- [ ] Requests are rejected (402/403) when `billing_status` is inactive, for both session-authed and API-key-authed routes.
- [ ] Webhook signature verification is enforced — no unauthenticated billing-state writes.
- [ ] Tests green covering the webhook state machine and the access-gate middleware.

## Technical notes
- No usage metering for MVP (flat plans only, Spec §10) — don't build metered-billing hooks.
- Stripe SDK runs via its fetch HTTP client (Workers-compatible), not the Node SDK (Spec §3.1).
- The billing gate is cross-cutting: it must sit in front of both BE-2's API-key-authed routes and BE-4's session-authed dashboard routes.

## Interfaces
**Consumes:** BE-4 merchant identity/session.
**Produces:** the `billing_status` field on the merchant record, the billing-access-gate middleware, and the Stripe webhook endpoint — consumed by FE-4 (billing/plan screen) and, cross-cuttingly, by every authenticated route once gated.

## Out of scope
- Usage-based/metered billing (deferred, Spec §2).
- More than 1–2 flat plan tiers (final tier count decided during build, Spec §15).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
