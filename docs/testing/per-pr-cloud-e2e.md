# Per-PR Cloud E2E pilot ledger

**Baseline recorded:** 2026-09-30
**Status:** Local baseline, Tasks 1–4 guard foundation, and the approved
2026-10-01 Task 5a/5b mock-only Beta protocol and controller slices are
complete. The separately approved 2026-10-02 raw-module packaging correction
and its metadata-based review fix are validated locally and independently
reviewed. The existing Notion mirrors were narrowly synchronized on 2026-10-02.
The separately approved 2026-10-05 Task 5e candidate diagnostics are implemented
and validated locally. Initial review found shared D1 IDs in the isolation
fixture; its test-only correction `e0ce221` passed independent scoped re-review
with no open findings. The four existing Notion destinations were narrowly
synchronized on 2026-10-05, with complete readbacks and all 17 index child
URLs/titles/order and active metadata preserved. Full Task 5/live gates remain
incomplete. The bounded 2026-10-05 provider-contract investigation at `ea8620f`
passed independent review; its nonblocking retained-version clarification is
incorporated in the closing proposal. Reviewed nonsecret conclusions were
narrowly synchronized to the four existing Notion destinations, with exact
complete readbacks and all 17 ordered native child links/active metadata
preserved and independently verified by root. No supported race-safe Operator
upload path was established; the conditional writer-boundary proposal and
provider/account-proof gates remain unadopted and require later approval.
Closing status-note review of `eb72ae5` is complete: spec compliant / quality
Approved, with no findings (`task-5f-notion-sync-review.md`). The
[clarification request](#cloudflare-clarification-request-draft-2026-10-05)
is a local unsent draft; no ticket or channel is selected, and no provider
response is pending. This draft has not been synchronized to Notion.
Public Worker mutations
remain disabled; the local evidence is not an approved Cloudflare
pilot, deployment, credential change, or every-push workflow. The separately
approved 2026-10-06 [local exact-D1 bootstrap safeguards](#local-exact-d1-root-bootstrap-2026-10-06)
are implemented, locally verified and independently accepted at `07af8ed`;
both Important review findings are addressed. Full deployed
Task 6b certification remains deferred. The separately approved reviewed
nonsecret summary is now mirrored, as recorded in the
[bootstrap synchronization ledger](#reviewed-local-bootstrap-status-synchronization-2026-10-06);
newer local sections are not reproduced wholesale.

The separately approved 2026-10-07 accumulated-checkpoint correction implements
the four Important ordinary-client/discovery findings and reconciles the
canonical roadmap. Independent scoped re-review is complete and root accepted
the bounded local correction. Earlier accepted source `07af8ed` and documentation
`4d6df6a`/`3ba5c14` retain their dated provenance. The reviewed nonsecret
checkpoint summary was published on 2026-10-07, as recorded in the
[checkpoint publication ledger](#reviewed-local-checkpoint-publication-2026-10-07),
and closes no live gate.

## Local passkey bootstrap extraction (2026-10-08)

**Status:** Bounded Task 7b is implemented and locally tested; independent task
review passed on 2026-10-08 for this local scope. The merged `dev` base is
`8c63e55`, with the same tree as accepted
Task 7a source `e254426`. Full Task 7, deployed Task 6b and all live gates remain
incomplete. Public Worker writes still refuse transport; automatic cloud
writes remain disabled and live NO-GO is unchanged.

Managed-local setup keeps its existing real CDP virtual WebAuthn authenticator,
activation UI, recovery-code acknowledgement and passkey sign-in. Its root
email is chosen before the local CLI call. The CLI's strict pending-root result
supplies both the activation grant and independently expected root user ID;
the server session supplies neither the expectation nor an invented email
field. Before serialization, the same browser context must receive HTTP 200,
the strict session schema, that exact user ID, root role and solely `passkey`.
Fixture, recovery, magic-link, mixed methods, malformed sessions, HTTP errors
and redirects refuse. Origins must be exact canonical HTTP localhost or
127.0.0.1 origins with an explicit valid port.

State stays in memory until owned browser/context cleanup succeeds. Publication
creates a random sibling temporary file exclusively with mode 0600, writes,
syncs and closes it, then hard-links the complete file exclusively to the
destination. Existing output files, symlinks and directories are preserved;
rejected validation/serialization/publication leaves no final state artifact.
Owned unpublished temporaries are removed. If temporary unlink fails after
successful publication, the valid output still counts as success and the
owning local stack's private-directory cleanup handles the residual private
temporary. Filesystem crash/cleanup-failure recovery is not certified.

The 54 new browser-free Vitest cases use actual ephemeral loopback HTTP,
Playwright's real request context and actual filesystem outcomes. Only the
browser snapshot boundary is substituted. Real Chromium/WebAuthn belongs to
local Playwright. Its existing two-stack case additionally restores both saved
files into fresh browser contexts, validates exact independently expected
root/passkey sessions, checks mode 0600 and signed-in UI, and retains both
cross-state refusals. No additional stack is launched for these positive checks;
all six existing business, isolation, cleanup and controlled-routing cases
retain their full assertions and the two-worker runner.

**Table — Local extraction verification**

| Boundary or command | Result |
|---|---|
| Semantic RED / initial GREEN | 49 intended assertion failures / five positives among 54 cases before safeguards; strengthened RED asserts actual unwanted files. Initial GREEN: 54/54, 498 ms. |
| Stable pre-lint-correction full project suite | `pnpm -r --workspace-concurrency=1 test`: 103 Vitest files / 1,726 cases, zero failures/skips/warnings; Identity retains 221 Worker and 91 Node-config cases, E2E 173 browser-free cases. Log-write span 70.364 s. |
| Final covering E2E unit suite | 16 files / 173 cases, zero failures/skips/warnings, 921 ms after the narrow cleanup control-flow correction. |
| Final root and shared-key Node regressions | Root script suites 9/9, 1,094.46 ms; cloud key/live-run guard fixtures 9/9, 45.74 ms. Inputs are controlled fixtures; no credentials or authenticated live calls. |
| Final `pnpm build`, `pnpm lint` | Both exit 0; log-write spans 12.434 s / 0.910 s. Existing dashboard chunk-over-500-kB and two Fast Refresh warnings remain; the new `no-unsafe-finally` warning is fixed. |
| Full final local Chromium Playwright | One serialized final run: 6/6, zero failures/skips/retries, 24.2 s, two workers. Strengthened two-stack test 9.0 s; exactly three existing colour-environment warnings remain. |

The first lint found a new `no-unsafe-finally` warning plus the two existing
dashboard Fast Refresh warnings. The stable full project run finished before
the narrow warning correction; its source provenance is retained separately
from final covering checks. No cases were added beyond the original 54.
Pinned Node 22.18.0/pnpm 11.14.0, Corepack networking disabled and locked
dependency verification are used without installs. Root's initial baseline
sandbox failures were loopback `EPERM`/timeouts, not semantic RED; its local-only
retry passed 119/119. Raw logs and fresh browser output preserve earlier evidence.

This helper adds no cloud target/login or Access wiring, and changes no global
Operator client semantics or application contracts. The four unresolved
provider blockers remain `service-binding-remapping-unresolved`,
`asset-session-name-target-unproven`, `asset-upload-hash-contract-unproven` and
`asset-completion-scope-unproven`. Local state restoration certifies no provider
ownership, Access policy, deployed graph, HTTPS cloud passkey, two-cloud-stack
pilot, teardown or every-push workflow. No commit, push, deployment, Notion,
credential or live provider operation is part of this slice.

Code references:

- [Local bootstrap and private publication](../../tests/e2e/src/passkey-bootstrap.ts).
- [Managed-local CLI identity and stack lifecycle](../../tests/e2e/src/local-stack.ts).
- [Browser-free semantic failure cases](../../tests/e2e/test/unit/passkey-bootstrap.test.ts).
- [Existing two-stack restored-session integration](../../tests/e2e/test/playwright/local-stack.api.spec.ts).

## Local candidate and Access routing groundwork (2026-10-08)

**Status:** Bounded Task 7a local groundwork is implemented and locally tested;
independent task review passed on 2026-10-08. Acceptance covers this local scope.
Full Task 7 remains incomplete, public Worker writes still refuse
transport and automatic cloud writes remain disabled. The merged `dev` base
is `218bc2a`; earlier checkpoint/source/publication evidence retains its dates.

The candidate requires strict plain own-data records, all six existing run-key
fields matching an independently supplied current-run expectation, and exact
distinct run-derived HTTPS API/Operator origins under the expected account
subdomain. The existing key parser and resource-name digest are reused.
Frozen candidate data establishes syntax and tuple consistency only; caller
expectations do not establish live GitHub freshness, provider ownership,
verified bindings, Access receipts or deployment authority. The executable
configuration still admits only local/staging and refuses `cloud-ci`.

Access credentials are snapshotted before context creation and applied only
per dispatched HTTP request. Dedicated API/browser contexts refuse foreign,
Identity, alternate-preview and other-run destinations before transport.
Case-insensitive existing Access headers, malformed/control-containing input,
Host/authority spoofing and reflection failures refuse without input-bearing
errors. API caller Host headers are unsupported; any browser Host must match
the request URL. Browser contexts are fresh with service workers blocked.
All 3xx responses refuse with automatic redirects disabled, including
same-origin redirects; no redirected response is fulfilled to the browser.
Context disposal closes its dispatch lifetime. WebSockets, malicious test-code
exfiltration and future authentication redirect semantics are not covered.

Synthetic fixture hostnames reach only an allowlisted ephemeral loopback
TLS/CONNECT fixture. Actual Playwright HTTP and Chromium routing deliver
headers to an independent local receiver; foreign/redirect/spoof negatives
require zero receiver requests. Test-only proxy/TLS settings are absent from
production helpers. These local results prove no real Cloudflare Access
policy, HTTPS deployment or cloud passkey behavior. Browser coverage belongs
to a separate local-only Playwright case; the original five business,
isolation and cleanup cases retain their exact assertions.

**Table — Fresh local groundwork verification**

| Boundary or command | Result |
|---|---|
| Semantic RED/GREEN | Candidate consistency: 40 intended failures before validation, then 46/46 with the existing platform cases. Access policy: 34 intended failures/one positive before guards, then 75/75 with candidate cases. Real API/browser transport and redirect guards each produced two intended failures before correction. Foreign dispatch/Host/reflection regressions produced four intended failures, then focused 86/86 before browser runner placement. |
| Serialized full CI package coverage | `pnpm -r --workspace-concurrency=1 test`: 102 Vitest files / 1,672 tests, zero failures/skips, including Identity's 221 Worker plus 91 Node-config cases and E2E's 119 browser-free unit cases. Counts are summed from this run's package summaries. |
| Root and shared-key Node regressions | The two root script suites pass 9/9; cloud key/live-run guard fixtures pass 9/9. Their GitHub/provider inputs are controlled fixtures, not authenticated live calls. |
| `pnpm build`, `pnpm lint` | Both exit 0. Existing dashboard chunk-over-500-kB and two Fast Refresh warnings remain; no new final lint warning. |
| Full local Chromium Playwright | One full serialized run after other checks: 6/6, zero failures/skips, 22.9 s with two workers. Original five business/isolation/cleanup cases plus the local-only routing case (681 ms). Existing colour-environment warnings remain. |

Checks use pinned Node 22.18.0/pnpm 11.14.0, Corepack networking disabled and
locked-dependency verification, with no installation or upgrade. Initial local
transport and project sandbox attempts encountered loopback/Wrangler-log
`EPERM`; those environmental failures are separate from semantic RED. Test
listener errors now reject promptly. Approved local-only retries pass.
The root script's nested recursive command did not inherit the outer workspace
concurrency option, so final CI coverage runs the recursive package command
directly with concurrency one, followed by both root Node suites separately.
Raw logs and a new private Playwright output directory preserve older evidence.
Initial build test-fixture type errors and the intermediate control-regex lint
warning were corrected before the final source checks. No staging/provider,
credential, workflow or deployment operation occurred.

Code references:

- [Candidate validation](../../tests/e2e/src/cloud-target.ts) and
  [candidate negative cases](../../tests/e2e/test/unit/cloud-target.test.ts).
- [Scoped HTTP contexts](../../tests/e2e/src/cloud-access.ts) and
  [policy/API transport cases](../../tests/e2e/test/unit/cloud-access.test.ts).
- [Controlled local browser coverage](../../tests/e2e/test/playwright/cloud-access.browser.spec.ts).

## Reviewed local checkpoint publication (2026-10-07)

**Status:** The independently reviewed local checkpoint and bounded guard
correction are mirrored as a nonsecret current-status summary in the four
existing [roadmap](https://app.notion.com/p/3a6e5c7c2b8e81f6b412c45a2bc7b344),
[design](https://app.notion.com/p/3ebe5c7c2b8e8186866ef1e158bfd880),
[plan](https://app.notion.com/p/3ebe5c7c2b8e81229ee0d8a0acb2d309) and
[Plans index](https://app.notion.com/p/390e5c7c2b8e8165b7f7d77392eab088)
destinations. Each bounded replacement passed complete fresh readback equality
to its precomputed whole-page expected string, with no normalization or
formatting exception. All other page content and all 17 ordered native child
URLs/titles were preserved; all four destinations and 17 children remain
active with matching metadata. Root independently verified the complete
readbacks and native-child preservation before this publication provenance
update.

The summary identifies tested source `9408704`, independent correction review
of `3ba5c14..3da30f3` and local closing documentation `3c04e95`: I1–I4/M1 are
addressed, with zero open Important findings and no new findings in the scoped
correction. The [correction evidence](#checkpoint-lifecycle-and-creation-correction-2026-10-07)
belongs to that source freeze; this publication and its matching documentation
rerun no unchanged source suite. The 2026-10-06 `07af8ed`/`4d6df6a`/`3ba5c14`
bootstrap publication remains dated history.

Only reviewed nonsecret status was published. The clarification draft remains
unsent, and neither its body nor wholesale local evidence was synchronized.
M2–M5 remain deferred. Provider/Operator contracts, protected configuration,
remote D1 atomicity, deployed graph, cloud HTTPS/passkey/full-suite/two-stack
proof, complete teardown/reconciliation and every-push execution remain
pending. Public Worker writes refuse transport and automatic cloud writes
remain disabled. No full Task 5/deployed Task 6b/Tasks 7–10 completion or live
acceptance follows; prerequisite/clarification work requires separate approval.

## Checkpoint lifecycle and creation correction (2026-10-07)

**Status:** Reviewed and locally accepted at tested source `9408704`.
Independent scoped re-review of `3ba5c14..3da30f3` is COMPLIANT / APPROVED:
I1–I4 and M1 addressed, 0 open Important findings and no new findings
(`checkpoint-fix1-review.md`). The 2026-10-07 accumulated review of `3ba5c14` found 0 Critical,
4 Important and 5 Minor findings. The bounded correction addresses I1–I4
in the ordinary client and discovery contracts, plus M1 current-roadmap drift.
It adds no provider executor, live recovery flag or distributed lock.

**Table — Ordinary client lifecycle authority while healthy**

| Operation | Permitted inventory stages | Remaining identity requirement |
|---|---|---|
| Read-only lists and exact reads | `creating`, `active`, `quarantined`, `deleted` | Existing exact-target and complete-list guards |
| D1, Access application or service-token creation | `creating` | Durable exact-name intent, fresh exact result and successful ID checkpoint |
| Ordinary D1 SQL | `creating`, `active` | Recorded exact UUID and current identity readback |
| Exact D1, Access application or token cleanup | `creating`, `active`, `quarantined` | Existing exact identity and adopted binding/policy proof |
| Public Worker create/update/delete/subdomain | None | Unsupported, zero transport |

A poisoned client makes no subsequent transport call and cannot bootstrap.
Every ambiguous Access/token POST transport, envelope, identity, validation,
clock or persistence outcome irreversibly poisons that client and revokes its
Auth creation context. Unknown resources are neither retried nor guess-deleted.
Healthy quarantined inventory still permits proven exact-ID cleanup; deleted
inventory cannot authorize mutation.

One client-wide creation reservation covers D1, Access and token slots before
the first discovery/intent/builder/checkpoint await. Same-client same-slot or
sibling overlap refuses; after durable completion, sequential sibling retry
uses the latest inventory and preserves earlier IDs. Separate clients/runs
remain independent. The reservation is process-local only: it supplies no
store CAS, cross-process ownership, crash recovery or provider locking.
The token builder accepts only a plain object with one own field, `name`, equal
to the controller-derived token name, before POST. Extra provider fields are
unadopted; no new provider request schema is certified.

Terminal discovery preserves validated `quarantined`/`deleted` stage, IDs and
timestamps without provider reads, recovery or persistence. Creating/active
discovery reads every returned resource, including recovered IDs: exact Worker
listed name/tag and current bindings, exact D1 name/UUID, exact Access name/ID
and adopted destination/policy graph, and exact token name/ID. Missing or
substituted recorded resources refuse. Missing-ID recovery still requires a
unique durable intent and independently matching controller audit evidence.
A fully verified creating inventory may become active; an incomplete active
inventory may become creating. Every recovered ID or legitimate stage change
requires a successful durable checkpoint before return. Unchanged discovery
preserves timestamps and needs no save. These local legacy discovery reads
do not establish a Beta recovery adapter or live ownership proof.

**Table — Fresh pinned-Node-22 correction evidence**

| Command or boundary | Result |
|---|---|
| Original semantic I1–I4 RED | 12 tests: 11 expected assertion failures / one independence positive, 53.78 ms. Terminal revival, missing transition persistence, terminal transport, malformed-result reuse, overlap acceptance and wrong-name token POST were reproduced before production edits. |
| Supplemental I1 RED | Recovered Access graph: one expected assertion failure, 49.44 ms; foreign listed Worker name with recorded tag: one expected assertion failure, 44.19 ms. Each was captured before its correction. |
| Focused iteration GREEN | 67/67 before final cross-slot/name regressions, 80.10 ms. Deferred discovery/intent/checkpoint barriers, all post-POST failure variants, bootstrap revocation, exact quarantine cleanup, recorded readbacks and audit recovery pass. |
| `node --test scripts/cloud-e2e/*.test.mjs` | Final source/test freeze: 337/337, zero failures/skips/cancellations, 2,898.94 ms (2.94 s shell). |
| Affected syntax/lint | Both `.mjs` production syntax checks and four-file oxlint exit 0; focused lint 0.25 s shell. Project build covers the unchanged typed bootstrap consumers. |
| Serialized `pnpm test` | 100 Vitest files / 1,683 tests (1,592 main-config plus 91 Identity Node-config Vitest cases), plus nine separate Node script tests, zero failures/skips, 67.57 s shell. Identity retains 221 Worker and 91 Node-config cases, including eight real D1/bootstrap runner cases. |
| `pnpm build`, `pnpm lint` | Exit 0, 11.92 s / 0.99 s shell. Existing dashboard chunk and two Fast Refresh warnings remain. |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` with a fresh output directory | One serialized full run after tests/build/lint: 5/5, zero failures/skips, 23.4 s (24.18 s shell), two workers; three existing colour-environment warnings. Exact GAP values, persistence/redemption/retry, concurrent scenario isolation, failed-scenario disposal, browser authoring/publication and two independent local bootstrap instances retain their original assertions. |

Commands use explicit Node 22.18.0/pnpm 11.14.0, the Node bin first in child
PATH, Corepack networking disabled and project-script locked-dependency
verification. The full project command sets workspace concurrency to one.
Its initial sandbox attempt stopped before Identity assertions with loopback
`EPERM` (2.06 s); the scoped local-loopback/log retry passed. Both captures are
retained. No installation, configuration/dependency change or real provider
call occurred. Full new logs are retained under ignored
`.superpowers/sdd/2026-09-30-per-pr-cloud-e2e/checkpoint-fix1-logs/`;
historical captures remain untouched.

Fresh aggregate counts include Identity's separate Node-config Vitest run;
the nine Node script tests use `node:test` separately. Earlier dated aggregate
counts below retain their originally recorded historical values and have not
been recertified by this correction.

The verification above belongs to source/test freeze `9408704`; `3da30f3`
corrected fresh documentation counts only. These review-closure notes rerun
no unchanged source suite. Acceptance covers the bounded local correction,
not a fresh whole-branch audit, remote/Notion state or provider/live proof.

M2 long tar-name handling, M3 partial extraction residue, M4 JSON object-order
false refusal and M5 missing sanitized operation/stage diagnostics remain
explicitly deferred. Dashboard chunk/Fast Refresh and browser colour warnings
remain unchanged; historical `SQLITE_BUSY` cause is unproved. Authenticated
protected configuration, remote D1 atomicity, deployed service/version/D1/
Access/assets graph, cloud HTTPS/passkey/full-suite/two-stack proof, complete
teardown/reconciliation and every-push workflow remain separate live gates.
The 2026-10-06 Notion synchronization retained in the historical ledger below
is not fresh publication or acceptance of this correction.

Code references:

- [Ordinary client lifecycle, reservations and poisoning](../../scripts/cloud-e2e/cloudflare.mjs).
- [Discovery readback and durable transitions](../../scripts/cloud-e2e/inventory.mjs).
- [Client semantic and deferred-boundary regressions](../../scripts/cloud-e2e/cloudflare.test.mjs).
- [Terminal, recovery, graph and persistence regressions](../../scripts/cloud-e2e/inventory.test.mjs).

## Guarded application CI admission (2026-10-06)

**Status:** Task 6a is implemented and locally verified. Initial independent
review required CI selection-cookie parity and shared Identity service
admission; the approved bounded fix at `736e213` passed independent fix-only
re-review with all findings addressed and no new Critical/Important breakage
(`task-6a-fix1-review.md`).
The bounded change admits trusted controller-generated CI
application configuration. Task 6b full deployed-graph/bootstrap
certification, full Task 5, cloud browser/passkey acceptance and Tasks 7–10
remain incomplete. Public Worker writes still refuse transport, all four
provider blockers remain, and no deployment or every-push workflow is enabled.
Reviewed nonsecret Task 6a status was narrowly synchronized to the four
existing Notion destinations on 2026-10-06. Complete whole-page readbacks
matched only the approved substitutions, with all 17 ordered native index
child links and active metadata preserved. This is a summary/status sync;
newer local implementation sections were not reproduced wholesale. The
clarification draft remains local and unsent; its request body was not published.

**Table — Runtime CI configuration contract**

| Configuration | Required value or behavior |
|---|---|
| Mode/marker | `APP_ENV='ci'`; `CI_STACK_KEY` is the existing 20-lowercase-hex resource digest. A supplied expected marker must have that format and match exactly. A marker in any non-CI mode rejects. |
| API origin | Canonical `https://cb-e2e-${marker}-api.<account-label>.workers.dev`, with exactly one valid account label. |
| Identity/Operator origin | Canonical `https://cb-e2e-${marker}-operator.<account-label>.workers.dev`. Identity `PASSKEY_RP_ID` equals that hostname. |
| Origin exclusions | Reject credentials, query/fragment, trailing slash or other path, explicit port spelling, HTTP, localhost, custom/staging domains, wrong role and foreign marker. |
| Local test switch | `E2E_LOCAL_TEST_MODE` must be absent, including values `'0'` and `'1'`. |
| Identity email/secrets | `EMAIL_MODE='local-capture'`, `STAGING_ALLOWED_RECIPIENTS` parses as an empty array, direct `AUTH_SECRET`; no Resend values or Auth/Resend Secrets Store bindings. |
| API/Operator secrets | Direct `DECISION_SIGNING_SECRET` and `OPERATOR_SELECTION_SECRET`; Operator's store binding must be absent. Each direct secret has at least 32 nonblank trimmed characters. |
| Binding shape | API `DB` and Identity `AUTH_DB` expose `prepare` and `batch`. Identity `CORE`, Operator `IDENTITY`/`CORE` expose their consumed RPC methods; `IDENTITY_AUTH`/`ASSETS` expose `fetch`. Validation calls no binding method. |
| Root merchant selection | CI uses staging-equivalent `__Host-incentives-operator-selection` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/` and no Domain attribute. Signing, live-session association and eight-hour expiry remain; local cookie policy is unchanged. |

The digest is
`sha256(JSON.stringify([repository_id, pr, head_sha, run_id, attempt])).slice(0,20)`.
It is nonsecret configuration, not authentication or provider proof. Parsing
the origin naming convention does not prove that the account label is trusted,
that all apps share the controller's account, that a hostname is owned or
protected, or that bindings point at the intended remote IDs. Shape validation
cannot prove secret entropy or uniqueness. The future controller must certify
those identities, graph and Access properties independently before deployment/use.

Each app owns a small typed validator with no I/O or cached authority.
Validation precedes affected fetch/RPC behavior, secret getters, email delivery,
forwarding and E2E writes. Identity fixture, lifecycle and organization service
boundaries share one Identity-local association contract requiring the full environment and matching local database/mode
association; a bare CI mode or allow boolean grants no admission. Database
object association is a local consistency check, not exact remote-D1 proof.
Ordinary local/staging behavior, root/passkey/recovery rules and explicit local
lifecycle semantics remain; ordinary local fixture creation remains prohibited.

Real local Worker/D1 checks cover root-gated capabilities, proof-bound tenant
provisioning/recorded claims, active run-scoped fixture users/roles, signed
member sessions restricted to their owned tenant, immutable 900000 ms fixture
expiry, local employee magic-link capture, proof refusal, Product-then-Auth
disposal/audit/zero rows and idempotent retry. A concurrent signed fixture and
unrelated root survive disposal. The Identity-to-Core boundary uses an exact
hand-checked service fake where separate runtime bindings are unavailable;
Product persistence and disposal are separately exercised in real local D1.
This is not a full deployed graph, real HTTPS cloud passkey or email-delivery
result.

**Table — Dated local verification**

| Command | Result and provenance |
|---|---|
| Focused semantic RED | API 7 pass/1 fail (CI capability denied); Identity 6 pass/1 fail (CI auth denied); Operator 146 pass/1 fail (direct CI secret resolution denied). New helper missing-module failure is separate scaffold evidence. |
| Port regression RED/GREEN | Explicit `:8443` negative: Operator 71 pass/1 assertion failure before correction. Final focused API 43/43 (1.91 s), Identity 80/80 (12.28 s), Operator 228/228 (387 ms) after correction. |
| Three package suites | API 495/495 (9.04 s); Identity 201/201 Worker (30.04 s) plus 84/84 Node (4.23 s); Operator 227/227 (455 ms). These precede the final three additional port cases; final-source whole-project result follows. |
| `pnpm test` | Final source: 100 Vitest files, 1565 tests plus 9 Node tests passed; no failures/skips, 54.49 s shell. API 496, Identity 202 Worker plus 84 Node, Operator 228. The earlier pre-port run passed 1562 Vitest plus 9 Node tests in 59.57 s and remains separate evidence. |
| `pnpm build`, `pnpm lint` | Both final-source commands exit 0 (11.81 s and 0.84 s shell). Build retains the existing dashboard chunk-over-500-kB warning; lint retains two existing Fast Refresh warnings in `Toast.tsx:15` and `ThemeProvider.tsx:9`. |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` | 4 pass/1 failure in 23.6 s (24.77 s shell): local-only simultaneous-stack test stopped before readiness with workerd `SENTRY_DO` SQLite `SQLITE_BUSY`. The GAP, concurrent-run, failure-cleanup and browser-authoring tests passed. |
| Focused local-stack Playwright retry | 1/1 passed in 19.9 s (20.58 s shell; test 7.6 s), after other task tests completed, with separate evidence output and unchanged test/infra source. |

The initial full Playwright run overlapped local whole-project tests/build.
Distinct temporary stack state paths were confirmed; the successful focused
retry establishes an intermittent runtime-startup failure, not its cause or
a fix. The original failed run, diagnostics and retry results are retained.
No test was deleted, skipped or weakened. Earlier iteration failures were
also retained: fixture cleanup needed foreign-key-safe ordering, and an
existing API source-composition assertion required the app declaration before
the RPC class. Final corrected regressions pass.

Checks use Node 22.18.0 and cached pnpm 11.14.0 with
`pnpm_config_verify_deps_before_run=error`; no dependency/browser installation,
staging contact or remote write occurred. Local Worker loopback/Wrangler-log
permission was used. Full local logs live in ignored task evidence; earlier
Task 5 test counts and historical project/packaging evidence retain their
original provenance.

Code references:

- Marker derivation: [key.mjs](../../scripts/cloud-e2e/key.mjs).
- Runtime guards: [API](../../apps/api/src/ci-stack.ts), [Identity](../../apps/identity/src/ci-stack.ts), [Operator](../../apps/operator-web/src/ci-stack.ts).
- Runtime lifecycle/provenance: [Product tests](../../apps/api/test/e2e-lifecycle.test.ts), [Identity fixtures](../../apps/identity/test/e2e-fixtures.test.ts), [Identity lifecycle](../../apps/identity/test/e2e-lifecycle.test.ts).
- Local email and BFF: [Identity auth tests](../../apps/identity/test/auth.test.ts), [Operator BFF tests](../../apps/operator-web/test/bff.test.ts).
- Remaining boundary: [Task 6b](../superpowers/plans/2026-09-30-per-pr-cloud-e2e.md#task-6b-deferred-exact-d1-bootstrap-and-controller-certification).

### CI cookie and shared service admission review fix (2026-10-06)

Initial review identified two Important findings: HTTPS CI root-selection
cookies lacked the staging Secure/host-prefix policy, and the same Identity
service-association guard was duplicated across three services. The approved
fix gives CI and staging identical browser cookie restrictions while retaining
local behavior, and consolidates Identity's contract without caching admission
or changing each operation's local/staging/CI rules. Independent fix-only
re-review of `736e213` is complete: I1/I2/M1 addressed, M2 documented/deferred,
no new breakage (`task-6a-fix1-review.md`). The separately approved narrow
reviewed-status synchronization is complete; its scope and verification follow.

The CI BFF regression performs root merchant selection, asserts the literal
cookie name/attributes and uses the signed returned cookie on a protected
credential operation with the exact selected-root context. Identity
characterization mutates database, mode, local flag, marker or full environment
after service construction; fixture creation, lifecycle preview/disposal and
organization principal/provisioning refuse before session/Core/foreign-D1 calls,
with real Auth D1 claims, tenant rows and root session retained.

**Table — Review-fix local verification**

| Command | Result |
|---|---|
| Operator BFF semantic RED | 148 pass/1 expected assertion failure (588 ms): CI emitted the local unprefixed cookie. |
| Identity pre-extraction characterization | 79/79 passed (10.33 s); association tests established existing behavior before refactoring. |
| Focused GREEN | Operator BFF 149/149 (460 ms); Identity helper/fixture/lifecycle 84/84 (9.20 s). Both affected app typechecks exit 0. |
| Final project test/build/lint | 100 Vitest files/1581 tests plus 9 Node tests passed, zero failures/skips (55.59 s shell). Build and lint exit 0 (11.80 s/0.89 s); existing dashboard chunk and two Fast Refresh warnings remain. |
| Serialized local Chromium Playwright | One full run: 5/5 passed (22.8 s, 23.53 s shell), after other checks completed. A separate output directory preserved original failure artifacts; no retry, E2E/infra source change or cause/fix claim. |

These fix-round results are separate from the original full Playwright
4-pass/1-startup-failure and unchanged isolated 1/1 retry above. The original
`SQLITE_BUSY` cause remains unproved. Existing dashboard build/Fast Refresh and
Playwright colour warnings remain outside scope; no cloud/provider, exact-D1,
bootstrap or every-push gate is closed by this fix.

Code references:

- Selection policy and BFF consumer: [session.ts](../../apps/operator-web/src/session.ts), [BFF tests](../../apps/operator-web/test/bff.test.ts).
- Shared service association: [Identity validator](../../apps/identity/src/ci-stack.ts), [fixture tests](../../apps/identity/test/e2e-fixtures.test.ts), [lifecycle/organization tests](../../apps/identity/test/e2e-lifecycle.test.ts).

### Reviewed-status mirror synchronization (2026-10-06)

The earlier Task 6a canonical nonsecret status identifies reviewed source `736e213`
and closing documentation `f8f6dbf`, retains the 1,581 Vitest plus 9 Node and
5/5 local Playwright results above, and explicitly leaves the historical
`SQLITE_BUSY` cause, warnings and all provider/deployed/cloud gates unresolved.
Source and closing-note reviews are complete (`task-6a-fix1-review.md`,
`task-6a-closing-notes-review.md`); this publication ran no new code suite.

Only the existing [roadmap](https://app.notion.com/p/3a6e5c7c2b8e81f6b412c45a2bc7b344),
[design](https://app.notion.com/p/3ebe5c7c2b8e8186866ef1e158bfd880),
[plan](https://app.notion.com/p/3ebe5c7c2b8e81229ee0d8a0acb2d309) and
[Plans index](https://app.notion.com/p/390e5c7c2b8e8165b7f7d77392eab088)
received narrow nondeleting, unique-anchor additions on 2026-10-06. Every
complete readback matched its original whole page plus the exact approved
addition, without whitespace normalization or a formatting exception.
All 17 native child URLs, titles and order remain unchanged, with all children
and four destinations active. Existing content and history were preserved.

This summary/status synchronization is not wholesale reproduction of the
newer local implementation sections. The clarification request body remains
local and unsent. At that Task 6a publication, Task 6b, provider and deployed-
graph/Access proof, cloud passkey/browser acceptance, teardown and every-push
gates remained pending;
public Worker writes still refuse transport. No push or deployment is implied.
The later [bounded local bootstrap synchronization](#reviewed-local-bootstrap-status-synchronization-2026-10-06)
updates current Task 6b status while preserving this Task 6a publication history.

## Local verification baseline

The commands below were run from the `feat/per-pr-cloud-e2e` worktree. The
first sandboxed Worker-backed run could not bind `127.0.0.1` or write a local
Wrangler debug log, so it stopped before assertions. The same local-only
commands were rerun with that local permission and passed; no remote
Cloudflare operation was run.

| Command | Result | Measured time / count |
|---|---|---|
| `pnpm install --frozen-lockfile` | passed; lockfile already satisfied | 168 ms |
| `pnpm build` | passed | 13.168 s wall time |
| `pnpm lint` | passed (two existing dashboard fast-refresh warnings) | 3.846 s wall time |
| `pnpm test` | passed | 97 Vitest files / 1,395 assertions, plus 9 Node assertions; about 52 s from first workspace test start through the final Node suite |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` | passed | 5 Playwright tests in 24.4 s (25.258 s shell wall time) |

The local test command's package counts were: contracts 120; engine 71;
connector kit 43; operator web 152; E2E unit suite 39; Identity browser suite
146; Identity Node suite 82; module kit 11; dashboard 252; Promo 19; and API
460. The two Node script suites add 9 assertions. The slowest reported Vitest
package duration was Identity's browser suite at 24.59 s; dashboard reported
6.37 s and API 6.95 s.

Playwright used its pinned Chromium after installing it because it was absent
from the local Playwright cache. Its five passing tests were:

1. exact GAP-030/031 authoring, evaluation, signed redemption, and retry;
2. two concurrent run-scoped scenarios without tenant cross-talk;
3. cleanup after an intentionally failed scenario;
4. browser authoring, persistence, and publishing of the capped Promo; and
5. the **local-only** simultaneous-stack test. The last test proved two local
   bootstraps had distinct origins/directories, healthy Operator responses,
   distinct root sessions, and isolated Auth D1 state; it took 8.7 s.

## Assertion inventory retained for cloud E2E

The future cloud target must preserve these assertions from the existing suite;
a status-only probe is not equivalent coverage.

| Area | Exact assertion inventory |
|---|---|
| GAP pricing | The cart has original merchandise subtotal 10,001 minor units. A 25% order discount is capped at 1,500 and the matching-line fixed discount is 500 per unit: 500 on `duplicate_line_1`, 1,000 on `duplicate_line_2`, and 0 on `other_line`. The asserted total discount is **3,000** and discounted merchandise subtotal is **7,001**. Program/rule ordering is capped-quarter then five-per-unit. |
| Published configuration | Both run-scoped Promos are read back active after publication. Their stored active rewards retain the 2,500 basis-point / 1,500-minor-unit cap and the 500-minor-unit matching-product rule. |
| Evaluation and receipt | Evaluation decisions and the full price breakdown equal the exact expected breakdown. Redemption retains the evaluation ID, full breakdown, ordered program/rule entries, and is inspected with `integrityVerified: true`; the inspected redemption result equals the original result and has `receiptIntegrityVerified: true`. Inspection also checks each Promo at one use, 1,500 committed spend, and 3,500 budget remaining. |
| Idempotency | Retrying the identical redemption request returns a deep-equal redemption. Reusing its idempotency key with a changed external order is rejected as `409 VERSION_CONFLICT`. |
| Managed local-stack passkey bootstrap | During local stack setup, CDP enables WebAuthn and adds a virtual CTAP2 authenticator with resident key and verified user support. The browser opens root setup, submits the activation grant, creates the root passkey, requires the `Save your root recovery codes` heading, acknowledges the codes, finishes setup, chooses `Sign in with passkey`, and requires the `Sign in to Incentives` heading to become hidden. Before exclusive mode-0600 state publication it requires a strict server session for the independently CLI-issued user ID, root role and exactly `['passkey']`. The existing two-stack integration restores both saved files into fresh browser contexts and rechecks exact session identity/method, private mode, signed-in UI and cross-state refusal. This is managed-local coverage only: it is not a staging assertion. The future `cloud-ci` flow must separately prove equivalent real HTTPS passkey registration/sign-in and scoped state handoff on its disposable stack. |
| Browser flow | The actual edit page displays the maximum as `1500`; the test changes it to `1600`, restores `1500`, saves, verifies the GBP 15.00 summary, reloads and verifies it again, reads persisted configuration, confirms the publication dialog, publishes, sees active revision 1, and reads the persisted active reward again. |
| Concurrent and failure cleanup | Concurrent scenarios have different run, merchant, evaluation, and redemption IDs, retain the 3,000 result, and keep each program reference scoped to its own run. The failure scenario creates only its recorded tenant, throws intentionally, and still disposes that tenant. |
| Disposal proof | `withScenarioRun` cleans managed local/staging tenants in `finally`; `assertRunDisposed` requires recorded resources, every resource marked `cleaned`, disposal status for the run, and zero counts for every Product and Auth D1 inventory category. |

The current E2E suite does **not** test real email delivery. The planned
`cloud-ci` target therefore uses per-stack local capture/suppression rather
than claiming a Resend or inbox-delivery result.

## Task 1 build payload and completed Task 3 artifact check

The following `pnpm build` measurements were the Task 1 baseline before the
Task 3 `bundle-v1` artifact existed. They are retained as historical build
evidence; the completed artifact measurement follows the table.

| Payload component | Files / measurement |
|---|---:|
| API Worker entry, `apps/api/dist/worker.js` | 10,315 bytes |
| Identity Worker entry, `apps/identity/dist/worker.js` | 20,337 bytes |
| Operator Worker entry, `apps/operator-web/dist/worker.js` | 28,498 bytes |
| Dashboard assets, `apps/dashboard/dist` | 5 files; 753,670 bytes (736.01 KiB); largest 719,379 bytes |
| SQL migrations, API plus Identity | 14 files; 50,581 bytes (49.40 KiB); largest 19,074 bytes |
| Candidate payload (three entries + dashboard assets) | 8 files; 812,820 bytes (793.77 KiB); largest 719,379 bytes |
| Candidate payload including migrations | 22 files; 863,401 bytes (843.17 KiB); largest 719,379 bytes |

The largest present candidate file is well below the proposed **20 MiB per
file** limit, the largest migration is well below the separate **1 MiB
migration** limit, and the 863,401-byte candidate payload is well below the
proposed **64 MiB total unpacked** limit. No cap change is proposed. Task 3
subsequently built and verified an actual local `bundle-v1`: 22 extracted
files totaling **5,896,852 bytes** in a **5,918,720-byte** `bundle.tar`. Its
round trip and size caps passed the strict local verifier. This validates the
artifact boundary, not Beta version JSON/assets upload compatibility or a
remote deployment.

## Evidence boundary

This ledger contains only local counts, durations, source-derived assertions,
and non-sensitive file sizes. It deliberately contains no credentials, browser
state, run proof, cookie, token, customer payload, raw trace, Worker version,
or Cloudflare resource identifier.

## Worker API feasibility (public documentation, 2026-09-30)

Task 4's reviewed controller and inventory are a guarded foundation. Its
name-addressed Worker create, update, delete, and subdomain methods return
`immutable-worker-mutation-unproven`, alert, and make **zero transport calls**.
The 37 passing local `scripts/cloud-e2e/*.test.mjs` tests prove this refusal
and mock recovery behavior, not that Cloudflare accepts an upload or deletion.
The currently planned `PUT /workers/scripts/{script}` followed by a first
`POST .../subdomain` disable call cannot establish either immutable-ID
targeting or no transient public route. It must not be used for a live pilot.

| Operation | Public API contract / identity | Status and impact |
|---|---|---|
| Discover | [Legacy script list](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/list/) `GET /accounts/{id}/workers/scripts` calls `id` the script *name* and `tag` an immutable script ID. [Beta Worker list](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/list/) lists Worker objects with an immutable `id`. | Documented separately. **No documented equivalence of legacy `tag` and Beta `id` was found**; current `workerIds`/discovery must not be silently reused as Beta IDs. |
| Create | [Beta create](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/create/) `POST /accounts/{id}/workers/workers` accepts JSON `name` and `subdomain:{enabled:false,previews_enabled:false}` and returns immutable `result.id`. | Documented candidate for creating an empty Worker with both URL controls false in the *initial* request. Defaults and actual first-response state need disposable live proof. Persist create intent and returned Beta ID; a lost response needs Beta list/get plus matching audit evidence, else quarantine. |
| Read / configure | [Beta get](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/get/) `GET /accounts/{id}/workers/workers/{worker_id}` returns the immutable ID, name, subdomain settings and references. [Beta edit](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/edit/) `PATCH` changes supplied fields; [Beta update](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/update/) `PUT` is full replacement. `{worker_id}` accepts **ID or name**. | Documented API shape; controller must supply a certified immutable ID and verify response ID. A missing ID refuses; it never falls back to name. Partial PATCH is the proposed route toggle; exact account behavior needs proof. |
| Upload / activate | [Beta create version](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/) `POST /accounts/{id}/workers/workers/{worker_id}/versions` accepts JSON `main_module`, base64 `modules`, bindings, and `assets.jwt`; query `deploy=true` creates a 100% deployment, while omission/false is the staged candidate. Returns a **version UUID**, distinct from Worker ID, and version URLs. | Documented format and `deploy` semantics. Proposed: first create/read back the disabled empty Worker, attach and verify Access, then upload/deploy code by its Beta ID. Never treat a version UUID as a Worker ID. Whether version URLs are reachable before deployment or bypass protection is a live gate. |
| Assets / bindings | [Assets upload](https://developers.cloudflare.com/api/resources/workers/subresources/assets/subresources/upload/methods/create/) is a separate multipart `POST /accounts/{id}/workers/assets/upload` producing a completion JWT for the version. Beta version JSON uses `database_id` for D1 and `secret_text` for direct secrets; its `service` binding names the target Worker. | Documented schema, **unproven** compatibility with this repo's `bundle-v1` Operator SPA and pinned Wrangler 4.112.0 dry-run output. Name-addressed service bindings retain replacement/remapping risk even if the caller is addressed by ID; prove a safe graph/readback or stop. No PR code/config is executed by the controller. |
| Protect / publish | [Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) uses a `worker` destination with `worker_id` to cover production and preview URLs, subject to more-specific hostname/path policies. [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) warns a deployment can re-enable its public route and that disabling `workers.dev` alone leaves version/preview/deployment URLs. | Documented protection scope, but the exclusive Service Auth policy request/GET shape, overrides, account permissions, initial route defaults, propagation and all URL probes need live proof. Attach and verify Access before **any code upload** is the proposed stronger ordering; route enablement only after both apps pass. |
| Delete | [Beta delete](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/delete/) `DELETE /accounts/{id}/workers/workers/{worker_id}` accepts ID or name; `force=true` can break references. | Documented ID-addressable endpoint. Propose certified-ID GET/readback immediately before delete, `force` omitted/false, dependency teardown, mismatch quarantine. ID targeting removes the old name-replacement window for the target; service-binding names, concurrent graph changes and live error behavior remain unresolved. |
| Recover ownership | [Account audit V2](https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/list/) exposes actor token, raw method/URI/status and resource ID fields. | Documented fields; **unproven** that Beta create emits timely entries tying returned Worker ID to the pre-create intent. No checkpoint recovery from a matching name alone. |

### Task 5a mock-only evidence (2026-10-01)

The approved local amendment adds no transport and retains every public Worker
mutation as a zero-call refusal. `InventoryV1` may now carry a separate
`betaWorkerIds` map; a value is accepted only from a mock observation with the
controller-derived name, a 32-lowercase-hex fixture ID, explicit `routes: []`,
and `subdomain.enabled:false` plus `previews_enabled:false`. Missing/unknown
routes, malformed/duplicate IDs, legacy tags, wrong names, public overrides,
and changed IDs refuse. The protocol accepts only fixed, fresh synthetic mock
envelopes correlated to account/run/role: an empty pre-create GET must be
durably checkpointed in `creating` phase, then a single exact ID GET must also
be checkpointed. Opaque receipts from those successful writes—not raw inventory
or caller-supplied flags—are the only planner inputs. A process-local registry,
scoped to the injected evidence-store object and canonical trusted run/role,
reserves each transition before its durable write; differently ordered key
fields for the same logical run share one reservation. Failed reservations
remain fail-closed. This is neither cross-process locking nor store CAS/provider proof. The intent receipt is
single-use for the create plan; an exact synthetic POST create-result and later
same-ID GET readback must agree before the ID checkpoint. Both Access
attachments are separately checkpointed before their later readbacks, and each
prepared planning context expires after five minutes and is single-use.

The pure planners emit the documented create `POST /accounts/{accountId}/workers/workers`,
the ID-only Worker GET/PATCH/DELETE paths, and a version `POST` whose
`deploy:false` is a query field, never body data. The local inert version form
allows only a controller-selected JavaScript module and exact `DB` D1 binding;
it requires both exact token-exclusive API and Operator Access readbacks.
PATCH/DELETE require an opaque context with exact inert Worker/D1 graph, an
empty fixed version-list envelope, and both exact Access envelopes, so changed
route/identity/deployment or unknown graph/version state refuses. This is
synthetic local correlation evidence, not authenticated provider proof or a
claim that Beta Worker GET proves no outgoing bindings or versions; a complete
version-observation adapter and live provider schema proof remain gates.
Service-name binding replacement/remapping returns unsupported, and assets/JWT
remain unsupported. `references.workers` is not used as evidence of an outgoing
binding graph. `node --test scripts/cloud-e2e/*.test.mjs` passed **50/50**;
this proves request/validation behavior and existing zero-call guards only.
Its connected in-memory protocol enforces receipt ordering for request planning;
it is not a transport controller and does not establish provider behavior or
live transition proof.

### Task 5b mock-only identity and Access protocol (2026-10-01)

The follow-up local protocol addresses real create order without future-ID
preseeding. Three disabled empty Worker create intents, plans, POST results,
exact-ID GET readbacks, and ID checkpoints establish separate Beta receipts.
An empty service-token pre-create list and durable, run-scoped token intent
precede its single-use fixed POST plan. Only a same-store, same-run set of
three current role receipts with the exact inert Product/Auth D1 binding graph,
and the matching token POST result plus exact-ID
GET readback can checkpoint the complete Beta ID/token inventory. That write
finishes before any successor receipt is returned. Old receipts for **all
three** roles are revoked together; copied raw inventory cannot renew them.

Each Access app separately requires an empty pre-create list and durable
intent before a single-use pure POST plan. The API and Operator plans address
only their certified 32-lowercase-hex Beta Worker IDs, controller-derived
names, and the run token with one `non_identity` policy and one service-token
include. A correlated POST result and exact-app-ID GET must match that whole
graph before its ID enters a durable inventory checkpoint. Each checkpoint
rotates all three role receipts and revokes older attachments and prepared
evidence. Conflicting prior Beta IDs in any sibling checkpoint refuse the
token transition; the earliest sibling expiry bounds every Access graph
transition and code preparation. Both app IDs, both durable attachment
receipts, and later fresh exact-policy readbacks remain mandatory before a
supported Worker code plan.
The legacy Access client's `workerIds` continue to mean legacy script tags;
the Beta planner makes no transport call and accepts no name fallback.

At the Task 5b protocol prerequisite checkpoint, the 2026-10-01 local
`node --test scripts/cloud-e2e/*.test.mjs` result was **65/65**. Tests cover ordered empty-inventory progression, intent and ID
checkpoint failure, same-run overlap, distinct-run independence, forged
account/run/role/path/ID/token/policy/time evidence, expiry and superseded
receipts, both Access gates, and the unchanged zero-transport public Worker
refusal. Synthetic envelopes and a local store/process registry are correlation
fixtures, not authenticated Cloudflare provider proof, distributed CAS,
recovery, live readiness, or complete cleanup. Operator service
binding remapping, assets/JWT, and the other live gates above remain unsupported.

### Task 5b mock provisioning and teardown controller (2026-10-01)

`provisionMockStack` runs the actual `bundle-v1` verifier before any provider
request. With an injected mock provider and restricted evidence store, it
checkpoints a controller-derived inventory, creates and reads back two exact
D1 UUIDs, applies the verified SQL files as data, then drives all three empty
disabled Beta Worker intent/create/readback checkpoints. It composes the
opaque token and both Access identity transitions, durable attachment receipts,
fresh exact policy/Worker/version observations, and a pure API version plan.
It does not send the Worker code plan to a provider. Operator planning returns
`service-binding-remapping-unresolved`, so the result is `unsupported`, never
`VerifiedStack` or HTTPS readiness.

`teardownMockStack` accepts only the same process-local, verifier-established
run/account. Registration and raw-session cleanup remain private to the
controller; a forged or copied session cannot authorize provider calls.
Before any Worker is created, it can remove proven D1s in reverse order after
exact-ID/name GETs and observed absence after DELETE. Failed pre-create reads
or intent writes do not imply a create attempt; an ambiguous Auth POST retains
Auth as unresolved but can still permit independently proven Product cleanup.
Changed ownership or failed deletion leaves that D1 recorded. Any remaining
Worker/Access graph blocks dependent D1 deletion. Its
`local-cleanup-observed` outcome records a mock D1 cleanup, with
`complete:false`; it is not a completed Cloudflare teardown. Original failure
and cleanup failure have separate sanitized codes. Same-run overlap/replay is
reserved locally, while different trusted runs can progress in one store.
There is no distributed lock, store CAS, audit recovery, live adapter, CLI,
or provider proof.

The reviewed Task 5b local cloud-script result was **83/83** on 2026-10-02. The
controller tests cover ordered progression, a single ambiguous create attempt,
migration and cleanup failures, stale/changed evidence, ID checkpoint failure,
same-run overlap, distinct-run progress, bounded transient reads, timeout,
staging/other-run refusals, forged-session cleanup refusal, and scoped D1
cleanup after Auth pre-create or ambiguous-POST failure. The D1 guard
also rejects a returned UUID already present in pre-create discovery,
preventing substitution of an existing staging database. This is mock-boundary
evidence only; full Task 5,
live Cloudflare lifecycle, alternate-URL/HTTPS checks, real cleanup, the
Playwright suite, and the every-push workflow remain incomplete. The Notion
mirrors record this reviewed Task 5a/5b 83-test mock-only state; they do not
claim live-provider behavior or pilot readiness.

### Raw-module packaging correction (2026-10-02)

The approved producer correction uses fixed API, Identity and Operator
configs with pinned Wrangler `deploy --dry-run --outdir`, selecting regular
`worker.js` bytes as `workers/{role}.mjs`. Fresh output directories reject
stale files, and missing/nonregular/symlink/extra runtime outputs stop bundle
creation. The approved review fix adds explicit `--metafile` output in a fresh
per-role directory outside the runtime outdir. Filenames alone do not prove
sidecars: real Text modules named README or `worker.js.map` can occupy those
names and remain imported by the main module. Both collisions now refuse.
The verifier rejects the pinned serialized multipart metadata
envelope through a bounded byte-prefix check before extraction, retaining
all provenance, hash, path and size checks. It does not compile or import
PR JavaScript or interpret upload metadata.

The initial packaging commit `66c0298` passed **29/29** focused tests and
**106/106** cloud-script tests. After the metadata correction, focused tests
pass **62/62** (3,395.019 ms), and the final local cloud-script regression
passes **139/139** (2,342.800 ms), with zero
failures or skips. Checksum-valid multipart fixtures for all three roles stop
the actual mock controller before provider transport or extraction; legitimate
source containing multipart-related strings remains accepted. Producer tests
use real files, archives and byte comparisons with only the external process
substituted. Collision regressions reached semantic RED before the producer
fix, including real bundle creation that previously emitted incomplete archives.

Required metadata is a regular nonsymlink JSON file with input/output records.
Output paths resolve against the fixed config's project root, not process cwd.
The selected output must have an entry-point/input association, complete
imports/exports/input-byte records and the exact selected byte count. Only the
selected module and its generated map may appear as metadata outputs; the map
must match its regular file's size and have no entry point, imports, exports
or input contributions. Missing, malformed or mismatched metadata refuses.
Main-output imports may reference only the observed external platform modules
`cloudflare:workers`, `node:crypto` and `node:async_hooks`; the latter is a
dynamic import in Identity. Unknown specifiers, namespace lookalikes and runtime
file imports refuse, including sidecar-name collisions. This bounded pinned
contract is not a JavaScript parser or a general provider-validity guarantee.

The actual unprivileged producer built and archived all three pinned Wrangler
4.112.0 outputs in **18,127.263 ms** at `66c0298`, then repeated the amended
metadata invocation successfully in **16,342.042 ms**. Each archived module exactly matched the
retained output from that same dry run and passed Node 22 `--check` without
importing or evaluating it. Each output directory contained only `worker.js`,
`worker.js.map` and README; neither sidecar entered the archive.

**Table — Actual raw Worker modules**

| Role | Module bytes | Local validation |
|---|---:|---|
| API | 1,268,353 | Exact selected/archive bytes; compile-only check passed |
| Identity | 3,128,667 | Exact selected/archive bytes; compile-only check passed |
| Operator | 691,078 | Exact selected/archive bytes; compile-only check passed |

The archive contains exactly **22 files**, totaling **5,892,349 payload
bytes**, in a **5,914,112-byte** tar. Independent source-path enumeration and
byte comparisons preserve all **5 SPA assets (753,670 bytes)** and **14 SQL
migrations (50,581 bytes)**. Focused lint of the four producer/verifier/test
scripts passed at `66c0298`; focused producer/test lint passes for the metadata
correction. Local dependency recovery used the unchanged frozen lockfile
with lifecycle scripts disabled; the initial offline cache miss and sandbox
network failure did not establish packaging success. The measured round trip
followed successful approved recovery and local binary checks.

The 2026-10-02 project `pnpm test` at `66c0298` passed **97 Vitest files / 1,395
tests**, plus **9 Node tests**; that full suite was not repeated for the isolated
producer metadata correction. Its initial sandbox attempt stopped before Worker assertions
at Identity's loopback `listen EPERM`; the same local-only run passed with
approved loopback/log access. Independent review found the sidecar collision;
the approved `8aa2d8c` fix passed scoped re-review with no open findings, then
the approved narrow Notion mirror synchronization completed. These local byte/syntax
results do not establish arbitrary-JavaScript or provider compatibility, and
no authenticated Cloudflare request or deployment was made.

Code references:

- Producer and refusal coverage: [build-artifact.mjs](../../scripts/cloud-e2e/build-artifact.mjs), [build-artifact.test.mjs](../../scripts/cloud-e2e/build-artifact.test.mjs).
- Format/integrity and real consuming boundary: [artifact.mjs](../../scripts/cloud-e2e/artifact.mjs), [artifact.test.mjs](../../scripts/cloud-e2e/artifact.test.mjs).

**NO-GO for a live pilot:** Beta recovery/audit evidence, provider response
completeness, assets/JWT, service-name remapping, live D1 migrations, version/preview
exposure, Access behavior, and two-stack acceptance require separate approval
and disposable-account proof. No authenticated Cloudflare request was made.

## Operator upload feasibility (2026-10-02)

**Conclusion: NO-GO for live Operator upload.** The documented service graph
and asset-session requests select target names; no atomic immutable-target
constraint was established for either. The historical packaging investigation
exposed a module-format mismatch, corrected by the approved
[local packaging deliverable](#raw-module-packaging-correction-2026-10-02).
The mock-only packaging/candidate-validation
slice is specified in the [implementation plan](../superpowers/plans/2026-09-30-per-pr-cloud-e2e.md#proposed-next-mock-only-operator-slice-2026-10-02).
Its first packaging deliverable was approved on 2026-10-02 and implemented
locally; the second candidate diagnostic deliverable was separately approved
on 2026-10-05 and is now implemented with local verification. Independent scoped
re-review after the isolation-fixture correction and narrow existing-page
mirror synchronization are complete. The historical
Task 5a/5b **83/83** evidence and live NO-GO remain unchanged.
After independent review, this feasibility summary and the unadopted
packaging-first proposal were synchronized to the existing Notion design/plan
on 2026-10-02, with narrow roadmap/index next-step updates. Fresh complete
readbacks passed, and all 17 index child links were preserved and resolved.
After clean scoped re-review, the packaging/metadata result and 62/139 local
test counts were narrowly synchronized on 2026-10-02 to the existing design,
plan, roadmap and Plans index. Fresh complete readbacks matched only the
targeted substitutions; all 17 index child URLs/titles/order were preserved
and resolved read-only. Historical 83-test evidence and the prior `66c0298`
full-project test provenance remain unchanged; no live gate was closed.

### Exact service graph and identity contracts

The application graph has four service edges, including the default Identity
HTTP entrypoint used for authentication. The Core role is `api` in inventory.
Every target name below must be derived from the same trusted StackKey.

| Caller | Binding | Target role | Entrypoint |
|---|---|---|---|
| Operator | `IDENTITY_AUTH` | Identity | Default HTTP `fetch`; omit `entrypoint` |
| Operator | `IDENTITY` | Identity | `IdentityOperatorService` |
| Operator | `CORE` | Core/API | `CoreOperatorService` |
| Identity | `CORE` | Core/API | `CoreOperatorService` |

Local references: [Operator config](../../apps/operator-web/wrangler.toml),
[Identity config](../../apps/identity/wrangler.toml), exported classes in
[Identity](../../apps/identity/src/worker.ts) and [Core](../../apps/api/src/worker.ts),
and the [Operator HTTP/RPC consumer](../../apps/operator-web/src/worker.ts).
The installed Wrangler **4.112.0** schema describes `service` as a name and
`entrypoint` as an optional named export (`wrangler/config-schema.json:930–970`).
The [Beta version schema](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/)
likewise offers `service`, optional `entrypoint` and `environment`, with no
target Worker-ID/version condition in that binding shape. Worker immutable ID,
controller-derived name, and version UUID remain separate identities.

The [service-binding guide](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
allows independently deployed Workers. [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
apply to HTTP fetch calls, require the requested version in the current
deployment, can fall back to its traffic split, and do not support RPC calls.
They do not pin this graph. Native Previews retain the already-rejected
[production service-target limitation](https://developers.cloudflare.com/workers/previews/resources/).
These findings do not assert how Cloudflare internally resolves or retains a
binding after rename/delete/recreate; that behavior remains unproved.

The [Beta Worker GET](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/get/)
returns `references.workers` for **incoming** dependents, not the caller's
outgoing bindings. [Version GET](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/)
exposes version bindings/config and optional `include=modules`. A complete
future observation needs paginated version/deployment enumeration, each
relevant version's outgoing bindings, exact target ID/name/version association,
route/Access state, and unknown-field/completeness handling; a Worker GET or
empty incoming-reference list alone cannot certify it. Even complete fresh
observations leave a validation-to-upload/use race if another writer can replace
a target or change its deployment. A local lock, fresh name GET, shortened
expiry, or same-run marker does not establish a provider transaction.

The live gate needs a documented atomic target-ID constraint/stable binding
resolution contract, or an explicitly approved design amendment with an
enforceable account writer boundary for the entire create/upload/use/teardown
interval. No such control is established for the current same-account design;
names must still reject manual staging and sibling runs. A narrowly approved
disposable-account probe could measure rename/delete/recreate before and after
caller upload, concurrent target changes, and RPC target/version markers using
trusted inert modules. Observations alone cannot guarantee all future races.
Teardown follows Operator, then Identity, then Core, before dependent D1s;
foreign or incomplete incoming references quarantine the dependency. The
[delete contract](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/delete/)
warns that `force=true` may break service bindings; it is not a safe remedy.
No cleanup implementation is added by this investigation.

### Bundle, assets, and JWT mapping

The trusted controller must use verified bytes and its own binding/routing
profile. PR manifests supply file paths, lengths and SHA-256 only; embedded
Wrangler metadata is untrusted data and cannot supply bindings, account,
endpoints, compatibility settings, routes or secrets.

| Boundary | Observed/documented contract | Remaining gate |
|---|---|---|
| Historical Worker bytes | Before the packaging correction, the [artifact producer](../../scripts/cloud-e2e/build-artifact.mjs) stored `wrangler deploy --dry-run --outfile` output directly as `workers/{role}.mjs`. Installed `wrangler-dist/cli.js:144218–144224` serializes the upload FormData. On 2026-10-02 the Operator output was **692,443 bytes**, beginning with a multipart boundary, metadata and `worker.js` part; `node --check` rejected it. | This was not a JavaScript module merely because its suffix was `.mjs`. All three roles used the same producer; only Operator was reproduced in that historical investigation. The historical verifier round trip established integrity, not module format. |
| Historical module alternative | The same unprivileged Operator dry run with `--outdir` emitted `worker.js` (**691,078 bytes**), plus a map and README; `node --check worker.js` passed without evaluating the module. | The approved correction now selects actual module bytes and refuses unexpected additional runtime files. Privileged verification stays data-only; syntax checks belong in the unprivileged build. No packaging result proves provider acceptance. |
| Asset manifest | [Verifier](../../scripts/cloud-e2e/artifact.mjs) requires `assets/index.html` and exact path/size/SHA-256. Strip the one `assets/` prefix: `assets/index.html` becomes `/index.html`, and `assets/assets/x.js` becomes `/assets/x.js`. Pinned `cli.js:150019–150024,150309–150311` computes BLAKE3 of base64 bytes plus extension, truncated to 32 hex characters. | The [direct-upload example](https://developers.cloudflare.com/workers/static-assets/direct-upload/) instead computes truncated SHA-256 over base64 plus extension. Neither equals the bundle's SHA-256 over raw bytes. Keep integrity hashes separate; accepted upload-hash semantics require provider clarification/proof. |
| Session | [Session create](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/assets/subresources/upload/methods/create/) is `POST /accounts/{account_id}/workers/scripts/{script_name}/assets-upload-session`, body `{manifest:{"/path":{hash,size}}}`, returning `buckets` and `jwt`. | `script_name` is documented as a **name**. No ID-addressed/conditional session primitive was established; do not insert a Beta ID into this legacy parameter by inference. |
| Asset upload | [Upload API](https://developers.cloudflare.com/api/resources/workers/subresources/assets/subresources/upload/methods/create/) uses the account-scoped `/workers/assets/upload?base64=true` with multipart hash-keyed base64 file parts. Pinned `cli.js:150165–150181` authenticates with the session JWT, preserving MIME per part. The response's JWT is used for completion. | Validate requested bucket hashes against the exact byte snapshot; no caller-provided URL or headers. MIME selection belongs to the fixed trusted profile. The endpoint has no Worker/version ID parameter. |
| Completion and version | Direct-upload documentation states upload and completion tokens last one hour; the initial JWT is already a completion token when buckets are empty. Beta version JSON carries `assets.jwt`, `assets.config`, `bindings:[{name:"ASSETS",type:"assets"}, …]`, base64 JavaScript modules, and query `deploy:false`. | The cited contracts do not specify JWT claims, a verifiable binding to StackKey/immutable Worker ID/future version UUID, or whether wrong-target redemption is rejected. Treat tokens as opaque sensitive values; correlated local records/expiry cannot prove provider scope. Missing/expired/unbound evidence refuses. |

The fixed local diagnostic Operator asset profile preserves
`not_found_handling:"single-page-application"` and
`run_worker_first:["/auth/*","/internal/*","/operator/v1/*"]` plus `ASSETS`.
Do not import PR `_headers`, `_redirects`, `.assetsignore`, config, or multipart
metadata into that profile; the diagnostic rejects unsupported special files
rather than quietly omitting verified assets. Fixed compatibility settings
and role bindings also remain controller-owned. The current inert `DB` mock
profile is not the application profile (`AUTH_DB` and Identity's Core edge);
Task 6a now supplies local runtime admission; generated configuration and deployed-graph certification remain deferred under Task 6b and the future controller.

Required ordering remains disabled empty Workers, durable IDs, both Access
attachments and fresh exact readbacks, then any asset session or code upload;
Core must be available before Identity and Identity before Operator use.
Routes stay disabled until protection/graph checks and live URL probes pass.
Asset-first routing makes anonymous asset, SPA fallback, redirects, preview
and version URLs part of the protection proof, not just the document URL.
Provider hash/JWT/session compatibility and Beta version acceptance need a
separately approved inert disposable-account probe, including expired token,
other Worker/account token redemption, empty-bucket completion, and served
asset byte/length checks. This probe does not resolve target replacement by
itself or authorize PR-code deployment.

Local packaging commands used `WRANGLER_SEND_METRICS=false` and temporary
`WRANGLER_LOG_PATH`, then `pnpm --filter @incentives/operator-web exec wrangler
deploy --dry-run --config wrangler.toml --outfile
/private/tmp/cb-task5c-operator.mjs`, followed by the same command with
`--outdir /private/tmp/cb-task5c-operator-outdir`. Both exited zero and made no
authenticated Cloudflare request. Existing dashboard build output was used;
no full build or code suite rerun was needed. Documentation and primary API
contracts above were checked on **2026-10-02**; pinned source references use
`apps/operator-web/node_modules/wrangler/` as their local root.

## Operator candidate diagnostics (2026-10-05)

Exact local byte and synthetic-record comparisons now return only
`unsupported`, retaining all four live blockers. Task 5e was separately
approved for this six-file diagnostic slice. Independent scoped re-review and
the existing-page mirror synchronization are complete; the reviewed historical
83/83 controller and 139/139 packaging results retain their dated provenance.

The preparation input is the unchanged verifier result
`{key,buildSha,run:{run_id,attempt},files:[{path,size,sha256}]}`, with absolute
paths. Its StackKey, build/run provenance, one common extraction root, fixed
three Worker paths, mandatory SPA index, path schemas and existing
20 MiB/1 MiB/64 MiB caps are rechecked before reads. Only listed paths are read,
with exact raw byte length and SHA-256 comparison and recognized multipart
refusal. The returned snapshots contain only the Operator module and listed
assets, with one `assets/` prefix removed: `/index.html` and `/assets/x.js` are
the two tested examples. No directory scan, PR configuration or source
execution is involved. Raw copied bundle/candidate objects remain untrusted;
they cannot mint an opaque receipt or authorize any transport.

The fixed profile is plain data
`{binding:"ASSETS",not_found_handling:"single-page-application",run_worker_first:["/auth/*","/internal/*","/operator/v1/*"]}`.
The module is named `operator.mjs`, with content type
`application/javascript+module`. Assessment rechecks candidate shapes,
canonical base64, lengths, integrity hashes, unique safe paths and profile.
`_headers`, `_redirects` and `.assetsignore` are rejected.

The strict synthetic graph is
`{key,accountId,observedAt,complete,workers:[{role,workerId,name,versionId,bindings}]}`.
It requires precisely three distinct certified `InventoryV1.betaWorkerIds`;
absent/incomplete Beta IDs cannot fall back to legacy `cloudflare.workerIds`.
Controller-owned expected version UUIDs form a separate exact
`{api,identity,operator}` map. Each observed Worker and every service target
must match its same-run ID, derived name and expected version. The four
[application service edges](#exact-service-graph-and-identity-contracts) remain
exact. This local graph uses these binding records:

- Service: `{name,type:"service",workerId,service,versionId,entrypoint?}`;
  `IDENTITY_AUTH` omits `entrypoint`.
- D1: `{name,type:"d1",databaseId}`; API `DB` associates Product and Identity
  `AUTH_DB` associates Auth, with distinct exact database UUIDs.
- Assets: `{name:"ASSETS",type:"assets"}`; Operator has no D1 binding.

Unknown fields, roles, environments, bindings, duplicates, missing completeness
or versions, stale/future observations and invalid clocks refuse. This is the
application diagnostic graph, distinct from the unchanged controller's inert
Identity `DB`/no-Core graph and empty-version state. `complete:true` is a local
fixture requirement, not provider completeness or upload permission.
`references.workers` describes incoming references and cannot fill this
outgoing graph. A future adapter must prove complete version/deployment
observations.

The strict synthetic asset lifecycle is
`{key,accountId,role,workerId,workerName,manifestDigest,sessionId,startedAt,expiresAt,uploadManifest,buckets,completedBuckets,completion}`.
`manifestDigest` is SHA-256 of UTF-8 `JSON.stringify` over `[path,size,sha256]`
tuples sorted by normalized path in code-unit order. It is local snapshot
correlation, not a provider upload hash. `uploadManifest` maps every exact
candidate path to `{hash,size}`, with noncolliding opaque fixture hash labels;
no provider hash is computed or claimed. Provider BLAKE3 versus documented
example SHA-256 semantics remain unproved.

Each bucket request is `{hashes,requestedAt}`. It contains nonempty, known,
nonrepeated fixture labels. Requested labels may be a subset of the manifest,
as a synthetic session may require no upload for some cached assets. A dense
ordered completion array contains exactly one record per zero-based bucket
index: `{bucketIndex,sessionId,manifestDigest,observedAt,expiresAt,jwt}`.
Each final session completion is
`{sessionId,manifestDigest,observedAt,expiresAt,jwt}`. The empty-bucket case
requires empty request/completion arrays and this final completion.
Requests follow session start and remain ordered; bucket completions follow
their requests with strictly increasing completion times; final completion
follows every bucket completion. All observations use canonical finite UTC
clocks, cannot be in the future, and stay within the local five-minute bound
and recorded session/completion expiries. Exact run/account/Operator/session/
snapshot association and a nonempty opaque test token are required. These
fields are local test records, not invented provider JWT claims. No JWT is
parsed, returned or logged; expected graph versions do not preseed a future
Operator upload version or bind a token to it.

For an exact fixture, assessment returns only
`{status:"unsupported",blockers,graphMatches:true,assetPaths,moduleSha256}`.
The blockers are `service-binding-remapping-unresolved`,
`asset-session-name-target-unproven`, `asset-upload-hash-contract-unproven` and
`asset-completion-scope-unproven`. There is no transport parameter, request,
method, URL, headers, body, token or safety receipt output.

Task 5e local evidence: missing exports produced 11 passes/one failed test
file; semantic RED produced 11 passes/95 expected assertion failures.
Sparse bucket records then produced 146 passes/one semantic failure before
dense-record validation. Focused GREEN passed **147/147** in **162.489708 ms**;
final cloud-script regression passed **275/275**, zero failures/skips, in
**4,371.334125 ms**, and focused three-script lint passed. Both independent
runs preserve exact bytes, graph and completion records; swapping records
refuses. The actual mock controller still refuses Operator after both Access
gates with zero Worker-version/session/asset-upload transport. Either initial
or final API/Operator Access failure stops earlier. The original substantive
E2E assertion inventory remains unchanged.
The cloud run preceded only the final per-run four-edge assertion and
documentation edits; the final focused rerun passed 147/147 in 239.948875 ms,
with focused lint passing again. No production code changed after the cloud run.

Task 5e review fix (2026-10-05): independent review found that the two-run
acceptance fixture reused Product/Auth D1 UUIDs. The test-only correction now
uses disjoint literal Product/Auth pairs and distinct expected version maps,
asserts each run's exact D1/service/version associations and disjoint Worker/D1
sets, and rejects individual inventory D1 IDs, graph D1 IDs/association records
and expected-version maps from the other run in both directions while retaining
the recipient's keys and Worker observations. Both corrected valid fixtures
still return unsupported with all four blockers. Semantic RED was 146 passes /
16 assertion failures in 198.988917 ms before fixture correction; focused GREEN
is **162/162**, zero failures/skips, in **186.830125 ms**, with focused lint and
diffcheck passing. Production and consumer-controller code are unchanged.
The 275-test cloud result and full-project run below remain pre-fix evidence.
Root's fresh regression at `e0ce221` passed **290/290**, zero failures/skips,
in **4,651.59 ms**; independent scoped re-review found the isolation issue
addressed, with no open findings. On 2026-10-05, the approved nonsecret status
was narrowly synchronized to the four existing design/plan/roadmap/index
destinations. Fresh complete whole-page readbacks matched the authorized
substitutions, allowing only the explicitly reviewed single-newline design
rendering; all 17 native index child URLs/titles/order and active metadata were
preserved. Root independently verified all four pages and all 17 destinations.
This synchronization adopts no next provider task and closes no live gate.

The single final 2026-10-05 project `pnpm test` passed **97 Vitest files /
1,395 tests plus nine Node tests**, with zero failures/skips. Its log-write
span was **54,843.716309 ms**; Identity's Worker suite reported **23.87 s**,
and the final nine-test Node suite **1,072.940875 ms**. Node 22.18.0 and cached
pnpm 11.14.0 were used with `pnpm_config_verify_deps_before_run=error` to refuse
implicit installs. Approved local-only loopback/Wrangler-log permission was
used directly; there was no failed sandbox attempt or tooling restoration.
This is Task 5e project evidence at original `50cbfa1`, separate from the dated
`66c0298` result and not a repeated full suite at the test-only `e0ce221` fix.

Transport, real deployed bindings, JWT signature/scope, atomic replacement,
URL protection and provider hash acceptance remain unproved. No packaging
rebuild, browser E2E rerun, account operation, credential access, deployment,
or workflow was part of the diagnostic implementation. The separate post-review
mirror/status-note completion changed no code/tests and reran no suite.

Code references:

- Candidate comparisons: [operator-candidate.mjs](../../scripts/cloud-e2e/operator-candidate.mjs).
- Byte/graph/completion/isolation cases: [operator-candidate.test.mjs](../../scripts/cloud-e2e/operator-candidate.test.mjs).
- Real consumer refusal: [provision.test.mjs](../../scripts/cloud-e2e/provision.test.mjs).

## Provider target and assets contracts (2026-10-05)

**Conclusion: NO-GO remains.** Bounded public-contract research established no
documented immutable service-target selection or stable asset-session
precondition covering creation, upload, use and teardown. The new evidence is
Cloudflare's [2026-09-15 per-Worker permission release](https://developers.cloudflare.com/changelog/post/2026-09-15-granular-worker-permissions/),
which makes a conditional same-account writer-boundary proposal worth reviewing;
it does not make named targets immutable. Recommendation: resolve the provider
questions below before proposing any executor or account proof. No amendment
or permission change is adopted. Task 5e's separate status-note review at
`c42088f` is complete with no findings; full Task 5 remains incomplete.

**Table — Dated provider evidence and remaining blockers**

| Contract | Evidence checked 2026-10-05 | Finding and prerequisite |
|---|---|---|
| Service identity, entrypoint and version | Installed Wrangler 4.112.0 schema `services` and upload metadata use names/entrypoints. [Beta version create](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/) exposes `service`, optional `entrypoint`/`environment`, without target ID/version preconditions. [Version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/) apply to HTTP fetch only and can fall back to deployment percentages. | No immutable four-edge constraint established. ID-addressing the caller does not certify the named callee; copying an inherited binding from a caller version does not pin its target version. Provider clarification must cover resolution and rename/delete/recreate semantics. |
| Outgoing graph completeness | [Beta versions list](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/list/) paginates by page/per-page; [version GET](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/) exposes outgoing bindings/config and optionally modules. [Deployment list](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) is name-addressed; its first item is the active deployment and its entries carry version UUIDs/percentages. [Worker GET](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/get/) references are incoming dependents. | Proposed observations: exhaust unfiltered version/deployment pagination, reconcile totals/IDs and every exact full-version GET against the expected phase profile, then verify the active deployment selects the intended version at 100%. Missing bindings, extra/unknown versions, partial/changing pages or unresolved name/ID mapping refuse. No transactional snapshot or resolved callee-ID/version observation was established. |
| Asset-session target | [Session create](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/assets/subresources/upload/methods/create/) takes a script name and manifest, returns optional buckets/JWT; no Worker-ID field or identity precondition is documented. Pinned session request sends that name and manifest. | Beta ID substitution into `script_name`, a fresh GET, CLI `--strict`, or an advisory account lock cannot establish stable targeting. Clarify a documented primitive, or approve and prove an enforceable writer boundary for the whole lifecycle. |
| Upload hash | Pinned implementation uses BLAKE3; the [direct-upload example](https://developers.cloudflare.com/workers/static-assets/direct-upload/) uses SHA-256. Both hash base64 text followed immediately by the last extension without its dot, then take the first 32 hex characters. The session schema calls the field a hash without choosing an algorithm. | Exact local vectors demonstrate different results, not provider acceptance. Clarify accepted algorithm(s), verification/deduplication and same-hash alias semantics; retain independent full raw-byte SHA-256 for artifact integrity. |
| Completion scope and expiry | Direct-upload documentation describes a one-hour upload token, bucket requests using that bearer, a final token after all manifest files upload, and one-hour final validity; an empty bucket list returns completion directly. [Upload API schema](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/assets/subresources/upload/methods/create/) returns optional `jwt`; Beta version JSON accepts `assets.jwt`. | No public claim schema, per-bucket completion/expiry guarantee, single-use rule, immutable Worker/account/manifest scope, or wrong-target/expired redemption status was established. Clarify these separately, then prove accepted/rejected outcomes with trusted inert assets. No future version UUID exists before version creation. |
| Permission enforcement | [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/) now cover members, groups and tokens at product or selected-existing-Worker scope. Editor includes rename; creation needs product Admin; legacy broad permissions still work. [Authorization guidance](https://developers.cloudflare.com/workers/authorization/) says deploying bindings does not require separate bound-resource permissions. [Account-token create schema](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/) has policy effects, permission groups and resource maps, but no concrete Worker resource-key/rename/recreation contract. | Scoped deploy authority can reduce exposure, not constrain outgoing resources or exclude independent broad writers/admins. Clarify identity durability and coverage of Beta lifecycle/version/deployment, legacy/session and JWT upload/redemption endpoints; prove the actual account policy set separately. |

The expected application graph is still Operator `IDENTITY_AUTH` to Identity's
default HTTP fetch (entrypoint omitted), Operator `IDENTITY` to
`IdentityOperatorService`, and Operator/Identity `CORE` to API
`CoreOperatorService`. API `DB` targets Product D1, Identity `AUTH_DB` targets
the distinct Auth D1, and Operator's resource graph has `ASSETS` and these
services, no D1. Named RPC entrypoints cannot use HTTP overrides. A future complete
observation must distinguish the inert bootstrap profile from the application
profile, certify every allowed version and reject unexpected bindings; the
current synthetic `complete:true` record is not such an adapter.

Pinned hash semantics are UTF-8 bytes of standard padded base64 text plus the
case-sensitive final extension; there is no separator, path, MIME type or
lowercasing in that input. The 32-character lowercase hex prefix is 16 bytes,
not the full digest or a raw-byte checksum. Local measurement using only the
exact trusted installed function and `blake3-wasm` 2.1.5 gives, for UTF-8 `abc`
at `index.html`, BLAKE3 `81d5c47c184c7b210b5e633746d23ac2` versus the documented
SHA-256 example `4e5fcedb4b913f68d70b401270be56e5`; full raw-byte SHA-256 is
`ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
Ten synthetic vectors also cover case, final extension, no extension, trailing
dot, empty and binary bytes. Identical bytes/extensions produce identical
labels even at different paths; path uniqueness is separate from hash
uniqueness. No real Operator build or provider upload was repeated.

The provider lifecycle has one session/upload bearer and final completion,
not a guaranteed distinct JWT for every bucket. Intermediate uploads may lack
a JWT; pinned Wrangler uploads buckets concurrently and retains a returned
completion token after all requests finish. Its optional single-file mode
reads undocumented routing hints from the token; those implementation details
are not a public claim/scope contract. The five-minute local context and
synthetic session IDs, snapshot digests, ordered completion records and expiry
fields remain diagnostic policy only. No token was acquired, parsed or logged.

### Conditional same-account writer boundary

Two prerequisites remain alternatives: a provider-documented immutable target
or atomic identity precondition, or a separately approved writer-boundary
amendment. The former would preserve independent account writers if it covers
all four services and the asset lifecycle; no such primitive was established.
The latter could use a protected credential broker with exclusive effective
authority over CI Worker names/IDs and their versions/deployments for the
entire run. It would require provider-enforced removal/restriction of every
other effective writer, plus broker-side durable reservations and serialized
checked operations. Neither a process lock nor a convention provides that
enforcement.

The proposed boundary must cover dashboard members/groups, legacy/global keys,
OAuth/user/account tokens, Wrangler and direct legacy/Beta APIs, Workers Builds,
deploy hooks, Terraform/other CI, cleanup/janitor and administrative permission
or credential changes. The broker alone would create/delete CI Workers,
reject rename/recreate and independent target deployments while live, keep
names reserved until outstanding asset tokens expire or are verifiably
revoked, and fence/drain in-flight work before failover or teardown. No new
per-Worker grant can cover the pre-create interval; broad create authority
still needs containment. All target versions stay fixed during use. Unknown
writers, changed policy, foreign references or lost exclusivity quarantine the
run; no force deletion.

Manual staging/demo remain in this same account with their resources, data,
secrets and independent manual purpose preserved. Narrow permissions could
retain ordinary manual staging deployment, but Editor also allows rename;
its name-collision and permission-scope behavior needs a documented guarantee
or mediation of the affecting paths. Requiring staging operations to pass
through a broker would itself be an unapproved operational amendment. Existing
broad owners/admins who can bypass the broker or regrant access are not excluded
by scoped CI tokens. Any proposed restricted/offline break-glass authority must
stop/drain CI before activation; a promise to coordinate is insufficient. If
enforcement cannot be achieved while preserving manual staging, this option
fails. Broker compromise, permission propagation, provider consistency,
credential leakage and same-account quotas remain residual risks even after
approval; no move to another account is proposed.

### Separate next gates

Recommendation is provider clarification first, covering immutable target or
scope identity across rename/recreation, service version resolution, complete
outgoing/deployment observations, all relevant endpoint authorization, hash
acceptance and JWT wrong-target/expiry/replay behavior. Then obtain approval of
the exact prerequisite/amendment and its local focused contract plan. Only
after independent review and separate authority may a narrow same-account
trusted-inert two-stack proof exercise replacements/renames, denied alternate
writers, exact bindings/versions, token swaps/expiry, cached/empty/multiple
buckets, both hash candidates and served bytes. Access must precede all code
or sessions; initial/subsequent route and alternate-URL denial remain gates.
Sampling those outcomes cannot establish universal race freedom by itself.
The later `ci` application, real HTTPS passkey/full GAP suite, zero-row disposal,
cleanup and every-push rollout remain separate and incomplete.

Evidence references: installed `apps/operator-web/node_modules/wrangler/`
`package.json:3`, `config-schema.json:930–970`,
`wrangler-dist/cli.js:140360–140382` (service metadata), `143454–143468` and
`143662–143747` (`--strict` confirmation/preflight, not provider CAS),
`150019–150024` (hash), `139352–139368` (optional routing hints),
`150047–150081` (session/empty buckets), `150120–150181` (upload),
`150233–150257` (completion), `150309–150311` (manifest).
Public pages above were checked on 2026-10-05; direct-upload, version-overrides
and roles pages date their updates 2026-08-10, 2026-07-03 and 2026-09-15.
The scoped investigation changes docs only and creates no new suite result:
current **162/162** focused and **290/290** cloud evidence retain `e0ce221`
provenance, with original `50cbfa1` full-project evidence unchanged. Public
Worker writes stay zero-transport refusals, and diagnostics keep all four
blockers. Independent local review of `ea8620f` is spec compliant / quality
Approved (0 Critical, 0 Important, 1 Minor); the plan clarifies allowed retained
bootstrap/application versions versus sole active current-phase selection at
100%, with an append-only investigation-report correction. Narrow synchronization
to the four existing Notion destinations completed on 2026-10-05. PATCH and
fresh complete GETs match exact original-plus-substitution whole pages, with
no formatting exception; all 17 native child URLs/titles/order and active page
metadata are preserved. Root independently verified all four pages and 17
destinations. Closing status-note review of `eb72ae5` is complete: spec
compliant / quality Approved, with no findings (`task-5f-notion-sync-review.md`). No new policy,
executor, provider proof or live gate is adopted.

## Cloudflare clarification request draft (2026-10-05)

**Status: Draft / not sent.** No support ticket or channel is selected; no
provider response is pending. The copyable request below derives solely from
the [accepted contract evidence](#provider-target-and-assets-contracts-2026-10-05)
at `ea8620f` and its reviewed closing notes at `eb72ae5`. It has not been
synchronized to Notion. Selecting a destination and approving the exact final
message and sending require separate explicit approval. Any eventual reply
needs independent interpretation and an approved prerequisite decision;
clarification alone supplies no safety receipt or live proof. NO-GO, all four
diagnostic blockers and public Worker zero-transport refusals remain.

```text
Subject: Clarification of Workers target identity, permissions and asset upload contracts

We are evaluating temporary isolated stacks of three Workers and two D1
databases per PR run in one Cloudflare account. Independent manual staging
must remain in that account. Operator calls Identity through default HTTP and
named RPC, and Core through RPC; Identity also calls Core through RPC. We need
documented enforceable contracts before an executor or separately authorized
inert pilot. No live account proof has been run.

1. Target identity and observations: What supported API constrains each callee
   service and named asset-session target to an immutable Worker identity
   through rename, deletion/recreation, upload, use and teardown? Is there an
   immutable-ID selector or atomic compare-and-swap/identity precondition?
   Please specify default HTTP versus named RPC entrypoint/version resolution,
   including version-override fallback, and how to observe the complete outgoing
   graph, every retained version and active deployment percentages. Can those
   observations form an atomic snapshot or detect concurrent changes?

2. Permissions: What exact resource keys implement selected-Worker scopes, and
   does scope identity survive rename or exclude a replacement with the same
   name? Which Beta, legacy, assets-session, upload and redemption endpoints
   enforce them? Editor permits rename, creation needs broad product authority,
   and caller deploy rights do not themselves constrain bound resources. What
   enforceable model excludes or mediates every alternate writer, automation,
   legacy credential and administrator able to regrant access throughout the
   lifecycle while preserving independent same-account manual staging?

3. Asset hashes: Which upload-hash algorithm(s) are supported? Pinned Wrangler
   4.112.0 uses BLAKE3 while the direct-upload guide uses SHA-256 over standard
   padded base64 plus the final extension without its dot, retaining 32 hex
   characters. For UTF-8 abc at index.html, the measured prefixes are
   BLAKE3 81d5c47c184c7b210b5e633746d23ac2 and guide SHA-256
   4e5fcedb4b913f68d70b401270be56e5. Neither is raw-byte SHA-256. Please specify
   content verification, deduplication and same-hash/different-path alias
   semantics; these local vectors establish no provider acceptance.

4. Token lifecycle: How are the session bearer and final completion JWT scoped
   to account, immutable Worker and asset manifest? Please specify documented
   expiry, replay and revocation semantics, wrong-target/expired outcomes, and
   cached, empty and concurrent-bucket completion behavior. Is final completion
   distinct from intermediate acknowledgements without assuming a JWT per
   bucket, single use or a future version pin?

Please provide exact official documentation and API/precondition semantics for
each answer. Clarification will guide a separately authorized inert pilot;
it will not constitute proof of account enforcement or safe concurrent use.
```

Source references retained from the accepted 2026-10-05 investigation:

- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) and [HTTP version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/).
- [Beta version create](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/), [version GET](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/), [versions list](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/list/) and [deployments list](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/).
- [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/), [authorization guidance](https://developers.cloudflare.com/workers/authorization/) and [account-token schema](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/).
- [Asset-session create](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/assets/subresources/upload/methods/create/), [direct-upload guide](https://developers.cloudflare.com/workers/static-assets/direct-upload/) and [upload schema](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/assets/subresources/upload/methods/create/).

## Local exact-D1 root bootstrap (2026-10-06)

The approved local bootstrap safeguards persist a pending root only through
the exact Auth database owned by the client that freshly created it; full
deployed Task 6b controller certification remains deferred. Bounded local source
`07af8ed` is independently accepted after the two review fixes below.

The client snapshots its exact run/account and required protected staging
Product/Auth UUID exclusions separately from inventory and PR input. Complete
pre-create discovery, durable intent/create/checkpoint and fresh exact readback
establish local client authority. Raw/copied inventory, markers, arbitrary
callbacks/clients and verification booleans cannot mint it. The context expires
five minutes after creation without readback renewal; poison, deletion or changed
readback revokes it. Missing, malformed, reused, protected, foreign,
Product-instead-of-Auth and wrong-run targets refuse before SQL. Invalid secret,
email and finite-clock inputs refuse before bootstrap persistence. Same-client
bootstrap calls serialize; the shared core preserves the existing unique live
root/open-flow authority, pending-email resume, expired reissue, transactionality
and mandatory success-audit rollback. Activation grants expire after 600000 ms
and enter persistence only as hashes.

The exact-ID SQL consumer is an injected **local** protocol. Its fixture splits
rendered `/query` SQL through installed Wrangler and executes actual local D1
batch. Local persistence/rollback tests establish no live endpoint atomicity.
This adapter **must not be wired into a live controller** before provider
transactionality and full deployed graph/live prerequisites are separately
certified. Ordinary local/staging CLI targets, argument/output/error contracts,
secret-stripped children, exclusive 0600 SQL file and scoped cleanup remain.
No staging CLI environment override was added.

Focused evidence before final verification:

- Existing bootstrap characterization: 14 Worker tests passed in 4.65 s;
  the real runner/grant-exchange test passed in 4.80 s.
- Semantic RED: protected staging substitution and Product/Auth UUID aliasing
  produced two client/inventory assertion failures; invalid clocks and blank
  secret produced four sanitized Worker assertion failures. Deletion and
  ordinary changed-readback revocation each failed semantically before the fix.
- Shared-core onboarding GREEN: 62/62 passed in 4.66 s. Guard/controller
  GREEN: 74/74 passed in 189.18 ms; wrong inert D1/service targets refused
  before token/code/bootstrap progression.
- Actual local integration: four tests passed in 7.84 s, retaining two concurrent
  fixtures with four distinct Product/Auth UUIDs, distinct roots/secrets, one
  pending root/flow/audit per run, exact persisted 600000 ms expiry, hashed
  grants and successful own-grant Identity recovery exchange. Foreign grants
  and individual ID/client/key swaps refuse in both directions; recipient rows
  remain intact. New-root and expired-reissue audit failures roll back; retry,
  concurrent reissue, active-root/different-email refusal and a changed exact
  readback between SELECT and write are verified against actual D1 rows.

**Table — Original local verification on the `9f328ca` Task 6b source**

| Command | Result |
|---|---|
| Focused onboarding / real runner and exact-D1 integration | 62/62 (4.82 s) and 4/4 (7.85 s), zero failures/skips. Identity typecheck and focused cloud-script lint exit 0. |
| `node --test scripts/cloud-e2e/*.test.mjs` | 301/301, zero failures/skips, 2,917.48 ms. |
| `pnpm test` | 100 Vitest files / 1,588 tests plus nine Node tests, zero failures/skips; 59.24 s shell. Identity: 221 Worker plus 87 Node tests. |
| `pnpm build`, `pnpm lint` | Both exit 0, 11.86 s / 0.98 s shell. Existing dashboard chunk-over-500-kB warning and Fast Refresh warnings at `ThemeProvider.tsx:9` / `Toast.tsx:15` remain. |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` | One full serialized run after tests/build/lint: 5/5, zero failures/skips, 21.3 s (22.12 s shell); existing NO_COLOR/FORCE_COLOR warnings remain. No test/retry/infra change. |

These checks used Node 22.18.0, installed locked pnpm 11.14.0/Wrangler 4.112.0
and ordinary local loopback/log permission. No package/browser installation,
compatibility-date change or authenticated provider operation occurred. Full
outputs and distinct Chromium artifacts are retained in ignored Task 6b
evidence. The final commands ran after production/test self-review; only
verification documentation followed. Earlier historic evidence retains its
original source/run provenance, including the unproved prior SQLITE_BUSY cause.

The mock controller is unchanged and never reaches root bootstrap while
Operator service remapping/assets remain unresolved. Public Worker mutations
retain zero transport. No VerifiedStack, provider account/IAM proof, live D1
query, Access protection, HTTPS cloud passkey, disposal/teardown, pilot or
every-push gate is completed. At this original local implementation step, the
reviewed-status mirror reflected only prior Task 6a synchronization. The later
[reviewed local bootstrap status sync](#reviewed-local-bootstrap-status-synchronization-2026-10-06)
records separately approved narrow Task 6b publication.

Implementation references:

- [Shared bootstrap core](../../apps/identity/src/cli/bootstrap-root-core.mjs), [Worker wrapper](../../apps/identity/src/cli/bootstrap-root.ts) and [local/staging runner](../../apps/identity/src/cli/bootstrap-root-runner.mjs).
- [Guarded client](../../scripts/cloud-e2e/cloudflare.mjs) and [exact-ID consumer](../../scripts/cloud-e2e/root-bootstrap.mjs).
- [Real D1/recovery tests](../../apps/identity/test-node/bootstrap-root-runner.test.ts), [Worker bootstrap regressions](../../apps/identity/test/onboarding.test.ts) and [controller association refusals](../../scripts/cloud-e2e/provision.test.mjs).
- [Local authority design](../superpowers/specs/2026-09-29-per-pr-cloud-e2e-design.md#local-exact-d1-bootstrap-authority-2026-10-06) and [bounded implementation status](../superpowers/plans/2026-09-30-per-pr-cloud-e2e.md#task-6b-deferred-exact-d1-bootstrap-and-controller-certification).

### Immutable target and asynchronous freshness review fix (2026-10-06)

The approved `a07cf37` local fix keeps each bootstrap on its originally requested
Auth database. Its scoped re-review closed that target-swap finding but found a
residual clock reversal across checkpoint completion; the following
[clock correction](#irreversible-post-response-clock-observations-2026-10-06)
records that finding separately. Full deployed certification is still deferred.

Independent review of `9f328ca` found two Important defects despite its passing
suite: overlapping Auth creates could replace the target between SELECT and
INSERT, and delayed durable checkpoints or exact readbacks could extend the
five-minute window. Deterministic semantic RED reproduced both. The real local
D1 reproduction left the requested database empty and persisted one
user/profile/flow/audit in the other database; a delayed final GET also allowed
bootstrap after the original deadline. Diagnostics contain only outcomes,
UUIDs and counts, not generated grants or synthetic secrets.

The client now reserves D1 creation before its first await, refusing overlapping
same-client creates without sibling resources and releasing the reservation on
completion. Bootstrap captures one immutable Auth/Product/run/account creation
context and rechecks that exact context after queue acquisition, before and
after every exact GET, and immediately before SQL transport. Dependency deletion
or changed ordinary readback cannot restore authority during a pending GET or
checkpoint. These are process-local safeguards, not distributed provider locks.

The immutable creation deadline starts immediately before Auth POST transport,
so response/checkpoint latency consumes it. Validity is the half-open interval
`[createdAt, createdAt + 300000)`; exact expiry and backward clocks revoke
authority without readback renewal. Root grant expiry remains 600000 ms. Tests
use deferred boundaries and controlled clocks, not sleeps: literal ages 299999,
300000 and 300001 ms, delayed POST/checkpoint/final GET, backward clocks,
queued expiry/deletion and checkpoint dependency revocation. Actual local D1
tests verify one committed root on the requested database, zero rows in the
other run and zero persisted bootstrap effects after expired final readback.
Existing recovery, grant hashing, retry/concurrency, audit rollback, isolation
and CLI security assertions remain intact.

**Table — Final local verification on the asynchronous-fix source**

| Command | Result |
|---|---|
| Whole real D1/bootstrap runner file | 6/6, zero failures/skips, 8.99 s; actual target integrity and expired-readback zero rows. Focused cloud lint and Identity typecheck exit 0. |
| `node --test scripts/cloud-e2e/*.test.mjs` | 318/318, zero failures/skips, 3,035.52 ms. |
| `pnpm test` | 100 Vitest files / 1,590 tests plus nine Node tests, zero failures/skips; 62.52 s shell. Identity: 221 Worker plus 89 Node tests. |
| `pnpm build`, `pnpm lint` | Both exit 0, 11.89 s / 0.96 s shell; existing dashboard chunk and two Fast Refresh warnings remain. |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` | One serialized full run after tests/build/lint: 5/5, zero failures/skips, 22.3 s (23.20 s shell); three existing colour-environment warnings. |

Final commands ran after production/test self-review; only verification/status
docs followed. Installed locked Node/pnpm/Wrangler and ordinary local loopback/
log access were used, with no install, compatibility/configuration change or
retry/skip workaround. Complete outputs and distinct browser artifacts are
retained in ignored fix-round evidence; historical SQLITE_BUSY cause remains
unproved. The original table retains its original `9f328ca` provenance. No live adapter,
graph receipt, VerifiedStack, public Worker write, Task 7 progression or Notion
publication followed from that source correction; its mirror still reflected
Task 6a only. The separately approved status sync below changes no provider/live gate.

### Irreversible post-response clock observations (2026-10-06)

The separately approved local correction preserves the exact post-response
timestamp already recorded in the durable Auth checkpoint through completion.
Observed expiry or reversal permanently disqualifies bootstrap authority, even
after later clock recovery; ordinary exact-ID creation and read remain usable.
Independent scoped re-review of `07af8ed` is complete: residual I2 addressed,
no new Critical/Important breakage or out-of-scope observations
(`task-6b-fix2-review.md`). I1 was already closed by the `a07cf37` review;
both Important findings are addressed and the bounded local slice is accepted.

Scoped review of `a07cf37` reproduced POST age 300001 ms followed by checkpoint
completion age 100 ms accepting an INSERT. Completion had discarded the earlier
observation. Deterministic consumer RED also reproduced exact-expiry age 300000,
in-interval reversal 200 to 100, and post-response time before birth. All four
accepted both initial and recovered bootstrap and transported four SQL queries.
Actual local D1 RED for ages 300001 and 200 persisted one user/profile/flow/audit
in the requested database; the other run stayed empty.

The retained checkpoint observation is validated against the original half-open
five-minute deadline and completion against that observation. There is no hidden
resampling or deadline renewal. Existing creation reservation, immutable target
pinning, queued/readback/SQL boundary checks, revocation fencing and 600000 ms
root grants are unchanged. Actual local D1 GREEN verifies zero bootstrap rows in
both databases and unchanged Product sentinels after initial and recovered
attempts, plus retained durable Auth UUID/ordinary read. No new dependency,
runtime configuration, sleeps, retries or provider transport is introduced.

Initial consumer RED used ambient `/opt/homebrew/bin/node` 26.6.0 rather than
the approved runtime; initial pnpm child runtime was not explicitly pinned.
Those captures are retained as intermediate evidence, not Node 22 proof. A
narrow reversal/restoration of only the clock fix reproduced semantic RED on
explicit existing Node 22.18.0/pnpm 11.14.0 with Corepack networking disabled:
66 pass/4 expected failures (83.23 ms), and actual D1 two expected failures
(1.67 s; six name-filter exclusions). All final checks use the approved explicit
runtime and restored final source; earlier tables retain their original source
provenance. Full safe logs are retained separately in ignored fix-round evidence.

**Table — Final local verification on accepted source `07af8ed`**

| Command | Result |
|---|---|
| Covering root/client and whole real D1/runner file | 70/70 (79.61 ms) and 8/8 (9.66 s), zero failures/skips. Actual original/other-run rows remain empty after reversal/recovery, with Product and durable UUID retained. Focused lint/Identity typecheck exit 0. |
| `node --test scripts/cloud-e2e/*.test.mjs` | 322/322, zero failures/skips, 1,908.46 ms. |
| `pnpm test` | 100 Vitest files / 1,592 tests plus nine Node tests, zero failures/skips; 58.78 s shell. Identity: 221 Worker plus 91 Node tests. |
| `pnpm build`, `pnpm lint` | Both exit 0, 11.37 s / 0.81 s shell; existing dashboard chunk and two Fast Refresh warnings remain. |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` | One serialized full run after tests/build/lint: 5/5, zero failures/skips, 22.6 s (23.39 s shell); three existing colour-environment warnings. |

These commands use explicit Node 22.18.0/pnpm 11.14.0 with the same Node bin
prepended to child PATH, Corepack networking disabled and locked-dependency
verification on the project/build/lint/browser commands. Production/tests
were frozen before final checks; only verification/status docs followed. Full
logs and distinct browser artifacts are retained; the earlier incomplete
runtime provenance and historical unproved SQLITE_BUSY cause are not relabeled.
Root's fresh committed Node 22 covering checks passed 70/70 (78.89 ms) and
real D1/runner 8/8 (9.39 s). The accepted source remains `07af8ed`, not the
closing prose commit; no unchanged code suite was rerun for these status notes.
Acceptance covers only the bounded local bootstrap safeguards, not full
Task 6b, the branch, production/staging or any live certification.
The prior Task 6a-only mirror was unchanged by those closing notes. The later
separately approved narrow status sync follows; zero-transport public Worker
refusal and all deployed/provider/HTTPS/passkey/teardown/every-push gates remain
unchanged, with no Task 7 progression.

## Reviewed local bootstrap status synchronization (2026-10-06)

Reviewed nonsecret Task 6b status is now mirrored to the four existing
[roadmap](https://app.notion.com/p/3a6e5c7c2b8e81f6b412c45a2bc7b344),
[design](https://app.notion.com/p/3ebe5c7c2b8e8186866ef1e158bfd880),
[plan](https://app.notion.com/p/3ebe5c7c2b8e81229ee0d8a0acb2d309) and
[Plans index](https://app.notion.com/p/390e5c7c2b8e8165b7f7d77392eab088)
destinations. Each narrow nondeleting replacement superseded only the prior
current-status paragraph. PATCH and fresh complete GET strings exactly matched
the original whole page plus the approved replacement, without normalization
or a formatting exception. All 17 ordered native child URLs/titles and active
destination/child metadata were preserved. Root independently verified all
four whole pages, all 17 pairs and all active metadata/title checks.

The canonical status identifies accepted tested source `07af8ed`, findings
addressed across `a07cf37`/`07af8ed`, and closing documentation `4d6df6a`.
Source and closing-note reviews are complete (`task-6b-fix2-review.md`,
`task-6b-closing-notes-review.md`). It retains the explicit Node 22 results
above: 322 controller tests, 1,592 Vitest plus nine Node tests, eight real
local D1/runner tests and five local Playwright tests (22.6 s), with build,
lint and affected type checks passing. These are accepted-source evidence;
this documentation-only synchronization ran no new code suite. Persisted state,
recovery, concurrency, isolation and zero-bootstrap-SQL/row refusal evidence
retain their provenance. Task 6a remains locally accepted on `736e213`.

This is summary publication, not wholesale reproduction of newer local
sections. The clarification request body remains local and unsent. Existing
dashboard chunk/Fast Refresh and Playwright colour warnings remain, and the
earlier intermittent `SQLITE_BUSY` cause is still unproved. Acceptance is only
for bounded local safeguards: authenticated protected configuration, remote
query atomicity, deployed service/version/D1/Access/assets graph, cloud HTTPS/
passkey, teardown, two-cloud-stack and every-push acceptance remain pending.
Public Worker writes still refuse transport; no live-controller wiring, push,
deployment or Task 7 progression follows.
