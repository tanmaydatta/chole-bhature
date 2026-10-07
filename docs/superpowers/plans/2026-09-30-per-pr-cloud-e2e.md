# Per-PR Cloud E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing substantive Core/API, Identity, and Operator Playwright suite on every same-repository PR push against that push's isolated, temporary Cloudflare stack, with independent cleanup.

**Architecture:** A protected-branch controller validates an untrusted PR build artifact, creates two D1s and three Workers, establishes Worker-level Access before publishing routes, and creates a disposable root activation grant in the exact Auth D1. A separate account-token-free bootstrap job uses that grant and stack-scoped Access credentials for real browser passkey registration/sign-in; a later Playwright job runs the suite. A separate completion workflow and scheduled janitor reconcile exact-ID inventory after cancellation. The existing staging and static demo deployments are outside every generated name and binding.

**Tech Stack:** GitHub Actions, Node 22/TypeScript, pnpm 11.14.0, Wrangler 4.112.0, Cloudflare Workers/D1/Access APIs, Playwright 1.56.1, Vitest 4.1.10.

**Spec:** [2026-09-29-per-pr-cloud-e2e-design.md](../specs/2026-09-29-per-pr-cloud-e2e-design.md)

**Notion mirror:** https://app.notion.com/p/Per-PR-Cloud-E2E-Implementation-Plan-3ebe5c7c2b8e81229ee0d8a0acb2d309

**Historical mirror state (2026-10-02):** The approved Task 5a/5b mock-only protocol and controller
status is synchronized: 83 local cloud-script tests pass, public Worker writes
remain zero-transport refusals, and the separately approved live-pilot gates
remain incomplete.
After independent review on 2026-10-02, the Operator feasibility summary and
unadopted packaging-first proposal were also synchronized to the existing
design/plan mirrors, with narrow roadmap/index next-step updates. Complete
readbacks passed; all 17 index child links were preserved and resolved. This
did not adopt the proposal or add implementation/live evidence. The first
packaging deliverable was separately approved on 2026-10-02 and is now
implemented locally; its approved `8aa2d8c` metadata fix passed scoped
independent re-review with no open findings. The existing design/plan mirrors
and roadmap/Plans-index summaries were narrowly synchronized on 2026-10-02:
62 focused/139 cloud-script tests and real three-role byte/syntax/SPA/SQL proof,
retaining historical 83 and prior `66c0298` full-project provenance. Fresh
complete readbacks passed; all 17 index child links/order were preserved and
resolved. No provider/live gate was closed.
The second candidate diagnostic deliverable was separately approved on
2026-10-05 and is implemented with local Task 5e verification. Initial review
found shared D1 fixture IDs; its test-only correction `e0ce221` passed independent
scoped re-review with no open findings. Narrow synchronization to the four
existing Notion destinations completed on 2026-10-05, with complete readbacks
and all 17 index child URLs/titles/order and active metadata preserved. Root
independently verified those pages/destinations; no provider/live gate was closed.

The separately approved 2026-10-05 provider-contract investigation at `ea8620f`
passed independent review (0 Critical/Important, one nonblocking retained-version
clarification incorporated below). Reviewed nonsecret findings were narrowly
synchronized to the four existing Notion destinations, with exact complete
readbacks and all 17 native child URLs/titles/order and active metadata
preserved, no formatting exception. Root independently verified all four pages
and 17 destinations. No supported race-safe upload path, executor or permission
amendment is established/adopted. Closing status-note review of `eb72ae5` is
complete: spec compliant / quality Approved, no findings
(`task-5f-notion-sync-review.md`).

**Verified local status (2026-10-02):** Tasks 1–3 are complete on
`feat/per-pr-cloud-e2e` after scoped review: the baseline records 5 local
Playwright tests in 24.4 seconds, trusted run identity rejects ineligible or
stale PR events, and the artifact boundary verifies the untrusted bundle. Task
4 is complete as a guarded local foundation. The 2026-10-01 Task 5a amendment
added mock-only Beta request planning and observation validation (50/50
cloud-script tests), while every public Worker write still alerts and makes
zero transport calls. The bounded Task 5b prerequisite adds durable token and
Access create intents and ordered opaque identity transitions. The bounded
mock controller now composes them with verified artifacts, mock D1 migrations,
and fail-closed local cleanup (83/83 local cloud-script tests). Task 5a's
50-test status was already synchronized to the Notion mirror; the current Task
5b 83-test status is synchronized as well. The bounded implementation is not a live API
client or pilot. Public-documentation
feasibility found the Beta Worker lifecycle,
recorded as a separately bounded local amendment in the
[ledger](../../testing/per-pr-cloud-e2e.md#worker-api-feasibility-public-documentation-2026-09-30).
The separately approved raw-module packaging correction initially passed
29/29 focused and 106/106 cloud-script tests at `66c0298`. Its approved
metadata-based review fix passes 62/62 focused and 139/139 cloud-script tests,
focused producer/test lint and an actual amended three-role archive/raw-byte/
syntax/SPA/SQL round trip. The dated 2026-10-02 project test at `66c0298`
passed 97 Vitest files / 1,395 tests plus nine Node tests; it was not repeated
for the isolated producer fix. Independent scoped re-review passed with no open findings. The
[packaging ledger](../../testing/per-pr-cloud-e2e.md#raw-module-packaging-correction-2026-10-02)
records measured module/archive sizes and unchanged live gates.
No Cloudflare resource has been created, no live pilot has run, and automatic
per-PR cloud writes remain disabled. Two minor artifact hardening observations
(long tar paths and partial extraction residue on write failure) are deferred
to final branch review.

**Current local checkpoint (2026-10-07):** Tasks 1–4, mock-only Task 5a/5b,
Task 5d raw-module packaging, Task 5e non-authorizing diagnostics, Task 6a CI
admission and bounded local Task 6b bootstrap have accepted local evidence.
The accumulated review of `3ba5c14` found four Important ordinary-client/
discovery defects. Their separately approved eight-path correction and M1
roadmap reconciliation are implemented and locally verified; independent
scoped re-review is pending. The [fresh correction ledger](../../testing/per-pr-cloud-e2e.md#checkpoint-lifecycle-and-creation-correction-2026-10-07)
records 337 cloud tests, 1,592 Vitest plus nine Node tests, passing build/lint
and one full local browser run. These are new-source checks; the earlier
`07af8ed`/`4d6df6a`/`3ba5c14` accepted-source and synchronization records remain
historical. The correction is local only, with no fresh Notion publication.
M2 long tar paths, M3 extraction residue, M4 object-order false refusals and M5
sanitized operation/stage diagnostics remain deferred. Full Task 5, deployed
Task 6b and Tasks 7–10 remain incomplete; automatic cloud writes remain disabled.

## Global Constraints

- Only same-repository `pull_request_target` `opened`, `reopened`, and `synchronize` events may provision; `closed` requests cleanup; fork PRs are excluded. Current PR head SHA is authoritative before deploy and before test.
- The stack key is `(repository_id, PR number, exact head SHA, GitHub run ID, run attempt)`; each run owns three Workers, two D1s, two Worker-level Access applications, one service token, unique secrets/root, and E2E manifests. Different PRs and reruns never share these.
- The unprivileged PR build, trusted browser bootstrap, and Playwright jobs get no Cloudflare account token, manual staging root state, owner staging/BW secret, shared privileged cache, or staging Secrets Store binding. The trusted controller executes protected-branch code only; PR JS/SQL/assets are data on disposable resources.
- Account-level Workers, D1, and Access permissions may be broad. `cb-e2e-` naming is an application guard, not Cloudflare token isolation. Verify exact IDs, tuple, and binding graph before every mutation or deletion; ambiguous ownership fails closed.
- Core and Operator use distinct `workers.dev` HTTPS hosts protected by Access; Identity has no public route. Disable `workers_dev` and `preview_urls` on initial deploy and every subsequent deploy; verify no preview/version bypass and publish only after both Access gates pass.
- Deployed `cloud-ci` is an explicit future suite target and requires a controller-verified stack marker and exact bindings. Task 6a supplies local runtime shape/configuration admission only. Staging origin pins, owner bootstrap, Resend/Secrets Store behavior, and production guards retain their current semantics.
- `ci` email is local capture/suppression; the present E2E suite does not prove real email delivery. Preserve the full GAP-030/031 values, persistence, signed redemption, idempotency, browser passkey and edit/publish flow, failure disposal, and zero Product/Auth run-owned-row assertions. Keep two Playwright workers initially.
- Keep raw traces/screenshots on ephemeral runners; publish only sanitized failure evidence, seven-day retention. Credential handoff artifacts have one-day retention and are deleted at teardown where the API permits. Never log tokens, cookies, grants, proofs, customer payloads, or raw traces.
- Do not enable automatic every-push Cloudflare writes until the disposable two-stack feasibility pilot and security acceptance matrix pass. The user must review the implementation plan and approve each dispatch under repository AGENTS.md. Future tasks, commits, and live pilot steps below are not authorization to run them now.

## Review Focus

1. An event SHA that is no longer the live PR head must stop before deploy/test; Task 2 tests stale heads at both boundaries.
2. An artifact with a valid checksum but an extra path, symlink, oversized file, or embedded command/config must be rejected; Task 3 tests all four.
3. Access that protects only the document while an asset, redirect, or preview URL remains reachable must block route publication; Tasks 5 and 7 test these requests.
4. An orphan with a matching short name but a different Cloudflare ID or binding graph must be alerted and left untouched; Task 4 tests ambiguous lookup and Task 9 tests janitor refusal.
5. A cancelled first push must never revoke the newer push's token or delete its D1s, even when cleanup is retried; Task 9 tests the exact-ID boundary.

## File map and ownership

| Unit | Files to create or modify | Responsibility |
|---|---|---|
| Trusted controller protocol | `scripts/cloud-e2e/key.mjs`, `artifact.mjs`, `inventory.mjs`, `cloudflare.mjs`, `provision.mjs`, `teardown.mjs`, `cli.mjs`; corresponding `scripts/cloud-e2e/*.test.mjs` | Protected-branch input validation, artifact schema, exact-ID Cloudflare operations, checkpoints, policy gate, cleanup. These files must never be imported from a PR checkout. |
| CI transport | `.github/workflows/cloud-e2e.yml`, `.github/workflows/cloud-e2e-cleanup.yml`, `.github/workflows/cloud-e2e-janitor.yml`; `scripts/cloud-e2e/build-artifact.mjs`, `verify-run.mjs`, `evidence.mjs` | Separate runners/jobs, no shared privileged cache, immutable run metadata and short-lived artifact transport. Existing `.github/workflows/ci.yml` remains the build/lint/unit gate. |
| `ci` application mode | `apps/{api,identity,operator-web}/src/ci-stack.ts`, `apps/api/src/worker.ts`, `apps/identity/src/services/organizations.ts`, `apps/identity/src/routes/internal.ts`, `apps/api/src/env.ts`, `apps/api/src/services/e2e-capabilities.ts`, `apps/api/src/services/e2e-lifecycle.ts`, `apps/identity/src/auth.ts`, `worker.ts`, `staging-secrets.ts`, `services/e2e-fixtures.ts`, `services/e2e-lifecycle.ts`, `apps/operator-web/src/routes/types.ts`, `worker.ts`, `staging-secrets.ts`; focused existing tests | Validate stack marker/bindings, direct disposable secrets and capture email, then admit E2E capabilities, fixtures, inspection and disposal only on marked `ci`. |
| Exact-D1 root and browser | `apps/identity/src/cli/bootstrap-root-runner.mjs`, new `scripts/cloud-e2e/root-bootstrap.mjs`, `tests/e2e/src/cloud-login.ts`, their tests | Controller reuses root bootstrap SQL/cryptography against the inventory's new Auth D1 ID to produce a grant; a separate account-token-free job registers and signs in through real HTTPS passkey UI with virtual WebAuthn. |
| Cloud Playwright | `tests/e2e/src/config.ts`, `operator-client.ts`, `execution.ts`, `scenario-run.ts`, `manifest.ts`, `playwright.global-setup.ts`, `playwright.config.ts`, `test/playwright/promo.browser.spec.ts`, focused unit tests | Validate verified stack manifest and host-scoped Access headers; run existing API/browser scenarios and cleanup on external stack. |
| Docs | `README.md` if it becomes tracked, `tests/e2e/README.md`, `docs/testing/gap-030-031-e2e.md`, `docs/integration/staging-operations.md`, new `docs/testing/per-pr-cloud-e2e.md` | Commands, trust/cleanup runbook, exact test coverage and email limitation, staging preservation, pilot/rollout evidence. The current untracked `README.md` is user-owned; do not add or overwrite it without separately resolving ownership. |

## Controller contract and API ledger

Use one versioned `StackKeyV1` JSON object with `repository_id` (GitHub numeric ID), `repository` (canonical `owner/name`), `pr` (positive integer), `head_sha` (40 lowercase hex), `run_id` and `attempt` (positive integers). Derive `digest = sha256(JSON.stringify([repository_id, pr, head_sha, run_id, attempt])).slice(0,20)` and names `cb-e2e-${digest}-{api,identity,operator,product,auth,access-api,access-operator,token}`. Persist full key plus each returned Cloudflare ID; a name/hash match alone never authorizes reuse or deletion. The trusted account `workers.dev` subdomain produces `https://<worker-name>.<subdomain>.workers.dev` for Core/Operator; never read an origin from the PR artifact.

The untrusted `bundle-v1` artifact has only `manifest.json`, `workers/{api,identity,operator}.mjs`, `assets/**`, `migrations/api/*.sql`, and `migrations/identity/*.sql`. Its manifest contains `schema: 1`, full key, build SHA, relative path, byte length and SHA-256 for every file; it contains no resource names, URLs, commands, secrets, or Wrangler config. Reject nonregular files, duplicates, traversal/absolute paths, unlisted files, a file over 20 MiB, migration over 1 MiB, or total unpacked bytes over 64 MiB. These are initial limits to validate against the actual build during Task 3, never silently enlarge in the controller.

The protected controller uses a fixed account-scoped HTTP client with token only in its own job. D1's planned `GET/POST /accounts/{id}/d1/database`, `GET/DELETE /accounts/{id}/d1/database/{uuid}`, and `POST /accounts/{id}/d1/database/{uuid}/query` or documented import sequence (`init`, upload URL, `ingest`, `poll`) remain feasibility checks. For Access the proposed `POST/GET/DELETE /accounts/{id}/access/service_tokens` and `/accounts/{id}/access/apps` require live request/readback proof: each app must have only the intended Worker destination and an exclusive `decision:"non_identity"` Service Auth policy whose only include rule is `{service_token:{token_id:<this stack token ID>}}`. Current mock normalization is not proof of that provider schema. The account token needs Workers Scripts Write/Read, D1 Write/Read, Access Apps and Policies Write/Read, and Access Service Tokens Write/Read; test minimum accepted scopes in the pilot. Do not mint a zone or global key. [D1 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/), [Access applications](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/), [service tokens](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/service_tokens/methods/create/), [Service Auth policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/).

**Worker API correction, approved for mock-only planning but not live writes:** The earlier `PUT /workers/scripts/{script}` upload, name-addressed delete and first `POST .../subdomain {enabled:false}` are **superseded as executable instructions**: a prior name/tag check cannot prevent replacement between check and mutation, and disabling after upload cannot undo initial exposure. Public [Beta Worker create/get/edit/delete](https://developers.cloudflare.com/api/resources/workers/subresources/beta/) and [version creation](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/) suggest `POST /workers/workers` with an initially disabled `subdomain`, checkpoint returned Beta immutable `id`, attach/read back Access, then JSON base64 module upload to `/workers/workers/{worker_id}/versions` with `deploy` as a **query** parameter. Beta route toggle via `PATCH /workers/workers/{worker_id}` and delete by certified ID are candidates; the path also accepts names, which must never be used as fallback. A separate [assets upload](https://developers.cloudflare.com/api/resources/workers/subresources/assets/subresources/upload/methods/create/) returns `assets.jwt`. Current `workerIds` derive from legacy script-list `tag`, whose equivalence to Beta `id` is unproved; inventory, discovery, audit URI/method matching and client interfaces need revision. Service bindings still carry target *names*, so target replacement/remapping remains a separate unresolved risk despite exact-ID caller operations. The bounded mock protocol is tested, but all public Worker writes remain zero-transport refusals until a separately approved live revision. The [ledger](../../testing/per-pr-cloud-e2e.md#worker-api-feasibility-public-documentation-2026-09-30) distinguishes documented API shapes from required account proof.

The Operator SPA's separate assets upload/completion JWT, Beta version JSON (`main_module`, base64 modules, D1, service, direct-secret bindings), D1 migration behavior, immutable Worker ID and name mapping, and preview/version URL behavior remain Task 5 feasibility checks. Pinned Wrangler 4.112.0 local help confirms `versions upload` and `deploy` accept `--no-bundle`, `--assets`, and `--dry-run`; it does **not** establish that the current `bundle-v1` matches either remote API or that the CLI can target a certified Beta Worker ID. A trusted Wrangler fallback would require separate design review and observed dry-run/network behavior. No `pnpm`, package script, PR config, shell, or module loader may run in the controller. A failure to prove a safe fixed upload path stops rollout.

## Task 1: Local baseline and exact test inventory

**Files:** Modify: `docs/testing/per-pr-cloud-e2e.md` (create as pilot ledger); Test: existing `tests/e2e/test/playwright/*.spec.ts` and focused unit suites (no product edits).

**Interfaces:** Consumes the existing `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm e2e:local`; produces recorded test count, duration, assertion inventory and artifact sizes for Task 3.

- [x] Run `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm test`, then `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` after installing Playwright Chromium if needed. Expected: full local suite passes; record counts/timing, including the local-only simultaneous-stack test.
- [x] Enumerate assertions from `tests/e2e/src/gap-scenario.ts`, `test/playwright/gap.api.spec.ts`, `promo.browser.spec.ts`, and `scenario-run.ts` in the ledger: exact 3,000/7,001 and line allocations, published persistence, signed receipt, idempotency/409, browser edit/reload/publish, failure cleanup, zero Product/Auth rows. State that real email delivery is absent.
- [x] Record current Worker build output sizes and asset total; verify 20 MiB/file and 64 MiB/total artifact caps, or propose a reviewed cap change before Task 3. Commit only this ledger if changed: `git add docs/testing/per-pr-cloud-e2e.md && git commit -m "docs: record cloud E2E baseline"`.

## Task 2: Trusted run identity and GitHub eligibility

**Files:** Create: `scripts/cloud-e2e/key.mjs`, `verify-run.mjs`, `key.test.mjs`, `verify-run.test.mjs`; Modify later: `.github/workflows/cloud-e2e.yml` in Task 10.

**Interfaces:** `parseStackKey(value) -> StackKeyV1`; `resourceNames(key) -> {api,identity,operator,product,auth,accessApi,accessOperator,token}`; `verifyCurrentPr({event, githubClient, phase}) -> Promise<StackKeyV1 | null>` where `null` means ineligible fork/closed PR, stale SHA throws a typed stop. `phase` is `predeploy` or `pretest`.

- [x] Write `node:test` cases asserting deterministic legal names under Cloudflare limits, distinct names for attempt/head/PR/repository changes, fork rejection, `opened/reopened/synchronize` acceptance, live-head mismatch rejection at both phases, and closed-event cleanup-only behavior. Mock `GET /repos/{owner}/{repo}/pulls/{number}` and repository/run records; include a queued older run whose event SHA is stale.
- [x] Run `node --test scripts/cloud-e2e/key.test.mjs scripts/cloud-e2e/verify-run.test.mjs`. Expected: fail because exports are missing.
- [x] Implement the two modules with strict field schemas, canonical repository identity from GitHub's API rather than event text alone, and no PR-controlled names. Run the same command; expected pass. Commit: `git add scripts/cloud-e2e/key* scripts/cloud-e2e/verify-run* && git commit -m "feat: validate cloud E2E run identity"`.

## Task 3: Untrusted artifact format and build boundary

**Files:** Create: `scripts/cloud-e2e/build-artifact.mjs`, `artifact.mjs`, `artifact.test.mjs`; Modify: `package.json` (artifact build command only); Test: `scripts/cloud-e2e/artifact.test.mjs`.

**Interfaces:** `createBundleV1({key, checkout, outputDir}) -> Promise<manifest>` runs only in unprivileged PR build job; `verifyBundleV1({archive, expectedKey, expectedRun, destination}) -> Promise<VerifiedBundle>` runs only in trusted job and returns controller-owned absolute file paths and hashes, never executable instructions.

- [x] Add table-driven tests for exact manifest/hash and producing run ID/attempt, altered bytes, stale SHA, unexpected config/command, symlink/traversal/duplicate path, extra file, oversize, and archive extraction that would leave `destination`. Assert all bad inputs fail before a mocked Cloudflare client is called.
- [x] Run `node --test scripts/cloud-e2e/artifact.test.mjs`; expected fail for missing exports.
- [x] Implement deterministic prebuilt module/assets/migration collection from an unprivileged build, strict archive reader and verifier. The build may use PR package scripts; the verifier may only read bytes and parse JSON. Verify the operator asset manifest and bundle include the same built SPA currently configured by `apps/operator-web/wrangler.toml`. Run tests and `pnpm build`; expected pass. Commit: `git add scripts/cloud-e2e/build-artifact.mjs scripts/cloud-e2e/artifact* package.json && git commit -m "feat: verify disposable cloud build artifacts"`.

## Task 4: Exact-ID inventory and mutation guard

**Files:** Create: `scripts/cloud-e2e/inventory.mjs`, `cloudflare.mjs`, `inventory.test.mjs`, `cloudflare.test.mjs`.

**Interfaces:** `InventoryV1 = {key, names, cloudflare:{accountId, workerIds, d1Ids, accessAppIds, tokenId}, stage, createdAt, updatedAt}`; `assertOwnedResource(inventory, discovered, kind) -> void`; `checkpoint(inventory, store) -> Promise<void>` uses restricted, seven-day controller evidence separate from one-day credential artifacts; `discoverRun(key, api) -> Promise<InventoryV1>` merges exact checkpoints and deterministic-name discovery only when identity/bindings prove ownership. The `cloudflare.mjs` client exposes typed list/get/create/delete wrappers for the API ledger and rejects any target not certified by inventory. Before each create, checkpoint intent `{key, kind, exactName, startedAt, noPreexistingMatch}`; after response, checkpoint returned ID immediately. A crash before ID can be reconciled only if the read-only lookup and account audit evidence tie the creation to that intent/controller identity; otherwise quarantine and alert, never infer ownership from prefix or timestamp alone.

- [x] Write mocked tests for pre-create intent and immediate ID checkpoint; crash between create/checkpoint with and without independent creation evidence; foreign resource with matching prefix; same short hash but different ID; missing resource as idempotent success; staging/demo name or D1 UUID; wrong service binding graph; ID change between read and delete. Assert ambiguous or changed resources cause zero mutations and alert status. Worker write cases test refusal until a certified-ID path exists.
- [x] Run `node --test scripts/cloud-e2e/inventory.test.mjs scripts/cloud-e2e/cloudflare.test.mjs`; the initial missing-module failure and final passing local suite are recorded in the Task 4 report.
- [x] Implement guarded inventory and client using explicit account ID and validated key. D1/Access/token mutation guards and Worker read/discovery are mock-tested. The old name-addressed Worker mutation path is deliberately disabled because immutable-ID write semantics and first-route protection were not established. Task 4 is a foundation, not functioning Worker deploy/cleanup; 37/37 cloud-script tests passed.

### Checkpoint guard correction (2026-10-07)

The approved bounded correction touches only the two guard modules, their two
test files and the four existing status/design/plan/roadmap pages. It preserves
the Beta receipt/controller authority and original-target/bootstrap deadline
contracts; there is no new provider boundary or live task progression.

- [x] Record semantic RED before production edits for terminal preservation/durable stage changes, ordinary mutation lifecycle fences, irreversible Access/token post-POST poisoning, creation overlap and token pre-POST name/body validation. Retain supplemental RED for recovered Access graph proof and recorded Worker listed-name proof.
- [x] Preserve terminal discovery IDs/stage/timestamps without recovery or reads; verify every returned recorded/recovered identity and adopted graph before progression. Checkpoint every legitimate returned ID or stage change and refuse absent/failing persistence. Creation requires `creating`; D1 SQL requires `creating`/`active`; healthy exact cleanup also permits `quarantined`; `deleted` cannot mutate.
- [x] Reserve creation client-wide before awaits across D1/Access/token; refuse sibling overlap and merge sequential retries from the latest inventory. Permanently poison/revoke bootstrap after ambiguous post-POST result/validation/persistence; later mutations issue zero calls. Token builders accept only the adopted plain own-name body before POST. This is in-process only, without distributed coordination or new provider schema.
- [x] Verify final frozen source on pinned Node 22: 337 cloud tests, serialized 1,592 Vitest plus nine Node tests, affected syntax/lint and project build/lint; retain all new outputs and the initial loopback sandbox failure. Complete one full local Chromium Playwright run after the other commands. The [ledger](../../testing/per-pr-cloud-e2e.md#checkpoint-lifecycle-and-creation-correction-2026-10-07) owns exact timings, warnings and limits.
- [ ] Complete independent scoped re-review of this correction. Local verification is not fresh branch/remote merge certification, provider/live acceptance, deployment or publication authority.

## Task 5: Disposable two-stack Cloudflare feasibility pilot

**Files:** Create: `scripts/cloud-e2e/provision.mjs`, `provision.test.mjs`, `pilot.mjs`, `teardown.mjs`, `teardown.test.mjs`; Modify: `docs/testing/per-pr-cloud-e2e.md` (pilot results and go/no-go). No automatic workflow yet.

**Interfaces:** `provisionStack({key, bundle, api, inventoryStore}) -> Promise<VerifiedStack>` returns only after HTTPS/Access/binding checks; `VerifiedStack = {key, apiOrigin, operatorOrigin, accountResourceIds, accessTokenId}`. `pilot.mjs` requires explicit `--account-id <same-account-id>` and `--confirm-disposable-ci-prefix cb-e2e`; it uses two synthetic keys in the same Cloudflare account and refuses staging/default names.

- [ ] Write mocked transition tests: D1 create/migrate precedes Worker upload; `workers_dev=false` and previews disabled on every upload; Core/Identity/Operator exact graph; unique secrets; two Access apps each include only its token ID; both routes remain disabled until both app GETs verify destination/policy; any failed/uncertain check triggers exact-ID teardown with routes closed. Test missing/anonymous/wrong-stack token denied, alternate preview/version URL denied, and `ci` config rejection of staging/custom route/Secrets Store IDs.
- [ ] Run `node --test scripts/cloud-e2e/provision.test.mjs`; expected fail on missing export. Implement minimum phase machine with a 25-minute total budget, 5-minute D1/migration cap, 5-minute HTTPS readiness cap, 3 attempts with exponential backoff only for 429/5xx and network timeouts, and no retry of ambiguous creates without rediscovery. Check quota before create (maximum 2 concurrent pilot stacks; future production cap 8). Run mocked tests; expected pass.
- [x] **Task 5a mock-only amendment (2026-10-01):** pure planners require opaque receipts from a durable empty pre-create synthetic envelope, exactly one create plan, matching synthetic POST create-result/GET exact-ID readback, and durable ID checkpoint in `creating` phase. A local per-evidence-store/canonical-run/role reservation treats reordered valid StackKeys as one run, prevents overlapping mock transitions, and stays fail-closed after a failed write; it is process-local state, not a distributed lock or store CAS. Both durable Access-attachment receipts must precede fresh API/Operator readbacks; contexts use one canonical clock snapshot, are five-minute/generation-bound, and consume the parent phase after one plan. Unknown/stale/duplicate evidence, public overrides, missing D1 graph, assets/JWT, and service remapping refuse or return unsupported. Existing public Worker methods remain zero-transport refusals. This checks no endpoint and does not implement recovery, provisioning, cleanup, a pilot, or a workflow.
- [x] **Task 5b mock-only identity/Access prerequisite (2026-10-01):** establish all three disabled empty Beta Worker IDs from their durable intents and exact-ID readbacks before a run-scoped token intent and single-use POST plan. Conflicting prior Beta IDs in any sibling checkpoint refuse the token transition. Correlated token POST/GET and a successful inventory checkpoint rotate all three opaque ID receipts; old receipts, attachments, and prepared evidence cannot be reused. Each Beta-ID-only Access app likewise needs an empty pre-create list, durable intent, pure single-use POST plan, whole-graph POST/GET correlation, and durable ID checkpoint. The earliest sibling ID expiry bounds the whole Access graph through intent, plan, checkpoint, attachment, and code preparation. The two app IDs, durable attachments, and later fresh policy readbacks gate supported code plans. Same-run concurrent transitions fail closed; different runs sharing one local store remain independent. This is synthetic local correlation with 65 passing cloud-script tests, not provider ownership proof, transport, provisioning/teardown, or live pilot approval. Legacy Worker-tag Access behavior and zero-transport public Worker refusals remain guarded.
- [x] **Task 5b mock-only controller slice (2026-10-01; hardened 2026-10-02):** `provisionMockStack` verifies `bundle-v1`, checkpoints exact Product/Auth D1 IDs and mock migration results, then drives the opaque empty Worker, token, Access, attachment, and readback protocol through a pure API version plan. Operator service remapping remains unsupported; no Worker version plan executes and no `VerifiedStack` is issued. `teardownMockStack` permits only the verifier-established private local run/account; forged or copied raw sessions cannot authorize provider calls. It can remove mock-proven D1s before a Worker exists, checking exact identity and observed absence. An Auth pre-create failure leaves no create ambiguity; an attempted but ambiguous Auth POST retains that target while independently proven Product can still be cleaned. A remaining Worker graph blocks dependent D1 deletion. Local process reservations, deadline/retry bounds, and sanitized original/cleanup failures are tested; 83/83 cloud-script tests pass. This adds no provider executor, live writes, pilot, readiness proof, or every-push workflow.
- [ ] **Remaining Task 5 pilot:** obtain separate live-write approval, then resolve Beta create recovery/audit evidence, provider response completeness, assets/JWT, service-name remapping, live D1 migrations, version/preview exposure, exact Access provider behavior, and two-stack acceptance. No mock success is live proof.
- [ ] After separate approval to perform live Cloudflare writes, use trusted inert probe modules (no PR code or `ci` app mode dependency) in the same-account disposable infrastructure pilot, first one stack, then two with distinct tokens. Check no public route before Access, anonymous denied afterward, own token allowed, other token denied on both API/Operator, preview/version URL denied, private Identity, exact binding/D1 IDs, HTTPS readiness, and exact-ID teardown inventory empty. Task 7 completes the pilot with real `ci` Workers, passkey and full suite before rollout. If any gate fails, stop here: no every-push workflow. This is an explicit future approval gate, not an action in this plan-writing task.
- [ ] Commit pilot code and evidence only after redaction: `git add scripts/cloud-e2e/provision* scripts/cloud-e2e/pilot.mjs scripts/cloud-e2e/teardown* docs/testing/per-pr-cloud-e2e.md && git commit -m "feat: probe protected disposable cloud stacks"`.

### Proposed next mock-only Operator slice (2026-10-02)

**Status:** Feasibility/documentation complete. The first raw-module packaging
deliverable and its metadata-based review fix were approved on 2026-10-02 and
are implemented locally and independently reviewed; their narrow mirror sync
is complete. The second diagnostic deliverable received its own bounded
six-file approval/dispatch on 2026-10-05 and is now implemented with local
verification; **independent scoped re-review and narrow existing-page mirror
synchronization are complete**. The
[evidence ledger](../../testing/per-pr-cloud-e2e.md#operator-upload-feasibility-2026-10-02)
records the historical multipart mismatch, corrected by this first deliverable,
and remaining live blockers: name-addressed service/session targets and
unproved asset hash/JWT scope. Preserve the
historical Task 5a/5b 83/83 result and all full Task 5/live gates. Do not add an
Operator upload executor, safety receipt, recovery, teardown or workflow here.

**First deliverable — correct packaging, independently reviewable:**

**Files:** Modify `scripts/cloud-e2e/build-artifact.mjs`, `artifact.mjs`,
`artifact.test.mjs`; create `scripts/cloud-e2e/build-artifact.test.mjs`.
Update this plan, the spec and the ledger with the resulting bounded evidence.
Keep `bundle-v1` paths, run provenance, hashes and current size caps; no config,
dependency or application change is proposed.

**Interfaces:** Preserve `createBundleV1` and `verifyBundleV1`. Refactor the
unprivileged producer's packaging unit as
`collectWorkerModule({checkout, temporary, role, execute}) -> Promise<{path,bytes}>`,
where `execute(command,args,options)` is the existing execFile-compatible seam.
Use pinned `deploy --dry-run --outdir <role-directory>` and select `worker.js`
as `workers/<role>.mjs`; require a regular file and reject unexpected additional
runtime modules, rather than silently dropping imports. The review fix adds
`--metafile <fresh-role-metadata-directory>/build.json` outside the runtime
outdir. Require regular nonsymlink JSON metadata, selected output/input/entry-point
association and exact byte counts; resolve output keys against the fixed config's
project root. Only selected worker/map outputs are allowed, and the generated
map must match file size with no entry point/imports/exports/input contributions.
Reject incomplete metadata and external runtime files even when named README
or `worker.js.map`. Accept only the exact observed external platform imports
`cloudflare:workers`, `node:crypto` and dynamic `node:async_hooks`, not namespace
wildcards. Metadata stays outside the archive. The trusted verifier remains a JSON/archive/byte
reader and rejects recognized serialized multipart worker payloads before
extraction. This rejection is a format guard, not a proof that arbitrary PR
JavaScript is valid; compile-only checks remain in the unprivileged build.

- [x] **RED:** `node --test scripts/cloud-e2e/build-artifact.test.mjs scripts/cloud-e2e/artifact.test.mjs` produced 7 passes and 22 failures before production changes. Separate missing-export failures were recorded for the new seam. Semantic failures demonstrated wrong archived bytes, archive emission despite invalid/failed outputs, and checksum-valid multipart acceptance for all three roles. Literal byte expectations, real filesystem/tar/manifest checks, and the actual mock-controller consuming boundary cover the break; the external pnpm process alone is substituted in producer tests.
- [x] **Initial GREEN (`66c0298`):** Output selection and the bounded data-format guard were implemented; focused tests passed 29/29 and the cloud-script regression passed 106/106, preserving existing provenance/path/cap refusals. After approved frozen-lockfile recovery with lifecycle scripts disabled, the actual producer's three-role round trip passed in 18,127.263 ms: exact selected/archive module bytes and unprivileged compile-only checks, exact source-path sets and bytes for five SPA assets and fourteen SQL migrations, and no Worker maps/README in the 22-file bundle. Focused script lint passed. The [ledger](../../testing/per-pr-cloud-e2e.md#raw-module-packaging-correction-2026-10-02) records measured sizes; this is neither API compatibility nor live proof.
- [x] **Review fix RED/GREEN:** Review found runtime Text modules hidden under generated-sidecar names. The approved metadata fix recorded semantic RED for both collisions and real bundle archive emission, then 62/62 focused and 139/139 cloud-script GREEN. Missing/nonregular/malformed/misassociated metadata, unexpected outputs/imports and mismatched module/map byte counts refuse. Exact platform imports pass, including the observed Identity dynamic builtin. The amended actual three-role round trip passes in 16,342.042 ms with unchanged raw modules, five SPA assets, fourteen SQL migrations and no sidecar/metadata leakage; focused producer/test lint passes. Fix-round tracked scope is only producer, producer tests and the same three matching docs.
- [x] **Packaging acceptance/re-review:** Existing verifier negatives and the real three-role bundle's exact SPA/migration byte checks pass; format refusals stop the actual mock controller before transport. Final 139/139 cloud-script regression and focused lint pass. The dated 2026-10-02 full project `pnpm test` at `66c0298` passed 97 Vitest files / 1,395 tests plus nine Node tests; it was not repeated for the isolated producer metadata fix. The project's sandbox attempt stopped at Identity loopback EPERM before assertions; its approved local-only retry passed. Independent review identified the collision; approved fix `8aa2d8c` passed scoped re-review with no open findings, followed by narrow existing-page Notion sync with complete readbacks and all 17 index children preserved/resolved. Only the bounded packaging deliverable is accepted; optional diagnostics and provider/live gates require separate approval. Commit only approved packaging/tests and matching documentation; no browser E2E run is required for this packaging deliverable.

**Second deliverable — approved Task 5e candidate diagnostics, separately reviewable:**

**Files:** Create `scripts/cloud-e2e/operator-candidate.mjs` and
`operator-candidate.test.mjs`; modify `provision.test.mjs` only to pin the
existing controller's refusal. No change to production client/inventory/receipt
authority or controller progression is proposed. Update the same three docs.

**Implemented interfaces (ordinary diagnostic data, never authority):**

```js
prepareOperatorCandidate({ verifiedBundle, expectedKey, readBytes })
  // Promise<{ key, module: { name, contentType, contentBase64, size, sha256 },
  //   assets: [{ path, size, sha256, contentBase64 }], assetProfile }>
assessOperatorMockUpload({ candidate, expectedInventory, expectedVersions, graph, assetsLifecycle, now })
  // { status: 'unsupported', blockers: [...], graphMatches: true,
  //   assetPaths: [...], moduleSha256 } for an exact synthetic candidate;
  // malformed/mismatched evidence throws; no method/path/headers/body/JWT output.
```

The candidate rechecks StackKey/build/run provenance and re-reads only listed
files through `readBytes(path) -> Promise<Buffer>`, comparing length/SHA-256
before constructing snapshots. `module.name` is controller-selected
`operator.mjs`, `contentType` is `application/javascript+module`, and
`assetProfile` is the fixed plain-data
`{binding:"ASSETS",not_found_handling:"single-page-application",run_worker_first:["/auth/*","/internal/*","/operator/v1/*"]}`.
The verifier returns absolute `{path,size,sha256}` records; preparation derives
one fixed extraction root and rechecks the full unchanged file/path/cap schema
before any listed-byte read. Raw bundle
objects remain untrusted inputs; no `VerifiedBundle` boolean grants authority.
Asset paths are normalized once from the verified `assets/` prefix, with no
directory scan, inferred omission or PR config execution. Reject `_headers`,
`_redirects` and `.assetsignore` until separately designed. Do not compute or
label a provider upload hash in this slice: the pinned BLAKE3/documented-example
SHA-256 discrepancy remains a blocker, distinct from raw-byte integrity.

`graph` is a strict **synthetic test schema**, not an asserted provider response:
`{key,accountId,observedAt,complete,workers:[{role,workerId,name,versionId,bindings}]}`.
Require exactly the three roles with certified distinct IDs, derived names,
using a complete `InventoryV1.betaWorkerIds` map, never legacy tag fallback,
version UUIDs supplied by controller-owned `expectedVersions` (exact
`{api,identity,operator}` map, separate from InventoryV1) and the four exact
service edges/entrypoints from the ledger; reject extra bindings/environments
or an absent version/complete field. This hypothetical observed-version graph
is not the current controller's empty-version state and cannot advance it.
Retain exact Product/Auth D1 associations. A future provider adapter must prove
complete outgoing version/deployment observations; `references.workers` cannot
populate this outgoing graph. `complete:true` is only a synthetic fixture
requirement, never provider assurance or upload permission.

`assetsLifecycle` is also synthetic local correlation data:
`{key,accountId,role,workerId,workerName,manifestDigest,sessionId,startedAt,
expiresAt,uploadManifest,buckets,completedBuckets,completion}`. `uploadManifest`
is an explicitly synthetic `{"/path":{hash,size}}` fixture map with the exact
candidate paths/lengths and non-colliding test hash labels; every requested
bucket hash must belong to that map. It does not establish real provider hash
acceptance or integrity. Each completion contains its
originating `sessionId`, `manifestDigest`, `observedAt`, `expiresAt` and an
opaque `jwt`; these are test-record fields, **not invented JWT claims**.
The diagnostic requires ordered completed bucket records (or the documented
empty-bucket session completion), exact snapshot correlation, nonempty token,
and freshness bounded by the local five-minute context and recorded expiry.
No raw token is returned/logged. Expected version IDs are graph observations;
the future Operator version UUID does not exist yet and must not be preseeded
or claimed as a JWT binding.

Concrete local record schemas and ordering are recorded in the
[diagnostic ledger](../../testing/per-pr-cloud-e2e.md#operator-candidate-diagnostics-2026-10-05):
service bindings use `{name,type:"service",workerId,service,versionId,entrypoint?}`;
D1 uses `{name,type:"d1",databaseId}`; assets uses
`{name:"ASSETS",type:"assets"}`. Bucket requests are `{hashes,requestedAt}`;
their dense ordered completions add `bucketIndex` to the final-session
`{sessionId,manifestDigest,observedAt,expiresAt,jwt}` shape. The local digest is
SHA-256 over JSON-serialized `[normalizedPath,size,rawSha256]` tuples sorted by
path in code-unit order. Fixture upload hash labels are opaque and distinct;
they do not prove the provider hash contract. All records use strict known
fields, finite canonical fresh UTC clocks, session-before-request and
request-before-completion ordering, exact zero-based indices, strictly
increasing bucket completion times and final completion after all buckets.
Empty buckets still require the matching final completion. These local
schemas establish no provider response or JWT-claim contract.

- [x] **RED (2026-10-05):** The focused command recorded missing diagnostic exports separately (11 passes/one failed file), then semantic RED (11 passes/95 assertion failures) for exact byte/profile/graph output and malformed or mismatched evidence. Table-driven cases cover run/account/role/ID/name/version/entrypoint and every service edge, staging/sibling/unknown targets, missing completeness/version/Beta IDs and legacy fallback, clock/expiry/order, post-verification and post-preparation byte/path/hash changes, checksum-valid multipart modules, opaque token presence, session/manifest correlation and missing/duplicate/unknown bucket records. Sparse arrays produced an additional 146-pass/one-failure semantic RED before dense-record validation. No test claims cryptographic rejection of a valid wrong-target provider JWT.
- [x] **GREEN (2026-10-05):** Only byte preparation and strict local synthetic validation were implemented. `node --test scripts/cloud-e2e/operator-candidate.test.mjs scripts/cloud-e2e/provision.test.mjs` passed 147/147 in 162.489708 ms; final `node --test scripts/cloud-e2e/*.test.mjs` passed 275/275, zero failures/skips, in 4,371.334125 ms, and focused three-script lint passed. Independent runs preserve exact byte/graph/completion records and reject swaps. The real `provisionMockStack` consumer still refuses Operator after both Access gates with zero Worker-version/session/asset-upload calls; either initial or final API/Operator Access failure stops earlier. Every valid diagnostic returns unsupported; there is no upload-positive case.
- [x] **Final project verification (2026-10-05):** One guarded `pnpm test` passed 97 Vitest files / 1,395 tests plus nine Node tests, zero failures/skips, with Node 22.18.0/cached pnpm 11.14.0 and `pnpm_config_verify_deps_before_run=error`. Approved local-only loopback/Wrangler-log permission was used directly, with no failed sandbox attempt, dependency restoration or implicit install. The log-write span was 54,843.716309 ms. Only final per-run four-edge assertions/docs changed after the cloud regression; final focused tests passed 147/147 in 239.948875 ms and focused lint passed again, with no later production change. This is separate Task 5e evidence; no build/actual packaging/browser E2E rerun was required for the unchanged producer/apps.
- [x] **Isolation review fix (2026-10-05):** Independent review found shared Product/Auth UUIDs in the two-run fixture. A test-only correction uses distinct literal D1 pairs and expected version maps; exact per-run D1/service/version associations and disjoint Worker/D1 sets are asserted. Individual inventory D1 ID, graph D1 ID/association-record and expected-version-map swaps reject in both directions with recipient keys/Worker observations retained. Both valid fixtures remain unsupported with all four blockers. Semantic RED was 146 pass / 16 assertion failures in 198.988917 ms before fixture correction; focused GREEN passed 162/162, zero failures/skips, in 186.830125 ms, with focused lint/diffcheck passing. Only candidate tests and matching docs changed; production/consumer-controller code is unchanged. Root's fresh cloud regression at `e0ce221` passed 290/290, zero failures/skips, in 4,651.59 ms; independent scoped re-review found the isolation issue addressed with no open findings. The earlier 275 cloud and original `50cbfa1` full-project results remain pre-fix evidence, with no repeated project/build/actual-packaging/browser run.
- [x] **Diagnostic implementation acceptance:** Local self-review, diffcheck, document consistency/internal-link checks and the approved scope are complete. Diagnostics provide useful exact comparisons, cannot mint receipts or a transport request, and preserve public Worker zero-call refusals and the original substantive E2E inventory. Independent scoped re-review after the isolation fix and narrow synchronization to the four existing Notion destinations completed on 2026-10-05. Fresh complete whole-page readbacks matched only the authorized substitutions, allowing one explicitly reviewed single-newline design rendering; all 17 native index child URLs/titles/order and active metadata were preserved. Root independently verified all four pages and 17 destinations. No next provider task was adopted and no live gate was closed. Keep transport, deployed bindings, JWT signature/scope, atomic replacement behavior and URL protection explicitly unproved. The separate local status-note review of `c42088f` is complete with no findings; full Task 5/live acceptance is incomplete.

### Bounded provider-contract investigation (2026-10-05)

**Status:** Approved research/documentation slice complete; independent review
of `ea8620f` is spec compliant / quality Approved (0 Critical, 0 Important,
1 Minor, clarified below). No supported race-safe Operator upload path was established;
NO-GO and all four diagnostic blockers remain. The [evidence matrix](../../testing/per-pr-cloud-e2e.md#provider-target-and-assets-contracts-2026-10-05)
separates documented shapes, pinned Wrangler 4.112.0 behavior, ten credential-free
synthetic hash vectors, inference and account-only proof. No source/test/config,
executor, build, authenticated call or new suite result was added. Current
`e0ce221` 162 focused/290 cloud and original `50cbfa1` full-project provenance
remain unchanged. This completes neither full Task 5 nor any live gate.

The new prerequisite evidence is [per-Worker authorization](https://developers.cloudflare.com/workers/authorization/workers/):
selected-existing-Worker scopes apply to people/groups/tokens, but Editor also
renames, creation needs product Admin, and legacy broad permissions still work.
The [account-token schema](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/)
does not establish concrete Worker resource keys, scope identity across rename/
recreation or every Beta/assets endpoint's enforcement. [Binding deployment](https://developers.cloudflare.com/workers/authorization/#bindings)
needs no separate permissions on bound resources. These facts support only
the conditional [same-account broker proposal](../../testing/per-pr-cloud-e2e.md#conditional-same-account-writer-boundary),
not automatic adoption or isolation. Existing manual staging writers and
owner/admin bypass must be addressed; all create/rename/delete/recreate,
version/deploy, legacy API, session/upload/redemption, automation and policy
writers must be excluded or mediated throughout the lifecycle. No staging
resource/data/secret or same-account requirement is weakened.

**Next proposed files/change/test plan — requires a new approval:**

1. Modify only this plan, the matching design spec and testing ledger to record
   provider clarification and an explicit prerequisite decision. Obtain exact
   supported target/precondition semantics, permission resource syntax/identity
   durability and complete endpoint coverage; hash verification/dedup semantics;
   session/final token target, expiry, replay and wrong-target/expired behavior;
   and complete outgoing/version/deployment observation semantics. If choosing
   a broker amendment, specify principal coverage, exclusive credential custody,
   durable fenced serialization, failure/cancellation/failover and delayed name
   release, plus preservation of manual staging and restricted break-glass.
   Verify primary evidence, full-page consistency/internal links and diffcheck;
   unchanged code requires no new suite. No provider contact or IAM change is
   authorized by this proposal.
2. Only after that documented decision is approved, propose creating
   `scripts/cloud-e2e/provider-observations.mjs` and
   `provider-observations.test.mjs`, with consuming refusal assertions in
   `operator-candidate.test.mjs`/`provision.test.mjs` and these three docs.
   Contract: normalize documented complete outgoing/version/deployment and
   asset-lifecycle observations into ordinary data, never a receipt, token
   output or transport request. Focused semantic tests must reject partial/
   changing pagination, named-ID swaps, unknown/unapproved versions or profiles,
   wrong entrypoints/D1/ASSETS, cross-run records, expired/wrong-target completions
   according to actual documented outcomes, and leaked tokens; distinguish
   final completion from bucket acknowledgement and verify approved hash
   vectors/aliases. Retained known bootstrap/application versions are allowed
   only with exact inventory-approved bindings/config; independently require
   solely the intended active current-phase version at 100%. Keep valid cases
   unsupported and zero-transport. This is a conditional proposal, not work
   in this investigation; exact inputs depend
   on provider clarification, and local negatives cannot prove provider scope.
3. Separately approve a bounded trusted-inert same-account proof/harness and
   authenticated authority only after independent prerequisite/implementation
   review. Exercise both isolated stacks, denied alternate writers and admin
   boundary, rename/replacement timing, exact outgoing/version readbacks,
   hash/served bytes, cache/empty/multiple buckets, JWT swaps/expiry/replay and
   Access-before-session/code with initial/alternate URL denial. No PR code,
   manual staging change or automatic workflow belongs in that proof. Sampled
   outcomes supplement the contract and enforcement, never replace them.

After independent local review, narrow nonsecret synchronization to the four
existing Notion destinations completed on 2026-10-05. PATCH and fresh complete
GETs match exact original-plus-substitution whole pages, with no formatting
exception; historical text and all 17 native child URLs/titles/order and active
metadata are preserved. Root independently verified all four pages and 17
destinations. The M1 retained-version clarification is incorporated in this
proposal and appended to the investigation report; final closing status-note
review of `eb72ae5` is complete: spec compliant / quality Approved, no findings
(`task-5f-notion-sync-review.md`). No provider task or policy is adopted. The full
pilot, remaining Task 6b certification/bootstrap, real HTTPS passkey/GAP suite, row disposal, cleanup and rollout
retain their own future approvals and acceptance gates.

### Cloudflare clarification draft and approval gates (2026-10-05)

**Status: Draft / not sent.** The approved documentation-only slice prepares
one [canonical request](../../testing/per-pr-cloud-e2e.md#cloudflare-clarification-request-draft-2026-10-05)
from accepted Task 5f evidence. No ticket or channel is selected; no provider
response is pending. This local draft has not been synchronized to Notion.
It implements no future task, reordering, executor or permission amendment;
NO-GO, all four blockers, zero-transport refusal and full Task 5/live gates remain.

- [ ] **Destination and sending approval:** Select an exact channel/destination
  and obtain separate explicit approval of the exact final message and sending
  before any provider contact. Draft preparation authorizes neither discovery
  nor sending.
- [ ] **Provider reply and prerequisite approval:** Independently interpret any
  eventual reply against official API/documentation semantics, record remaining
  uncertainty, and obtain approval of the exact prerequisite decision and local
  contract plan. A reply is clarification, not a safety receipt or account proof.
- [ ] **Inert pilot approval:** Preserve the existing independent review and
  separately authorized same-account two-stack pilot/security matrix gates.
  No account action or implementation follows from this draft.

## Task 6: Isolated `ci` app mode and exact-D1 root bootstrap

Task 6 is split into bounded application admission (6a) and deferred
controller graph certification/exact-D1 bootstrap (6b). The separately approved
2026-10-06 local bootstrap slice is recorded below; full deployed certification
remains deferred. Task 6a's approval on
2026-10-06 authorizes local source/tests/docs and a local commit only. It
authorizes no bootstrap, cloud target, generated deployment configuration,
provider research, transport, deployment or workflow. The original Task 6
requirements remain below, divided by responsibility.

### Task 6a: Guarded application CI admission (2026-10-06)

**Status:** Implemented locally. Initial independent review required CI
selection-cookie parity and shared Identity service admission; the separately
approved bounded fix at `736e213` passed independent fix-only re-review with
all findings addressed and no new Critical/Important breakage
(`task-6a-fix1-review.md`). Existing warnings remain documented/deferred.
Separately approved reviewed nonsecret Task 6a status was narrowly synchronized
to the four existing Notion destinations on 2026-10-06. Complete whole-page
readbacks matched the exact approved additions with no formatting exception;
all 17 ordered native index child links and active destination/child metadata
were preserved. This summary/status sync identifies reviewed source `736e213`
and closing documentation `f8f6dbf`, without reproducing newer local sections
wholesale. The clarification draft remains local and unsent; its request body
was not published. Verification and limitations are recorded in the
[application admission ledger](../../testing/per-pr-cloud-e2e.md#guarded-application-ci-admission-2026-10-06).

**Files:** New `apps/{api,identity,operator-web}/src/ci-stack.ts` and each app's
`test/ci-stack.test.ts`; API typed environment, Worker and E2E
capability/lifecycle services; Identity typed Worker environment, auth,
secret resolution, fixture/lifecycle services and necessary
`services/organizations.ts`/`routes/internal.ts` session/provisioning
integration; Operator typed environment, Worker and secret resolution.
Extend the existing focused lifecycle/auth/fixture/BFF/secret tests and update
this plan, design spec and testing ledger.

**Interface:** Each app owns `assertCiStack(env, expectedMarker?) -> void`,
without I/O or cached authority. Require the existing 20-lowercase-hex resource
digest, canonical exact marker/role workers.dev origin, required callable
binding methods, direct secrets of at least 32 nonblank characters, and no
local-test flag. Identity uses local capture with an empty recipient list,
exact Operator RP host, and no Resend or staging store bindings; Operator has
no selection-secret store binding. Identity service boundaries revalidate the
full typed environment and its database/mode association, never a bare
`appEnv='ci'` or allow boolean. The marker is nonsecret configuration;
runtime shapes establish no account ownership, D1/service IDs, Access
protection or secret entropy/uniqueness.

The approved review-fix scope adds Operator `src/session.ts` and its existing
BFF test: CI uses staging-equivalent Secure/HttpOnly/SameSite=Strict, Path=/,
no Domain and `__Host-` selection-cookie policy, preserving signing/session/
expiry and local behavior. Identity consolidates the repeated association
logic in its existing validator and three service call sites. Existing helper,
fixture and lifecycle tests cover mode/database/local-flag association and
post-construction mutation, with real D1 state and zero boundary side effects.
The [fix verification](../../testing/per-pr-cloud-e2e.md#ci-cookie-and-shared-service-admission-review-fix-2026-10-06)
retains all original failure/retry evidence and the unchanged deferred gates.

- [x] Establish semantic RED at existing API capability/disposal, Identity signed-fixture and Operator handshake consumers; preserve the original local/staging regressions.
- [x] Implement the three validators and guarded CI fixture/session/provisioning/capability/inspection/disposal admission. Preserve root/proof/tenant authority, run ownership, immutable 900000 ms fixture expiry and the Product-then-Auth cleanup saga.
- [x] Exercise real local Worker/D1 persistence, signed sessions, proof rejection, owned-member authorization, local email capture, disposal audit/zero rows, retained concurrent fixtures and idempotent retry. Separate Core/runtime bindings use a hand-checked interface fake only where the local cross-app binding is unavailable.
- [x] Run focused iteration, three package suites, one final root `pnpm test`, build, lint and local Chromium Playwright; record actual final counts, warnings and limitations in the ledger before committing explicit approved paths.
- [x] Complete independent fix-only re-review after the bounded cookie/shared-guard correction at `736e213` (`task-6a-fix1-review.md`); all findings addressed, no new Critical/Important breakage. This closes no provider or live acceptance gate.
- [x] Separately authorize and complete the narrow reviewed-status synchronization to the four existing Notion destinations on 2026-10-06; exact complete whole-page parity and all 17 preserved ordered native links/active children pass. The [synchronization ledger](../../testing/per-pr-cloud-e2e.md#reviewed-status-mirror-synchronization-2026-10-06) records summary-only scope; no clarification request body was published and no provider or live acceptance gate is closed.

### Task 6b: Deferred exact-D1 bootstrap and controller certification

**Status:** The separately approved 2026-10-06 local bootstrap safeguards are
implemented. Independent review of `9f328ca` found two Important asynchronous
target/freshness defects; their separately approved bounded correction is
implemented locally. Scoped re-review of `a07cf37` closed the target finding
but found a residual clock reversal across checkpoint completion; its separately
approved local correction at `07af8ed` passed independent scoped re-review:
I2 addressed, no new Critical/Important breakage or out-of-scope observations
(`task-6b-fix2-review.md`). Both Important findings are addressed across
`a07cf37`/`07af8ed`; only the bounded local slice is accepted.
Reviewed nonsecret status was separately approved and narrowly synchronized
to the four existing Notion destinations on 2026-10-06. Exact complete
whole-page parity and all 17 preserved ordered native links/active children
passed, with root independently verifying readback and metadata. The
[bootstrap synchronization ledger](../../testing/per-pr-cloud-e2e.md#reviewed-local-bootstrap-status-synchronization-2026-10-06)
records accepted tested source `07af8ed` and closing documentation `4d6df6a`;
prior Task 6a publication remains historical. Only the reviewed summary was
published, not newer local sections wholesale or the unsent clarification body.
Full deployed controller
certification remains deferred. This bounded slice authorizes no provider
adapter, live query, deployment, workflow or Task 7 progression.

**Files:** Shared `apps/identity/src/cli/bootstrap-root-core.mjs` and `.d.mts`,
existing Worker wrapper/runner and bootstrap tests; new
`scripts/cloud-e2e/root-bootstrap.mjs` and `root-bootstrap.test.mjs`, guarded
client/inventory and their tests, existing controller association tests and
the matching three docs. `provision.mjs`, schemas, deployment configuration,
dependencies and workflows remain unchanged.

**Interfaces:** `bootstrapCiRoot({authDatabaseId, key, authSecret, email, d1Client})
-> Promise<{activationGrant, expiresAt}>` requires the actual guarded client
that freshly created Auth, its exact run/account and independently supplied
protected staging Product/Auth UUID exclusions. Raw or copied inventory,
markers, callbacks and verification booleans cannot mint authority. The
five-minute client creation context cannot be renewed through readback;
its immutable half-open deadline starts immediately before Auth POST transport
and includes response/checkpoint latency. Exact expiry and backward clocks
revoke it. The post-response observation recorded in the exact-ID checkpoint
is retained through completion; later clock recovery cannot erase an observed
expiry/reversal and mint authority. Ordinary durable creation remains recorded.
D1 creation reserves before the first await; bootstrap pins its
original Auth/Product/run/account context across queue acquisition and every
readback/SQL boundary. Poison, deletion or changed exact readback revokes it,
including during awaited checkpoints/GETs. The returned grant
expires after 600000 ms. The controller must independently certify trusted account
subdomain, actual D1 UUIDs, exact service targets and deployed configuration
before use. Local callable binding shapes and marker strings cannot do this.
Existing local/staging bootstrap entry points retain their semantics.

The shared bootstrap core requires atomic batch persistence, including the
success audit, and preserves root races, same-email resume and expired reissue.
Worker calls use actual D1 batch; the local/staging runner retains explicit
targets, stripped child secrets, an exclusive 0600 SQL file and scoped cleanup.
The exact-ID consumer's injected local `/query` fixture splits rendered SQL
and executes actual local D1 batch. This establishes no live `/query`
atomicity: it **must not be wired into a live controller** until provider
transactionality and the full graph/live gates are separately certified.
`provisionMockStack` remains unchanged and never reaches root bootstrap while
Operator service remapping/assets remain unsupported. The
[local bootstrap ledger](../../testing/per-pr-cloud-e2e.md#local-exact-d1-root-bootstrap-2026-10-06)
records the tests and remaining boundaries; the separately approved narrow
Task 6b status mirror closes no provider, deployed or every-push gate.

Local slice:

- [x] Reject protected, missing, malformed, reused, foreign and Product Auth targets; preserve zero-SQL refusal and exact inert D1/service association guards.
- [x] Share bootstrap SQL/domain behavior without an environment override for staging; exercise actual local persistence, 600000 ms expiry, recovery exchange, race/retry, isolation and audit rollback.
- [x] Implement the approved seven-file asynchronous target/freshness correction after deterministic semantic RED, with actual requested/foreign D1 row-integrity and expired-readback zero-row evidence; retain original `9f328ca` results separately in the [review-fix ledger](../../testing/per-pr-cloud-e2e.md#immutable-target-and-asynchronous-freshness-review-fix-2026-10-06). Same-client overlapping D1 creates refuse; later ordinary sequential creation remains usable. No sleep, dependency/configuration or controller progression change.
- [x] Preserve the irreversible post-response clock observation after residual I2 review of `a07cf37`; deterministic consumer and actual D1 RED/GREEN prove zero bootstrap SQL/rows after checkpoint reversal and later recovery, with ordinary exact-ID creation retained. The [clock-fix ledger](../../testing/per-pr-cloud-e2e.md#irreversible-post-response-clock-observations-2026-10-06) keeps original/runtime evidence separate and records accepted source `07af8ed`: explicit Node 22 final 322 cloud, 1,592 Vitest plus nine Node, eight real D1/runner and five Playwright (22.6 s), with build/lint/typecheck passing. Closing status notes rerun no unchanged code suite.
- [x] Complete root independent review of bounded local source `07af8ed` on 2026-10-06 (`task-6b-fix2-review.md`): both Important findings addressed, no new Critical/Important breakage. Root fresh committed Node 22 guard 70/70 and real D1/runner 8/8 pass. No full Task 6b, branch, production/staging or deployed certification follows; prior Task 6a-only mirror state is historical.
- [x] Separately approve and complete narrow reviewed-status synchronization on 2026-10-06: exact four-page parity, all 17 ordered native URL/title pairs and active destination/child metadata preserved, with root independent readback. The [bootstrap synchronization ledger](../../testing/per-pr-cloud-e2e.md#reviewed-local-bootstrap-status-synchronization-2026-10-06) retains source `07af8ed`/closing prose `4d6df6a`; no unchanged suite rerun, clarification body publication or provider/live acceptance.

Full deployed acceptance remains pending:

- [ ] Certify deployed controller configuration/readback and protected account exclusions for wrong D1 UUID/service targets; the implemented local negatives do not prove the deployed graph.
- [ ] Certify a live atomic exact-ID D1 bootstrap adapter before wiring the shared core to a deployed controller; preserve root authority, expiry, unique disposable secrets and the immutable staging target.
- [ ] Complete cross-Worker deployed capability/inspection/disposal and real HTTPS passkey acceptance under the live graph/pilot gates in Tasks 5 and 7; local Task 6a/6b evidence does not complete them.

## Task 7: Real passkey bootstrap and cloud Playwright target

**Files:** Create: `tests/e2e/src/cloud-login.ts`, `cloud-access.ts`, focused `tests/e2e/test/unit/{cloud-login,cloud-access,config}.test.ts`; Modify: Playwright files in the file map and `package.json` for `e2e:cloud-ci`.

**Interfaces:** `loadTarget(env)` adds `{kind:'cloud-ci', apiOrigin, operatorOrigin, stackKey}` from a controller-issued manifest whose run tuple and artifact provenance are rechecked against GitHub's live PR/run metadata; no unspecified cryptographic signature is assumed. `accessHeadersFor(url, verifiedOrigins, credential) -> HeadersInit` returns headers only for exact API/Operator origins; `createCloudRootState({target, activationGrant, output}) -> Promise<void>` runs trusted protected-branch code in a fresh bootstrap job with **no account token**, uses CDP virtual authenticator for real registration and sign-in, then verifies root through `/operator/v1/session`. The controller passes only the activation grant, verified origins/tuple, and short-lived stack Access credential in a one-day restricted artifact; the bootstrap job passes a 0600 root state and stack credential to the later Playwright job through a separate one-day artifact. Delete both at teardown where the API permits; never log their contents.

- [ ] Add failing tests for manual staging origin, HTTP, stale SHA/stack ID, missing token, mismatched manifest, cross-origin redirect, asset/subrequest/`page.goto` token coverage, cookie/challenge continuity, and missing root state. Assert Cloud target never starts `startManagedLocalStack` or uses the owner staging login helper, and the bootstrap job receives no Cloudflare account token or PR checkout.
- [ ] Run `pnpm --filter @incentives/e2e test`; expected new tests fail. Implement origin-scoped browser routing and API request headers, with redirects to foreign hosts stripped/blocked. Adapt `playwright.global-setup.ts`, `config.ts`, `operator-client.ts`, `promo.browser.spec.ts` and root bootstrap. Keep real CDP WebAuthn, not an injected session.
- [ ] Extend `execution.ts` and `scenario-run.ts` claimed-run and `finally` guards to `cloud-ci`; preserve `cleanupStagingRun` Product-then-Auth saga and `assertRunDisposed` zero-row inventory. Keep `local-stack.api.spec.ts` local-only. Run unit tests and `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local`; expected pass. In the approved live pilot, require passkey registration/sign-in and full HTTPS suite, including API/browser projects, before marking feasibility passed. Commit: `git add tests/e2e package.json && git commit -m "feat: run full Playwright suite on protected cloud stack"`.

## Task 8: Proven tenant disposal and stack teardown

**Files:** Modify: `scripts/cloud-e2e/teardown.mjs`, `teardown.test.mjs`, `inventory.mjs` checkpoint stages; Create: `scripts/cloud-e2e/evidence.mjs`, `evidence.test.mjs`.

**Interfaces:** `teardownStack({key, api, inventoryStore, tenantEvidence}) -> Promise<TeardownResult>` takes trusted inventory, never a PR artifact cleanup target. `TeardownResult` includes per-resource exact-ID outcomes, row-disposal assertion status, final empty/remaining list and sanitized failure codes.

- [ ] Add failing tests for normal row disposal then zero Product/Auth rows, failed test still disposing, token revoke/delete before routes/app/Worker/D1 deletion, reverse dependencies, absent resource idempotence, mismatch refusal, retry after partial deletion, and missing root/proof after cancellation reported as `row_disposal_unproven` before deleting only proven whole-D1s. Test sanitized evidence excludes token/cookie/grant/proof and raw trace names.
- [ ] Run `node --test scripts/cloud-e2e/teardown.test.mjs scripts/cloud-e2e/evidence.test.mjs`; expected fail on new tenant/evidence assertions. Extend pilot's strict read-before-delete path with normal Product-then-Auth tenant cleanup, zero-row proof, route disable first if security state is uncertain, then token revoke/delete, apps, Workers, D1 by proven UUID. Keep cleanup failures as failing results; 3 bounded retries for transient API faults and alert with run key. Run tests; expected pass. Commit: `git add scripts/cloud-e2e/teardown* scripts/cloud-e2e/evidence* scripts/cloud-e2e/inventory.mjs && git commit -m "feat: verify tenant and stack teardown"`.

## Task 9: Completion cleanup, janitor, and cancellation races

**Files:** Create: `.github/workflows/cloud-e2e-cleanup.yml`, `.github/workflows/cloud-e2e-janitor.yml`, `scripts/cloud-e2e/reconcile.mjs`, `reconcile.test.mjs`; Modify: `scripts/cloud-e2e/cli.mjs`.

**Interfaces:** `reconcileTerminalRun({githubRun, key, api, inventoryStore}) -> Promise<TeardownResult>` reconstructs tuple from GitHub run metadata, checks `completed` terminal state and age; `janitor({now, minAgeMs, maxStacks})` defaults to 2-hour minimum age and 8 stacks per invocation, never touches a live run. Completion workflow runs outside PR concurrency group.

- [ ] Add failing tests for cancelled mid-D1 create/migration, mid-Worker deploy, mid-fixture, mid-cleanup; missing inventory checkpoint; missed completion event; newer push with different run ID/attempt; wrong ID or graph; live/queued run below age threshold. Assert old-run cleanup never selects new-run resources, replay is idempotent, and an ambiguous orphan alerts without deletion.
- [ ] Run `node --test scripts/cloud-e2e/reconcile.test.mjs`; expected fail. Implement protected `workflow_run: completed` cleanup plus scheduled janitor and close-event request, reconstructing from GitHub run record and trusted inventory only. Give each workflow its own concurrency key, `contents:read`, and no PR checkout; require the protected default branch workflow to be reviewed before activation. Run tests and a mocked cancellation/replay simulation; expected pass. Commit: `git add .github/workflows/cloud-e2e-cleanup.yml .github/workflows/cloud-e2e-janitor.yml scripts/cloud-e2e/reconcile* scripts/cloud-e2e/cli.mjs && git commit -m "feat: reconcile cancelled cloud E2E runs"`.

## Task 10: Protected PR workflow, full matrix, docs, and rollout gate

**Files:** Create: `.github/workflows/cloud-e2e.yml`; Modify: `tests/e2e/README.md`, `docs/testing/gap-030-031-e2e.md`, `docs/integration/staging-operations.md`, `docs/testing/per-pr-cloud-e2e.md`, `package.json` if script names changed. Preserve untracked user-owned `README.md`.

**Interfaces:** Workflow jobs: `build` (PR head, read-only, no secrets/cache), `controller` (protected checkout, validates bundle, provisions, creates exact-D1 root grant), `bootstrap` (fresh protected checkout, no account token or PR checkout, real browser passkey setup with grant and stack credentials only), `playwright` (separate fresh runner, disposable root state and stack credentials only), `finalize` (best-effort protected cleanup and failing cleanup status). Concurrency group `cloud-e2e-pr-${{ github.event.pull_request.number }}` with `cancel-in-progress:true`; live SHA checks from Task 2 remain authority.

- [ ] Write a workflow static/security test in `scripts/cloud-e2e/workflow.test.mjs` asserting `pull_request_target` event filter, same-repo gate, separate build/controller/bootstrap/test runners, no PR checkout or PR scripts in controller/bootstrap, no privileged shared cache, no account token in build/bootstrap/test, exact artifact run identity, one-day grant/credential and root-state artifact handoffs, `always()` cleanup, seven-day redacted evidence retention, and no raw trace upload. Run `node --test scripts/cloud-e2e/workflow.test.mjs`; expected fail before workflow exists.
- [ ] Implement workflow with `opened/reopened/synchronize/closed`, PR-keyed cancellation, protected checkout/controller and bootstrap code, explicit job permissions and 30-minute job cap. Retain `.github/workflows/ci.yml` build/lint/unit check. Controller emits a restricted short-lived grant/stack credential artifact; bootstrap consumes it without account credentials and emits a separate root-state/stack-credential artifact for Playwright. Neither downstream job runs PR package scripts before the trusted passkey setup is complete. A test result never grants cleanup authority.
- [ ] Run workflow test, all `node --test scripts/cloud-e2e/*.test.mjs`, `pnpm build`, `pnpm lint`, `pnpm test`, and `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local`; expected pass. Re-run the approved live two-stack pilot and the full cloud matrix: same-stack missing/wrong token and preview denial; both full suites simultaneously; rapid second push mid-fixture; cancellation/failure mid-deploy and mid-cleanup; janitor replay; exact-ID mismatch refusal; staging Worker/domain/D1/Secrets Store and demo pre/post inventory identical. Record first cloud baseline, full test counts and exact values, passkey and zero-row outcomes, IDs redacted.
- [ ] Update docs in this same change: E2E workspace commands/credentials/recovery, GAP coverage and explicit email-delivery limitation, staging manual ownership, operations API/permissions/quotas/cleanup and alert runbook, pilot evidence and go/no-go. Keep the workflow disabled or non-required until every acceptance row passes and the owner reviews the protected default-branch workflow. Then enable every-push and set the new cloud check required through the separately controlled repository settings change; no status-only smoke replaces the suite. Commit reviewed files: `git add .github/workflows/cloud-e2e.yml scripts/cloud-e2e/workflow.test.mjs tests/e2e/README.md docs/testing/gap-030-031-e2e.md docs/integration/staging-operations.md docs/testing/per-pr-cloud-e2e.md && git commit -m "feat: gate PRs on isolated cloud E2E"`.

## Execution and acceptance notes

- The pilot is the first external mutation and requires separate approval. If Access cannot protect both Worker IDs before route publication, the Worker upload/assets path executes PR code in the controller, or preview/version URLs bypass Access, stop rollout and revise the approved design. Do not substitute public Workers, shared service tokens, or manual staging.
- For each future task, write the brief file/change/test plan in chat, wait for explicit approval, then dispatch a subagent at the tier/model required by repository AGENTS.md. Commit suggestions are future steps only and must not include “created by Codex.” Update docs in the same push as observable changes.
- Final acceptance is four applicable staging-class cloud tests plus the local-only skip, the existing exact assertions and zero-row checks, two isolated simultaneous stacks, successful cancellation cleanup, and unchanged manual staging/demo inventory. The count may grow as tests are added; no claim of real email-delivery coverage is made.
