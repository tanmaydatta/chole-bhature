# Gate C Playwright-assisted manual run — 2026-07-20

**Status:** Stopped on 2026-07-21 — the user replaced Playwright execution with reusable developer and non-technical manual guides.

**Procedure:** [Gate C manual end-to-end test](../gate-c-manual-test.md)

**Procedure Notion mirror:** https://app.notion.com/p/3a3e5c7c2b8e8155aa10c869b97b7e5a

**Implementation plan:** [Gate C Manual Playwright Verification Implementation Plan](../../superpowers/plans/2026-07-20-gate-c-manual-playwright-verification.md)

**Notion mirror:** https://app.notion.com/p/3a4e5c7c2b8e81f28b7dd9455e94b71a

**Replacement guides:** [Developer setup](../gate-c-local-environment-setup.md) · [Non-technical tester](../gate-c-non-technical-manual-guide.md)

**Source commit under test:** `404d6c88377ad8deeaa34c07f42e6a0b5e0489c9`

**Started (UTC):** `2026-07-20T20:18:33Z`

**Completed (UTC):** `2026-07-21T07:04:25Z`

**Recording:** No video was retained. Sensitive flows were excluded, and all disposable recordings were removed when the Playwright request was withdrawn.

## Safe tool metadata

| Tool | Version |
| --- | --- |
| Node.js | `22.18.0` |
| pnpm | `11.14.0` |
| Wrangler | `4.112.0` |
| Playwright | `1.61.1` |
| Chromium | Chrome for Testing `149.0.7827.55` / Playwright Chromium `1228` |

## Setup observations

- The detached checkout had no Core, Identity, or Operator Web `.wrangler` directory before migrations.
- `pnpm install --offline --frozen-lockfile` stopped with `ERR_PNPM_NO_OFFLINE_TARBALL` for locked tarballs (`@vitest/runner` `4.1.10` initially and `drizzle-orm` `0.45.2` in the fresh rerun). The conditional networked `pnpm install --frozen-lockfile` retries completed without changing the lockfile. This is a reproducibility/setup note, not a product verdict.
- Temporary `pnpm init` emitted `devEngines.packageManager.version` as `^11.14.0`, which the same pnpm/Corepack path rejected because it required an exact semver. The temporary-only value was changed to `11.14.0`; Playwright and Chromium then installed. No repository manifest changed.
- Product and Auth migrations both completed against fresh, separate disposable local D1 stores.
- The documented `pnpm dev:local` command failed during the dashboard build before any Worker started. See `GATE-C-ISSUE-001`.
- After manually building the engine, a second startup attempt built the dashboard but exposed another omitted workspace build (`@incentives/promo`) and a shared default inspector-port collision. Local port `8788` was also already owned by an unrelated pre-existing process, which was inspected and deliberately left untouched. The continuation uses only explicit alternate/private and inspector ports; no unrelated process is stopped.

## Case results

| Case | Status | Expected | Actual | Safe evidence |
| --- | --- | --- | --- | --- |
| ENV-01 | Fail | Fresh Core, Identity, Operator Web, Product D1, and Auth D1 are ready through the documented command | Both fresh D1 migrations passed, but `pnpm dev:local` failed while compiling the dashboard, before the Workers started | Exit `2`; TypeScript `TS2307` for `@incentives/engine` and consequential `TS7006`; no secrets |
| ROOT-01 | Pass | Root bootstrap and passkey registration succeed | Virtual CTAP2 passkey registered and the recovery handoff appeared | Recovery values were never logged or persisted |
| ROOT-02 | Pass | Recovery handling is show-once and passkey sign-in persists | Acknowledgement was required; codes disappeared; passkey sign-in survived hard refresh | Only code count/uniqueness booleans were inspected |
| TENANT-01 | Pass | Alpha/Beta provisioning, switching, and refresh are authoritative | Both synthetic clients provisioned; each selection resolved to the authoritative name after hard refresh | Condition-based wait allowed the canonical name lookup to finish |
| INVITE-01 | Fail | Admin invitation acceptance and magic-link sign-in succeed safely | The real Admin invitation POST returned `400 INVALID_REQUEST`; no invitation row or captured email was created | Valid synthetic request shape; safe correlation presence; no token |
| AUTHZ-ADMIN | Blocked | Admin has all merchant permissions and no root platform access | No Admin can be onboarded because `INVITE-01` fails | `GATE-C-ISSUE-003` |
| AUTHZ-OPERATOR | Blocked | Operator has schema/customer/program operations and no team/credentials | No Operator can be onboarded because `INVITE-01` fails | `GATE-C-ISSUE-003` |
| AUTHZ-VIEWER | Blocked | Viewer has intended reads/evaluation and no protected reads or mutations | No Viewer can be onboarded because `INVITE-01` fails | `GATE-C-ISSUE-003` |
| AUTHZ-ROOT | Pass | Root platform access works and merchant routes require selection | Unselected root reached platform clients but not tenant data; selected root had full tenant controls | Selection cookie value was not inspected |
| SEC-01 | Pass | Credential plaintext is shown exactly once | Plaintext appeared once and was absent after dismissal, navigation, refresh, storage, and list read | Presence booleans only; no plaintext retained |
| SEC-02 | Pass | Cookies/storage/cache/request authority boundaries are safe | Cookie flags, zero durable secret matches, same-origin requests, zero browser authority headers, and `no-store` matched | No cookie/storage values or bodies retained |
| SEC-03 | Blocked | CSRF is rejected and forbidden errors are safe | Foreign-origin mutation was rejected; lower-role response could not run because invitation onboarding failed | CSRF status/code only; `GATE-C-ISSUE-003` |
| SCHEMA-01 | Pass | Typed definitions publish and deprecate with impact review | Published version 1 persisted; the published context field required impact/deprecation and left working definitions | Keys/types/version only |
| CUSTOMER-01 | Not run | Exact create/update/conflict/refresh behavior is canonical | Pending | No secrets |
| PROMO-01 | Not run | Revision 1 persists nested conditions, ordered rewards, and fallback | Pending | No secrets |
| PROMO-02 | Not run | Revision 2, all effect selectors, lifecycle, and refresh work | Pending | No secrets |
| DEMO-01 | Not run | Retained modules are marked Demo data and make zero live mutations | Pending | No secrets |
| CLEANUP-01 | Pass | All processes and disposable artifacts are cleaned up | Chromium/Workers stopped; disposable worktree, secrets, driver, and temporary recordings removed | Ports and worktree verified absent |

Result counts: **8 Pass, 2 Fail, 4 Blocked, 4 Not run**. Open findings: `GATE-C-ISSUE-001`, `GATE-C-ISSUE-002`, and `GATE-C-ISSUE-003`.

## Issues

### GATE-C-ISSUE-001 — Documented local stack command omits required workspace builds

- Severity: High for local onboarding and Gate C; no runtime product data was reached.
- Affected case: `ENV-01`.
- Reproduction: From a fresh detached checkout at the source commit, complete both D1 migrations and run the documented `pnpm dev:local` command.
- Expected: The runner builds required workspace dependencies and starts Core on `8787`, Identity on `8788`, and Operator Web on `5173`.
- Actual: The first command exits `2` while compiling the dashboard because `@incentives/engine` cannot resolve, followed by an implicit-`any` error in `ConditionRow.tsx`. After the engine-only operational workaround, Core then cannot bundle because the unbuilt `@incentives/promo` export is absent.
- Safe HTTP/code/correlation evidence: No HTTP request was possible through the documented command. Compiler codes were `TS2307` and `TS7006`; the Core bundler reported unresolved `@incentives/promo`.
- Dependent cases: Browser cases cannot start through the documented command. The stopped run used explicit dependency builds and separate Worker commands to gather independent evidence.
- Proposed follow-up: In separately approved product work, make the local runner build every required workspace dependency before the dashboard and add verification for a fresh checkout.
- Status: Open

### GATE-C-ISSUE-002 — Concurrent local Workers compete for the default inspector port

- Severity: High for the documented three-Worker local startup path.
- Affected case: `ENV-01`.
- Reproduction: After required workspace packages are built, run the documented `pnpm dev:local`, which launches all three Wrangler processes concurrently without explicit inspector ports.
- Expected: All three Workers start on their configured application ports with independent inspector endpoints.
- Actual: Startup reports `Address already in use (127.0.0.1:9230)` and the runner stops its children.
- Safe HTTP/code/correlation evidence: Wrangler startup error for loopback inspector port `9230`; no application request was involved.
- Dependent cases: Browser cases cannot reliably start through the documented runner. The stopped run used three explicit, unique inspector ports outside product code.
- Proposed follow-up: In separately approved product work, give each local Worker an explicit unique inspector port and verify child cleanup when any Worker exits.
- Status: Open

### GATE-C-ISSUE-003 — Valid dashboard invitation request is rejected by Identity RPC validation

- Severity: Critical for client onboarding; root remains usable.
- Affected case: `INVITE-01`; blocks `AUTHZ-ADMIN`, `AUTHZ-OPERATOR`, `AUTHZ-VIEWER`, and the lower-role half of `SEC-03`.
- Reproduction: As selected root for `Gate C Beta`, open Team, enter `admin@gate-c.example`, choose `admin`, and select **Invite user**.
- Expected: A sent invitation appears and local-capture receives its single-use email.
- Actual: The BFF returns `400 INVALID_REQUEST` / `Request validation failed`; Auth D1 contains no invitation and no captured email.
- Safe HTTP/code/correlation evidence: Submitted synthetic shape was `{ email, role, expiresInSeconds }` with the documented values; HTTP `400`, code `INVALID_REQUEST`, `retryable=false`, correlation identifier present. No token existed.
- Dependent cases: Admin/Operator/Viewer onboarding and authorization matrices are blocked; root-capable product cases remain independent.
- Proposed follow-up: In separately approved product work, remove or relocate the extra top-level correlation field passed by the protected team route so `IdentityCreateInvitationRequestSchema` receives exactly its strict contract, then add a real Worker integration regression test.
- Status: Open

## Gate C verdict

**Gate C in progress — Task 10 blocked.** Playwright execution was stopped by product choice and replaced with linked manual guides. `ENV-01` and `INVITE-01` failed with `GATE-C-ISSUE-001` through `GATE-C-ISSUE-003`; lower-role cases remain blocked, and Customer/Promo/Demo cases were not run.
