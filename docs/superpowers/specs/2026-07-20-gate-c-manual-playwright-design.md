# Gate C Manual Browser Verification with Playwright — Design Spec

**Status:** Approved for implementation planning

**Notion parent:** [Referral Discount Targeting Platform](https://app.notion.com/p/Referral-Discount-Targeting-Platform-Cashback-API-first-2fce5c7c2b8e8070b865daaa741e7370)

**Notion mirror:** https://app.notion.com/p/3a3e5c7c2b8e8154a874f172136feae1

## Goal

Create a reusable, human-readable Gate C manual test procedure, then execute that exact procedure against the real local three-Worker/two-D1 stack using Playwright-controlled Chromium. Record expected versus actual behavior without adding a committed end-to-end test suite.

## Scope

The procedure covers the remaining Gate C evidence for Tasks 7–9:

- root bootstrap, virtual passkey registration/sign-in, and show-once recovery handling;
- two-client root selection, switching, and hard-refresh banner accuracy;
- captured invitation acceptance, magic-link sign-in, team invitations, and fixed-role authorization;
- show-once credentials and browser authority/secret boundaries;
- live schema, exact-customer, and immutable Promo authoring/lifecycle flows;
- real canonical permission/conflict errors and correlation metadata;
- retained Affiliate, Referral, Loyalty, Events, and Analytics demo-only separation.

This work does not add a repository Playwright configuration, committed E2E tests, CI browser jobs, production changes, Task 10 functionality, Audit, or operator redemption.

## Chosen approach

Each run uses a disposable detached Git worktree created from the exact commit under test. Dependencies are installed from the existing pnpm store with the frozen lockfile. Because Wrangler state is relative to that disposable checkout, Core Product D1 and Identity Auth D1 start empty without deleting, moving, or reusing the developer's normal local state.

Core and Identity migrations are applied in the disposable checkout. Separate per-run `AUTH_SECRET` and `OPERATOR_SELECTION_SECRET` values are stored only in ignored `.dev.vars` files inside that checkout. The existing local runner builds the dashboard and launches Core on `8787`, Identity on `8788`, and public Operator Web on `5173`.

Playwright is installed only in a temporary directory and is not added to the repository. The resolved Playwright and Chromium versions are recorded in the run report. A temporary, uncommitted driver controls Chromium and a CDP virtual WebAuthn authenticator. It follows the same numbered actions written for a human; it is an execution aid, not a test artifact or future source of truth.

## Manual procedure structure

The canonical procedure lives at `docs/testing/gate-c-manual-test.md`. Every numbered case includes:

- prerequisites and starting state;
- exact human browser or terminal action;
- expected visible result;
- expected network/security result where relevant;
- evidence that may be recorded safely;
- cleanup or state transition before the next case.

The procedure uses stable case identifiers so later run reports can compare results without copying or reinterpreting the steps.

## Scenarios

### 1. Environment and root

Create the disposable checkout, install dependencies offline, write per-run local secrets, apply both migration sets, start all three Workers, and verify only Operator Web is used as the browser origin. Bootstrap one root through the real CLI, enter its activation grant without persisting it, register a virtual passkey, verify recovery codes are displayed once, acknowledge them without recording their values, and sign in with the passkey.

### 2. Root tenant context

Provision two clients. Select client A, hard-refresh, switch to client B, and hard-refresh again. The visible root banner and authorized responses must always match the selected merchant. A name lookup failure must fall back to the authoritative merchant identifier rather than a previous client's name.

### 3. Employee onboarding and authorization

Invite an Admin through the real dashboard. Read the newest invitation from Identity's disposable `local_email_capture` table, keep the token only in process memory, navigate to the emitted token-only URL, manually enter the invited email, accept, and follow the real sign-in action. Request a magic link, read the new captured message without recording its URL, navigate through it, and confirm the authenticated membership.

The Admin then invites Operator and Viewer users through the dashboard, and the same acceptance/sign-in flow is repeated. For root, Admin, Operator, and Viewer, verify visible navigation, mutation controls, denied direct routes, and actual permission responses. Denied pages must not issue their protected page fetch before the route guard resolves.

### 4. Browser security boundary

Create a credential and verify plaintext appears once, is absent after dismissal/navigation/refresh, and cannot be recovered from list responses. Inspect Chromium cookies, local/session storage, requests, and responses. Browser requests must use relative Operator Web paths and contain no authoritative merchant, actor, root, Core/Identity URL, or credential header. Session and root-selection cookies must have the expected HttpOnly/SameSite properties. Authenticated and operator JSON responses must be `Cache-Control: no-store`. Unsafe mutations from a foreign origin or missing required browser metadata must fail safely.

Trigger real forbidden and stale/conflict responses. Record only status, canonical code, retryability, safe message, and correlation identifier. Do not record request bodies containing customer attributes, invitation/magic tokens, configuration trees, or secret values.

### 5. Live product flows

Create typed schema definitions, inspect impact, publish, and deprecate a published definition. Perform exact-customer 404, create, versioned update, two-context stale update conflict, and explicit refresh. Create a Promo draft with global eligibility, nested `ALL`/`ANY`, ordered rewards, fallback, and canonical effects; publish revision 1; refresh; edit the same logical reference into revision 2; publish; pause; resume; and end. Verify server revision pointers and irreversible end presentation survive refresh.

Visit every retained Affiliate, Referral, Loyalty, Events, and Analytics route. Each must display `Demo data`, and the browser must issue no `/operator/v1` mutation from those pages.

## Expected-versus-actual record

Each execution writes `docs/testing/runs/YYYY-MM-DD-gate-c-playwright-run.md`. The report records:

- source commit, operating system, Node/pnpm, Wrangler, Playwright, and Chromium versions;
- disposable checkout and D1 initialization outcome without secret paths or values;
- one row per stable case identifier with `Pass`, `Fail`, `Blocked`, or `Not run`;
- expected and actual behavior;
- safe response metadata and non-sensitive observations;
- final Gate C verdict and remaining work.

The report never contains secrets, invitation or magic links, activation grants, recovery codes, credential plaintext, complete customer attributes, condition trees, reward payloads, or raw browser traces.

## Failure policy

Product failures are recorded before any further action. Each issue entry includes a stable issue identifier, severity, affected case, exact reproduction steps, expected behavior, actual behavior, safe status/code/correlation metadata, dependency impact, and a proposed follow-up. Product code is not fixed during this verification run unless the user separately authorizes a fix.

Harness or environment failures are investigated with the systematic-debugging workflow. A temporary driver/setup correction may be made to continue the run, but the report distinguishes harness failure from product failure and records the correction. If a failure blocks dependent cases, those cases are marked `Blocked`; independent cases continue where safe.

Any required `Fail`, `Blocked`, or `Not run` result keeps Gate C `In progress` and Task 10 cannot start.

## Artifact and secret handling

Playwright scripts, browser profiles, screenshots, traces, downloads, generated secrets, captured email URLs, and disposable D1 files remain under temporary directories. They are never committed or mirrored to Notion. Screenshots are taken only when the page contains no sensitive material and are used during the active run; the durable report uses textual, redacted evidence.

Cleanup terminates all Worker and browser processes, removes the disposable Git worktree through Git, and deletes only the explicit temporary directories created by the run. It never deletes the main checkout's `.wrangler` state or user files.

## Documentation and Notion synchronization

The design, manual procedure, and dated run report are committed locally. Each is mirrored to Notion under the Referral Discount Targeting Platform; implementation plans remain under the existing Plans page. After read-back verification, the active Plan 3 status and Plans index note are updated to either:

- Gate C complete, Task 10 ready; or
- Gate C still in progress, with the open issue identifiers listed.

No document is marked complete until its Notion mirror reads back without truncation or unknown blocks.
