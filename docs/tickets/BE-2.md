# BE-2 · Hono skeleton + API-key auth + rate limiting
> **Phase 0 (M0):** Phase 0 (**P0-4**) delivers the Hono skeleton + a static-token gate (publishable/secret) + single-tenant merchant resolver. Remaining Phase 1 scope: hashed/rotatable D1-backed API keys + per-key rate limiting.

## Context
Spec §3.1 (Hono + zod) and §4 (publishable vs secret API keys, per-key rate limiting). Depends on INFRA-1 (workspace) and BE-1 (`api_keys` table).

## Scope
- `apps/api` Hono app skeleton with a zod request-validation middleware pattern.
- API-key auth middleware: looks up a hashed key against `api_keys` (BE-1), distinguishes **publishable** (client-side: evaluate + wallet-read only) from **secret** (server-side: redemptions/events/customer writes) per Spec §4.
- Per-key rate-limiting middleware (KV or DO-backed token bucket, keyed by api-key id).
- Attaches `merchant_id` (resolved from the authenticated key) to request context for tenant scoping (Spec §11).

## Acceptance criteria
- [ ] Hono app boots locally via `wrangler dev`.
- [ ] Missing/invalid/revoked keys are rejected with 401.
- [ ] A publishable key calling a secret-only route is rejected with 403, enforced centrally (not per-route ad hoc).
- [ ] Exceeding a key's rate-limit threshold returns 429 in a test.
- [ ] `merchant_id` is available on request context for every authenticated route.
- [ ] Tests green (`pnpm test`) covering key-type gating and rate-limit thresholds.

## Technical notes
- Keys are hashed in D1 (never store plaintext) — hashing/verification lives in this middleware.
- Route-to-key-kind mapping should be declarative so BE-10/BE-11/BE-12/BE-13 just declare which kind (publishable/secret) they require.
- Rate limiting is per API key, not per merchant — a merchant with both key types gets independent buckets.

## Interfaces
**Consumes:** INFRA-1 `apps/api` skeleton; BE-1 `api_keys` table + `db` factory/`batch()` helper.
**Produces:** the Hono `app` instance, the `apiKeyAuth` middleware (with publishable/secret gating), the rate-limit middleware, and the `merchant_id` request-context convention — every route ticket from BE-4 through BE-17 mounts on this app and reuses this middleware stack.

## Out of scope
- The key-issuance/rotation endpoints themselves (BE-5).
- Merchant dashboard session auth — a separate mechanism (better-auth, BE-4), not API keys.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
