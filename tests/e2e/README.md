# End-to-end test workspace

The full local API/browser suite runs automatically on same-repository PR
pushes against disposable Workers and private local D1 stores.

As of 2026-10-12, the local E2E foundation is accepted for use with a known
passkey-activation flake. Both jobs passed in [Ubuntu run 37955992809](https://github.com/tanmaydatta/chole-bhature/actions/runs/37955992809)
on [harness commit bab7e8ad](https://github.com/tanmaydatta/chole-bhature/commit/bab7e8adf086ad33f2578279b86bf57b23914ad5)
in [PR #21](https://github.com/tanmaydatta/chole-bhature/pull/21): five E2E cases
passed first attempt and the independent-stack case passed its existing single
CI retry. Pre/post workerd processes, threads and RSS were zero.
This is a usable foundation, not fully stable or finished E2E acceptance.
All six tests remain enabled and genuine failures block CI. Further flake
diagnosis is capped at two hours; product work proceeds without waiting for
perfect flake elimination. The later [post-merge `dev` run 38229971480](https://github.com/tanmaydatta/chole-bhature/actions/runs/38229971480)
on [merge commit 520f342](https://github.com/tanmaydatta/chole-bhature/commit/520f342a55fb5a681e56fb698edabb53ecbdb386)
passed build/lint but failed one of 214 E2E unit-package cases at its unchanged
five-second timeout. The PR-only full E2E job was skipped on that `dev` push;
the exact stalled unit operation is not known. The pre-merge PR run had passed
both jobs. This diagnostic change records only closed stage labels and bounded
elapsed milliseconds around that real-browser unit's launch, navigation,
cancellation, cleanup and fixture teardown. Both CI jobs now select the same
project-pinned Chromium and install its Linux dependencies, removing the
baseline job's reliance on the runner's system Chrome. Local headed commands
still use system Chrome. This change does not claim the earlier timeout's exact
cause or a fresh hosted pass. See [Local PR E2E CI](../../docs/testing/local-pr-e2e-ci.md)
for exact evidence, historical failures and remaining boundaries. Staging
remains protected owner-run manual acceptance after a separately approved
deployment; per-PR cloud environments and guarded upload remain parked and
unfinished. This closeout performs no deployment or staging acceptance.

From the repository root, after `pnpm install --frozen-lockfile` and `pnpm build`:

```sh
pnpm e2e:local:headed
```

This opens system Chrome so you can watch the Promo draft, save, refresh, detail,
and publish flow and the evaluate-only Playground scenarios. `pnpm e2e:local` runs all ten API/browser tests headlessly
with two workers. No pre-existing root session, ports, `.dev.vars`, or local D1
state is needed: Playwright builds the dashboard/dependencies once, allocates
unique loopback ports and Worker names, migrates two private temporary D1
stores, bootstraps a disposable root through the existing root CLI and actual
passkey UI with a virtual WebAuthn authenticator, then removes only that suite's
temporary files/processes. System Chrome must be installed; set
`E2E_BROWSER_CHANNEL=chromium` on the underlying Playwright command if you
have installed its pinned browser instead. The headed script intentionally
selects the browser project; the headless script runs all projects.

The local-only [checkout simulator case](../../docs/integration/integration-simulator.md)
uses existing run-owned ROOT/operator recipes to publish two capped coded
Promos, schema and customer, then calls CLI runtime through public merchant
credentials. It proves preflight-before-update, versions, exact allocations,
accepted/retry identity, actual HTTP409 usage exhaustion, repricing, one fake
capture and zero owned Product/Auth rows after disposal. No harness settings,
authority/controller changes or remote simulator writes are introduced. The
CLI/capabilities source is locally verified, not deployed to staging.

The local passkey bootstrap helper accepts only exact HTTP loopback origins
with an explicit port. Before saving state it checks the server session against
the root user ID returned by that suite's local bootstrap CLI, requires the
strict session schema, root role and exactly `['passkey']`, and refuses HTTP
errors or redirects. It keeps browser state in memory until its browser closes,
then publishes a complete file created with mode 0600 without overwriting an
existing file, symlink or directory. The two-stack isolation case now uses
independent managed-local fixture Admins instead of repeating ROOT/passkey
setup. It verifies distinct origins, directories and tenant/principal/session
identities, exact typed own-stack sessions and signed-in browser UI, private
0600 state files, and bidirectional cross-stack HTTP 401 `UNAUTHORIZED` replies.
Both run capabilities are durably recorded before bootstrap. Even after setup
or assertion failure, protected disposal and fresh complete Product/Auth
zero-row inventories are attempted for every attempted bootstrap (both runs
when both were attempted) before capability/member files are retired;
cleanup failures retain recovery records and fail the case.
Vitest cases exercise real local HTTP/filesystem failure paths and
real Chromium browser/context cancellation, including late fulfillment. Actual
WebAuthn bootstrap remains in the full local Playwright suite.
This bounded local extraction is implemented and locally tested; independent
task review passed on 2026-10-08 for this local Task 7b scope.
It adds no cloud target or login, Access wiring or provider authority. See the
[dated local passkey evidence](../../docs/testing/per-pr-cloud-e2e.md#local-passkey-bootstrap-extraction-2026-10-08).

For staging, first apply a pending Product `0007` migration before Product
`0008`, then apply the matching Auth migrations and deploy the
[matching Workers](../../docs/integration/staging-operations.md#e2e-platform-deployment-order)
under the normal protected owner process. Create a private, ignored directory
for the owner's browser state and complete the ordinary passkey sign-in in the
headed Chrome window opened by the helper:

```sh
mkdir -p tests/e2e/.runs
chmod 700 tests/e2e/.runs
pnpm e2e:staging:login --output "$PWD/tests/e2e/.runs/staging-root.json"
```

The helper accepts only an absolute path under an existing owner-owned 0700
directory, pins `https://operator.staging.wastd.dev`, checks the resulting
session is root, and creates a new 0600 storage-state file without overwriting
another file. It never prints cookies. It does not create a root account or
use a test login backdoor. When the session expires, repeat the login with a
**new** output filename (or move the old file to an owner-only archive first).
Then run the visible browser check:

```sh
E2E_OPERATOR_STORAGE_STATE="$PWD/tests/e2e/.runs/staging-root.json" pnpm e2e:staging:headed
```

`pnpm e2e:staging` runs all projects headlessly. The stage command pins both
public origins, requires the explicit staging-enable flag, checks the storage
file, live root session, and exact cross-Worker/Product/Auth migration capability
before any fixture creation, and never creates an initial root. Re-authenticate
with a new file when the session expires.
Do not put cookies, proofs, bearer tokens, or credentials on a command line.
The stage command creates and irreversibly deletes only run-provenance tenants;
it fails before any write on old/mixed Workers or missing lifecycle migrations.
The storage-state **path** is safe to place in the shell command; keep the
file and its containing directory private.

## Control lease foundation

Version 2 control leases and SQL write fences provide a foundation for future
preauthenticated product tests. The parked runtime candidate includes dedicated
control endpoints, controller account issuance and member-session resolution;
the routine harness and protected staging integration remain incomplete. The
default commands continue to use the version 1 ROOT flow. The opt-in local
Promo check below is the first bounded version 2 product-flow proof.

The 2026-10-16 candidate boundary correction makes a disabled Operator refuse
bootstrap and controller calls before forwarding, while preserving separately
authenticated setup capability checks and exact-proof status/disposal recovery.
Controller authority becomes available only after the initial Admin cookie and
principal verify and bootstrap completion is durably recorded within the
creation lease. Issuance alone does not grant readiness. These local boundary
checks alone do not establish a preauthenticated headless product flow or staging
acceptance; see [Staging Worker operations](../../docs/integration/staging-operations.md#preauthenticated-control-candidate--2026-10-16).

Version 2 fixture accounts require controller-owned synthetic reservations.
Ordinary invitation acceptance for a version 2 fixture organization refuses
before any writes. Manual tenants and version 1 ROOT runs keep their existing
invitation and account flows. Permanent fixture markers refuse business writes
when the matching control ledger is missing, expired or fenced.

Reservations refuse collisions with retained version 1 claims without changing
legacy business or disposal rows. Fixture organizations require the exact
reserved tenant tuple and permanent marker. Membership writes check both the
organization and retained user ownership, including missing account ledgers;
new memberships also require the matching marked user, not an existing manual
identity. Product and Auth share one atomic batch engine while keeping their
own tenant scope lookups.

Local capture for a version 2 synthetic invitation address requires an explicit
control runtime and exact live pending-invitation ownership. The capture INSERT
uses the same atomic SQL write fence; stale or ambiguous ownership refuses even
after tenant deletion. Reserved controller account addresses remain no-email.
Ordinary shared recipients are not inferred to be fixture-owned from invitations;
manual/version 1 capture and Resend behavior are unchanged. Full harness conversion
and protected staging configuration wiring remain pending.

Creation leases last 15 minutes from reservation, with eight live leases per
target and a default quota of three accounts per run. Exact-run cleanup
invocations last five minutes and grant only fencing and disposal authority.
The [preauthenticated product E2E contract](../../docs/superpowers/specs/2026-10-12-preauthenticated-product-e2e-design.md)
records the remaining integration and rollout boundaries.

Code references:

- Product lease and fence schema: [Product migration](../../apps/api/migrations/0009_e2e_control_leases.sql).
- Auth lease, account and session constraints: [Auth migration](../../apps/identity/migrations/0007_e2e_control_leases.sql).
- Shared atomic write boundary: [Workers batch engine](../../packages/worker-runtime/src/e2e-control-write-batch.ts).
- Invitation acceptance boundary: [invitation service](../../apps/identity/src/services/invitations.ts).
- Explicit-runtime local capture boundary: [email adapters](../../apps/identity/src/email.ts).

## Experimental one-flow local preauth check

As of 2026-10-16, `CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local:preauth`
passed the existing exact capped-Promo browser case headlessly on its first
attempt (14.3s). An ordinary fixture Admin authored, saved, refreshed and
published the Promo; no ROOT CLI, passkey bootstrap or platform selection was
used. All four run-owned resources were cleaned and the protected final status
verified zero Product/Auth rows before retiring that run's capability/member
files. Earlier failed recovery records remain private and unchanged.

The local account/scope slice additionally checks Account context on Promo
list, create/edit and reloads: exact setup-derived fixture Admin name/email,
Admin role, Test fixture and Identity client name. Seed intent names the
organization `${runId}_merchant` and user `${runId}_admin`; Local Promo fixture
is only the descriptive control request label. Expected values are whitelisted
setup metadata, never a session-response oracle or private cookie/proof. The
same spec's full ROOT path checks ROOT, Passkey and the recipe's exact
`${runId}_merchant Browser authoring shop`,
without inventing the real owner's email. Real scroll checks exercise header
title/actions, bottom navigation and a separate demo badge. All existing
percentage/cap/save/publish assertions and protected cleanup remain. On
2026-10-19 the final opt-in case passed first attempt in 14.1s (four resources
cleaned, zero Product/Auth rows), and all ten headless local cases passed in
23.4s. These account-display results claim no deployment or staging acceptance.

Fixture mode now waits for actual HTTP responses from all three local Workers
before the capability handshake, within the existing shared 45-second readiness
budget. HTTP readiness is not business-health acceptance. No server/auth guard
was relaxed. See [Experimental local preauthenticated Promo check](../../docs/testing/preauth-local-promo.md)
for exact evidence and limits. This is one opt-in local proof, not full suite
conversion or staging readiness. The paired-stack isolation case also uses
ordinary fixture Admins, as described above. The default/full local command
still performs one global ROOT/passkey bootstrap for its legacy business
recipes; its timeouts, retries and two workers remain intact. This bounded
replacement does not diagnose or claim to fix the earlier paired-passkey
activation failure, and does not establish shared-target concurrency or
recovery acceptance.

## Check the local cloud helper groundwork

Cloud candidate and Access routing checks run on controlled local fixtures;
`E2E_TARGET=cloud-ci` remains unavailable. With dependencies and the pinned
browser already installed, run `pnpm --filter @incentives/e2e test`, then
`E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` from the repository root. The
business/isolation/cleanup guarantees remain covered, with fixture Admins in
the paired isolation case described above; a
separate local-only browser case checks HTTP navigation, assets, subrequests,
credential snapshots and refusal before foreign or redirected dispatch.
Staging skips that controlled-fixture case.

The groundwork is implemented and locally tested; independent task review
passed on 2026-10-08. Acceptance covers this bounded local groundwork.

The candidate must match an independently supplied run tuple and account
subdomain. This local consistency check proves no live GitHub freshness,
provider ownership, deployment, binding graph or Access policy. The dedicated
HTTP contexts dispatch only to the exact candidate API/Operator origins,
refuse header collisions and Host spoofing, and refuse every 3xx response,
including same-origin redirects. Browser contexts start fresh with service
workers blocked; WebSockets and real cloud authentication remain outside this
groundwork. No cloud login or runtime cloud command is supplied. See the
[dated local evidence](../../docs/testing/per-pr-cloud-e2e.md#local-candidate-and-access-routing-groundwork-2026-10-08)
and remaining deployment gates before extending these helpers.

## Staging outcome — 2026-10-14

The separately approved API/Operator rollout from PR #23 merge
`1d25ef36d06fb7b44b288bd85c3a92d61999983d` passed the full headless staging
suite: **7 passed, 2 intended local-only skipped, 0 failed**, two workers,
1.0 minute (63.450 seconds command time), no reported retry/flake. All three
Playground cases passed. Eight run-owned tenants were disposed, all 53 recorded
resources were cleaned and final protected inventories confirmed zero
Product/Auth rows. Identity, migrations, secrets, production and the demo were
unchanged. See the [dated staging verification](../../docs/testing/evaluation-playground-staging-2026-10-14.md)
for deployed versions, runtime transformations and evidence boundaries.

```sh
CI=true E2E_BROWSER_CHANNEL=chromium \
  E2E_OPERATOR_STORAGE_STATE=/absolute/private/current-root-state.json \
  pnpm e2e:staging
```

This uses an existing authorized owner session and performs the protected
prewrite handshake. It does not authorize a future deployment or login bypass.
`local-stack.api.spec.ts` and `cloud-access.browser.spec.ts` remain local-only;
their staging skips do not skip product coverage.

## Check the evaluate-only Playground

The three Playground browser scenarios use real local/staging Workers, canonical
responses, fresh ROOT browser contexts and normal merchant selection. They
verify anonymous/stored-customer evaluation, required typed live fields,
published revision authority, exact capped and per-line stacked discounts,
input-change invalidation, code diagnostics, empty selection and free
shipping's zero merchandise saving. Every scenario checks run disposal and
zero Product/Auth rows, including after assertion failure. Core Workers/D1
tests locally and separately prove persisted snapshot HMAC integrity, unchanged budgets
and counters, and zero redemption rows; the browser suite adds no privileged
snapshot-inspection endpoint and performs no redemption for the Playground.

For a focused local run from the repository root:

```sh
CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local playground.browser.spec.ts
```

Run `CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` for the full gate.
Member-account fixture recipes remain staging-only; these ROOT browser
checks do not claim member sign-in coverage. BFF tests preserve the existing
Admin/Operator/Viewer evaluation permissions. The dated staging outcome above
accepts only this evaluate-only slice, not full Task 10/Gate D. The E2E rewrite remains parked; no framework, authority,
startup, retry, timeout or worker-setting change is required by this slice.
See [Evaluate a basket in the Playground](../../docs/integration/evaluation-playground.md).

## Recipes and ownership

`pnpm recipe:e2e <recipe> --input /absolute/path/input.json [--run e2e_...]`
accepts typed, validated JSON; `add-merchant` can generate the run ID and all
later recipes reuse it. Available recipes: `add-merchant`, `add-user`,
`add-admin`, `set-role`, `add-schema`, `add-customer`,
`create-api-credential`, `add-promo`, `publish-promo`, and `cleanup-run`.
Arguments must be in files rather than shell command lines. The credential
recipe saves its token to a private file and prints only its location.

`add-user` and `add-admin` require staging. They create fully active,
run-exclusive synthetic accounts in an E2E-owned merchant and verify actual
Better Auth session identity and permissions. They do **not** test invitation
email delivery or acceptance; local Identity tests cover ordinary email auth.
These version 1 member-account recipes remain staging-only; the version 2
candidate additionally admits explicitly managed local stacks. Fixture sessions
retain their immutable 15-minute issuance cap. `set-role` uses the authorized
operator API. No recipe writes remote D1 directly.

Each run gets a random 96-bit `e2e_` ID; merchant, user, Promo/code, customer,
order, and idempotency identifiers are run-scoped. A mode-0600 manifest in
`tests/e2e/.runs` records every created ID and its owner. The run proof,
cookies, and tokens are separate private files. Independent scenarios share
one suite bootstrap but not tenant state or browser contexts. Playwright uses
two bounded workers; API tests carry detailed business assertions, and browser
specs exercise real Promo UI interactions, the evaluate-only Playground and
controlled local routing. The measured local baseline on
2026-09-25 was 5 Playwright tests in 23.9 seconds, including bootstrap,
two concurrent full scenarios, browser smoke, and two simultaneous independent
Worker/Auth D1 instances. The PR CI job runs every project and all ten tests
without selection or sharding. For focused local diagnosis, Playwright accepts
`--project=api`, `--project=browser`, or `--shard`; each shard starts its own
isolated stack.

## Cleanup and recovery

The independent-stack test registers its fixture owner before simultaneous
startup. Normal test timeout teardown cancels pending and ready stacks without
waiting indefinitely for startup fulfillment. Setup commands and Workers belong
to dedicated POSIX process groups pinned by live IPC supervisors. Only each live
supervisor signals its own group and inheriting descendants; the parent never
signals a remembered group ID after supervisor exit. Late temporary resources, browsers and contexts are
disposed before use, and cancellation prevents root-state publication. Successful
tests still await both starts and all stops; cleanup failures are reported with
the original test failure preserved.

Setup commands and passkey bootstrap have 45-second cancellation deadlines;
pending browser acquisition plus close has a 10-second cleanup bound, as do
resource cleanup and supervisor IPC shutdown. Owned groups receive TERM then
KILL after five seconds; numeric membership inspection excludes the supervisor
and its completed inspector. Inspection failure triggers best-effort self-group
termination and remains an incomplete cleanup, not success. Late browser close
failure or acquisition deadline reaches both caller and fixture owner. The suite's test
timeout, retry count and concurrency remain unchanged. The paired fixture case
retains the session/tenant isolation checks described above. Fixture teardown
supports normal Playwright test interruption, not uncatchable OS termination
such as SIGKILL or descendants that escape their owned process group.
Managed diagnostics emit fixed phases before awaits and every ten seconds,
bounded elapsed milliseconds, known failure hints and launcher exit/signal
values, never raw private logs or error content. Unknown text is not reflected.
Passkey substeps identify launch, context/page/CDP initialization, navigation,
activation, recovery, sign-in, server verification, state snapshot, cleanup and
publication. Nested context cleanup precedes its enclosing browser close;
both share the existing ten-second total bound. A failed or never-settling
nested cleanup still attempts browser close and reports safe incompleteness,
without waiting for arbitrary bootstrap work or publishing after cancellation.
The passkey phase unit also emits only fixed stage names and bounded elapsed
milliseconds before its browser and teardown awaits, so a future five-second
unit timeout can be attributed to a narrower lifecycle boundary.
CI's best-effort capacity summaries contain only bounded system numbers.

The scenario runner previews and disposes its claimed tenant in `finally`,
then reopens a root read-only inventory to assert **zero Product and Auth
run-owned rows** and checks every manifest resource is `cleaned`. This occurs
on success and after a scenario assertion fails. Product deletion precedes
Auth deletion in a resumable two-DB saga. Both databases retain only a
sanitized run ID/merchant ID/status/timestamp disposal audit tombstone; no
fixture customer or credential content remains. Disposal is irreversible.
The normal local Worker config has no disposal path; the temporary Playwright
stack alone sets `E2E_LOCAL_TEST_MODE=1` in its private generated configs.
Staging requires `APP_ENV=staging`, live root authority, exact run proof,
server-recorded provenance, and dry-run inventory. Production is closed.

If a stage run fails during cleanup, retain its private `.runs` files and
resume only that run:

```sh
E2E_TARGET=staging E2E_ENABLE_STAGING=1 E2E_OPERATOR_STORAGE_STATE=/absolute/private/root-state.json pnpm recipe:e2e cleanup-run --run e2e_REPLACE_WITH_RECORDED_ID
E2E_TARGET=staging E2E_ENABLE_STAGING=1 E2E_OPERATOR_STORAGE_STATE=/absolute/private/root-state.json pnpm recipe:e2e cleanup-run --run e2e_REPLACE_WITH_RECORDED_ID --execute
```

The first command is a read-only preview. The second executes scoped,
idempotent disposal; it refuses foreign resources/proofs. Never edit a remote
D1 database to repair a run. Keep the private manifest until the final
zero-row inventory succeeds; then follow the repository's test-artifact
retention policy. Ignored local `.runs` files from an earlier aborted
temporary stack can be discarded only after confirming that stack's state was
removed.

The exact GAP-030/031 values, assertions, and staging/local evidence boundary
are documented in [the scenario guide](../../docs/testing/gap-030-031-e2e.md).
