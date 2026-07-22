# Gate C manual end-to-end test

**Status:** Ready to run

**Scope:** Chromium against the real local Operator Web, Identity, and Core Workers with fresh local Auth and Product D1 databases.

**Notion mirror:** https://app.notion.com/p/3a3e5c7c2b8e8155aa10c869b97b7e5a

**Browser-only tester guide:** [Non-technical end-to-end testing guide](gate-c-non-technical-manual-guide.md)

**Developer environment guide:** [Local environment setup for manual end-to-end testing](gate-c-local-environment-setup.md)

**Notion guides:** [Developer setup](https://app.notion.com/p/3a4e5c7c2b8e8197b2daf950431552b3) · [Non-technical tester](https://app.notion.com/p/3a4e5c7c2b8e81a8949cff0b321b04fc)

This is the canonical human procedure for Gate C. A Playwright-assisted run must perform these same numbered actions and record results against the same case IDs. It must not replace this procedure with an automated test suite.

## Safety and verdict rules

- Use only the disposable checkout created below. Never delete or reuse `.wrangler` state in a normal checkout.
- Use only the fixed `gate-c.example` identities and test data in this document.
- Never record secrets, the root activation grant, recovery-code text, invitation or magic-link URLs, credential plaintext, signed cookies, complete customer attributes, complete condition trees, complete reward payloads, or raw traces.
- Do not put sensitive values in screenshots, shell history, a run report, an issue, Git, or Notion. Clear sensitive terminal output after using it.
- Record only visible outcomes, safe HTTP status/error codes, correlation IDs, counts, names expressly allowed below, and redacted metadata.
- A product deviation is recorded before continuing. Do not fix product code during the verification run.
- A required `Fail`, `Blocked`, or `Not run` result keeps Gate C `In progress` and blocks Task 10.
- Chromium is the only browser in scope. A human may use a native platform passkey. A Playwright-assisted run uses a temporary Chromium CDP virtual authenticator; no Playwright files belong in the repository.

## Fixed test data

| Purpose | Value |
| --- | --- |
| Root | `root@gate-c.example` |
| Admin | `admin@gate-c.example` |
| Operator | `operator@gate-c.example` |
| Viewer | `viewer@gate-c.example` |
| Clients | `Gate C Alpha`, `Gate C Beta` |
| Customer reference | `gate-c-customer` |
| Customer variable | `customer.tier`: required enum `bronze`, `silver`, `gold` |
| Context variable | `context.channel`: required enum `web`, `mobile` |
| Main Promo reference | `gate-c-promo` |
| Free-shipping Promo reference | `gate-c-free-shipping` |

## Role contract

| Capability | Root with selected client | Admin | Operator | Viewer |
| --- | --- | --- | --- | --- |
| Platform clients | Yes | No | No | No |
| Team and credentials | Yes | Read/manage | No | No |
| Schemas | Read/manage/publish | Read/manage/publish | Read/manage/publish | Read only |
| Customers | Read/manage | Read/manage | Read/manage | No |
| Promos/programs | Read/manage/publish | Read/manage/publish | Read/manage/publish | Read only |
| Evaluations | Run | Run | Run | Run |
| Audit | Read | Read | Read | Read |

Root is unrestricted but must select a client before using merchant-scoped routes. The header must continue to identify a root session. Operator has no member or credential permission. Viewer has no customer, member, credential, or mutation permission.

## Disposable environment setup

### Terminal A — create a clean checkout

1. From the normal source checkout, freeze the source commit and create a unique temporary directory:

   ```sh
   export GATE_C_SOURCE_REPO="$(git rev-parse --show-toplevel)"
   export GATE_C_SOURCE_COMMIT="$(git rev-parse HEAD)"
   export GATE_C_RUN_ROOT="$(mktemp -d)"
   git worktree add --detach "$GATE_C_RUN_ROOT/repo" "$GATE_C_SOURCE_COMMIT"
   cd "$GATE_C_RUN_ROOT/repo"
   ```

2. Confirm the checkout is disposable and fresh:

   ```sh
   test "$(git rev-parse HEAD)" = "$GATE_C_SOURCE_COMMIT"
   test ! -e apps/api/.wrangler
   test ! -e apps/identity/.wrangler
   ```

3. Reuse the existing package store without changing the lockfile:

   ```sh
   pnpm install --offline --frozen-lockfile
   ```

   If and only if this fails with `ERR_PNPM_NO_OFFLINE_TARBALL`, record the missing locked package as a setup note and run `pnpm install --frozen-lockfile` with network access. Do not continue for any other install error, and confirm the lockfile remains unchanged.

4. Generate distinct secrets with private file permissions. Do not print them:

   ```sh
   umask 077
   export GATE_C_AUTH_SECRET="$(openssl rand -hex 32)"
   export GATE_C_OPERATOR_SECRET="$(openssl rand -hex 32)"
   printf 'AUTH_SECRET=%s\n' "$GATE_C_AUTH_SECRET" > apps/identity/.dev.vars
   printf 'OPERATOR_SELECTION_SECRET=%s\n' "$GATE_C_OPERATOR_SECRET" > apps/operator-web/.dev.vars
   ```

5. Apply both local migration sets:

   ```sh
   pnpm --filter @incentives/api db:migrate:local
   pnpm --filter @incentives/identity db:migrate:local
   ```

6. Start the real three-Worker stack and leave it running:

   ```sh
   pnpm dev:local
   ```

7. Wait for the runner to report Core on `8787`, Identity on `8788`, and Operator Web on `5173`. Open only `http://localhost:5173` in Chromium. Browser traffic must enter through Operator Web; Core and Identity are private service dependencies.

### Terminal B — bootstrap root safely

1. Enter the disposable checkout and load the same Identity secret without printing it:

   ```sh
   cd "$GATE_C_RUN_ROOT/repo"
   set -a
   . apps/identity/.dev.vars
   set +a
   pnpm --filter @incentives/identity exec node src/cli/bootstrap-root-runner.mjs --environment local --email root@gate-c.example
   unset AUTH_SECRET
   ```

2. Use the returned activation grant immediately in `ROOT-01`. Never paste it anywhere else and clear the terminal after the setup finishes.

### Reading locally captured mail

When a case tells you to read the latest captured email, run the following from the disposable checkout, replacing the recipient. The output contains a sensitive one-time link: open it directly and never copy it into evidence.

```sh
cd "$GATE_C_RUN_ROOT/repo/apps/identity"
pnpm exec wrangler d1 execute incentives-auth-local --local --config wrangler.toml \
  --command "SELECT text_body FROM local_email_capture WHERE recipient='admin@gate-c.example' ORDER BY created_at DESC, id DESC LIMIT 1" \
  --json
```

Use `operator@gate-c.example` or `viewer@gate-c.example` for their flows. A Playwright-assisted operator must query and consume the link in memory without logging it.

## Test cases

### ENV-01 — Fresh three-Worker/two-D1 stack

**Starting state:** No disposable checkout exists. **Depends on:** none.

1. Complete every command in “Disposable environment setup.”
2. Confirm both `.wrangler` paths were absent before migrations and were created only in the disposable checkout.
3. Confirm both migration commands exit successfully.
4. Open `http://localhost:5173` in a fresh Chromium profile and wait for the sign-in/root-access page.
5. In DevTools Network, confirm browser requests use origin `http://localhost:5173`; do not navigate to ports `8787` or `8788`.

**Expected:** Core, Identity, and Operator Web are ready; Auth and Product D1 are distinct, freshly migrated local stores; the UI loads through `5173`; the repository lockfile and manifests are unchanged.

**Safe evidence:** Source commit, tool versions, migration success, three readiness endpoints/ports, and absence of pre-existing disposable `.wrangler` directories. Do not record secret or temporary-path values.

### ROOT-01 — Root bootstrap and passkey registration

**Starting state:** `ENV-01` passed and Terminal B returned a fresh grant. **Depends on:** `ENV-01`.

1. In the fresh Chromium profile, expand **Root setup or recovery**.
2. Paste the grant into **Activation grant** and select **Set up root passkey**.
3. Complete the native passkey prompt. For Playwright-assisted execution, attach one CDP virtual authenticator before clicking: CTAP2, internal transport, resident key, user verification, and automatic presence enabled.
4. Wait for **Save your root recovery codes**.

**Expected:** Registration succeeds once for `root@gate-c.example`; no grant appears in the URL, storage, or later response; a recovery handoff is shown.

**Network/security expectation:** Registration uses same-origin `/operator/v1` requests and a session is established with an HTTP-only cookie. No browser request directly targets Core or Identity.

**Safe evidence:** Registration success and recovery-handoff presence only. Never record the grant, credential material, or recovery-code text.

### ROOT-02 — Show-once recovery handling and passkey sign-in

**Starting state:** Recovery handoff from `ROOT-01` is visible. **Depends on:** `ROOT-01`.

1. Confirm multiple recovery-code rows are visible and no duplicate row is displayed, without transcribing or reading their values into a tool/report.
2. Store them only if this is a real human-owned test account; for the disposable run, validate presence/count and do not persist them.
3. Tick **I have stored these recovery codes securely** and select **Finish setup**.
4. Confirm the recovery codes disappear.
5. Sign out if the UI entered a session; otherwise select **Sign in with passkey**. Complete the passkey prompt.
6. Hard-refresh the page.

**Expected:** Codes are shown once, acknowledgement is required, codes cannot be redisplayed, passkey sign-in succeeds, and the session survives refresh.

**Safe evidence:** Code count/uniqueness boolean, acknowledgement required, codes absent afterward, sign-in success. Never record code text or WebAuthn credential data.

### TENANT-01 — Provision Alpha/Beta, switch, and hard-refresh banner

**Starting state:** Signed-in root with no selected client. **Depends on:** `ROOT-02`.

1. Open **Platform clients**. Enter `Gate C Alpha` in **Client name**, then select **Provision client**.
2. Repeat for `Gate C Beta`.
3. Select **Select Gate C Alpha** and confirm the root banner names `Gate C Alpha`.
4. Open a merchant page such as **Promos**, hard-refresh, and confirm the banner and content still use Alpha.
5. Return to **Platform clients**, select **Select Gate C Beta**, then hard-refresh a merchant page again.
6. Confirm the banner names `Gate C Beta` and no Alpha label or Alpha-scoped data is presented as current.

**Expected:** Both clients are provisioned; selection persists securely across a hard refresh; switching is authoritative and does not leave stale tenant identity.

**Network/security expectation:** Client selection is represented by a signed HTTP-only cookie, not local/session storage or a client-supplied authority header.

**Safe evidence:** Client names, safe merchant identifier suffixes if needed, selected-name sequence Alpha → Beta, and refresh outcome. Never record the signed selection cookie.

### INVITE-01 — Captured Admin invitation acceptance and magic-link sign-in

**Starting state:** Root has selected `Gate C Beta`. **Depends on:** `TENANT-01`.

1. Open **Team**, enter `admin@gate-c.example` in **Invite email**, choose `admin` in **Invite role**, and select **Invite user**.
2. Confirm the invitation is listed without a token in the UI.
3. Read the latest captured Admin email with the safe query above and open its real token-only invitation URL in a new isolated Chromium profile/context.
4. Confirm the invitation query parameters are scrubbed from the visible URL.
5. Enter `admin@gate-c.example` manually in **Invited email** and select **Accept invitation**.
6. Select the real **Sign in** link, enter the same email in **Work email**, and select **Email me a sign-in link**.
7. Read the latest captured Admin email, open its magic link in the same isolated context, and wait for the authenticated dashboard.

**Expected:** Only the exact invited email accepts; invitation and magic links are single-purpose; the Admin receives an active Beta membership and an Admin session.

**Network/security expectation:** Tokens are used only from their links, disappear from the visible URL after consumption, and never enter repository/browser storage evidence.

**Safe evidence:** Recipient, role, invite accepted, URL scrubbed, magic sign-in succeeded, membership active. Never record either link or token.

### AUTHZ-ADMIN — Admin navigation, actions, and direct routes

**Starting state:** Admin is signed into Beta. **Depends on:** `INVITE-01`.

1. Confirm **Team**, **Credentials**, **Variables**, **Customers**, and **Promos** are visible; **Platform clients** is not.
2. Open each visible route directly and confirm it loads.
3. Confirm Admin sees team invitation/role controls, credential creation controls, variable create/publish controls, customer create/save controls, and Promo authoring/publish controls.
4. Invite `operator@gate-c.example` as `operator` and `viewer@gate-c.example` as `viewer`.
5. Complete each invitation and magic-link sign-in exactly as in `INVITE-01`, each in a separate isolated Chromium context.
6. Navigate directly to `/platform/clients`; confirm it is denied or safely redirected and no platform-client data request succeeds.

**Expected:** Admin has every current merchant permission, can onboard both fixed lower roles, and cannot use root-only platform-client functionality.

**Safe evidence:** Visible route/control matrix, two active member roles, and safe denied-route status/code. No invite or magic links.

### AUTHZ-OPERATOR — Operator navigation, actions, and direct routes

**Starting state:** Operator is signed into its isolated Beta context. **Depends on:** `AUTHZ-ADMIN`.

1. Confirm **Variables**, **Customers**, **Promos**, evaluation, and audit navigation is available.
2. Confirm **Team**, **Credentials**, and **Platform clients** navigation is absent.
3. Open Variables, Customers, and Promos directly and confirm manage/publish controls are present.
4. Navigate directly to `/settings/team`, `/settings/credentials`, and `/platform/clients`.
5. Confirm each protected page is denied or safely redirected and its protected data request is absent.
6. Make one direct same-origin request to a real forbidden team or credential BFF endpoint and record only status, safe error code, retryable flag, and correlation-id presence.

**Expected:** Operator can manage schema/customer/program work and evaluations, but cannot read/manage members or credentials and has no platform access.

**Safe evidence:** Navigation/control booleans plus safe forbidden response metadata.

### AUTHZ-VIEWER — Viewer navigation, hidden mutations, and direct-route denial

**Starting state:** Viewer is signed into its isolated Beta context. **Depends on:** `AUTHZ-ADMIN`.

1. Confirm read-only **Variables** and **Promos**, evaluation, and audit navigation is available.
2. Confirm **Customers**, **Team**, **Credentials**, and **Platform clients** navigation is absent.
3. Open Variables and Promos; confirm read content is present but **New variable**, **Publish schema**, **Save draft**, **Publish revision**, **Pause Promo**, and **End Promo** are absent.
4. Navigate directly to `/customers`, `/settings/team`, `/settings/credentials`, and `/platform/clients`.
5. Confirm each is denied or safely redirected and no protected page data request is made.
6. Request one real forbidden mutation endpoint and capture only safe response metadata.

**Expected:** Viewer can read schemas/programs and run evaluations but cannot read customers/team/credentials or perform mutations.

**Safe evidence:** Read/mutation control matrix, protected-request count, safe forbidden status/code/correlation presence.

### AUTHZ-ROOT — Selected/unselected root behavior

**Starting state:** Root context still exists; Alpha and Beta exist. **Depends on:** `TENANT-01`.

1. In a new root context with no client-selection cookie, sign in with the registered passkey.
2. Confirm the banner reads **Root access · No client selected**.
3. Open **Platform clients** and confirm it works.
4. Try a merchant-scoped direct route such as `/promo`; confirm the UI tells root to select a client and does not fetch tenant content.
5. Select Beta and confirm the banner identifies both root access and `Gate C Beta`.
6. Open Team, Credentials, Variables, Customers, and Promos and confirm full controls are available.

**Expected:** Root remains visibly root, platform access works without a client, merchant routes require authoritative selection, and selected root has unrestricted tenant access.

**Safe evidence:** Banner strings, route/control matrix, and absence/presence of scoped calls. Never record cookies.

### SEC-01 — Show-once credential boundary

**Starting state:** Admin or selected root is signed into Beta. **Depends on:** `AUTHZ-ADMIN` or `AUTHZ-ROOT`.

1. Open **Credentials**. Create a local secret credential named `Gate C show once` with at least one allowed scope.
2. Confirm **Copy the new token now** appears and a non-empty token is shown. Do not copy, read aloud, screenshot, or log it.
3. Select **Dismiss token** and confirm plaintext disappears.
4. Navigate away, return, then hard-refresh.
5. Confirm the credential list shows only redacted suffix/metadata and there is no reveal/retrieve action.

**Expected:** Plaintext exists in one immediate response/UI handoff only and cannot be retrieved after dismissal, navigation, or refresh.

**Network/security expectation:** Later credential-list responses contain metadata/suffix only; cache headers prevent storage of sensitive JSON.

**Safe evidence:** Non-empty boolean, shown-once boolean, dismissed boolean, redacted suffix presence, plaintext absent from later response/storage searches.

### SEC-02 — Cookies, storage, cache, and authority-header inspection

**Starting state:** Authenticated root/Admin contexts and created test data exist. **Depends on:** `SEC-01`.

1. In Chromium Application storage, inspect cookie metadata without copying values.
2. Confirm session and root-selection cookies, when present, are `HttpOnly`, use an appropriate `SameSite` policy, and are scoped to the expected local host/path.
3. Inspect localStorage and sessionStorage key names and search in-memory for the fixed emails, customer reference, token, grant, recovery material, and complete authored data. Do not serialize storage values into evidence.
4. Inspect representative session, schema, customer, Promo, team, and credential JSON responses.
5. Confirm sensitive/private responses use `Cache-Control: no-store` or an equivalent non-cacheable policy.
6. Inspect outgoing `/operator/v1` request header names. Confirm the browser does not supply merchant/user/role/permission authority through custom headers.
7. Confirm all browser application requests are same-origin on `http://localhost:5173`.

**Expected:** Authority comes from server sessions/signed selection, cookies have safe metadata, durable browser storage has no secrets or complete private records, private JSON is non-cacheable, and the browser never calls private Workers directly.

**Safe evidence:** Cookie flags with values redacted, storage key names/count and sensitive-match count, cache-header values, request origin, and prohibited-authority-header count.

### SEC-03 — CSRF rejection and safe forbidden response

**Starting state:** An authenticated context exists. **Depends on:** `SEC-02` and one lower-role context.

1. From an authenticated page, issue a credentialed mutation-shaped request with `Origin: https://foreign.gate-c.example` using DevTools or the temporary browser operator. Do not include secret payload data.
2. Confirm the request is rejected and no state change occurs.
3. As Viewer or Operator, request one real forbidden same-origin BFF endpoint from the authorization cases.
4. Inspect the error response.

**Expected:** Foreign-origin mutation is rejected; forbidden response exposes only a safe code/message, retryability, and correlation identifier—not stack traces, SQL, binding names, secrets, or internal records.

**Safe evidence:** HTTP statuses, safe error codes, retryable flags, correlation-id presence, forbidden-text leak count, and unchanged-resource boolean.

### SCHEMA-01 — Typed definitions, impact, publish, and deprecate

**Starting state:** Selected root/Admin/Operator in Beta; no schema definitions. **Depends on:** authorization case for the chosen actor.

1. Open **Variables** and confirm an empty draft state.
2. Select **New variable**. Enter Key `customer.tier`, Label `Tier`, Source `customer`, Type `enum`, Enum values `bronze, silver, gold`, tick **Required**, then **Save variable**.
3. Create Key `context.channel`, Label `Channel`, Source `context`, Type `enum`, Enum values `web, mobile`, tick **Required**, then save.
4. Select **Impact customer.tier** and **Impact context.channel**; confirm safe counts/warnings render before any destructive choice.
5. Select **Publish schema** and confirm **Published version 1** after the canonical reload.
6. Hard-refresh and confirm both typed definitions and published version remain.
7. Select **Delete** for the unreferenced published `context.channel`; confirm the UI first shows impact and offers **Confirm deprecate context.channel**, not immediate deletion.
8. Confirm deprecation and verify the draft version advances while the published snapshot/version remains coherent.

**Expected:** Client-defined types drive authoring; publishing is durable; a published definition requires impact review and deprecation semantics.

**Network/security expectation:** Real `/operator/v1/schema` reads/mutations are same-origin; response is non-cacheable.

**Safe evidence:** Keys/types/enum labels, draft/published version numbers, impact counts, deprecation outcome. Do not record full schema JSON.

### CUSTOMER-01 — Exact 404/create/update/stale conflict/refresh

**Starting state:** `customer.tier` is published; two authorized manage contexts are available. **Depends on:** `SCHEMA-01`.

1. In context A, open **Customers**, enter exact reference `gate-c-customer`, and select **Look up customer**.
2. Confirm **No customer exists for this exact reference.** and that no fuzzy/alternative record appears.
3. Choose `gold` in **Tier** and select **Create customer**. Confirm **Version 1**.
4. In context B, look up the same exact reference and confirm Version 1.
5. In context A, change Tier to `silver`, select **Save customer**, and confirm **Version 2**.
6. In still-stale context B, change Tier to `bronze` and select **Save customer**.
7. Confirm a `409` conflict UI, safe correlation identifier, and a **Refresh customer** action; confirm the stale write did not overwrite Version 2.
8. Select **Refresh customer** and confirm Version 2 with Tier `silver`. Hard-refresh and look up again.

**Expected:** Exact lookup yields 404/create, typed controls serialize correctly, optimistic versions advance, stale writes conflict rather than overwrite, and refresh returns canonical data.

**Safe evidence:** Exact reference, selected enum sequence, versions, `409`, safe code/correlation presence, canonical value after refresh. Do not record complete attribute objects.

### PROMO-01 — Revision 1 with nested groups, ordered rewards, and fallback

**Starting state:** Published `customer.tier` exists; a program-managing actor is signed into Beta. **Depends on:** `SCHEMA-01`.

1. Open **Promos**, start **Create Promo**, set **External reference** to `gate-c-promo` and **Promo name** to `Gate C conditional rewards`.
2. Select **Use complete authoring example**.
3. Confirm the editor contains nested/typed conditions, including a large-basket rule and a nested `customer.tier = gold` rule.
4. Confirm reward order is: Rule 1 **Order percent** at 2000 basis points; Rule 2 **Line item fixed** for `product-a`, GBP 500 minor units; fallback **Order fixed**, GBP 250 minor units.
5. Confirm the overall eligibility and every reward rule is authorable and at least each conditional reward has a non-empty condition.
6. Select **Save draft** and confirm **Draft revision 1** after a canonical reload.
7. Select **Publish revision** and confirm **Active revision 1** and any overlap/impact warning.
8. Hard-refresh the Promo list, open the same Promo, and confirm the external reference, rule order, nested conditions, rewards, fallback, limits, and Active revision 1 survive.

**Expected:** A client can author arbitrary typed/nested conditions and ordered outcome-specific rewards with a fallback; revision 1 persists and publishes under the exact external reference.

**Network/security expectation:** Create/publish requests use same-origin BFF calls and private responses are non-cacheable.

**Safe evidence:** Reference, revision, rule count/order, condition/reward type summaries, fallback presence, persistence booleans. Do not record the complete condition tree or reward payload.

### PROMO-02 — Revision 2, all effect selectors, pause/resume/end, refresh

**Starting state:** `gate-c-promo` Active revision 1. **Depends on:** `PROMO-01`.

1. Open `gate-c-promo`, select **Edit Promo**, and confirm the external reference is fixed and the example button is absent.
2. Change the name to `Gate C conditional rewards revision 2`.
3. Select **Move reward rule 2 up** so the former line-item rule is evaluated first.
4. Change that rule from **Line item fixed** to **Line item percent** and retain a valid product reference/basis-points value.
5. Confirm the editor has now exercised **Order percent**, **Line item fixed**, **Order fixed**, and **Line item percent** selectors across revisions.
6. Select **Save draft**; confirm **Draft revision 2** coexists with **Active revision 1**. Hard-refresh and confirm both states persist.
7. Select **Publish revision** and confirm **Active revision 2**.
8. Select **Pause Promo**, confirm **Paused**; select **Resume Promo**, confirm **Active**; select **End Promo**, acknowledge the irreversible confirmation, and confirm **Ended** with no Resume action.
9. Start another Promo: external reference `gate-c-free-shipping`, name `Gate C free shipping`, then use the example only as a scaffold.
10. Change one reward selector to **Free shipping**, retain at least one non-empty condition, remove the fallback if necessary, and clear both Budget fields so no budget is submitted.
11. Save and publish it; hard-refresh and confirm the free-shipping effect persists. End it after verification.

**Expected:** Editing the same logical Promo produces revision 2 without changing its reference; rule ordering and changed effects persist; lifecycle transitions reload canonical state; all five effect selectors work, including no-budget free shipping.

**Safe evidence:** References, revision/lifecycle sequence, selector-coverage list, order-change boolean, free-shipping persistence. Do not record complete authored payloads.

### DEMO-01 — Retained module markers and zero live mutations

**Starting state:** Any authenticated Beta actor with navigation access. **Depends on:** authentication only.

1. Clear or mark the Network log and initialize an unsafe mutation counter for `/operator/v1` methods `POST`, `PUT`, `PATCH`, and `DELETE`.
2. Visit **Affiliates**, **Referrals**, **Loyalty**, **Events**, and **Analytics** one by one.
3. On each page, confirm a visible **Demo data** marker or equivalent explicit non-live label.
4. Interact only with harmless navigation/filter controls; do not intentionally invoke live module mutations.
5. Inspect the Network log/counter.

**Expected:** Retained modules are unmistakably demo-only and produce zero `/operator/v1` mutations.

**Safe evidence:** Five page names, demo-marker booleans, mutation count. Do not store response bodies.

### CLEANUP-01 — Process, worktree, and temporary-artifact cleanup

**Starting state:** All independent cases have a recorded status. **Depends on:** completion of the run.

1. Save only the redacted run report in the source worktree.
2. Close every Chromium context and stop the local runner with `Ctrl-C`. Confirm ports `5173`, `8787`, and `8788` no longer answer.
3. Return to the normal source checkout and verify the target is exactly the temporary path created for this run:

   ```sh
   cd "$GATE_C_SOURCE_REPO"
   test -n "$GATE_C_RUN_ROOT"
   test "$GATE_C_RUN_ROOT" != "/"
   test -d "$GATE_C_RUN_ROOT/repo"
   git worktree remove "$GATE_C_RUN_ROOT/repo"
   ```

4. Remove only the now-validated explicit `$GATE_C_RUN_ROOT` temporary directory. Confirm `git worktree list` no longer contains it.
5. Confirm the normal checkout has no new `.dev.vars`, Playwright packages, browser binaries, driver, or changed Wrangler state from this run.

**Expected:** Processes are stopped, the disposable worktree and all secret-bearing temporary artifacts are gone, and only the procedure/run report changes remain in the feature branch.

**Safe evidence:** Port-down booleans, worktree absent, temporary root absent, repository status summary. Do not record the temporary absolute path.

## Result template

Use one row per stable case in a dated file under `docs/testing/runs/`. Replace every initial `Not run` before declaring Gate C complete.

| Case | Status | Expected | Actual | Safe evidence |
| --- | --- | --- | --- | --- |
| ENV-01 | Pass / Fail / Blocked / Not run | Fresh Workers and D1 stores are ready | Record the observed safe readiness outcome | No secrets |

Allowed status values are exactly `Pass`, `Fail`, `Blocked`, and `Not run`. Include source commit, Chromium/Playwright/Wrangler/pnpm versions, start/end time, issue links, and an overall verdict. Do not include raw screenshots/traces unless they have been reviewed and redacted; text evidence is preferred.

## Issue template

Create an issue entry immediately when actual behavior differs from expected. Continue independent cases, but mark dependent cases `Blocked`.

### GATE-C-ISSUE-NNN — Short title

- Severity:
- Affected case:
- Reproduction:
- Expected:
- Actual:
- Safe HTTP/code/correlation evidence:
- Dependent cases:
- Proposed follow-up:
- Status: Open

## Final Gate C decision

- `Done`: all 18 required cases are `Pass`, all temporary artifacts are cleaned up, the local report and Notion mirror match, and the Plans page/status are updated.
- `In progress`: any required case is `Fail`, `Blocked`, or `Not run`, or cleanup/synchronization is incomplete.
- `Killed`: the approved scope is deliberately abandoned and the reason is recorded; this is not a substitute for a failure.

Task 10 may start only after Gate C is `Done`.
