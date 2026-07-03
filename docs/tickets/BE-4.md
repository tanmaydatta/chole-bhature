# BE-4 · Merchant dashboard auth (better-auth)

## Context
Spec §3.1 (dashboard auth: better-auth, email+password, sessions, native D1 adapter) and §8 (distinct from API keys). Depends on BE-1 (D1) and BE-2 (Hono app).

## Scope
- Integrate better-auth (email+password, sessions) using its native D1 adapter against BE-1's D1 database.
- Single-seat model for MVP: one auth user per `merchants` row (no roles/multi-seat — deferred, Spec §2).
- Mount better-auth's routes on the BE-2 Hono app; issue a session cookie/token on login, validate it on protected dashboard-facing routes.

## Acceptance criteria
- [ ] Signup creates a `merchants` row plus a better-auth user/session; login issues a valid session; logout invalidates it.
- [ ] Protected routes reject requests without a valid session (401), independent of BE-2's API-key middleware — two distinct auth mechanisms.
- [ ] Single-seat enforced: one merchant maps to exactly one auth user in MVP.
- [ ] Tests green covering signup/login/logout/session-expiry.

## Technical notes
- better-auth is chosen specifically for first-class D1 support, avoiding hand-rolled password/session crypto (Spec §3.1).
- Distinct from API keys (BE-2/BE-5): this is a cookie/session for a human in the browser; API keys are for programmatic access from merchant backends/storefronts.
- Billing gating (BE-7) hangs off the merchant identity established here.

## Interfaces
**Consumes:** BE-1 D1 (`merchants` table + D1 binding for the better-auth adapter); BE-2 Hono app to mount auth routes on.
**Produces:** session-based auth (login/signup/logout routes + session-validation middleware) and the canonical `merchant` identity — consumed by BE-5 (onboarding ties to the same merchant), BE-7 (billing state keyed to merchant), FE-1 (login/signup screens call these routes).

## Out of scope
- Multi-seat/roles/SSO (explicitly deferred, Spec §2).
- API-key issuance (BE-5).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
