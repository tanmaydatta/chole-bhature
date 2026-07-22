# Staging Invitation and Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** In progress

**Notion:** https://app.notion.com/p/3a5e5c7c2b8e81e984a5c732810e7588

**Goal:** Restore client-admin invitations by sending the strict Identity RPC shape and persist 100% of logs for all three staging Workers.

**Architecture:** Operator Web remains the authority boundary that derives session, merchant, organization, and correlation context before calling Identity. The create-invitation route will construct the one contract-specific envelope that places `correlationId` only inside `input`; the shared helper remains unchanged for other RPCs. The protected staging Wrangler generator will add the same explicit observability table to API, Identity, and Operator Web without changing checked-in local configs or deploying anything.

**Tech Stack:** TypeScript 6, Zod 4 contracts, Vitest 4, Node.js staging-config generator, Wrangler 4 TOML configuration, Cloudflare Workers Logs.

## Global Constraints

- Work on `fix/staging-invitation-observability`; do not commit or push directly to `dev`.
- Do not use Git worktrees.
- Do not run any Cloudflare create, write, migration, deployment, secret, domain, or delete action; the operator performs every Cloudflare mutation.
- Enable persisted staging logs for API, Identity, and Operator Web with `enabled = true` and `head_sampling_rate = 1`.
- Do not enable Cloudflare traces, Logpush, third-party export, or production configuration.
- Do not alter checked-in local `wrangler.toml` files.
- Do not record email addresses, secrets, cookies, invitation links, activation grants, or recovery codes in docs or test evidence.
- Follow red-green-refactor: every production-code change must be preceded by a regression test that fails for the expected reason.

---

## File map

- `apps/operator-web/test/bff.test.ts`: browser-to-BFF regression proving the emitted invitation RPC satisfies the strict shared contract.
- `apps/operator-web/src/routes/team.ts`: narrow create-invitation request construction fix.
- `apps/identity/test-node/staging-wrangler-runner.test.ts`: generated-config regression for every supported staging action.
- `packages/contracts/src/deployment-topology.test.ts`: topology-level assertion that all three staging Workers enable 100% observability.
- `scripts/staging-wrangler-config.mjs`: protected generated staging Wrangler configuration source of truth.
- `docs/testing/staging-activation-run-2026-07-21.md`: sanitized staging execution evidence and remaining manual checks.
- `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`: historical issue resolution annotation without rewriting the original failed result.
- `docs/testing/gate-c-local-environment-setup.md`: remove the resolved invitation blocker from current prerequisites.
- `docs/testing/gate-c-non-technical-manual-guide.md`: remove language that says invitation testing is expected to be blocked.

---

### Task 1: Repair the create-invitation Identity RPC envelope

**Files:**
- Modify: `apps/operator-web/test/bff.test.ts`
- Modify: `apps/operator-web/src/routes/team.ts`

**Interfaces:**
- Consumes: `contracts.IdentityCreateInvitationRequestSchema.safeParse(value)` and the existing `ProtectedRoute` context.
- Produces: `IDENTITY.createInvitation({ sessionId, selectedMerchantId, input })`, where `input.correlationId` is present and top-level `correlationId` is absent.

- [x] **Step 1: Strengthen the selected-root invitation test against the real strict contract**

In `lets selected root manage the client team with server-resolved organization authority`, replace the loose `expect.objectContaining` assertion for `createInvitation` with:

```ts
    const invitationRequest = env.IDENTITY.createInvitation.mock.calls[0]?.[0];
    expect(contracts.IdentityCreateInvitationRequestSchema.safeParse(invitationRequest).success)
      .toBe(true);
    expect(invitationRequest).toEqual({
      sessionId: 'session-root',
      selectedMerchantId: 'merchant-a',
      input: {
        organizationId: 'org-a',
        email: 'new@example.test',
        role: 'admin',
        expiresInSeconds: 86400,
        correlationId,
      },
    });
    expect(invitationRequest).not.toHaveProperty('correlationId');
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @incentives/contracts build
pnpm --filter @incentives/operator-web exec vitest run test/bff.test.ts -t "lets selected root manage the client team"
```

Expected: FAIL because strict parsing returns `false`, the actual request contains a top-level `correlationId`, or the exact-envelope assertion reports that extra property.

- [x] **Step 3: Construct the create-invitation envelope without the generic helper**

In `apps/operator-web/src/routes/team.ts`, replace the current `createInvitation` call with:

```ts
      return context.env.IDENTITY.createInvitation({
        sessionId: context.principal.sessionId,
        selectedMerchantId: context.operator.merchantId,
        input: {
          organizationId: organizationId(context),
          ...body,
          correlationId: context.correlationId,
        },
      });
```

Do not modify `identityRequest`; list, retry, role-change, and member-removal calls require its top-level correlation ID.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @incentives/operator-web exec vitest run test/bff.test.ts -t "lets selected root manage the client team"
```

Expected: one passing test and no failures.

- [x] **Step 5: Run the complete Operator Web test and typecheck gates**

Run:

```bash
pnpm --filter @incentives/operator-web test
pnpm --filter @incentives/operator-web build
pnpm --filter @incentives/operator-web lint
```

Expected: every command exits 0.

- [x] **Step 6: Commit the isolated invitation repair**

```bash
git add apps/operator-web/test/bff.test.ts apps/operator-web/src/routes/team.ts
git commit -m "fix: send valid invitation rpc envelope"
```

---

### Task 2: Enable persisted 100% logs for every staging Worker

**Files:**
- Modify: `apps/identity/test-node/staging-wrangler-runner.test.ts`
- Modify: `packages/contracts/src/deployment-topology.test.ts`
- Modify: `scripts/staging-wrangler-config.mjs`

**Interfaces:**
- Consumes: `renderStagingWranglerConfig(app, configuration, repositoryRoot)` for `api`, `identity`, and `operator-web`.
- Produces: a top-level TOML `[observability]` table with `enabled = true` and `head_sampling_rate = 1` in every generated staging config.

- [x] **Step 1: Add the runner-level generated-config assertion**

Inside the parameterized `renders and cleans a protected %s %s config` test, after the config-path assertions, add:

```ts
    expect(capture.config).toContain(`[observability]
enabled = true
head_sampling_rate = 1`);
```

This covers every supported API, Identity, and Operator Web staging dev, migrate, and deploy path.

- [x] **Step 2: Add topology-level assertions for all three Workers**

In `generates the complete staging topology from validated inputs`, after creating `operatorStaging`, add:

```ts
    for (const generated of [apiStaging, identityStaging, operatorStaging]) {
      expect(section(generated, 'observability')).toContain('enabled = true');
      expect(section(generated, 'observability')).toContain('head_sampling_rate = 1');
    }
```

- [x] **Step 3: Run both focused tests and verify RED**

Run:

```bash
pnpm --filter @incentives/identity exec vitest run --config vitest.node.config.ts test-node/staging-wrangler-runner.test.ts
pnpm --filter @incentives/contracts exec vitest run src/deployment-topology.test.ts
```

Expected: FAIL because generated configs do not contain an `observability` table.

- [x] **Step 4: Add one reusable staging observability fragment**

Near the existing staging constants in `scripts/staging-wrangler-config.mjs`, add:

```js
const STAGING_OBSERVABILITY_TOML = `[observability]
enabled = true
head_sampling_rate = 1`;
```

Insert `${STAGING_OBSERVABILITY_TOML}` once in each returned API, Identity, and Operator Web template. For API and Operator Web, keep the top-level `routes = [...]` line before the fragment. Put the fragment before the next TOML table (`[[d1_databases]]` or `[vars]`) so `routes` and other top-level keys cannot accidentally become observability properties.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --filter @incentives/identity exec vitest run --config vitest.node.config.ts test-node/staging-wrangler-runner.test.ts
pnpm --filter @incentives/contracts exec vitest run src/deployment-topology.test.ts
```

Expected: all focused tests pass.

- [x] **Step 6: Run the staging generator lint and complete Identity Node tests**

Run:

```bash
apps/identity/node_modules/.bin/oxlint scripts/staging-wrangler-config.mjs scripts/staging-wrangler-runner.mjs
pnpm --filter @incentives/identity exec vitest run --config vitest.node.config.ts
```

Expected: both commands exit 0.

- [x] **Step 7: Commit the isolated observability configuration**

```bash
git add scripts/staging-wrangler-config.mjs apps/identity/test-node/staging-wrangler-runner.test.ts packages/contracts/src/deployment-topology.test.ts
git commit -m "feat: persist all staging worker logs"
```

---

### Task 3: Record the staging failure, resolution, and repeatable manual continuation

**Files:**
- Create: `docs/testing/staging-activation-run-2026-07-21.md`
- Modify: `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`
- Modify: `docs/testing/gate-c-local-environment-setup.md`
- Modify: `docs/testing/gate-c-non-technical-manual-guide.md`
- Modify: `docs/superpowers/plans/2026-07-22-staging-invitation-observability.md`

**Interfaces:**
- Consumes: sanitized root/client/manual results already observed and the automated verification output from Tasks 1–2.
- Produces: a safe activation record that tells the next tester exactly what passed, failed, was fixed, and still needs manual staging verification.

- [x] **Step 1: Create the sanitized staging activation run report**

Create `docs/testing/staging-activation-run-2026-07-21.md` with these sections and facts:

```md
# Staging activation run — 2026-07-21

**Status:** In progress — invitation fix awaiting merge and operator redeployment

## Environment

- API health: Pass (`GET /v1/health` returned 200 with `{ "status": "ok" }`)
- Operator origin: Pass (dashboard loaded over HTTPS)
- Identity exposure: Pass (private Worker was not publicly reachable)
- Product/Auth migrations: Pass (no pending migrations after activation)
- Persisted Worker logs: Pending redeployment of the generated 100% observability config

## Completed manual checks

- Root activation grant exchange: Pass
- Root passkey registration and sign-in: Pass
- Recovery codes displayed and stored by the operator: Pass; values not recorded
- Client provisioning: Pass for two active staging clients
- Root client selection and refresh persistence: Pass for both clients

## Invitation incident

- Result before fix: Fail
- Safe response: HTTP 400, `INVALID_REQUEST`, non-retryable
- Correlation: `3d718b24-0ed9-4801-b5e5-a00f458f4f9d`
- Reproduction: the failure remained after correcting the recipient email
- Boundary evidence: Operator Web accepted the browser body and invoked Identity; Identity rejected the create-invitation RPC before invitation processing
- Root cause: an extra top-level `correlationId` violated strict `IdentityCreateInvitationRequestSchema`; the valid correlation ID already belonged inside `input`
- Code resolution: Pending merge and Operator Web redeployment

## Remaining manual continuation

1. Redeploy API, Identity, and Operator Web after merge so all three persist 100% of staging logs.
2. Retry the client-admin invitation for an allowlisted recipient.
3. Confirm the invitation is listed as sent/pending and the email arrives.
4. Accept the invitation in a fresh browser profile and complete magic-link sign-in.
5. Continue role enforcement, schema, customer, Promo evaluation, redemption, retry, and exhaustion checks from the non-technical guide.

## Evidence policy

Do not add recipient addresses, secrets, cookies, links containing tokens, activation grants, or recovery-code text.
```

- [x] **Step 2: Annotate the historical Gate C issue without rewriting history**

Under `GATE-C-ISSUE-003` in `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`, add:

```md
- Resolution on 2026-07-22: The same contract mismatch was reproduced in staging. Operator Web sent a forbidden top-level `correlationId` to the strict Identity create-invitation RPC. The regression fix constructs the contract-specific envelope and keeps the correlation ID inside `input`. The original run remains Fail; end-to-end closure requires redeployment and a fresh manual invitation.
```

- [x] **Step 3: Remove obsolete expected-blocker wording from current guides**

In `docs/testing/gate-c-local-environment-setup.md`, remove the prerequisite statement that invitations currently return `INVALID_REQUEST`. In `docs/testing/gate-c-non-technical-manual-guide.md`, change the status to `Ready to use after developer setup` and remove sentences saying invitation testing is currently expected to be blocked. Retain the troubleshooting instruction that tells a tester to record any future `Request validation failed` response as a failure.

- [x] **Step 4: Validate documentation safety and formatting**

Run:

```bash
rg -n "@gmail|@outlook|@hotmail|AUTH_SECRET|RESEND_API_KEY|OPERATOR_SELECTION_SECRET|recovery code:" docs/testing/staging-activation-run-2026-07-21.md
git diff --check
```

Expected: the secret/recipient scan prints no matches and `git diff --check` exits 0.

- [x] **Step 5: Sync the plan status and testing documents to Notion**

Use `ntn pages edit` for the existing Gate C run (`3a4e5c7c-2b8e-81f2-8b7d-d9455e94b71a`), local setup (`3a4e5c7c-2b8e-8197-b2da-f950431552b3`), and non-technical guide (`3a4e5c7c-2b8e-81a8-949c-ff0b321b04fc`). Create the staging activation report below the platform documentation page (`2fce5c7c-2b8e-8070-b865-daaa741e7370`). Confirm the Plans index still links this plan with `In progress`. Do not include any excluded evidence.

- [x] **Step 6: Check off completed plan boxes and commit documentation**

```bash
git add docs/testing/staging-activation-run-2026-07-21.md docs/testing/runs/2026-07-20-gate-c-playwright-run.md docs/testing/gate-c-local-environment-setup.md docs/testing/gate-c-non-technical-manual-guide.md docs/superpowers/plans/2026-07-22-staging-invitation-observability.md
git commit -m "docs: record staging invitation incident"
```

---

### Task 4: Verify the branch and prepare review without deploying

**Files:**
- Verify only: all files changed in Tasks 1–3

**Interfaces:**
- Consumes: the fixed Operator Web envelope, generated observability config, and sanitized docs.
- Produces: a reviewable branch whose automated checks pass and whose Cloudflare changes remain undeployed.

- [x] **Step 1: Run repository-wide tests**

Run:

```bash
pnpm test
```

Expected: all workspace tests pass.

- [x] **Step 2: Run repository-wide typecheck/build and lint**

Run:

```bash
pnpm build
pnpm lint
```

Expected: both commands exit 0. The existing dashboard bundle-size warning may appear and is non-blocking; record it without claiming pristine output.

- [x] **Step 3: Review the exact branch diff and secret safety**

Run:

```bash
git diff --check dev...HEAD
git status --short --branch
git diff --stat dev...HEAD
git diff dev...HEAD -- apps/operator-web/src/routes/team.ts scripts/staging-wrangler-config.mjs
```

Expected: only planned files are tracked; `.pnpm-store/` and `CLAUDE.md` remain untracked and untouched; no secret values appear.

- [x] **Step 4: Request code review before publication**

Use `superpowers:requesting-code-review` to review the contract boundary, TOML placement, test strength, documentation accuracy, and secret safety. Address only confirmed findings and re-run affected checks.

- [ ] **Step 5: Push the branch and open a PR targeting `dev`**

```bash
git push -u origin fix/staging-invitation-observability
gh pr create --base dev --head fix/staging-invitation-observability --title "Fix staging invitations and enable Worker logs" --body $'## Summary\n- send a strict create-invitation Identity RPC envelope\n- persist 100% of logs for all three staging Workers\n- record the staging incident and repeatable continuation\n\n## Verification\n- pnpm test\n- pnpm build\n- pnpm lint\n\n## Deployment\nCodex made no Cloudflare mutations. After merge, the operator must redeploy API, Identity, and Operator Web.'
```

The PR body must summarize the root cause, 100% staging logs across three Workers, automated verification, manual redeployment requirement, and absence of Cloudflare mutations by Codex.

- [ ] **Step 6: Merge only after CI passes, then hand off operator redeployment**

After CI and review pass, run `gh pr merge --merge --delete-branch` to merge the current branch into `dev`. Do not deploy. Give the operator these three commands, one at a time, waiting for completion after each:

```bash
(
  set -a
  . ./.env.staging
  set +a
  pnpm --filter @incentives/api deploy:staging
)
```

```bash
(
  set -a
  . ./.env.staging
  set +a
  pnpm --filter @incentives/identity deploy:staging
)
```

```bash
(
  set -a
  . ./.env.staging
  set +a
  pnpm --filter @incentives/operator-web deploy:staging
)
```

- [ ] **Step 7: Resume manual testing and close documentation only after evidence**

After the operator redeploys, verify an invitation reaches the allowlisted client admin and is accepted in a fresh browser profile. Update the activation report and Notion plan from `In progress` to `Done` only after the remaining manual checks required by the staging activation plan are complete; otherwise leave it `In progress` with exact Pass/Fail/Blocked results.
