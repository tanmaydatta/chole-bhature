# BE-5 · Merchant onboarding + API-key endpoints

## Context
Spec §4's API-key model (publishable + secret) needs issuance/management endpoints, and §8 needs onboarding to complete the merchant profile created at BE-4 signup. Depends on BE-2.

## Scope
- Minimal onboarding endpoint: complete the merchant profile (e.g. business name) for the `merchants` row created at BE-4 signup.
- API-key CRUD: create (generates both a publishable and a secret key, secret revealed once), list (masked), rotate (issues a new key, invalidates the old one).
- Keys hashed before storage in `api_keys` (BE-1); plaintext returned only at creation/rotation.

## Acceptance criteria
- [ ] Onboarding endpoint updates the merchant profile for the authenticated merchant.
- [ ] Create returns a publishable key (plaintext, safe to expose) and a secret key (plaintext, shown once) tied to the authenticated merchant.
- [ ] List returns masked keys (no plaintext secret) with metadata (created date, key type, last-used).
- [ ] Rotate invalidates the old key atomically with issuing the new one — no window where both verify.
- [ ] All endpoints scoped to the calling merchant only.
- [ ] Tests green covering create/reveal-once/list-masked/rotate-invalidates-old.

## Technical notes
- Reuses BE-2's key-hashing convention (store hash, not plaintext) and the `api_keys` table (BE-1).
- These endpoints sit behind dashboard session auth (BE-4), not API-key auth — a merchant manages their own keys via the dashboard.

## Interfaces
**Consumes:** BE-2 Hono app + hashing convention; BE-1 `api_keys` table; BE-4 merchant/session identity.
**Produces:** onboarding endpoint plus `/v1/api-keys` create/list/rotate endpoints and the reveal-once/masked-list contract — consumed by FE-4 (API-keys screen).

## Out of scope
- Per-key rate-limit configuration UI (limits are BE-2 middleware defaults, not user-tunable in MVP).
- Billing/plan gating of key creation (BE-7).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
