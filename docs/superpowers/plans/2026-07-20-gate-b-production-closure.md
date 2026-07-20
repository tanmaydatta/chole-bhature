# Gate B Production Closure Implementation Plan

**Status:** Done

**Notion parent:** [Plans](https://app.notion.com/p/Plans-390e5c7c2b8e8165b7f7d77392eab088)

**Notion mirror:** https://app.notion.com/p/3a3e5c7c2b8e81b49fd3c046d513aef5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the reviewed production-readiness gaps in Identity HTTP failures, authentication persistence auditing, and real staging configuration without committing external resource placeholders.

**Architecture:** Identity keeps its static safe local configuration while staging commands call one shared Node runner. The runner validates environment-supplied staging values, renders two temporary mode-`0600` Wrangler configs, validates the selected app's repository-local `node_modules/wrangler/bin/wrangler.js`, and invokes that JavaScript entrypoint with the absolute current Node executable, argument arrays, and `shell: false`; it never executes the package-manager shell shim and removes all temporary material in `finally`. Better Auth failures are classified using verified authorization state so credential denials remain 401 while post-verification infrastructure failures become retryable 503 responses. With the pinned Better Auth/passkey version `1.6.23`, a session-persistence failure after successful passkey verification is wrapped as status `400` with the exact raw error code `AUTHENTICATION_FAILED`; only that exact wrapper or a 5xx response is treated as infrastructure failure, and only while the captured authorization remains current.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers/Miniflare/D1, Node.js ESM, Wrangler, pnpm.

## Global Constraints

- Keep Core local worker `incentives-api` and Product D1 `incentives-dev`.
- Support local and staging only; do not add production configuration.
- Require real staging Product/Auth D1 UUIDs, HTTPS operator origin, matching RP ID, and safe staging environment values.
- Reject sentinel/zero/equal database IDs and `.invalid` endpoints.
- Never invoke a shell, print generated configuration, or persist staging config after success/failure.
- Preserve exact canonical Identity HTTP errors: `{ error: { code, message, correlationId, retryable, fields? } }`.
- Keep Auth migration history append-only and retain transactional session/passkey persistence auditing.

---

### Task 1: Authentication Failure Classification

**Files:**
- Modify: `apps/identity/src/auth.ts`
- Modify: `apps/identity/test/rereview.test.ts`

**Interfaces:**
- Consumes: Better Auth `Response`, captured `PasskeyAuthorization`, and `isPasskeyAuthorizationCurrent()`.
- Produces: canonical retryable 503 for post-verification persistence failures, 401 for invalid/stale authentication, and `failed` versus `denied` audit outcomes.

- [ ] Add real failure-injection tests for passkey-authenticated session rollback, passkey registration failure outcome, magic-link session failure outcome, and non-OK passkey-options normalization.
- [ ] Run `pnpm --filter @incentives/identity exec vitest run test/rereview.test.ts` and confirm the new assertions fail for the missing behavior.
- [ ] Classify a verify-authentication response as infrastructure failure only when a captured authorization is still current and the response is either 5xx or the pinned Better Auth `1.6.23` status-400/exact-`AUTHENTICATION_FAILED` persistence wrapper; preserve every other 4xx and stale/invalid case as 401 denied behavior.
- [ ] Normalize non-OK generate-authentication-options responses through the canonical error boundary.
- [ ] Record 5xx authentication/registration/verification attempts as `failed` and policy/credential rejections as `denied`.
- [ ] Re-run the focused Identity suite and expect all tests to pass.

### Task 2: Fail-Closed Staging Configuration Runner

**Files:**
- Create: `scripts/staging-wrangler-runner.mjs`
- Create: `scripts/staging-wrangler-config.mjs`
- Create: `apps/identity/test-node/staging-wrangler-runner.test.ts`
- Create: `.env.staging.example`
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/identity/package.json`
- Modify: `packages/contracts/src/deployment-topology.test.ts`
- Modify: `docs/superpowers/plans/2026-07-20-gate-b-production-closure.md`

**Interfaces:**
- Consumes environment variables `STAGING_PRODUCT_D1_ID`, `STAGING_AUTH_D1_ID`, `STAGING_OPERATOR_ORIGIN`, and `STAGING_PASSKEY_RP_ID`, plus CLI arguments `<api|identity> <dev|migrate|deploy>`.
- Produces validated app-specific temporary Wrangler TOML passed only by filesystem path to `wrangler`, with process exit status preserved.

- [ ] Add Node E2E tests using a fake Wrangler executable that capture argument arrays and config file modes/content without logging the config.
- [ ] Cover success for both apps and all command mappings, cleanup on success/failure, zero/sentinel/equal/non-UUID D1 IDs, non-HTTPS/`.invalid` origin, RP/origin mismatch, unsafe environment, unknown app/action, and redacted stdout/stderr.
- [ ] Run the Node test and confirm it fails because the runner is absent.
- [ ] Implement pure validation/rendering in `scripts/staging-wrangler-config.mjs` and process/temp-file lifecycle in `scripts/staging-wrangler-runner.mjs` using `spawnSync`/`execFile` argument arrays with `shell: false`.
- [ ] Point both apps' staging dev/migrate/deploy scripts at the shared runner and add clean-checkout dependency build pre-hooks.
- [ ] Replace sentinel staging values in checked-in Wrangler files with local-only safe structure; generated staging config must receive all real remote values from the environment.
- [ ] Document copy-and-fill usage in `.env.staging.example` without any real credentials or resource IDs.
- [ ] Re-run Node and topology tests and expect all tests to pass.

### Task 3: Verification and Review

**Files:**
- Verify all files changed by Tasks 1-2.

**Interfaces:**
- Consumes: completed Gate B working-tree diff.
- Produces: evidence for tests, build, lint, fresh migrations, staging dry-run with fake Wrangler, and clean diff.

- [ ] Run `pnpm test`, `pnpm build`, `pnpm lint`, and `git diff --check`; require exit 0, allowing only the two pre-existing dashboard Fast Refresh warnings.
- [ ] Apply Product and Auth migrations to separate fresh temporary local D1 directories and require every migration to succeed.
- [ ] Run a read-only code review against the complete uncommitted diff and resolve Critical/Important findings.
- [ ] Pause before commit and report exact verification evidence to the controller.
