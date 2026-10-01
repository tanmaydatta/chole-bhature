# Per-PR Cloud E2E pilot ledger

**Baseline recorded:** 2026-09-30
**Status:** Local baseline, Tasks 1–4 guard foundation, and the approved
2026-10-01 Task 5a/5b mock-only Beta protocol and controller slices are
complete. Public Worker mutations remain disabled; the local evidence is not an approved Cloudflare
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

`teardownMockStack` accepts only the same process-local registered run/account.
Before any Worker is created, it can remove proven D1s in reverse order after
exact-ID/name GETs and observed absence after DELETE. Changed ownership,
ambiguous creates, failed checkpoints, or any remaining Worker/Access graph
leave resources in the reported inventory and stop dependent deletion. Its
`local-cleanup-observed` outcome records a mock D1 cleanup, with
`complete:false`; it is not a completed Cloudflare teardown. Original failure
and cleanup failure have separate sanitized codes. Same-run overlap/replay is
reserved locally, while different trusted runs can progress in one store.
There is no distributed lock, store CAS, audit recovery, live adapter, CLI,
or provider proof.

The current local cloud-script result is **79/79** on 2026-10-01. The new
controller tests cover ordered progression, a single ambiguous create attempt,
migration and cleanup failures, stale/changed evidence, ID checkpoint failure,
same-run overlap, distinct-run progress, bounded transient reads, timeout,
and staging/other-run refusals. The D1 guard also now rejects a returned UUID
already present in pre-create discovery, preventing substitution of an
existing staging database. This is mock-boundary evidence only; full Task 5,
live Cloudflare lifecycle, alternate-URL/HTTPS checks, real cleanup, the
Playwright suite, and the every-push workflow remain incomplete. The Notion
mirrors still reflect the earlier Task 5a 50-test state; this local update has
not been exported.

**NO-GO for a live pilot:** Beta recovery/audit evidence, provider response
completeness, assets/JWT, service-name remapping, live D1 migrations, version/preview
exposure, Access behavior, and two-stack acceptance require separate approval
and disposable-account proof. No authenticated Cloudflare request was made.
