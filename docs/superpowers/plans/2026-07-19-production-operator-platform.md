# Production Operator Platform and Integration Harness Implementation Plan

**Status:** In progress — Tasks 1–9 and Gates A/B are complete; Gate C code review is clean and real-browser/local-stack verification is pending.

**Notion parent:** [Plans](https://app.notion.com/p/Plans-390e5c7c2b8e8165b7f7d77392eab088)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an authenticated, tenant-aware, deployable operator platform and integration harness before committing to any commerce connector.

**Architecture:** Keep the existing Core API as the product-data Worker, add a Better Auth Identity Worker with its own D1, and put the dashboard behind a database-free Operator Web Worker/BFF. Replace seeded tenancy with private operator context or merchant credentials, add immutable schema/program lifecycles, then expose a safe Playground and public-contract CLI.

**Tech Stack:** TypeScript 6, pnpm workspaces, Hono, Cloudflare Workers/service bindings/D1, Drizzle, Better Auth, Resend, React 19, Vite 8, Zod, Vitest/RTL, Playwright, GitHub Actions.

**Approved design:** `docs/superpowers/specs/2026-07-19-production-operator-platform-design.md`

**Notion mirror:** https://app.notion.com/p/Production-Operator-Platform-and-Integration-Harness-Implementation-Plan-3a2e5c7c2b8e8191ba1ff65dd30752b3

## Global Constraints

- Work on feature branches created from current `origin/dev`; use reviewed PRs into `dev`, never direct pushes.
- Preserve canonical packages as the only shared wire-type source; dashboard types cannot redefine runtime contracts.
- Operator Web has no D1 binding; Identity has only Auth D1; Core has only Product D1.
- Public signup is unavailable. Root is operations-bootstrapped; employees are invited.
- Root has full cross-merchant authority but must explicitly select a merchant and remain visibly/auditably root.
- Browser input never supplies authoritative merchant, actor, permission, or root context.
- Persistent customer attributes never appear in evaluation input.
- Promo rewards remain ordered first-match-wins `rewardRules` plus optional `fallbackReward`.
- Production Operator UI and simulator CLI cannot commit redemptions; the production integration API can.
- Do not implement Shopify/manual connectors, custom roles, client passkeys, bulk backfill UI, or future-module runtimes.
- Use TDD. Each task ends green and committed; each delivery gate receives code review before the next gate.

---

## Delivery Gate A — Tenant-aware Core and immutable configuration

### Task 1: Add canonical operator, credential, revision, and audit contracts

**Files:**
- Create: `packages/contracts/src/operator.ts`
- Create: `packages/contracts/src/credentials.ts`
- Create: `packages/contracts/src/audit.ts`
- Modify: `packages/contracts/src/programs.ts`
- Modify: `packages/contracts/src/evaluation.ts`
- Modify: `packages/contracts/src/runtime-api.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/production-operator-contracts.test.ts`

**Interfaces:**
- Produces: `PermissionKeySchema`, `OperatorPrincipalSchema`, `OperatorCallContextSchema`, `ApiCredentialViewSchema`, `ProgramRevisionSchema`, `ProgramLifecycleSchema`, `AuditEntrySchema`.
- Changes: decisions require `programRevision: number`; operator/public request schemas remain distinct.

- [x] Write failing schema tests proving invalid permission keys, plaintext credential views, missing program revisions, and browser-supplied operator context are rejected.
- [x] Run `pnpm --filter @incentives/contracts test -- production-operator-contracts.test.ts`; expect failures for missing exports.
- [x] Implement strict Zod schemas and exported inferred types; extend documentation fixtures with valid examples.
- [x] Run contracts tests, typecheck/build, and `pnpm --filter @incentives/contracts test`; expect exit 0.
- [x] Commit with `git commit -m "feat: define production operator contracts"`.

### Task 2: Migrate Product D1 from seeded tenancy to merchants, keys, revisions, and audit

**Files:**
- Create: `apps/api/migrations/0002_production_operator.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts`
- Test: `apps/api/test/production-migration.test.ts`
- Test: `apps/api/test/repositories.test.ts`

**Interfaces:**
- Produces repositories for merchant provisioning, credential digests, logical programs/revisions/counters, schema deprecation/impact, and product audit.
- Preserves existing Plan 2 rows as the seeded merchant's revision 1 during migration tests; production completion later removes seeded request fallback.

- [x] Write a migration test that applies `0001`, inserts representative Plan 2 data, applies `0002`, and asserts preserved schema/customer/evaluation/redemption foreign keys and revision/counter ownership.
- [x] Run `pnpm --filter @incentives/api test -- production-migration.test.ts`; expect missing migration failure.
- [x] Add forward-only tables/indexes and repository methods using merchant-scoped compound constraints; never reconstruct credential plaintext.
- [x] Run repository and migration tests on both clean and upgraded databases; expect exit 0.
- [x] Commit with `git commit -m "feat: migrate core tenancy and program revisions"`.

### Task 3: Replace static-token scope with internal operator context and merchant credentials

**Files:**
- Create: `apps/api/src/auth/operator-context.ts`
- Create: `apps/api/src/auth/api-credentials.ts`
- Create: `apps/api/src/services/merchant-service.ts`
- Create: `apps/api/src/routes/internal-merchants.ts`
- Create: `apps/api/src/routes/credentials.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/env.ts`
- Delete: `apps/api/src/auth/static-token.ts`
- Test: `apps/api/test/tenancy-auth.test.ts`
- Test: `apps/api/test/credentials.test.ts`

**Interfaces:**
- Produces: idempotent merchant provisioning, private `OperatorCallContext`, `pk_`/`sk_` authentication, exact-origin CORS for publishable routes, scope/expiry/revocation checks.

- [x] Write failing tests for two-merchant isolation, forged operator headers, wrong scopes, revoked/expired keys, allowed/disallowed origins, rotation overlap, and show-once token responses.
- [x] Run the two focused test files; expect static seeded merchant behavior to fail isolation assertions.
- [x] Implement private and public middleware as separate entry paths; hash random token material and audit safe key metadata.
- [x] Run focused tests plus `pnpm --filter @incentives/api test`; expect exit 0 and no seeded request fallback.
- [x] Commit with `git commit -m "feat: enforce merchant-scoped core access"`.

### Task 4: Complete schema impact/deprecation and immutable Promo revision lifecycles

**Files:**
- Modify: `apps/api/src/services/schema-service.ts`
- Modify: `apps/api/src/services/program-service.ts`
- Modify: `apps/api/src/services/evaluation-service.ts`
- Modify: `apps/api/src/services/redemption-service.ts`
- Modify: `apps/api/src/routes/schemas.ts`
- Modify: `apps/api/src/routes/programs.ts`
- Test: `apps/api/test/schema-lifecycle.test.ts`
- Test: `apps/api/test/program-revisions.test.ts`
- Test: `apps/api/test/full-flow.test.ts`

**Interfaces:**
- Produces schema impact preview/deprecation and program draft/publish/schedule/pause/resume/end operations with stable logical reference and revisioned decisions.

- [x] Write failing tests for published-field immutability, required-customer coverage, draft-only field blocking, deprecation, atomic revision swap, counter continuity, schedule, pause/resume, irreversible end, and old-revision redemption.
- [x] Run focused tests; expect missing lifecycle endpoints/repositories.
- [x] Implement impact queries and atomic Product D1 transactions; keep advisory reward-rule warnings separate from blocking contract validation.
- [x] Run all Core/contract/module tests and the real-D1 full flow; expect exit 0.
- [x] Commit with `git commit -m "feat: add safe schema and promo lifecycles"`.

**Gate A review: complete.** Verified public OpenAPI, migration from merged Plan 2, tenant isolation, keys, revision/counter semantics, and all existing conditional-reward behavior before proceeding.

---

## Delivery Gate B — Identity and authorization

### Task 5: Build the isolated Better Auth Identity Worker

**Files:**
- Create: `apps/identity/package.json`
- Create: `apps/identity/wrangler.toml`
- Create: `apps/identity/src/worker.ts`
- Create: `apps/identity/src/auth.ts`
- Create: `apps/identity/src/email.ts`
- Create: `apps/identity/src/db/schema.ts`
- Create: `apps/identity/migrations/0001_auth.sql`
- Test: `apps/identity/test/auth.test.ts`

**Interfaces:**
- Produces service-binding auth routes, sessions, passwordless links, passkey root, recovery codes, disabled signup, and injectable local-capture/Resend mail adapters.

- [x] Add failing tests for blocked signup, unknown-email-safe responses, single-use/expired links, session revocation, root passkey requirement, and secrets absent from logs.
- [x] Run `pnpm --filter @incentives/identity test`; expect the workspace/package to be absent.
- [x] Install pinned Better Auth dependencies, configure same-origin proxy URLs/cookies, D1 session/rate-limit storage, and mail adapters.
- [x] Run Identity tests/build/lint and migration on a clean local Auth D1; expect exit 0.
- [x] Commit with `git commit -m "feat: add isolated identity worker"`.

### Task 6: Add provider-neutral permissions, invitations, and idempotent client provisioning

**Files:**
- Create: `apps/identity/src/authorization/registry.ts`
- Create: `apps/identity/src/authorization/authorize.ts`
- Create: `apps/identity/src/services/invitations.ts`
- Create: `apps/identity/src/services/organizations.ts`
- Create: `apps/identity/src/routes/internal.ts`
- Create: `apps/identity/src/cli/bootstrap-root.ts`
- Test: `apps/identity/test/authorization.test.ts`
- Test: `apps/identity/test/onboarding.test.ts`

**Interfaces:**
- Produces `authorize(principal, permission, merchantId)`, fixed Admin/Operator/Viewer bundles, root wildcard, invite lifecycle, last-Admin protection, and retryable provisioning state.

- [x] Write the complete role matrix test plus cross-organization, removed-member, duplicate provisioning, failed/retried provisioning, last-Admin, and second-root tests.
- [x] Run focused tests; expect missing registry/services.
- [x] Implement deny-by-default registry and idempotent organization/merchant coordination through Core's private service interface.
- [x] Run all Identity tests and an Identity/Core contract test; expect exit 0.
- [x] Commit with `git commit -m "feat: add invite-only organization authorization"`.

**Gate B review: complete.** Verified no public signup path, no Better Auth role checks in business code, no Product D1 binding, root recovery, and tenant-safe invitations.

---

## Delivery Gate C — Operator Web and live dashboard

### Task 7: Add the database-free Operator Web Worker/BFF

**Files:**
- Create: `apps/operator-web/package.json`
- Create: `apps/operator-web/wrangler.toml`
- Create: `apps/operator-web/src/worker.ts`
- Create: `apps/operator-web/src/session.ts`
- Create: `apps/operator-web/src/routes/auth.ts`
- Create: `apps/operator-web/src/routes/platform.ts`
- Create: `apps/operator-web/src/routes/team.ts`
- Create: `apps/operator-web/src/routes/credentials.ts`
- Create: `apps/operator-web/src/routes/schemas.ts`
- Create: `apps/operator-web/src/routes/customers.ts`
- Create: `apps/operator-web/src/routes/programs.ts`
- Test: `apps/operator-web/test/bff.test.ts`

**Interfaces:**
- Produces same-origin `/auth/*` proxy and `/operator/v1/*` BFF; consumes Identity/Core service bindings; serves `apps/dashboard/dist` assets; has no D1 binding.

- [x] Write failing tests for unauthenticated/forbidden calls, root merchant selection, forged tenant fields, correlation propagation, safe errors, and absence of production operator redemption route.
- [x] Run `pnpm --filter @incentives/operator-web test`; expect missing package.
- [x] Implement route-specific permission checks and typed service clients; never forward browser auth/tenant headers to Core.
- [x] Run tests/build/lint and inspect generated Wrangler bindings; expect no D1 binding.
- [x] Commit with `git commit -m "feat: add operator web gateway"`.

### Task 8: Wire authentication, root, team, and credential dashboard surfaces

**Files:**
- Create: `apps/dashboard/src/lib/bff-client.ts`
- Create: `apps/dashboard/src/auth/*`
- Create: `apps/dashboard/src/pages/platform/*`
- Create: `apps/dashboard/src/pages/settings/Team.tsx`
- Create: `apps/dashboard/src/pages/settings/Credentials.tsx`
- Modify: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/src/components/layout/AppShell.tsx`
- Test: `apps/dashboard/src/pages/OperatorAccessFlow.test.tsx`

**Interfaces:**
- Produces invite acceptance/sign-in, root provisioning/merchant switcher/banner, fixed role management, and show-once keys.

- [x] Write mocked-BFF tests for root and each client role, last-Admin errors, key show-once/rotation/revocation, and demo markers.
- [x] Run the focused test; expect missing authenticated routes.
- [x] Implement canonical typed pages without storing sessions or keys in local storage; preserve current visual system.
- [x] Run dashboard tests/build/lint; expect exit 0.
- [x] Commit with `git commit -m "feat: add authenticated operator administration"`.

### Task 9: Wire schema, customer, and immutable Promo authoring

**Files:**
- Create: `apps/dashboard/src/data/schema-api.ts`
- Create: `apps/dashboard/src/data/customer-api.ts`
- Create: `apps/dashboard/src/data/program-api.ts`
- Modify: `apps/dashboard/src/pages/setup/Variables.tsx`
- Modify: `apps/dashboard/src/components/builder/ConditionBuilder.tsx`
- Modify: `apps/dashboard/src/pages/promo/PromoCreate.tsx`
- Modify: `apps/dashboard/src/pages/ProgramDetail.tsx`
- Create: `apps/dashboard/src/pages/customers/CustomerLookup.tsx`
- Test: `apps/dashboard/src/pages/LiveOperatorJourney.test.tsx`

**Interfaces:**
- Produces live schema impact/publish/deprecate, exact customer lookup/update, Promo draft/revision/lifecycle, typed nested conditions, and advisory rule warnings.

- [x] Write a mocked-BFF journey defining fields, publishing, updating a customer, authoring two ordered rewards/fallback, publishing revision 1, editing/publishing revision 2, and preserving counters.
- [x] Run focused tests; expect demo-store behavior to fail network assertions.
- [x] Replace store access only on live surfaces; keep future modules visibly demo-only and make nested `ALL`/`ANY` controls functional.
- [x] Run dashboard and workspace tests/build/lint; expect exit 0.
- [x] Commit with `git commit -m "feat: wire live schema customer and promo operations"`.

**Gate C review: in progress.** Code review and automated verification are clean at `791443e`. Pending real-browser/local-stack verification: role-specific navigation and direct routes, root context switching/hard refresh, captured invitation acceptance and sign-in across all three Workers/two D1s, passkey ceremonies, browser storage/network/cookie/CSRF/no-store behavior, real correlated BFF errors, and live/demo separation.

---

## Delivery Gate D — Integration diagnostics

### Task 10: Build the Evaluation Playground

**Files:**
- Create: `apps/dashboard/src/pages/playground/EvaluationPlayground.tsx`
- Create: `apps/dashboard/src/pages/playground/request-builder.ts`
- Create: `apps/operator-web/src/routes/playground.ts`
- Test: `apps/dashboard/src/pages/playground/EvaluationPlayground.test.tsx`
- Test: `apps/operator-web/test/playground.test.ts`

**Interfaces:**
- Produces schema-driven request editor, structured decision inspector, credential-free curl template, local/staging commit, and server-enforced absence of production commit.

- [ ] Write tests for anonymous/stored customer evaluation, typed context, selected reward/revision, reasons, expiry, confirmation, idempotent retry, `409 EXHAUSTED`, and production route absence.
- [ ] Run focused tests; expect missing page/route.
- [ ] Implement environment capability response and split evaluate/commit BFF routes; do not infer production from URL text.
- [ ] Run focused tests and full dashboard/operator/core suites; expect exit 0.
- [ ] Commit with `git commit -m "feat: add safe evaluation playground"`.

### Task 11: Build the public-contract CLI simulator

**Files:**
- Create: `apps/integration-simulator/package.json`
- Create: `apps/integration-simulator/src/client.ts`
- Create: `apps/integration-simulator/src/fake-connector.ts`
- Create: `apps/integration-simulator/src/scenario.ts`
- Create: `apps/integration-simulator/src/index.ts`
- Test: `apps/integration-simulator/src/scenario.test.ts`

**Interfaces:**
- Produces `runScenario(config)` and `pnpm --filter @incentives/integration-simulator start`; imports contracts/connector-kit only.

- [ ] Write HTTP-boundary tests for published-fixture validation, customer update, evaluation/mapping, redeem-before-capture, retry, exhaustion/reprice, sanitized trace, and production refusal.
- [ ] Run simulator tests; expect missing implementation.
- [ ] Implement fake native `shopper_id`/`total_pence`/`sku` mapping and parse canonical error responses, including `409 EXHAUSTED`.
- [ ] Run simulator and connector conformance tests plus a real local-D1 flow; expect exit 0.
- [ ] Commit with `git commit -m "feat: add canonical integration simulator"`.

**Gate D review:** Prove the dashboard and CLI agree on canonical requests/decisions and that neither simulator can redeem in production.

---

## Delivery Gate E — Audit, deployment, and acceptance

### Task 12: Complete cross-service audit, safe observability, and retention

**Files:**
- Create: `apps/identity/src/services/audit.ts`
- Create: `apps/api/src/services/audit-service.ts`
- Create: `apps/operator-web/src/routes/audit.ts`
- Modify: `apps/dashboard/src/lib/bff-client.ts`
- Create: `apps/dashboard/src/pages/settings/Audit.tsx`
- Create: `apps/dashboard/src/pages/settings/Audit.test.tsx`
- Modify: each Worker request/error middleware
- Modify: `apps/dashboard/src/App.tsx`
- Modify: `apps/dashboard/src/components/layout/AppShell.tsx`
- Test: `apps/operator-web/test/audit.test.ts`
- Test: `apps/api/test/safe-logging.test.ts`

**Interfaces:**
- Produces correlated Identity/Product audit queries, merged live Audit dashboard views, root labels, safe structured logs, configurable 12-month retention, and alertable safe events.

**Sequencing:** Task 8 deliberately ships without a live Audit surface. Task 12 adds the BFF audit contract, merged data, dashboard client, Audit page, and page tests together so the UI cannot precede its authoritative data boundary. Repository documentation synchronization to Notion remains required later in Task 13; this sequencing change does not reduce total scope.

- [ ] Write tests that trace one correlation id across all Workers and reject snapshots containing tokens, links, attributes, carts, conditions, or rewards.
- [ ] Run focused tests; expect missing audit services.
- [ ] Implement owning-service audit writes and BFF merge pagination; add retention cleanup and safe event categories.
- [ ] Implement the typed dashboard audit client and live Audit page only after the merged BFF query is available.
- [ ] Run all service tests and secret-pattern scans; expect exit 0.
- [ ] Commit with `git commit -m "feat: add production audit and observability"`.

### Task 13: Add isolated deployments, CI/CD, smoke tests, and operator documentation

**Files:**
- Create: `.github/workflows/plan3-ci.yml`
- Create: `.github/workflows/deploy-staging.yml`
- Create: `.github/workflows/deploy-production.yml`
- Create: `scripts/smoke/staging.ts`
- Create: `scripts/smoke/production.ts`
- Create: `docs/integration/operator-quickstart.md`
- Create: `docs/operations/root-bootstrap.md`
- Create: `docs/operations/deployment-rollback.md`
- Modify: `README.md`
- Modify: `apps/dashboard/README.md`

**Interfaces:**
- Produces feature/`dev`/`main` checks, automatic staging, manually approved production, clean/upgraded migration checks, environment-specific smoke suites, and tested operational runbooks.

- [ ] Add failing workflow-contract tests validating three Workers/two D1s per environment, no dashboard secret injection, protected production job, backup-before-migrate, and production smoke mutation denylist.
- [ ] Run workflow/docs fixture tests; expect missing files.
- [ ] Implement workflows and smoke clients; use expand/contract deployment order Core/Identity before Operator Web and independent Worker rollback.
- [ ] Validate every JSON/curl example through canonical fixtures; synchronize changed repository docs to Notion and read them back without truncation/unknown blocks.
- [ ] Run `pnpm install --frozen-lockfile`, `pnpm -r test`, `pnpm -r build`, `pnpm -r lint`, migration tests, local E2E, `git diff --check`; expect all exit 0.
- [ ] Commit with `git commit -m "docs: ship production operator platform runbooks"`.

## Final acceptance

- [ ] Request code review for each delivery gate and resolve all correctness/security findings.
- [ ] Deploy `dev` through the staging workflow and record smoke correlation ids without recording data/secrets.
- [ ] Open a reviewed `dev` to `main` PR; require manual production approval.
- [ ] Run non-redemption production smoke tests and verify audit entries.
- [ ] Confirm the completion gate in the approved design and synchronize final repository/Notion status.
