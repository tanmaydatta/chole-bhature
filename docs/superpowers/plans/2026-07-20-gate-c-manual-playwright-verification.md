# Gate C Manual Playwright Verification Implementation Plan

**Status:** Todo

**Notion parent:** [Plans](https://app.notion.com/p/Plans-390e5c7c2b8e8165b7f7d77392eab088)

**Notion mirror:** https://app.notion.com/p/3a3e5c7c2b8e81bc9760ded20a24acc3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document an exact human Gate C browser procedure, execute those same steps with temporary Playwright-controlled Chromium against fresh local Worker/D1 state, and record a redacted expected-versus-actual verdict.

**Architecture:** Commit only the manual procedure and dated run report. Create a disposable detached Git worktree for fresh Wrangler state and install Playwright 1.61.1 plus Chromium only in a temporary directory. Use an uncommitted one-off driver with CDP virtual WebAuthn to operate the real three-Worker/two-D1 stack; record product failures without fixing them during this run.

**Tech Stack:** Markdown, Git worktrees, pnpm 10, Wrangler 4.112.0, Playwright 1.61.1, Chromium, CDP WebAuthn, Cloudflare Workers, D1.

## Global Constraints

- Do not add a repository Playwright configuration, E2E test package, browser dependency, CI job, or committed browser driver.
- Chromium is the only browser in scope.
- Every run starts from a new detached worktree with fresh default local Auth D1 and Product D1 state; never delete, move, or reuse the main checkout's Wrangler state.
- The committed manual procedure is the source of truth. The temporary Playwright driver follows the same stable case identifiers and actions.
- Do not persist or document local secrets, activation grants, recovery codes, invitation/magic links, credential plaintext, complete customer attributes, condition trees, reward payloads, or raw traces.
- Record product failures before continuing and do not fix product code during this run without separate user approval.
- A required `Fail`, `Blocked`, or `Not run` result keeps Gate C `In progress` and prevents Task 10.
- Commit and mirror the manual procedure and dated run report to Notion; keep this implementation plan under the Plans page with an explicit status beside its link.
- Use the approved design at `docs/superpowers/specs/2026-07-20-gate-c-manual-playwright-design.md`.

---

### Task 1: Write the canonical human Gate C procedure

**Files:**
- Create: `docs/testing/gate-c-manual-test.md`
- Modify: `docs/superpowers/plans/2026-07-20-gate-c-manual-playwright-verification.md`

**Interfaces:**
- Produces stable manual case identifiers consumed by the temporary Playwright run and dated report.
- Produces exact setup, action, expectation, safe-evidence, and cleanup instructions that require no Playwright knowledge.

- [ ] **Step 1: Establish the documentation contract before writing the procedure**

Run:

```bash
test ! -e docs/testing/gate-c-manual-test.md
```

Expected: exit 0, proving the new procedure is not accidentally validating an older document.

- [ ] **Step 2: Write the procedure header and safe disposable setup**

Document exact commands for:

```bash
GATE_C_RUN_ROOT="$(mktemp -d)"
git worktree add --detach "$GATE_C_RUN_ROOT/repo" HEAD
cd "$GATE_C_RUN_ROOT/repo"
pnpm install --offline --frozen-lockfile
```

Then document generating separate 32-byte random secrets under a restrictive `umask`, writing them only to `apps/identity/.dev.vars` and `apps/operator-web/.dev.vars`, applying both local migration sets, starting `pnpm dev:local`, waiting for `http://localhost:5173`, and bootstrapping `root@gate-c.example` with the same in-memory `AUTH_SECRET` used by Identity.

- [ ] **Step 3: Define the exact stable cases**

The document must contain these identifiers in this order:

```text
ENV-01          Fresh three-Worker/two-D1 stack
ROOT-01         Root bootstrap and passkey registration
ROOT-02         Show-once recovery handling and passkey sign-in
TENANT-01       Provision Alpha/Beta, switch, and hard-refresh banner
INVITE-01       Captured Admin invitation acceptance and magic-link sign-in
AUTHZ-ADMIN     Admin navigation, actions, and direct routes
AUTHZ-OPERATOR  Operator navigation, actions, and direct routes
AUTHZ-VIEWER    Viewer navigation, hidden mutations, and direct-route denial
AUTHZ-ROOT      Selected/unselected root behavior
SEC-01          Show-once credential boundary
SEC-02          Cookies, storage, cache, and authority-header inspection
SEC-03          CSRF rejection and safe forbidden response
SCHEMA-01       Typed definitions, impact, publish, and deprecate
CUSTOMER-01     Exact 404/create/update/stale conflict/refresh
PROMO-01        Revision 1 with nested groups, ordered rewards, and fallback
PROMO-02        Revision 2, all effect selectors, pause/resume/end, refresh
DEMO-01         Retained module markers and zero live mutations
CLEANUP-01      Process, worktree, and temporary-artifact cleanup
```

For every case, include starting state, numbered terminal/browser actions, visible expectations, network/security expectations, safe evidence, and dependencies on earlier cases.

- [ ] **Step 4: Fix the test data and role expectations**

Use these non-production values:

```text
root@gate-c.example
admin@gate-c.example
operator@gate-c.example
viewer@gate-c.example
Gate C Alpha
Gate C Beta
customer.gate-c-customer
customer.tier = bronze|silver|gold
context.channel = web|mobile
gate-c-promo
gate-c-free-shipping
```

Document the fixed-role expectations from `ROLE_PERMISSIONS`: Admin has every current permission; Operator has schema/customer/program/evaluation operations but no team/credential management; Viewer has schema/program/evaluation reads and no customer/team/credential or mutation access; root requires a selected client for merchant routes and remains visibly root.

- [ ] **Step 5: Document the live product actions exactly**

Specify:

- create and publish `customer.tier` plus `context.channel`, inspect impact, then deprecate the published unreferenced context field;
- exact customer `gate-c-customer`: observe 404, create typed values, update once, create a stale conflict from a second browser context, then refresh;
- `gate-c-promo`: use the complete authoring example, publish revision 1, refresh, edit the same external reference, reorder/change rewards, publish revision 2, and exercise pause/resume/end;
- verify order fixed/percent, line-item fixed/percent, and free-shipping selectors; use a separate no-budget `gate-c-free-shipping` Promo if required by Core's free-shipping budget rule;
- visit Affiliate, Referral, Loyalty, Events, and Analytics pages while recording `/operator/v1` mutation count.

- [ ] **Step 6: Add result and issue templates**

Include this result row shape:

```markdown
| Case | Status | Expected | Actual | Safe evidence |
| --- | --- | --- | --- | --- |
| ENV-01 | Pass / Fail / Blocked / Not run | Fresh Workers and D1 stores are ready | Record the observed safe readiness outcome | No secrets |
```

Include this issue shape:

```markdown
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
```

- [ ] **Step 7: Validate the procedure contract**

Run:

```bash
rg -n "ENV-01|ROOT-01|ROOT-02|TENANT-01|INVITE-01|AUTHZ-ADMIN|AUTHZ-OPERATOR|AUTHZ-VIEWER|AUTHZ-ROOT|SEC-01|SEC-02|SEC-03|SCHEMA-01|CUSTOMER-01|PROMO-01|PROMO-02|DEMO-01|CLEANUP-01" docs/testing/gate-c-manual-test.md
rg -n "Pass / Fail / Blocked / Not run|GATE-C-ISSUE-NNN|Never record|Notion" docs/testing/gate-c-manual-test.md
git diff --check
```

Expected: all 18 case identifiers appear, the result/issue/safety contract appears, and diff check exits 0.

- [ ] **Step 8: Commit the manual procedure**

```bash
git add docs/testing/gate-c-manual-test.md docs/superpowers/plans/2026-07-20-gate-c-manual-playwright-verification.md
git commit -m "docs: add repeatable gate c manual procedure"
```

### Task 2: Prepare the disposable stack and temporary Playwright operator

**Files:**
- Temporary only: `$GATE_C_RUN_ROOT/repo`
- Temporary only: `$GATE_C_RUN_ROOT/playwright/package.json`
- Temporary only: `$GATE_C_RUN_ROOT/playwright/gate-c-operator.mjs`
- Create after execution begins: `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`

**Interfaces:**
- Consumes the committed manual case identifiers.
- Produces a fresh running local stack, a Chromium browser with virtual WebAuthn, and an in-memory result collection keyed by case identifier.

- [ ] **Step 1: Create the disposable checkout from the exact current commit**

Run the `ENV-01` setup commands from the manual document. Record only the source commit and whether the detached checkout/install/migrations succeeded. Verify no `.wrangler` directory existed before migrations and both D1 migration commands exit 0.

- [ ] **Step 2: Install temporary Playwright 1.61.1 and Chromium**

Inside `$GATE_C_RUN_ROOT/playwright`, create a private temporary package and run:

```bash
pnpm init
pnpm add --save-dev playwright@1.61.1
pnpm exec playwright install chromium
```

Expected: the repository lockfile and package manifests remain unchanged.

- [ ] **Step 3: Create the one-off operator outside the repository**

The scratch module must:

```js
import { chromium } from 'playwright';

const results = new Map();
function record(caseId, status, expected, actual, safeEvidence = '') {
  results.set(caseId, { status, expected, actual, safeEvidence });
}
```

It must launch headed Chromium when available, attach CDP, enable `WebAuthn`, add a resident-key/user-verification virtual authenticator, observe request/response metadata without retaining bodies, and expose helpers to:

- query the disposable Identity D1 for only the latest captured email in memory;
- create separate browser contexts for root/Admin/Operator/Viewer/stale-customer cases;
- count unsafe `/operator/v1` requests per case;
- inspect cookies and storage metadata without serializing sensitive values;
- record `Pass`, `Fail`, `Blocked`, or `Not run` rather than silently throwing away later independent cases.

The operator must never write tokens, grants, codes, credentials, complete attributes, condition trees, reward payloads, or raw traces to stdout or files.

- [ ] **Step 4: Start the real local stack and bootstrap root**

Launch `pnpm dev:local` in a persistent terminal in the disposable checkout. Wait by condition for Operator Web to answer at `http://localhost:5173`; do not use a fixed sleep. Run the real root bootstrap CLI, parse its JSON in memory, and pass the activation grant directly to the temporary process without logging it.

- [ ] **Step 5: Create the dated run report skeleton**

Write the source commit, safe tool versions, case table with all 18 identifiers initially `Not run`, an empty issue section, and a `Gate C verdict: In progress` footer. Do not include temporary absolute paths or secret values.

### Task 3: Execute environment, root, tenant, onboarding, and authorization cases

**Files:**
- Temporary only: `$GATE_C_RUN_ROOT/playwright/gate-c-operator.mjs`
- Modify: `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`

**Interfaces:**
- Consumes the running disposable stack and stable procedure.
- Produces actual-versus-expected results for `ENV-01` through `AUTHZ-ROOT`.

- [ ] **Step 1: Execute `ENV-01`, `ROOT-01`, and `ROOT-02` exactly as documented**

Use virtual WebAuthn for passkey registration and sign-in. Verify recovery codes are present, unique in count, and disappear after acknowledgement without reading or storing their text. Record visible/auth/session outcomes only.

- [ ] **Step 2: Execute `TENANT-01`**

Provision Alpha and Beta, select Alpha, hard-refresh, select Beta, hard-refresh, and verify every root banner/merchant-scoped response matches the authoritative selection. Record names and non-sensitive merchant IDs only if the procedure permits; never record signed selection cookies.

- [ ] **Step 3: Execute `INVITE-01`**

Invite the Admin, query the latest captured invitation only in memory, navigate to its real token-only path, manually fill the email field, accept, follow `Sign in`, request a magic link, query and navigate to it in memory, and verify authenticated Admin membership.

- [ ] **Step 4: Execute role onboarding and `AUTHZ-*` cases**

As Admin, invite Operator and Viewer and complete their captured-link flows in separate contexts. Check the documented navigation/control matrix and direct routes. For denied direct pages, observe that the protected page request is absent; separately call a forbidden real BFF endpoint and record only safe error metadata.

- [ ] **Step 5: Record every deviation before continuing**

For each mismatch, add a `GATE-C-ISSUE-NNN` entry before executing the next independent case. Mark dependent cases `Blocked`; do not change product code.

### Task 4: Execute security and live product cases

**Files:**
- Temporary only: `$GATE_C_RUN_ROOT/playwright/gate-c-operator.mjs`
- Modify: `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`

**Interfaces:**
- Produces results for `SEC-01` through `DEMO-01` and the safe evidence needed for the final Gate C verdict.

- [ ] **Step 1: Execute `SEC-01` through `SEC-03`**

Create a local credential, verify show-once behavior, then dismiss/navigate/refresh and prove list/storage/network metadata cannot recover plaintext. Inspect cookie flags, storage keys/counts, relative request destinations, forbidden authority headers, `no-store`, and CSRF rejection. Record only booleans, counts, safe codes, and correlation IDs.

- [ ] **Step 2: Execute `SCHEMA-01`**

Create the two fixed typed definitions, inspect impact, publish, observe version/warnings, then request deprecation of the published unreferenced context field. Hard-refresh and verify canonical draft/published lifecycle values.

- [ ] **Step 3: Execute `CUSTOMER-01`**

Use exact reference `gate-c-customer`, exercise 404/create/typed update, then use a second authenticated Admin browser context to load the same version. Save from the first context, submit the stale second context, verify canonical conflict metadata and unchanged second draft, then explicitly refresh.

- [ ] **Step 4: Execute `PROMO-01` and `PROMO-02`**

Create/publish revision 1, refresh pointers, edit the same external reference into revision 2, reorder/change rules, publish, and verify all canonical reward selectors across the main and no-budget free-shipping Promo. Exercise pause/resume/end and hard-refresh after each transition. Record only external references, statuses, and revision numbers.

- [ ] **Step 5: Execute `DEMO-01`**

Visit retained module routes, assert visible `Demo data`, and record a zero count of unsafe `/operator/v1` requests caused by those pages.

- [ ] **Step 6: Preserve failures without product fixes**

If any product expectation fails, finish independent cases where safe, leave the issue `Open`, keep the Gate C verdict `In progress`, and do not start Task 10.

### Task 5: Finalize, clean up, review, and synchronize the evidence

**Files:**
- Modify: `docs/testing/runs/2026-07-20-gate-c-playwright-run.md`
- Modify: `docs/superpowers/plans/2026-07-20-gate-c-manual-playwright-verification.md`
- Modify: `docs/superpowers/plans/2026-07-19-production-operator-platform.md`
- Modify: `.superpowers/sdd/notion-plans-index.md` (ignored synchronization source)

**Interfaces:**
- Produces the durable Gate C verdict, issue list, local/Notion status, and Task 10 readiness decision.

- [ ] **Step 1: Execute `CLEANUP-01`**

Stop Chromium and all Workers, remove the disposable worktree with Git, then remove only the explicit `$GATE_C_RUN_ROOT` temporary directory. Verify the primary worktree's tracked and Wrangler state are unchanged except for the intended documentation files.

- [ ] **Step 2: Finalize the dated report**

Replace every initial `Not run` with the actual result or a justified retained `Blocked`/`Not run`. Summarize counts by status and list open issue IDs. Set the verdict:

- `Gate C complete — Task 10 ready` only when every required case is `Pass`;
- otherwise `Gate C in progress — Task 10 blocked` with issue IDs.

- [ ] **Step 3: Independently review the manual procedure and report**

Review for exact reproducibility, contradictions, accidental secret/customer payload inclusion, unsupported success claims, and mismatch between case table and issue list. Resolve documentation findings; do not resolve product failures inside this verification task.

- [ ] **Step 4: Run final documentation/security checks**

```bash
rg -n "ENV-01|CLEANUP-01|Gate C verdict|GATE-C-ISSUE" docs/testing/gate-c-manual-test.md docs/testing/runs/2026-07-20-gate-c-playwright-run.md
rg -n "activationGrant|recovery code|token=|sk_|pk_|magic-link/verify|customer\.tier.*gold" docs/testing docs/superpowers/plans/2026-07-20-gate-c-manual-playwright-verification.md
git diff --check
git status --short
```

Expected: structural checks pass; the sensitive-pattern scan contains only instructional prohibitions or synthetic labels, never real run values; diff check exits 0.

- [ ] **Step 5: Update local and Notion status**

Mark this plan `Done` only if all its documentation/execution steps are complete. Update the main Plan 3 Gate C line and Plans index note from the actual verdict. Create/mirror the manual procedure and run report under the platform root, keep this plan under the Plans page, and read every page back without truncation or unknown blocks.

- [ ] **Step 6: Commit the durable evidence**

If Gate C passed:

```bash
git add docs/testing docs/superpowers/plans
git commit -m "docs: record gate c browser verification"
```

If Gate C did not pass, use:

```bash
git add docs/testing docs/superpowers/plans
git commit -m "docs: record gate c browser findings"
```

- [ ] **Step 7: Start Task 10 only when the recorded verdict is complete**

Do not create Task 10 implementation changes in this task. A clean Gate C verdict updates Plan 3 to `Task 10 is next`; any issue keeps Task 10 blocked until separately approved fixes are implemented and reverified.
