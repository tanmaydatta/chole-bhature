# Local PR E2E CI

Same-repository pull requests run the full local API and browser suite against disposable Workers and real local D1 stores, checking product behavior before staging acceptance.

## Execution contract

| Boundary | Contract |
|---|---|
| Trigger | Pull requests opened, reopened or updated by a push, for any target branch; the head repository must equal this repository. External forks skip the local E2E job. |
| Superseded runs | The existing workflow/ref concurrency group cancels older runs for the same PR ref, including its baseline and local E2E jobs. |
| Baseline | The existing build, lint and unit-test `verify` job still runs. Pushes to `dev` run that baseline; the local E2E job is PR-only. |
| Runtime | Ubuntu, Node 22.18.0, pnpm 11.14.0, frozen lockfile installation, Corepack networking disabled (`COREPACK_ENABLE_NETWORK=0`), dependency verification required (`pnpm_config_verify_deps_before_run=error`) and global virtual store disabled (`pnpm_config_enable_global_virtual_store=false`); project-pinned Playwright Chromium with Linux system dependencies, then workspace build. |
| Suite | `pnpm e2e:local`, both API and browser projects, all six tests, two workers, no filtering or sharding; the existing one CI retry remains. |
| Authority | `contents: read`; checkout credentials are not persisted for the local E2E job. No staging session, Cloudflare token, repository secret or privileged GitHub write token is supplied to the suite. |
| Isolation | Fresh root/passkey identity, unique loopback ports and Worker names, private temporary Product/Auth D1 stores, and independently scoped scenario tenants. A test-scoped owner registers before both concurrent starts and cancels pending/ready stacks during normal timeout teardown. Late acquisitions are disposed before use; cleanup failures preserve the test failure. |

Built workspace contracts must exist before Playwright imports its global
setup. The managed stack additionally builds its dashboard and runtime
dependencies, migrates its private databases and bootstraps root through the
supported local CLI and actual passkey UI with a virtual WebAuthn authenticator.

Code references:

- [CI workflow](../../.github/workflows/ci.yml).
- [Playwright configuration](../../tests/e2e/playwright.config.ts).
- [Managed-local setup](../../tests/e2e/playwright.global-setup.ts).
- [Local stack lifecycle](../../tests/e2e/src/local-stack.ts).
- [Actual passkey bootstrap and private state publication](../../tests/e2e/src/passkey-bootstrap.ts).

## Behavioral coverage

**Table — Existing full local suite**

| Case | Assertions |
|---|---|
| Exact Promo business flow | Author and publish a 25% order Promo capped at GBP 15.00 and a GBP 5.00 per-matching-unit Promo; read configurations back; assert ordered rule/line allocations, 3,000 total discount and 7,001 discounted subtotal; verify signed evaluation/redemption integrity, persisted ledger, one usage and 3,500 remaining budget per Promo; identical retry changes nothing and conflicting reuse is refused. |
| Concurrent scenarios | Two complete business scenarios run concurrently with different run, merchant, evaluation and redemption IDs, run-owned allocations and exact totals; both dispose successfully. |
| Failure cleanup | An intentionally failed scenario disposes only its recorded tenant. Success and failure paths assert zero run-owned Product/Auth rows and cleaned manifest resources. Sanitized disposal audit tombstones remain. |
| Independent stacks | Two extra local stacks have distinct origins, directories and root identities. Fresh browser contexts restore each mode-0600 saved state and verify the independently expected root identity, root role, passkey-only session and signed-in UI; both cross-state uses are rejected. |
| Promo browser flow | Use the real edit page, check the 1500 cap, change and restore it, save, verify the exact GBP 15.00 detail summary, reload, check API persistence, publish through the confirmation dialog, and verify active revision 1 and the exact persisted published reward. |
| Controlled local routing | A real browser navigates pages, assets and subrequests through a local transport fixture; credential snapshots survive caller mutation, foreign requests never dispatch, same-origin and foreign redirects refuse, header collisions refuse before dispatch, and closed contexts stay closed. This uses synthetic Access fixture credentials, not live Access. |

All existing assertions remain intact. The business flow uses actual local
Workers/D1 and browser interactions. Passkey bootstrap runs during managed
setup and is additionally checked through the restored-session isolation case.
The controlled routing fixture certifies its local HTTP boundary only.
The independent-stack case still starts both stacks concurrently; failure-safe
ownership does not serialize startup or change its behavioral assertions.

Code references:

- [Business, concurrency and failure cleanup tests](../../tests/e2e/test/playwright/gap.api.spec.ts).
- [Exact scenario and persistence assertions](../../tests/e2e/src/gap-scenario.ts).
- [Independent stack and session checks](../../tests/e2e/test/playwright/local-stack.api.spec.ts).
- [Promo browser test](../../tests/e2e/test/playwright/promo.browser.spec.ts).
- [Controlled routing browser test](../../tests/e2e/test/playwright/cloud-access.browser.spec.ts).

## Diagnostics and private state

CI reports test names, timings and assertion failures in its console using the
list reporter. Trace and screenshot capture are disabled in CI, video remains
disabled, and the workflow uploads no artifacts or raw reports. Local runs
outside CI retain their existing failure trace/screenshot behavior.

Managed startup reports a fixed lifecycle phase before asynchronous work and
every ten seconds, with elapsed milliseconds bounded to 0–3,600,000. Timeout
diagnosis therefore does not depend on reaching an outer catch.
Passkey progress additionally identifies browser launch, context/page and CDP
virtual-authenticator initialization, page navigation, root activation, recovery
confirmation, passkey sign-in, server verification, state snapshot, context and
browser close, and state publication. These labels contain no origins, paths,
root identities, activation grants, cookies or raw errors. Failures report
per-Worker known failure hints and the owned Wrangler launcher's exit/signal state. Classification
scans the complete private Worker log, including an early native error followed
by a long backtrace, but emits only closed labels: resource unavailable, address
in use, too many open files, out of memory, native check failed or segmentation
fault. Unknown content is not reflected. These are diagnostic hints, not proof
of the native cause; the launcher's state is not a directly observed workerd exit.
Owned setup commands and Workers use dedicated POSIX groups pinned by live IPC
supervisors, including inheriting descendants after command exit. Only the live
supervisor signals its own group; the parent never signals a remembered group
ID after exit. Closed command-exit IPC preserves the actual launcher's exit and
signal rather than substituting a successful supervisor exit. Setup commands and passkey bootstrap
cancel after 45 seconds. Cancellation rejects new acquisitions, closes acquired
or late browsers/contexts, and prevents root-state publication. Pending browser
acquisition plus close has one ten-second cleanup bound; its failure or deadline
is tracked by the owner and reaches the caller/fixture. The browser waits for its
registered context cleanup, not arbitrary bootstrap work. Failed or never-settling
nested cleanup shares that same bound and still attempts the enclosing browser
close; neither stack startup nor suite concurrency is serialized. Resource cleanup and
supervisor IPC shutdown are also bounded to ten seconds. Groups receive TERM,
then KILL after five seconds; numeric membership inspection excludes the live
supervisor and its completed inspector. Inspection failure triggers best-effort
self-group termination and reports incompleteness. Cleanup continues after an individual
failure and reports incompleteness without raw error content. Test fixture
teardown covers normal Playwright body timeout, not uncatchable OS termination
or descendants that escape the owned group. No suite timeout, retry or worker
count is increased.

Code references:

- [Cancellation-safe stack owner and fixture callback](../../tests/e2e/src/local-stack.ts).
- [Real process descendants and actual Playwright timeout regressions](../../tests/e2e/test/unit/local-stack.test.ts).
- [Real Chromium cancellation and publication regressions](../../tests/e2e/test/unit/passkey-bootstrap.test.ts).

Before and after the suite, CI prints best-effort numeric capacity summaries:
CPU/affinity counts, memory, process/thread and workerd counts, workerd RSS,
process/file limits and available cgroup PID/memory/OOM-kill counters. No process
arguments, environment or raw log content is printed. Unavailable counters are
`null`; a summary failure does not change the suite's exit status.

Saved browser state, cookies, API credentials, run proofs, manifests, generated
Worker configs, temporary D1 stores and raw diagnostic files remain private.
The ignored `.runs` directory is not uploaded. Assertion failures are diagnosed
from the console and reproduced locally; raw local traces/reports must not be
attached to public evidence because they can carry privileged synthetic sessions,
headers and run proofs.

## Dated verification and remaining acceptance

On 2026-10-09, the latest published [hosted Ubuntu run 37951296533](https://github.com/tanmaydatta/chole-bhature/actions/runs/37951296533)
on [harness head 9c258ac](https://github.com/tanmaydatta/chole-bhature/commit/9c258acbf61c2b41712eaf6eaad645504633d0d6)
failed both jobs. Baseline `verify` passed build/lint but its E2E unit package
passed 209 of 210 cases: the pending-browser-acquisition test exceeded its
unchanged five-second test timeout. The full suite passed five of six cases;
the independent-stack case failed during passkey bootstrap at its 45-second
startup deadline on both attempts. Pre/post numeric summaries reported zero
workerd processes, threads and RSS; no orphan workerd termination was reported.
The hosted gate remains blocked. The exact unit timeout stage and the original
native/hang/resource cause remain unproved and are not assumed to be shared.

The local amendment made the fake-clock cleanup-timer registration boundary
explicit and added fixed passkey substeps before asynchronous work. A real
WebAuthn/browser cancellation regression also exposed simultaneous nested
context/browser close exceeding the unchanged five-second unit limit; structured
context-before-browser disposal passed that regression. Real-resource tests
cover child close failure/deadline and an unfulfilled cleanup hook while still
attempting the enclosing browser close and reporting safe incompleteness.
The amended source passed 97 focused cases and all 214 E2E unit-package cases;
its unchanged full suite passed six tests with two workers in 21.2 seconds,
without skips or retries. These are macOS results with pinned CI runtime/browser
settings, not an explanation or fix claim for either hosted failure. Independent
review and a new Ubuntu run are required before accepting this amendment.

On 2026-10-09, the subsequent [hosted Ubuntu run 37936891294](https://github.com/tanmaydatta/chole-bhature/actions/runs/37936891294)
on [documentation head 5a005a60](https://github.com/tanmaydatta/chole-bhature/commit/5a005a60c1100c2de279bbf0e3ee5fb96611f1d6)
passed `verify`, but only five of six E2E cases passed. The independent-stack
case timed out at 120 seconds on both attempts; post-suite totals were 24 workerd
processes, 204 threads and 2,252,980 KiB RSS, and runner cleanup terminated 24
orphaned workerd processes. That head does not satisfy the hosted gate. The
native/hang/resource cause remains unproved. The timeout-safe ownership change
requires a newly reviewed Ubuntu run; an earlier green run is historical evidence,
not acceptance of this change.

The proposed timeout-safe lifecycle passed 93 focused process/browser/privacy
cases and all 210 E2E unit-package cases on 2026-10-09. A real controlled
Playwright timeout first left four owned launcher/descendant processes alive;
the shared fixture callback now disposes all four. Cancellation regressions
also use real Chromium, late browser/context fulfillment and real private
files. The unchanged full local suite passed six tests with two workers in
22.9 seconds (23.45 seconds for the command), without skips or retries, using
the pinned Node/pnpm runtime and CI Chromium settings. These are macOS results,
not proof that the original Ubuntu hang or native fault is fixed.

On 2026-10-09, [hosted Ubuntu run 37935917355](https://github.com/tanmaydatta/chole-bhature/actions/runs/37935917355)
passed both `verify` and `local-e2e` on the reviewed [harness commit 0974eb77](https://github.com/tanmaydatta/chole-bhature/commit/0974eb77df181e02f9d23788df07c93f1c609986)
in [PR #21](https://github.com/tanmaydatta/chole-bhature/pull/21). The full suite
passed all six tests with two workers in 42.6 seconds, with no failures, skips,
flaky results or retries; the independent-stack case took 16.8 seconds.
Before and after the suite, numeric summaries reported zero workerd processes
and threads, and no orphan workerd termination was reported. This satisfies
the hosted gate for that commit; the original native cause remains unproved,
and one green run does not prove the flake is eliminated.

The earlier [hosted Ubuntu run 37911292536](https://github.com/tanmaydatta/chole-bhature/actions/runs/37911292536)
passed baseline `verify` and five of six E2E tests. The independent-stack case
failed when the Operator runtime stopped before readiness; its retry timed out.
That failed run did not satisfy the hosted gate. The preceding [run 37911132214](https://github.com/tanmaydatta/chole-bhature/actions/runs/37911132214)
was cancelled after the same-PR documentation push `b851c53`, demonstrating
superseded-run cancellation.

The subsequent local harness check on 2026-10-09 passed all 21 focused
configuration/ownership/privacy cases and all 192 E2E unit-package cases.
Semantic regression tests first demonstrated abandoned temporary resources,
failure to await late peers/cleanup, lost early native hints and credential-shaped
log reflection; the implementation then passed those tests. The full local suite
passed all six tests with two workers in 23.4 seconds (24.14 seconds for the
command), with no skips or retries. Independent review then passed the exact
reviewed source's full local suite in 20.1 seconds, with two workers and no
skips or retries. These are macOS results using the pinned runtime and CI
Chromium settings, separate from the successful Ubuntu result above; neither
claims to prove the original native fault fixed.

On 2026-10-09, the full managed-local baseline passed six tests with two workers
in 27.5 seconds, with no skips or retries, using Node 22.18.0, pnpm 11.14.0 and
the lockfile-pinned Chromium. A fresh checkout first required the workspace build;
the restricted local sandbox also required permission to bind loopback servers.
Neither setup failure executed a behavioral test.

The initial CI milestone's final local run with `CI=true` and pinned Chromium passed all six tests
with two workers in 22.1 seconds (22.88 seconds for the command), with no
failures, skips or retries. A temporary product UI regression rendered a
250% summary instead of 25%; the unchanged browser test failed on its exact
GBP 15.00 summary assertion after saving. The product file was restored
byte-for-byte before the full passing run. This is macOS local evidence with
CI settings; hosted Ubuntu execution is reported by the PR check.

Local CI does not certify deployed Worker versions/bindings, remote D1 migration
state, staging secrets, HTTPS/passkey policy, live Access, invitation/email
delivery, production behavior or deployment/teardown. Staging remains an
owner-run manual acceptance step after an approved deployment, using an ordinary
private root passkey session, the cross-Worker capability/migration handshake,
the full applicable suite and scoped cleanup.

Disposable cloud PR stacks and guarded upload remain paused, unfinished,
unadopted and unverified. The unresolved provider boundaries remain service
binding remapping, the asset/session target name, upload hash semantics and
asset completion scope. Local routing checks establish no live provider
ownership, GitHub freshness, cloud binding graph, Access policy, HTTPS cloud
passkey login, two-cloud-stack isolation or remote teardown; `cloud-ci` remains
unavailable. This workflow creates no cloud deployment.

## Related

- [End-to-end test workspace](../../tests/e2e/README.md).
- [GAP-030/031 automated end-to-end verification](gap-030-031-e2e.md).
- [Staging Worker operations](../integration/staging-operations.md).
- [Per-PR Cloud E2E pilot ledger](per-pr-cloud-e2e.md).
