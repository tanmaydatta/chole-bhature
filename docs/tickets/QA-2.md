# QA-2 · E2E suite via reference storefront

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §14 (success criteria: full-loop E2E), exercised through FE-6's reference storefront. Depends on FE-6.

## Scope
- Automated E2E suite: configure a program (dashboard) → evaluate → redeem → event → wallet credit, run against staging (INFRA-2).

## Acceptance criteria
- [ ] The suite runs against the staging environment (not local/dev) and exercises the full loop for at least one program per type.
- [ ] The suite is part of the CI/CD pipeline (INFRA-3) or runnable on demand against staging.
- [ ] Tests green.

## Technical notes
Scope-level for now; drives FE-6's reference storefront rather than calling the API directly, to prove the integration pattern end-to-end — refresh test steps once FE-6's final flow is in place.

## Interfaces
**Consumes:** FE-6 reference storefront; INFRA-2 staging environment.
**Produces:** the E2E regression suite — the release-readiness gate referenced by Spec §14's definition of done.

## Out of scope
- Load/concurrency testing (QA-3).
- Production-environment testing (staging only, per scope).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
