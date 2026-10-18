# Preauthenticated Product E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user mandates subagents for coding; ROOT never inline-edits implementation. ROOT announces the complexity/model before dispatch and reviews each task before the next.

**Goal:** Run routine product E2E with real synthetic member sessions and automatic run-scoped setup/disposal, without owner passkey login.

**Architecture:** Add a separate version-2 control protocol over existing Operator → Identity → Core bindings. Identity authenticates a dedicated setup credential and issues genuine Better Auth member cookies; immutable run leases and execution-time D1 guards fence creation, business mutations and cleanup independently. Convert the existing product harness after these server boundaries pass.

**Tech Stack:** Existing TypeScript/Zod, Workers RPC, D1/SQLite, Better Auth 1.6.23, Vitest Workers pool, Playwright, project-pinned Wrangler 4.112.0 and pnpm; no new dependencies.

**Spec:** [Preauthenticated product E2E contract](../specs/2026-10-12-preauthenticated-product-e2e-design.md), approved at `604ede28289d11af0803e3d588d110ad3b95be20`.

## Global Constraints

- Preserve real UI, APIs, D1 persistence, exact business assertions, permissions, tenant isolation and all six existing local cases. Keep two workers, simultaneous scenarios, existing timeouts/retries and baseline auth/security tests.
- “Its immutable creation lease expires 15 minutes after reservation.” Use `900_000` ms; no renewal. Keep the existing fixture constraint `hard_expires_at = issued_at + 900000`, with an additional earlier controller deadline.
- “Each recovery invocation has a five-minute deadline and may be retried.” Use `300_000` ms per invocation; recovery never grants authoring or issuance.
- Control bodies are at most 16 KiB (`16_384` bytes); admit at most eight active leases per target atomically. Deployment-configured account quotas default to three, without a per-role uniqueness rule.
- Stage supports a trusted local runner with durable 0700 directories/0600 proofs. Hosted staging, persistent CI proof storage, optional auth-smoke integration and per-PR cloud provisioning remain deferred.
- Setup credentials stay in trusted process memory and Identity bindings; never browser state, argv, logs, traces or artifacts. Cookies/proofs/controllers remain private. Auth/cookie signing keys never authorize setup.
- Local control requires a fresh managed stack, exact allocated loopback origins/private stores and a per-stack credential. Ordinary local, production, unknown modes and reflected caller flags refuse before writes.
- Keep legacy version-1 ROOT routes/claims/disposal compatible and manual staging tenants unaffected. Lost proof quarantines only its run; it cannot be recovered from a hash.
- This document authorizes no execution. User plan approval precedes implementation dispatch; credential creation, remote migrations/deployments, release/push/PR and external documentation publication require separate later approval.

## Review Focus

- A v2 ownership marker remains but its ledger is missing/corrupt: fail closed, rather than treating the tenant as legacy (Task 2).
- The lease expires while a D1 batch runs: reject and roll back the entire mutation, including rate windows/audits/counters (Task 2).
- Better Auth slides expiry or completes session issuance after cancellation: no accepted session or published cookie survives the creation deadline (Task 3).
- The creation generation is older than the deployed generation: creation refuses; cleanup requires an explicitly compatible generation registry (Task 4).
- A runner dies with a stale lock or genuinely loses its proof: recover only from retained private proof, never infer ownership from PID/hash or block another run (Tasks 5–6).

---

## Before implementation

Use this existing worktree and approved spec as planning provenance; implementation isolation/branch selection belongs to the later approved execution. Preserve dirty/user files and ignored evidence. All future authored edits use `apply_patch`; commands below run from the repository root with `login:false` and must not source credential files. Existing build scripts define the commands; no install/upgrade is part of these tasks.

The full baseline gate for each task is, sequentially: `pnpm build`, `pnpm lint`, `pnpm test`. Expected: exit 0, no skipped/disabled regressions; report actual new counts. Tasks 5–7 additionally run `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` using the already installed pinned browser. A RED observation must identify the intended missing contract/behavior, not an unrelated import, environment or old test failure. Add a minimal compiling stub if necessary before the behavioral RED run.

### Shared interfaces and file map

Task 1 owns these exact schemas/types in new `packages/contracts/src/e2e-control.ts`; export through existing `src/index.ts`. Each schema is strict; secrets are excluded from views/errors. Names below are proposed, not existing APIs.

| Type | Fields/contract |
|---|---|
| `E2eControlRuntime` | `{ environment: 'local'\|'staging'; generation: string; targetId: string; enabled: boolean; accountQuota: number; cleanupGenerations: string[] }`; generation is lowercase 40-hex source commit, target ID is 64-hex canonical target digest; quota is deployment-configured integer 1–32, default 3. |
| `E2eControlEnvelope` | `{ protocol: 'incentives-e2e-control'; version: 2; generation: string; targetId: string; requestId: string }`; request ID is UUID; generation/target are expectations compared to server values. |
| `E2eControlLease` | `{ runId; merchantId; provisioningId; organizationId?: string; generation; targetId; issuedAt: number; expiresAt: number; phase }`; run ID uses existing `E2eRunIdSchema`, IDs are UUIDs. Phases: `reserved`, `product-provisioned`, `auth-provisioned`, `active`, `fencing`, `disposing`, `disposed`, `quarantined`. |
| `E2eControlBootstrap` | `{ operation:'bootstrap'; envelope; runId; proof; controllerToken; name }`; proof/token are independent 43-character base64url encodings of 32 bytes; name ≤120 characters. Server allocates all tenant IDs. |
| `E2eControlAction` | Discriminated `{ envelope; runId; proof; operation }`: `status`, `cancel`, `dispose`; `account` adds existing fixture slug/role; `inspect` adds existing evaluation/idempotency/program-reference query. |
| `E2eControlCapabilities` | `{ protocol; version: 2; runtime: {environment,generation,targetId}; operator: 2; identity: 2; product: 2; migrations: {auth: string[]; product: string[]}; fencing: true; recovery: true }`. |
| `E2eControlRunView` | `{ lease; auth: Record<string,number>; product: Record<string,number> }`; counts exclude sanitized ownership/disposal tombstones. |
| `E2eControlAccount` | Existing `E2eFixtureAccount` (including its nonempty-string session ID) plus `cookieAttributes:{name:string;path:'/';httpOnly:true;secure:boolean;sameSite:'Lax';expiresAt:number}` from Identity's actual Better Auth policy. |
| `E2eControlBootstrapResult` | `{ lease; admin: E2eControlAccount }`; `admin.cookieHeader` is private. Status/idempotent readback never repeats it. |
| `IdentityControlCall` | `{ authorization: {kind:'setup'\|'controller'; value:string}; input: {operation:'capabilities'; envelope} \| E2eControlBootstrap \| E2eControlAction }`. |
| `CoreControlCall` | `{ envelope; operation; reservation?: StoredControlLease; cleanup?: CleanupInvocation; query?: E2eInspectionQuery }`; `capabilities` requires only envelope; `reserve/provision/activate/status/inspect/fence/dispose` require full reservation including hashes/request/payload/quota. `inspect` requires query; `dispose` requires cleanup. No setup credential reaches Core. |
| `CoreControlReply` | Capabilities: `{protocol;version:2;runtime:{environment,generation,targetId};product:2;migrations:string[];fencing:true;recovery:true}`; otherwise `{lease;product:Record<string,number>}`, existing `E2eRunInspection`, or control error. Identity verifies it before Operator composes capabilities. |
| `CleanupInvocation` | `{ id: string; runId; proofHash; currentGeneration; issuedAt; expiresAt }`, UUID ID and SQL-clock issuance/expiry. |

`E2eControlReply = E2eControlCapabilities | E2eControlBootstrapResult | E2eControlRunView | E2eControlAccount | E2eRunInspection | E2eControlError`; `E2eControlError` is `{error:{code,correlationId:string,retryable:boolean}}`. Codes: `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_REQUEST`, `INCOMPATIBLE`, `CONFLICT`, `EXPIRED`, `QUARANTINED`, `UNAVAILABLE`; map to 404/401/403/400/409/409/401/409/503. Never expose raw errors.

Declare `StoredControlLease` in contracts alongside the call schema; its fields are specified in Task 2. Use existing `E2eInspectionQuery`/`E2eInspectionQuerySchema` from `operator.ts`. Task order is contracts → SQL fences → bootstrap/session → recovery → harness → real acceptance → staging readiness. File scopes below are exact; future paths are not links.

### Task 1: Define the separate control protocol

**Files:** Create `packages/contracts/src/e2e-control.ts`, `packages/contracts/src/e2e-control.test.ts`; modify `packages/contracts/src/index.ts`, `packages/contracts/src/paths.ts`, `packages/contracts/src/paths.test.ts`.

**Interfaces:** Consumes existing run, fixture-account, role and inspection schemas. Produces the types/table above, corresponding `…Schema` exports, and `E2E_CONTROL_PREFIX = '/operator/v1/e2e-control'`. Existing v1 schema exports remain unchanged.

- [ ] **Write contract tests.** Pin extra-key rejection, secret-free status, independent token/proof validation, exact limits and required discriminator fields. Exercise existing v1 fixtures unchanged. Example behavioral assertion:

  ```ts
  expect(E2eControlEnvelopeSchema.safeParse({ protocol: 'incentives-e2e-control',
    version: 1, generation: 'a'.repeat(40), targetId: 'b'.repeat(64),
    requestId: crypto.randomUUID() }).success).toBe(false);
  ```
- [ ] **Observe RED.** Run `pnpm --filter @incentives/contracts exec vitest run src/e2e-control.test.ts src/paths.test.ts`. Expected: v2 schema/path behavioral assertions fail against the compiling stub; preserve failure evidence.
- [ ] **Implement schemas/exports.** Match the interface table, normalize nothing silently, forbid caller-provided tenant IDs in bootstrap and preserve existing inspection reference bounds (1–4). Keep generation separate from protocol version.
- [ ] **Verify GREEN.** Repeat the focused command, then all three baseline commands above. Expected: strict v2 assertions and all legacy contracts pass.
- [ ] **Review and checkpoint.** ROOT reviews exact diff; stage only this task's five files and commit with `git commit -m 'feat: define isolated E2E control protocol'`. No application behavior is exposed; no runtime docs change is required yet.

### Task 2: Establish durable leases and atomic SQL fences

**Files:** Create `apps/api/migrations/0009_e2e_control_leases.sql`, `apps/identity/migrations/0007_e2e_control_leases.sql`, each app's `src/services/e2e-control-store.ts`, API `src/repositories/e2e-write-fence.ts`, Identity `src/services/e2e-write-fence.ts`, API `test/e2e-control-fence.test.ts`, Identity `test/e2e-control-store.test.ts`. Modify both `src/db/schema.ts` and `vitest.config.ts`, API `src/repositories/d1-repositories.ts`, `src/redemption/d1-atomic-redemption-coordinator.ts`, and Identity `src/services/organizations.ts`.

**Interfaces:** Consumes Task 1 types. `StoredControlLease = E2eControlLease & {proofHash:string;controllerHash:string;requestId:string;payloadHash:string;accountQuota:number}`. `createIdentityControlStore(db:D1Database)` produces `reserve(input: Omit<StoredControlLease,'issuedAt'|'expiresAt'|'phase'>): Promise<StoredControlLease>`; `createProductControlStore(db:D1Database)` produces `mirror(lease:StoredControlLease): Promise<StoredControlLease>`. Both expose `read(runId:string): Promise<StoredControlLease|null>`, `advance(runId:string,expectedPhase:E2eControlLease['phase'],nextPhase:E2eControlLease['phase']): Promise<StoredControlLease>`, `quarantine(runId:string): Promise<void>`, `beginCleanup(runId:string,proofHash:string,currentGeneration:string,requestId:string): Promise<CleanupInvocation>`. `withProductBusinessWrite` takes `(db:D1Database,runtime:E2eControlRuntime|undefined,merchantId:string,statements:D1PreparedStatement[]): Promise<D1Result[]>`; `withAuthBusinessWrite` substitutes `organizationId:string`. `withControlWrite` requires runtime, substitutes `lease:StoredControlLease,intent:'provision'|'activate'|'fence'|'dispose'` and adds `cleanup?:CleanupInvocation`. Missing runtime refuses marked tenants; unmarked legacy/manual writes remain unchanged.

- [ ] **Write migrated-D1 tests.** Seed two v2 tuples, a legacy ROOT tuple and a manual tenant in the existing Workers test databases. Cover ninth simultaneous admission, equal request ID/different payload, missing/corrupt ledger under a permanent v2 marker, old/new merchant scope, and failed/fenced mutations. Assert actual row/counter differences, not just exception codes:

  ```ts
  const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first();
  await expect(withProductBusinessWrite(env.DB, runtime, lease.merchantId,
    [env.DB.prepare('DELETE FROM customers WHERE merchant_id = ?1')
      .bind(lease.merchantId)])).rejects.toThrow();
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first()).toEqual(before);
  ```
  Here `runtime` and fenced `lease` are strict seeded values. Pause actual repository/redemption mutations after authorization, fence, resume, and assert budgets/counters/audits/ledger/rate windows unchanged. Test final-guard expiry with a Vitest-only SQL-clock substitution in the guard DDL and an advancing clock statement inside the real atomic D1 batch; assert prior writes roll back. Separately test actual SQL-clock expiry. No runtime clock override is exposed. Test concurrent account quota/duplicate-slug reservations.
- [ ] **Observe RED.** Run `pnpm --filter @incentives/api exec vitest run test/e2e-control-fence.test.ts` and `pnpm --filter @incentives/identity exec vitest run test/e2e-control-store.test.ts`. Expected: real database admission/fencing/rollback assertions fail; do not execute remote migrations.
- [ ] **Implement additive schema/store/fences.** Both databases receive `e2e_control_runs` (lease/hashes/quota), `e2e_control_requests` (unique run/request/action/payload hash; sanitized status), `e2e_control_cleanup` (invocation/deadline) and `e2e_control_write_guards` (exact operation tuple). Auth adds `e2e_control_accounts` with unique `(run_id,slug)`, user/membership/session IDs, generation and issuance state. Reserve Auth claim/ledger before Product I/O. Claims get immutable `control_version=2`; Product `merchants` and Auth `organizations`/`user` get immutable `e2e_control_run_id`. Missing/corrupt ledger under either marker refuses; NULL markers preserve legacy. Admission and account quota are atomic; phase transitions and identities/hashes/deadlines are immutable or monotonic.

  Each business batch inserts an operation-specific SQL guard, executes mutations, rechecks SQL-clock lease/status before commitment, then removes guards atomically. `RAISE(ABORT)` rolls back everything; zero changes is not success. Cleanup/provisioning use exact tuple/proof/invocation predicates, never ambient bypass. Compile Drizzle statements preserving result indexes and redemption `changes()` guards. Cover all repository/public-token/rate-window/audit and Auth membership/invitation/role mutations. Auth migration also defines v2 session INSERT/UPDATE triggers: join immutable user marker → account issuance/generation → run/claim, check SQL expiry and permitted phase; deny fixture sliding refresh, allow expired-session DELETE. Task 3 supplies matching issuance intent and resolver enforcement. Keep v1 disposal unchanged.
- [ ] **Verify GREEN.** Repeat both focused commands; run baseline build/lint/test. Expected: actual partial-batch rollback and all manual/legacy flows pass. Require a written inventory matching every mutation entrypoint to its guard and negative test before review.
- [ ] **Review and checkpoint.** ROOT reviews transaction/admission/coverage evidence; stage only the listed files, then `git commit -m 'feat: fence E2E fixture mutations with immutable leases'`. The foundation remains unexposed; no live migration is authorized.

### Task 3: Authenticate and complete server-side bootstrap/session issuance

**Files:** Create each Worker's `src/e2e-control-runtime.ts`, Identity/Core `src/services/e2e-control.ts`, Operator `src/routes/e2e-control.ts`, and each app's `test/e2e-control.test.ts`. Modify API `src/env.ts`, all three `src/worker.ts` / `src/ci-stack.ts`, Identity `src/auth.ts`, `src/staging-secrets.ts`, `src/services/e2e-fixtures.ts`, `src/services/organizations.ts`, Operator `src/routes/types.ts`; update `docs/integration/staging-operations.md` and `tests/e2e/README.md` with control contract/readiness status.

**Interfaces:** Consumes Task 2 store/fences. Produces `controlRuntime(env): E2eControlRuntime` per Worker's existing Env type, `IdentityOperatorService.e2eControl(call:IdentityControlCall): Promise<E2eControlReply>` and `CoreOperatorService.e2eControl(call:CoreControlCall): Promise<CoreControlReply>`. Identity resolves the new setup secret only on control calls and compares credential/proof hashes in constant time. Core validates its own runtime and stored tuple on private bindings, with no public control route or ordinary ROOT context.

- [ ] **Write authorization and real-session tests.** Cover no credential, ROOT cookie used as setup authority, normal business route receiving setup/controller authorization, wrong token/proof/scope/target/generation, absent schema, mixed Worker versions and normal-local/production/unknown mode. Assert zero claim/user/session writes on refusal. Test malformed/oversized streamed bodies and duplicate authorization headers. Missing setup binding must leave manual auth unchanged. Use real Better Auth and Auth D1 to assert `['e2e-fixture']`, exact membership/permissions, no platform role, disabled email and immutable 900000 ms record; resolve through both cookie and session-ID paths. Race issuance/sliding refresh against cancellation/expiry and assert no accepted cookie or renewed authority.

  For the returned admin, assert the real resolved principal:
  ```ts
  expect(principal.authenticationMethods).toEqual(['e2e-fixture']);
  expect(principal.platformRole).toBeUndefined();
  expect(principal.merchantId).toBe(admin.merchantId);
  ```
- [ ] **Observe RED.** Run `pnpm --filter @incentives/identity exec vitest run test/e2e-control.test.ts test/e2e-fixtures.test.ts`, `pnpm --filter @incentives/api exec vitest run test/e2e-control.test.ts`, and `pnpm --filter @incentives/operator-web exec vitest run test/e2e-control.test.ts test/bff.test.ts`. Expected: setup/negative/deadline assertions fail; ROOT guards remain intact.
- [ ] **Implement guarded control operations.** Under `/operator/v1/e2e-control`, expose POST `/capabilities`, `/bootstrap`, `/runs/:runId/{status,accounts,inspect,cancel,dispose}`. Setup authorization permits capabilities/bootstrap and exact-proof recovery status/disposal. Active controller-plus-proof permits status/account/inspection/cancel/disposal only. Every cookie-bearing request refuses independently of browser headers; also reject queries/browser metadata/origins/redirects. No ordinary principal resolution. Operator forwards bounded private authorization; only Identity has `E2E_SETUP_SECRET_STORE` (staging) or direct `E2E_SETUP_SECRET` (managed local).

  Read deployment-owned `E2E_CONTROL_GENERATION`, `E2E_CONTROL_TARGET_ID`, `E2E_CONTROL_ENABLED`, `E2E_CONTROL_ACCOUNT_QUOTA`, `E2E_CONTROL_CLEANUP_GENERATIONS`. Check actual live v2/schema capabilities before mutations; never reflect caller generation. Authenticate, allocate UUIDs, reserve, mirror/provision Product, create Auth organization/membership, activate both, then return verified admin state. No ROOT fabrication. Persist account intent/generation before Better Auth; Task 2's triggers plus both resolver checks enforce deadline. Derive cookie attributes from `auth.$context.authCookies.sessionToken`; browser expiry is the earlier lease/fixture deadline. Failed/lost issuance requires exact-run cleanup/new run, never remint. Enable helpers only for managed local/staging; ordinary local/cloud-ci v2 stay closed. Keep missing control secret independent of manual auth.
- [ ] **Verify GREEN.** Repeat the three focused package commands with full filters, then baseline gate. Expected: genuine member session accepted only for its owned tenant; all ROOT/passkey/recovery and manual auth tests remain green. Real cross-Worker transport is proved later in Task 5, not by mocked unit bindings.
- [ ] **Review/docs/checkpoint.** ROOT reviews complete authority closure and session races; stage exact task files plus updated staging documentation, then `git commit -m 'feat: bootstrap preauthenticated run-owned E2E members'`.

### Task 4: Make cleanup monotonic and recoverable after expiry

**Files:** Modify Identity/Core `src/services/e2e-control.ts`, `src/services/e2e-control-store.ts`; create each app's `test/e2e-control-recovery.test.ts`; extend existing `test/e2e-lifecycle.test.ts`; update `docs/integration/staging-operations.md`.

**Interfaces:** Consumes `CleanupInvocation`, `beginCleanup` and exact control-write guards. Produces `disposeControlRun(call: IdentityControlCall): Promise<E2eControlRunView>` in Identity, using Core `fence`/`dispose`. A new request ID creates one five-minute cleanup-only invocation; identical retries read/reuse its original deadline. No creation lease extends.

- [ ] **Write failure-phase/race tests.** Inject loss before/after reservation, mirror, Product/Auth activation, account mint and each disposal batch. Confirm readback/absence against exact tuples, Product zero before Auth deletion, concurrent disposal idempotence, cancellation-delivery failure and expiry. Assert old generation creation denied and cleanup allowed only when explicitly in `cleanupGenerations`; unknown/incompatible generations and wrong/lost proof do not mutate. Corrupt ownership quarantines one run while another succeeds. A manual member inserted into a fixture organization makes ownership verification refuse deletion. Preserve legacy ROOT disposal assertions.

  With an authenticated recovery `call`, assert real inventory:
  ```ts
  const disposed = await disposeControlRun(call);
  expect(Object.values(disposed.product).every(n => n === 0)).toBe(true);
  expect(Object.values(disposed.auth).every(n => n === 0)).toBe(true);
  ```
- [ ] **Observe RED.** Run `pnpm --filter @incentives/api exec vitest run test/e2e-control-recovery.test.ts test/e2e-lifecycle.test.ts` and `pnpm --filter @incentives/identity exec vitest run test/e2e-control-recovery.test.ts test/e2e-lifecycle.test.ts`. Expected: partial-init/expired-controller recovery assertions fail.
- [ ] **Implement cleanup.** Fence Auth first to revoke members/issuance, then fence Core before any deletion. Serialize per tuple through conditional state/cleanup-invocation guards; guard queued business mutations as Task 2 requires. Read back uncertain phases and exact absence, dispose Product, verify all owned tables zero, then dispose Auth and verify zero. Keep only sanitized tuple/audit tombstones; request/account journals must not retain customer/email/cookie data. Authenticate setup-plus-proof again on recovery after timeout/death; use current matching Worker protocol and a deploy-reviewed previous-generation allowlist, never an all-generations fallback. Missing proof yields quarantine/owner-review, no hash inversion or foreign deletion.
- [ ] **Verify GREEN.** Repeat focused commands and baseline gate. Expected: faults recover from every recorded phase, cleanup failures remain failures and foreign/manual rows remain byte-for-byte unchanged.
- [ ] **Review/docs/checkpoint.** ROOT reviews failure matrix and SQL guards; stage task files and documentation, then `git commit -m 'feat: recover exact E2E runs without owner sessions'`.

### Task 5: Replace routine harness authority with private control/member state

**Files:** Under `tests/e2e`, create `src/control-client.ts`, `src/member-state.ts`, `test/unit/control-client.test.ts`, `test/unit/member-state.test.ts`; modify `src/{local-stack,config,run-store,manifest,operator-client,execution,scenario-run,staging-cleanup,cli}.ts`, `playwright.global-setup.ts`, unit `{local-stack,run-store,operator-client,member-session,capabilities,execution,recipes,staging-cleanup,cli,platform}.test.ts`, and Playwright `{gap.api,local-stack.api,promo.browser,cloud-access.browser}.spec.ts`. Update `tests/e2e/README.md`, `docs/testing/local-pr-e2e-ci.md`, `docs/testing/gap-030-031-e2e.md`.

**Interfaces:** Consumes v2 replies. Produces `ControlClient.capabilities(): Promise<E2eControlCapabilities>`, `bootstrap(input:E2eControlBootstrap): Promise<E2eControlBootstrapResult|E2eControlRunView>`, `action(input:E2eControlAction,controllerToken?:string): Promise<E2eControlReply>`, `close(): Promise<void>`; `publishMemberState(target:Target,account:E2eControlAccount,outputPath:string): Promise<string>` verifies/publishes actual state. Status-only bootstrap retry triggers disposal/new run. Store adds `createControlRecord(envelope:E2eControlEnvelope,proof:string,controllerToken:string): Promise<void>` and `readControlRecord(): Promise<{envelope:E2eControlEnvelope;proof:string;controllerToken:string}>`, fsyncing exclusive files before dispatch. `RecipeContext` adds `control:ControlClient`, `memberStorageState:string`, `lease:E2eControlLease`; `operator` is the admin member client.

- [ ] **Write harness failure/privacy tests.** Assert scoped URLs/headers, no redirects or retry-after-cookie-loss, exact session/permission verification, exclusive state publication refusing symlinks/overwrites, private file modes and failed fsync preventing dispatch. Setup credential must not appear in member state/manifests/errors. Store status-only retries separately from minted-cookie delivery; stale authoring locks never authorize takeover by PID. Account recipes use control, business recipes use members, and add-merchant returns the already reserved merchant without ROOT selection.

  After actual publication to `path`, with the test's private `setupSecret`:
  ```ts
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readFile(path, 'utf8')).not.toContain(setupSecret);
  ```
- [ ] **Observe RED.** Run `pnpm --filter @incentives/e2e exec vitest run test/unit/control-client.test.ts test/unit/member-state.test.ts test/unit/local-stack.test.ts test/unit/run-store.test.ts test/unit/execution.test.ts`. Expected: new control/member flow assertions fail, no external staging calls occur.
- [ ] **Implement stack/harness conversion.** Build/start/readiness once per suite; generate a per-stack setup key in private Identity-only temporary vars and identical server generation/target metadata for all three Workers. Derive local target digest from owned stack ID, exact origins, generated binding names and private-store identity; verify generated configs contain no remote stores/services. Bootstrap once per scenario and save proof/controller before its first request. Scope browser/API contexts to member state; admin does not invoke platform selection/capability/disposal routes. Close contexts on cancellation and report failed remote cancellation until immutable expiry. Preserve old passkey helper and an explicit `startManagedLocalStack({authMode:'passkey'})` path for its existing unit regressions; routine default is `fixture`. Do not implement optional auth-smoke integration.
- [ ] **Verify GREEN.** Repeat focused tests, baseline gate and full local E2E command. Expected: existing six cases run with two workers; deep assertions and actual browser interactions pass with genuine member sessions. Independent-stack case now checks expected member identities and crossed-state rejection; controlled routing case retains all assertions. No owner/passkey work occurs in routine global setup.
- [ ] **Review/docs/checkpoint.** ROOT reviews state publication/owned cleanup and the six-case mapping; stage only task files/docs, then `git commit -m 'test: run product E2E with real preauthenticated members'`.

### Task 6: Prove real concurrent failure boundaries and fresh CI

**Files:** Create `tests/e2e/test/playwright/preauth-lifecycle.api.spec.ts`, `tests/e2e/test/support/preauth-runner.ts`; extend `test/playwright/gap.api.spec.ts`, `promo.browser.spec.ts`, `local-stack.api.spec.ts`, `test/unit/local-stack.test.ts`; modify `.github/workflows/ci.yml` only if explicit test/report wiring is needed; update the Task 5 testing docs.

**Interfaces:** Consumes Task 5 client/store/scenario functions. Produces a real local failure/lifecycle suite and sanitized `{phase,elapsedMs,outcome}` timings. The support runner is an owned child that writes its durable record and announces a closed ready phase over IPC; the parent kills only its live child handle, not a PID/group guess.

- [ ] **Write real acceptance cases.** Kill the child after persisted bootstrap while the parent's managed Workers remain alive; reopen its 0600 proof and perform cleanup-only recovery. Remove only the test-owned proof in a separate lost-proof case and assert refusal/quarantine plus another run's success. Race two simultaneous runs/disposals and a paused redemption/role change. Assert all run-owned Product/Auth rows zero, manifest resources cleaned, only sanitized tombstones retained and manual/foreign fixtures unchanged. Retain exact `3000` discount, `7001` subtotal, usage/budget/allocations, same/conflicting retries and the real edit/save/reload/publish dialog assertions; add real admin/operator/viewer denials.

  Retain the actual existing scenario call/assertions:
  ```ts
  const result = await withScenarioRun(runGapScenario);
  expect(result.expected.totalDiscount).toBe(3000);
  expect(result.expected.discountedMerchandiseSubtotal).toBe(7001);
  ```
- [ ] **Observe RED.** Run `E2E_BROWSER_CHANNEL=chromium E2E_TARGET=local pnpm --filter @incentives/e2e exec playwright test preauth-lifecycle.api.spec.ts --project=api`. Expected: at least one newly exposed failure boundary fails; if all pass, record the checks as coverage rather than inventing a defect or weakening the assertion.
- [ ] **Implement only a demonstrated missing lifecycle fix.** Obtain ROOT approval of its exact owning-file scope before dispatching a correction outside this task's listed files. Add fixed safe timings for stack/readiness/bootstrap/cleanup. Preserve same-repository CI, zero staging secrets, pinned browser and console-only diagnostics; no filters/quarantine/timeouts/retry changes.
- [ ] **Verify GREEN.** Run the focused command, baseline gate and full local E2E. Require all six original cases plus new local cases, two workers and simultaneous business scenarios. After later release approval, obtain fresh PR CI for this exact revision; do not substitute older green runs or fixed historical test counts.
- [ ] **Review/docs/checkpoint.** ROOT reviews full evidence and whole-branch authority coverage; stage task files/docs and any demonstrated owning-module fixes explicitly, then `git commit -m 'test: prove preauthenticated E2E isolation and recovery'`.

### Task 7: Prepare protected shared-staging operation; gate all live writes

**Files:** Create `scripts/staging-e2e-preflight.mjs`, `scripts/staging-e2e-preflight.test.mjs`, `scripts/staging-vault-to-env.d.mts`, `tests/e2e/src/staging-control-runner.ts`; modify `scripts/{staging-wrangler-config,staging-wrangler-runner,staging-secret-transfer,staging-vault-to-env}.mjs`, existing `scripts/{staging-secret-transfer,staging-vault-to-env}.test.mjs`, Identity `test-node/{staging-secrets,staging-wrangler-runner,staging-wrangler-resolution,staging-wrangler-task10}.test.ts`, `tests/e2e/package.json`, root `package.json`; update the four Task 5/3 documentation files.

**Interfaces:** Consumes v2 runtime/client. Produces private `StagingTargetReceipt {version:1;generation;targetId;accountId;checkedAt;expiresAt;workerVersions:{api,identity,operator};productD1Id;authD1Id}`. `ApprovedStagingTarget` contains those string identities plus `zoneIds:string[]`, Worker names, exact public origins and Secrets Store ID. `ProviderSnapshot` contains captured account/database/deployment/version/routing responses as `unknown`; `verifyStagingE2eTarget(snapshot:ProviderSnapshot,approved:ApprovedStagingTarget): StagingTargetReceipt` strictly parses them. Target digest excludes generation/version IDs, remaining stable for approved cleanup across releases. Wrapper action: `e2e-preflight`; script: `e2e:staging:preauth`. Legacy staging-login remains.

- [ ] **Write mocked provider-boundary tests.** Verify one active 100%-traffic version per Worker, account membership, both actual D1 UUIDs, exact deployed service/D1/Secret Store bindings, private Identity routing, public origins, and identical deployed server generation/target. Refuse mixed traffic, stale receipts (five-minute maximum), incomplete metadata, mismatches and caller-provided hashes. Test new-secret resolution absent without breaking normal staging auth, new Bitwarden item name/folder/ID/key validation, distinct setup/auth secrets and sanitized output. Provider snapshots are unit fixtures, not live proof.

  With constructed provider snapshots and pinned `approved`, assert mismatched account refusal:
  ```ts
  expect(() => verifyStagingE2eTarget(snapshot,
    {...approved, accountId:'0'.repeat(32)})).toThrow();
  ```
- [ ] **Observe RED.** Run `node --test scripts/staging-e2e-preflight.test.mjs scripts/staging-secret-transfer.test.mjs scripts/staging-vault-to-env.test.mjs`, and `pnpm --filter @incentives/identity exec vitest run --config vitest.node.config.ts`. Expected: new readiness/secret-isolation assertions fail with no provider calls.
- [ ] **Implement protected readiness tooling only.** Extend the existing wrapper allowlist; use its installed Wrangler resolver, captured private output and sanitized projections. Its internal read commands are `whoami --account <approved-account-id> --json`, `d1 info <approved-database-name> --json --config <private-config>` for both databases, `deployments status --name <approved-worker-name> --json --config <private-config>`, then `versions view <observed-version-id> --name <approved-worker-name> --json --config <private-config>` for all three. These argument forms were verified against installed help/source; version JSON contains `resources.bindings`. Missing required metadata refuses rather than invoking an unsupported settings getter. The protected renderer derives generation from clean reviewed checkout HEAD, injects identical values into all three Workers and validates the immutable approved target before any deployment. Local receipt creation validates owned configs/private stores instead of provider metadata. Fresh preflight plus live capability handshake is mandatory before fixture writes; refresh read-only receipt as needed without extending run leases.

  Routing requires the protected preflight's additional GET-only adapter: `/accounts/{accountId}/workers/scripts/{name}/subdomain`, `/accounts/{accountId}/workers/domains`, `/zones/{approvedZoneId}/workers/routes`; verify zone/account ownership and complete results. These endpoints exist in installed Wrangler's Cloudflare SDK; add no dependency or provider writer. Verify Identity has no public exposure and origins target the pinned Workers. Extend vault reader/transfer allowlists for only `E2E_SETUP_SECRET`, never auto-create/delete vault entries. Identity alone gets the binding. Add the preflight Node test to baseline `test`/lint scripts. Local/PR tests never import the vault runner. Retained-proof recovery stays private; hosted CI remains deferred.
- [ ] **Verify local GREEN.** Repeat focused Node/Identity tests, baseline gate and complete local E2E. Check all internal docs links and CLI usage against source. ROOT reviews tooling, target evidence projection and exact future external actions. Stage only task files/docs; `git commit -m 'feat: prepare protected staging product E2E setup'`.
- [ ] **Stop for separate live approval.** Present the reviewed source/green CI and concrete target/credential/binding/migration/deployment change before any remote write. After approval only: create and verify a new Bitwarden entry without deleting any existing entry; transfer it to the existing Secrets Store through the reviewed protected helper; apply Product 0009 and Auth 0007 via existing protected migration commands; deploy matching Core, Identity and Operator through protected commands. Initial rollout has no v2 leases; later rollouts disable new creation and drain/fence all live v2 leases before mixed versions, preserving manual data. Keep fixtures closed until target receipt and all matching capabilities pass.
- [ ] **Run separately approved staging acceptance.** Execute `pnpm e2e:staging:preauth` from the trusted local runner after the preceding gate. Expected: all four existing staging-applicable cases retain assertions; the two existing local-only cases keep their skips. New process-kill cases are local-only; equivalent staging expiry/recovery/foreign-scope checks use retained proofs and owned fixtures. For actual staging expiry, prepare a retained run and wait for its natural deadline in the trusted runner before bounded Playwright verification; do not shorten TTL or relax timeouts. Verify zero-row cleanup, manual data unchanged and no owner login. Record revision/Worker versions/timings; no shipped claim until acceptance passes. Notion publication remains a later explicitly approved, bounded update to existing pages.

## Verify the completed change

ROOT must map every spec acceptance row to Task 6 local evidence and Task 7 separately approved staging evidence, inspect private-only proof/session handling, and compare all cross-task signatures to Task 1/2 contracts. Passing unit snapshots are never deployment/account evidence. The user must review this plan before the mandated subagent implementation begins; planning completion is not an implementation or staging approval.

## Related

- [Preauthenticated product E2E contract](../specs/2026-10-12-preauthenticated-product-e2e-design.md)
- [End-to-end test workspace](../../../tests/e2e/README.md)
- [Local PR E2E CI](../../testing/local-pr-e2e-ci.md)
- [Staging Worker operations](../../integration/staging-operations.md)
