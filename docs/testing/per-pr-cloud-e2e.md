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
incomplete. The bounded 2026-10-05 provider-contract investigation is complete
locally; no supported race-safe Operator upload path was established. Its
conditional writer-boundary proposal and separate provider/account-proof
gates below await independent review and any later approval.
Public Worker mutations
remain disabled; the local evidence is not an approved Cloudflare
pilot, deployment, credential change, or every-push workflow.

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
| Managed local-stack passkey bootstrap | During local stack setup, CDP enables WebAuthn and adds a virtual CTAP2 authenticator with resident key and verified user support. The browser opens root setup, submits the activation grant, creates the root passkey, requires the `Save your root recovery codes` heading, acknowledges the codes, finishes setup, chooses `Sign in with passkey`, and requires the `Sign in to Incentives` heading to become hidden. It then saves a cookie-containing root storage state with mode `0600`. This is current managed-local setup coverage only: it is not a staging assertion. The future `cloud-ci` flow must separately prove the equivalent real HTTPS passkey registration/sign-in and scoped state handoff on its disposable stack. |
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
full `ci` application configuration remains Task 6.

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
blockers. Notion synchronization of these new findings is held for independent
local review.
