# Per-PR Cloud E2E — Design Spec

**Status:** Approved design under local implementation. On 2026-10-01, the
Beta lifecycle amendments 5a/5b were approved for bounded mock-only planning,
identity transitions, controller orchestration, and validation; they are not approval for a live API call, pilot, deployment, or
workflow.

**Date:** 2026-09-29

**Notion mirror:** https://app.notion.com/p/Per-PR-Cloud-E2E-Design-Spec-3ebe5c7c2b8e8186866ef1e158bfd880

**Mirror state:** The approved Task 5a/5b mock-only protocol and controller
status is synchronized: 83 local cloud-script tests pass, public Worker writes
remain zero-transport refusals, and no live provider behavior, pilot,
deployment, or workflow is claimed.
The separately approved 2026-10-02 raw-module packaging correction is local
implementation evidence; its approved `8aa2d8c` metadata fix passed scoped
independent re-review with no open findings. The existing design/plan mirrors
and roadmap/Plans-index summaries were narrowly synchronized on 2026-10-02:
62 focused/139 cloud-script tests and real three-role byte/syntax/SPA/SQL proof,
with historical 83 and prior `66c0298` full-project provenance retained.
Fresh complete readbacks passed; all 17 index child links/order were preserved
and resolved. This synchronization closes no provider/live gate.
Task 5e's second candidate diagnostic deliverable was separately approved on
2026-10-05 and is implemented with local verification. Initial review found
shared D1 isolation-fixture IDs; the test-only correction `e0ce221` passed
independent scoped re-review with no open findings. The four existing Notion
destinations were narrowly synchronized on 2026-10-05 with complete readbacks
and all 17 index child URLs/titles/order and active metadata preserved. No
provider/live gate was closed.

The bounded provider-contract investigation at `ea8620f` passed independent
review on 2026-10-05 (0 Critical/Important, one nonblocking retained-version
clarification incorporated in the closing proposal). Reviewed nonsecret
findings were narrowly synchronized to the four existing Notion destinations:
exact complete readbacks passed with all 17 ordered native children and active
metadata preserved, no formatting exception. Root independently verified all
four pages and 17 destinations. No supported race-safe Operator upload path or
adopted prerequisite follows; closing status-note review of `eb72ae5` is complete
(spec compliant / quality Approved, no findings;
`task-5f-notion-sync-review.md`). The prior
Task 5e review at `c42088f` is complete with no findings.

## Goal and success criteria

Run the existing staging-class Core/API, Identity, and Operator Playwright suite on **every new push to a same-repository pull request**, against that push's own temporary Cloudflare stack. A newer push cancels the older run for that PR. Different PRs may run together without sharing Workers, databases, root sessions, Access credentials, fixtures, or cleanup ownership. Fork PRs do not receive cloud E2E. The manually operated staging stack and static demo remain untouched.

Passing means the real browser passkey flow and the full applicable API/browser assertions run over deployed HTTPS Workers and two remote D1 databases. The exact GAP-030/031 business values, persistence inspection, idempotency, concurrency, and zero run-owned-row checks remain required. A status-only smoke or a substitute set of assertions does not satisfy this design. The current suite does not assert real email delivery; this design does not add that claim.

## Existing baseline and alternatives considered

Today [CI](../../../.github/workflows/ci.yml) builds, lints, and runs tests on PRs and `dev`; its concurrency is keyed by Git ref. [Playwright](../../../tests/e2e/README.md) has a managed local stack and a staging target. The staging target pins `operator.staging.wastd.dev` and `api.staging.wastd.dev`, its root login assumes an owner-held session, and the staging root bootstrap CLI names the manual Auth D1. Identity's staging mode requires Resend and staging Secrets Store bindings. None of these paths can safely be repointed at temporary resources by changing only environment variables. The current staging evidence is four applicable passing tests and one local-only skip; the local suite has five tests with two Playwright workers.

Three approaches were considered:

| Approach | Benefit | Reason for decision |
|---|---|---|
| Run each PR against manual staging | Minimal deployment work | PRs share state and deployments; pushes can interfere with owner operations. Rejected. |
| Use native Worker Previews | Cloudflare manages preview versions | Preview service bindings currently call the bound Worker's production deployment, so this three-Worker topology would cross the stack boundary. Rejected for this design. |
| Create three named Workers and two D1 databases per run | Exact bindings and data isolation, with independent PR runs | Chosen. Requires a trusted controller, Access bootstrap, and reliable teardown. |

The Preview limitation is documented in [Cloudflare's resource isolation guide](https://developers.cloudflare.com/workers/previews/resources/).

## Stack identity and topology

A stack key contains the repository identity, PR number, exact head SHA, GitHub run ID, and run attempt. The controller derives short, valid Cloudflare names from that tuple, never from a PR title, branch string, or artifact-supplied name. The run ID and attempt make reruns of the same commit distinct. Each key owns exactly:

- three temporary Workers: public-routable Core/API, private Identity, and public-routable Operator;
- one Product D1 and one Auth D1, both newly created and migrated for this key;
- a Worker-level Cloudflare Access application for each routable Worker and one service token accepted only by these two applications;
- unique Worker secrets, root identity/session, and E2E run manifests.

“Public-routable” means the API and Operator have HTTPS origins after protection is verified; anonymous requests must be denied by Access. Identity has no public route. Operator binds only to this key's Core and Identity; Identity binds only to this key's Core. Both D1 bindings use the exact IDs returned for this key. No configuration may name `incentives-api-staging`, `incentives-identity-staging`, `incentives-operator-web-staging`, the manual staging D1 IDs, staging custom domains, or the demo Worker. Generated config is validated against a controller-owned allowlist of identities and binding graph before every Cloudflare mutation.

Use distinct `workers.dev` hostnames for the two routable Workers so a run needs no wildcard DNS or staging custom-domain change. Worker names must fit Cloudflare's limits; full key fields remain in the controller inventory even if names contain shortened hashes. The exact Operator hostname is the passkey RP ID and `PUBLIC_APP_ORIGIN`; the API hostname is the exact E2E API origin. Hostname ownership and HTTPS readiness are checked before fixtures. Disable preview URLs and verify that no version/deployment URL bypasses Access. [Cloudflare documents](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) that a `workers.dev` route can be re-enabled by deployment unless the config explicitly sets `workers_dev = false`; generated configs must control this property on every deploy.

## Trust boundary and workflow

A protected default-branch `pull_request_target` workflow handles `opened`, `reopened`, and `synchronize` events. It accepts only a PR whose head repository is this repository and whose current head SHA matches the event; a close event triggers prompt cleanup as an additional path. The whole run uses a PR-number concurrency group with `cancel-in-progress: true`. This cancels an older push for the same PR without serializing different PRs. Check the live PR head again before any deployment and before tests: a stale run stops provisioning or testing, then only its own stack is cleaned. GitHub does not promise ordering among queued concurrency runs, so SHA freshness is the authority, not queue order. Keep the existing build/lint/unit CI gate; cloud E2E is an additional required PR check once the pilot passes.

The unprivileged build job checks out the exact PR head and may execute its dependency, build, and test scripts. It has read-only repository permission, no Cloudflare account credential, no owner staging secret, no shared privileged cache, and a fresh runner. It produces versioned bundle, dashboard asset, and migration artifacts with a manifest and hashes. Those artifacts are untrusted data.

The privileged controller job runs **only protected-branch controller code** on a separate runner. It verifies the GitHub repository, PR number, current head SHA, producing run ID/attempt, artifact origin and hashes, artifact format/size, and expected paths. It does not source a PR shell file, load a PR module, run PR package scripts, or accept artifact-supplied resource names, URLs, commands, Wrangler config, or cleanup targets. It may upload PR-built Worker JavaScript and apply PR-authored SQL migrations **as data** only to this run's disposable resources. Untrusted Worker code can execute after deployment and may exfiltrate its disposable secrets or consume account resources; it never receives the account token, owner staging data, or shared Secrets Store bindings. The controller uses a fixed trusted deploy mechanism and fixed generated config, and account credentials leave its job before browser tests start.

Cloudflare account permissions for Workers, D1, and Access may be broad at the product/account level; a naming prefix is a controller application guard, **not** a Cloudflare-enforced token scope. The controller therefore verifies every resolved resource ID against the run tuple and expected existing inventory immediately before update or delete. It never chooses a target from an untrusted artifact alone. Same-account quotas and malicious PR Worker egress remain residual risks; cap per-run duration/resources and alert on abnormal spend.

After provisioning, an unprivileged Playwright job runs on a separate runner. It receives only the two verified origins, a stack-specific short-lived Access service credential, and a stack-specific root browser state. These temporary test credentials may be read by PR test code, so they grant access only to that disposable stack and are revoked at teardown. They are transferred as repository-scoped, short-retention workflow artifacts, never as command-line arguments, logs, repository files, or outputs from the privileged controller. Repository readers with artifact access may be able to retrieve them during their short lifetime; this is an explicit residual risk. The Playwright job has no account token and no manual staging root state. Its success cannot authorize Cloudflare deletion or change the controller's inventory.

GitHub's [`pull_request_target` guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows/) warns against running untrusted PR code with privileged context. The separate runners, trusted controller checkout, minimal job permissions, and absence of shared caches are mandatory. The design's protected workflow file must be reviewed on the default branch before enabling this trigger.

## Fail-closed provisioning and Access gate

The controller writes a trusted inventory checkpoint after each successful create and can rediscover deterministic names if cancellation occurs between creation and checkpoint. It records the exact Cloudflare IDs and run tuple in restricted, short-retention controller evidence; the janitor also enumerates the reserved prefix to find incomplete stacks. Discovery must verify exact names, IDs, bindings, and creation ownership before mutation; an ambiguous or foreign match stops and alerts rather than deleting it.

The original sequence that deployed Core, Identity, and Operator **before**
creating Worker-level Access is **superseded for implementation**. It cannot
establish that the first code upload avoids a transient public route or
alternate version/deployment URL. No Task 5 Worker create, upload, deploy,
route change, or delete may use that sequence. Task 4's zero-transport Worker
write refusal stays in force. The approved mock-only protocol below does not
establish provider behavior; a live pilot has its own separate approval gate.

The required provisioning checks remain: validate eligibility, current SHA,
budget/quotas, generated names, and the two newly created exact-ID D1s with
matching PR migrations. Reject a missing, reused, or staging D1 ID. Keep
Identity unrouted, use only this run's validated service/D1 graph and unique
`AUTH_SECRET`, `OPERATOR_SELECTION_SECRET`, and `DECISION_SIGNING_SECRET`, and
exclude manual staging and shared Secrets Store entries. Before any Worker
code can become reachable, verify two Worker-level Access applications with
exclusive `Service Auth` policies for **this stack token's ID**, not “any
service token,” and exact Core/Operator destinations; no public route may be
enabled while policy state is uncertain. Anonymous, cross-stack-token, and
alternate URL probes must fail closed. Only then may the matching token reach
each HTTPS origin; verify Identity remains private and every service/D1 target
belongs to the run. The synthetic root, browser WebAuthn passkey flow, and
read-only cross-Worker capability handshake precede release to tests. The
approved lifecycle revision must specify how to prove these checks before
Worker mutations are enabled.

[Cloudflare Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) supports Worker-level protection across a Worker's domains, and [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) are accepted through a `Service Auth` policy. Whether this account's Access permissions, API lifecycle, route publication sequence, and service-token headers work with Playwright's top-level navigation, assets, redirects, and WebAuthn must be proven in a **disposable-stack feasibility pilot** before automatic per-PR deployment is enabled. The pilot must demonstrate no public reachability before protection, anonymous denial afterward, passkey registration/sign-in, and token isolation using two temporary stacks. If the account cannot create per-Worker Access apps or service tokens without broader Access administration than the owner accepts, or cannot keep routes disabled until protection is active, this design is blocked; do not silently switch to public Workers or reuse a broad token. The Access token may require broad `Access: Apps and Policies Write` and `Access: Service Tokens Write` permissions; that is an acknowledged controller risk, not a proven per-stack Cloudflare permission boundary.

**Approved mock-only Beta lifecycle amendment (2026-10-01; not live):** Public [Beta Worker
create/get/edit/delete](https://developers.cloudflare.com/api/resources/workers/subresources/beta/) and [ID-addressed version creation](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/) suggest creating an empty Worker with `subdomain.enabled:false` and `previews_enabled:false` in its initial JSON request, checkpointing its returned immutable Beta `id`, attaching and reading back Worker-level Access, and only then uploading/deploying code by that certified ID. The current name-based script upload followed by a disable call is not a proven safe first-publication sequence; Task 4 correctly refuses all Worker writes. The Beta `{worker_id}` path also accepts names, so the controller must never use a name fallback. Legacy script-list `tag` is documented as an immutable script ID, but its equivalence to Beta Worker `id` is not established. Service bindings still name target Workers, so exact-ID caller operations alone do not settle target replacement/remapping. Keep the same isolation, credential separation, checkpoints, audit recovery, route and alternate-URL denial, and fail-closed requirements. The [feasibility ledger](../../testing/per-pr-cloud-e2e.md#worker-api-feasibility-public-documentation-2026-09-30) lists the unresolved API and live-proof gates; none authorizes an implementation change or live Cloudflare call.

The approved local scope uses opaque local receipts, not caller-provided
inventory/boolean/version sentinels. In `creating` phase, a fixed synthetic
mock GET pre-create envelope must prove an empty result and be durably
checkpointed; only that single-use receipt can create the fixed disabled
request. Its matching synthetic POST create-result and later fixed ID-addressed
GET readback, with the same run/role/account, bounded freshness, and one exact
result, can be durably checkpointed into the ID receipt. Both Access
attachments then require their own durable synthetic receipts before later
readbacks. Legacy `workerIds` remain legacy tags and cannot enter any Beta path.
A subsequent approved local amendment removes future-ID preseeding: all three
disabled empty Worker ID receipts are required before a service-token
pre-create list and durable create intent can yield a single-use fixed POST
plan. Matching token POST result and exact-ID GET readback must pass a durable
inventory checkpoint before its ID is usable. The sibling receipts must share
the same run/account and exact inert Product/Auth D1 binding graph. Each Access app similarly
requires an empty pre-create list, durable intent, pure single-use POST plan,
whole-graph POST result and exact-app-ID GET readback, then durable ID
checkpoint. The plans require certified 32-lowercase-hex Beta Worker IDs,
controller-derived names, the exact account and this run's token, and exactly
one `non_identity` service-token include without overrides or extra conditions.
Each successful identity checkpoint rotates all three role receipts and revokes
their earlier planning, attachments, and prepared evidence. Failed or
overlapping checkpoints remain fail-closed; an old receipt cannot be refreshed
with a later clock or caller-supplied inventory. This is a local store/process
reservation and synthetic correlation contract, not provider creation proof.
A complete fresh local context additionally requires the exact inert Worker
graph, empty-version-list observation, and exact API/Operator Access
observations. Only that context may produce PATCH/DELETE/version plans.
Unknown fields, duplicate/malformed/stale/wrong-run envelopes,
deleted/quarantined phase, deployment, public override, unknown version/binding
graph, assets, and service remapping refuse; Operator upload reports
unsupported. These synthetic envelopes are local correlation evidence only,
not authenticated provider proof or Cloudflare authorization. Evidence contexts
are expiry- and phase-generation-bound, checked at every planning action, and
consumed after one plan. A local registry scoped to the injected evidence store
and canonical trusted run/role treats reordered fields of the same StackKey as
one identity and reserves an in-progress transition before its await. It
does not retry a failed reservation. This is deliberate mock-process state, not
store CAS, cross-process coordination, provider proof, or authorization.

The bounded 2026-10-01 Task 5b mock controller composes those receipts after
the real `bundle-v1` verification boundary. It locally orders exact D1
creation/readback and verified SQL migration data before the disabled empty
Worker sequence, then token, Access, attachment, and fresh readback gates. A
pure API version plan is reached, but no version is uploaded or deployed;
Operator service-binding remapping and assets remain unsupported. Local
teardown can remove mock-proven D1s before Workers exist, after exact-ID reads
and observed absence. A failed D1 pre-create read or intent is not an attempted
create; an ambiguous Auth POST retains Auth while independently proven Product
can still be cleaned. An unresolved Worker/Access dependency graph still blocks
dependent D1 deletion and remains in inventory. Teardown resolves only a
verifier-established private controller session; raw or copied session objects
cannot mint cleanup authority. Same-run overlap is refused within one process;
distinct runs can
progress in one mock store. The reviewed Task 5b 2026-10-02 suite passed 83/83
cloud-script tests. This does not establish provider schemas, authenticated
ownership, live readiness, complete teardown, HTTPS/passkey behavior, or a
production controller adapter. The reviewed Task 5b 83-test mock-only status
was synchronized to the existing Notion mirrors on 2026-10-02 in `65854ca`.
After independent review, the Operator feasibility summary and unadopted
packaging-first proposal below were synchronized to the existing Notion design
and plan on 2026-10-02. Roadmap/index next-step summaries were updated without
changing historical evidence or adopting implementation; full readbacks passed.

### Operator packaging and proposed candidate boundary (2026-10-02)

Live Operator upload remains **NO-GO**. The [dated evidence](../../testing/per-pr-cloud-e2e.md#operator-upload-feasibility-2026-10-02)
establishes name-addressed service bindings and asset sessions, without an
atomic immutable-target constraint or proved account writer boundary. Fresh
name/ID readbacks cannot exclude replacement after validation. HTTP version
overrides cannot pin the named RPC entrypoints. This investigation does not
amend the approved isolation model, enable transport, or authorize live proof.

The separately approved packaging deliverable corrects the module byte
contract. Wrangler 4.112.0 `--outfile` produced multipart upload data that the
historical producer stored under module paths. The unprivileged producer now
uses fixed role/config/output selection with `--outdir`, taking only regular
`worker.js` bytes for each role. Missing, stale, nonregular or extra runtime
outputs refuse. After review exposed runtime Text modules hidden under README
and map names, the approved producer fix requires explicit fresh build metadata
outside the outdir. Selected output paths resolve against the fixed config's
project root, with entry-point/input association and exact byte counts. Only
the main module and a proven generated map are represented; missing, malformed
or mismatched metadata refuses. Runtime file imports refuse even when named
like sidecars. Exact observed external platform imports (`cloudflare:workers`,
`node:crypto`, and Identity's dynamic `node:async_hooks`) remain supported;
namespace prefixes alone are not accepted. The verifier rejects the recognized pinned multipart metadata
envelope before extraction through a bounded byte-prefix check. It remains
an archive/JSON/byte reader, without importing or compiling PR source.
Artifact checksum success and this format rejection do not prove arbitrary
JavaScript validity or provider compatibility; compile-only checks belong in
the unprivileged build.

The [packaging evidence](../../testing/per-pr-cloud-e2e.md#raw-module-packaging-correction-2026-10-02)
retains the initial `66c0298` result (29/29 focused, 106/106 cloud-script) and
records the metadata correction's 62/62 focused and 139/139 cloud-script tests,
focused producer/test lint and an actual amended three-role pinned-Wrangler
build/archive round trip. Selected and
archived modules match byte for byte and pass unprivileged compile-only checks;
all five SPA assets and fourteen SQL migrations match their exact source path
sets and bytes, with no Worker sidecars or build metadata archived. The dated
2026-10-02 project test at `66c0298` passed 97 Vitest files / 1,395 tests plus
nine Node tests; it was not repeated for the isolated producer metadata fix.
Independent scoped re-review passed with no open findings. This resolves the bounded local
packaging mismatch, without proving provider acceptance or enabling upload.

Code references:

- Producer: [build-artifact.mjs](../../../scripts/cloud-e2e/build-artifact.mjs).
- Verifier: [artifact.mjs](../../../scripts/cloud-e2e/artifact.mjs).
- Selection/refusal tests: [build-artifact.test.mjs](../../../scripts/cloud-e2e/build-artifact.test.mjs).
- Checksum-valid format/consumer regressions: [artifact.test.mjs](../../../scripts/cloud-e2e/artifact.test.mjs).

The separately approved 2026-10-05 Task 5e mock diagnostic now compares exact
Operator/SPA byte snapshots, the fixed SPA/ASSETS profile, four service edges
and certified run/account/role IDs against a distinct hypothetical observed
version graph. It requires complete distinct `betaWorkerIds` without legacy
tag fallback, a separate exact expected version UUID map, API `DB`/Product,
Identity `AUTH_DB`/Auth plus Core, and Operator ASSETS with no D1. It does not
change the controller's inert Identity `DB`/no-Core graph or empty versions.
The synthetic `complete:true` flag grants no provider assurance or upload
permission, and incoming `references.workers` cannot populate outgoing edges.

Strict synthetic session/bucket/completion records compare exact snapshot
digest and fixture upload labels, run/account/Operator/session correlation,
ordered dense buckets and completions, opaque nonempty tokens, recorded
expiry and finite fresh clocks within five minutes. The local digest uses
sorted normalized `[path,size,rawSha256]` tuples; it is not a provider upload
hash. Tokens are not parsed, logged or returned, and no future Operator version
UUID is preseeded or claimed as a JWT binding. The [diagnostic contract](../../testing/per-pr-cloud-e2e.md#operator-candidate-diagnostics-2026-10-05)
defines the precise local schemas and fixed routing profile. Every valid case
still returns `unsupported` with the four unresolved service-remapping,
name-addressed asset-session, provider upload-hash and completion-scope
blockers, never a request or receipt. No transport is injected into these
diagnostics; actual controller tests retain zero Worker-version/session/asset
upload calls after both Access gates and earlier refusal on either failed gate.

Initial Task 5e focused GREEN at `50cbfa1` was 147/147; the cloud-script regression was 275/275
with zero failures/skips and focused lint passing. These new counts are
separate from the historical 83/139 results and dated `66c0298` project test.
Only final per-run edge assertions/docs changed after the cloud run; final
focused tests passed 147/147 in 239.948875 ms and focused lint passed again.
The subsequent 2026-10-05 review fix gives the two-run fixture distinct literal
Product/Auth D1 pairs and expected version maps, asserts exact per-run
associations/disjoint Worker and D1 IDs, and rejects individual D1 record/ID
and version-map swaps with recipient keys/observations retained. Both valid
fixtures remain unsupported with all four blockers. Semantic RED was 146 pass /
16 assertion failures; focused GREEN is 162/162 (186.830125 ms), with lint and
diffcheck passing. Production is unchanged; the 275-test cloud/full-project
results retain their pre-fix provenance. Root's fresh `e0ce221` cloud regression
passed 290/290, zero failures/skips, in 4,651.59 ms; independent scoped re-review
found the isolation issue addressed with no open findings.
The single guarded 2026-10-05 project test passed 97 Vitest files / 1,395 tests
plus nine Node tests with zero failures/skips, using approved local-only
loopback/log permission and no dependency restoration or implicit install.
This original `50cbfa1` project result is not a repeated full suite at `e0ce221`.
The approved nonsecret status was narrowly synchronized on 2026-10-05 to the
four existing Notion destinations. Fresh whole-page readbacks matched only
authorized substitutions (with one explicitly reviewed design newline
rendering); all 17 native child URLs/titles/order and active metadata were
preserved, with root independently verifying all four pages and 17 destinations.
No next provider task was adopted. The
[bounded plan](../plans/2026-09-30-per-pr-cloud-e2e.md#proposed-next-mock-only-operator-slice-2026-10-02)
still grants no upload authority. Transport, deployed bindings, JWT
signature/scope, atomic replacement behavior and URL protection remain unproved.
An ID-constrained provider primitive or explicitly approved enforceable writer
boundary, then narrow inert account proof of session/JWT/hash/routing behavior,
is required before revisiting upload support. A same-account lock or a passing
mock is not that boundary. Existing full Task 5, Task 6 `ci` configuration,
HTTPS/passkey, teardown and rollout gates remain incomplete.

### Provider prerequisite conclusion (2026-10-05)

The [dated provider-contract findings](../../testing/per-pr-cloud-e2e.md#provider-target-and-assets-contracts-2026-10-05)
retain all four blockers. Service binding names/entrypoints do not pin callee
IDs or versions, RPC cannot use HTTP version overrides, complete version GETs
and paginated deployment observations are state checks rather than atomic
constraints, and asset sessions have no established stable-ID precondition.
Pinned BLAKE3 and the documented SHA-256 example disagree; local vectors prove
that difference only. The documented session bearer/final completion lifecycle
does not guarantee a JWT per bucket or prove immutable target scope and
wrong-target/expired redemption. No future Operator version UUID may be preseeded.

Recommendation is provider clarification before an executor. A documented
ID-constrained target/precondition remains preferable. Alternatively, an
explicitly proposed same-account writer-boundary amendment would require a
protected broker with exclusive effective CI lifecycle authority and durable
fencing over create/upload/use/teardown, including rename/recreate and target
deployment. Cloudflare's [new per-Worker scopes](https://developers.cloudflare.com/workers/authorization/workers/)
are a possible enforcement component, not an adopted boundary: Editor permits
rename, create needs product Admin, legacy broad writers remain valid, and
deploy permissions do not isolate bound resources. Scope identity durability,
concrete policy syntax and all Beta/assets/JWT endpoint coverage need provider
clarification and separate account proof.

The [canonical clarification request](../../testing/per-pr-cloud-e2e.md#cloudflare-clarification-request-draft-2026-10-05)
is a local draft dated 2026-10-05, not sent or synchronized to Notion. No ticket
or channel is selected, and no provider response is pending. Selecting a
destination, the exact final message and sending need separate explicit
approval; interpreting any reply and adopting a prerequisite remain separate
gates. The draft supplies no target, permission, hash or token guarantee.

All dashboard/token/OAuth/build-hook/IaC/CI/cleanup/admin writers must be
restricted or mediated, including ability to regrant access. Scoped deploy
tokens do not remove owner/admin bypass. The [conditional boundary](../../testing/per-pr-cloud-e2e.md#conditional-same-account-writer-boundary)
preserves manual staging/demo in the same account; changing their operating
permissions or routing manual operations through a broker needs explicit
amendment approval. If bypass exclusion cannot coexist with that preservation,
retain NO-GO. Naming conventions and account locks are insufficient.

After a prerequisite is independently reviewed and approved, narrow trusted-inert
two-stack account proof must separately check enforcement, outgoing graph,
replacement/rename, hash/JWT compatibility, served bytes and all initial/alternate
URL protection. Sampled results cannot prove universal race freedom. No
account operation, source/test change, new suite count, transport authority or
live acceptance follows from this documentation. Current `e0ce221` 162/290 and
original `50cbfa1` project evidence retain their provenance. Full Task 5 and
the later `ci`, HTTPS/passkey, full GAP, disposal and rollout gates remain open.

## Cloud-CI application mode and suite behavior

Add an explicit `cloud-ci` target instead of relaxing the existing staging origin checks. Generated Workers use a `ci` application environment tied to the controller-verified stack key. Product, Auth, Operator, fixture, capability, inspection, and disposal guards admit `ci` only with this isolated stack marker and exact D1 bindings. Production and manual staging guards retain their existing behavior. The cloud target requires HTTPS origins matching the controller manifest, and rejects the manual staging domains, stale SHA, missing Access credential, or a mismatched stack ID before fixture writes. The trusted root bootstrap operation targets the exact newly created Auth D1 ID; it does not call the existing CLI's hard-coded staging database path.

The `ci` mode uses the same deployed Workers, service-binding graph, migrations, HTTPS cookies, session logic, root authority, API contracts, business logic, and virtual-authenticator browser flow as staging. The intentional divergence is email: it uses per-stack local capture/suppression and no Resend credential or real delivery, because the current E2E suite does not test email delivery. It also resolves generated disposable secrets directly rather than binding staging Secrets Store entries. These exceptions must be explicit in environment validation and covered by negative tests; `ci` must never be a synonym for a staging deploy or a way to enable test-only behavior on a normal Worker.

Adapt the existing Playwright global setup so `cloud-ci` consumes the verified external stack and stack-specific browser state without starting a local stack. Keep both API and browser projects, two bounded workers initially, their substantive assertions, and the current scenario `finally` disposal/zero-row inventory checks. The local-only simultaneous-stack test remains local-only; the cloud acceptance test separately proves two simultaneous PR stacks. Add Access headers only to requests for this run's exact API and Operator origins, including browser navigation and same-origin subrequests; do not forward them on redirects to another host. The feasibility pilot must confirm this does not break passkey challenge/cookie behavior. The browser test uses a real Cloudflare-hosted Operator origin and CDP virtual WebAuthn, not an injected app session.

Run local build/lint/unit and a local Playwright check early. Provision and build independent resources in parallel where dependencies allow, but preserve the D1-before-Worker, protection-before-route, and root-before-test ordering. Measure the first cloud baseline. Shard Playwright only after the unsharded full suite passes, with each shard using separate run-scoped tenant IDs and independent manifests within the same isolated stack; do not drop assertions or replace zero-row checks to improve runtime.

## Cancellation, cleanup, and evidence

The normal path disposes each recorded E2E tenant through the protected Product-then-Auth saga and asserts zero run-owned Product/Auth rows. It then revokes/deletes the stack Access service token, disables both public routes, deletes the two Access applications, all three Workers, and both D1 databases, checking exact IDs at each step. Whole-D1 deletion is safe only after proving the databases belong solely to this run; it is not a substitute for the normal row-cleanup assertion. If a test fails, still run normal row cleanup and teardown while retaining the failure result.

Cancellation may terminate a runner during migration, deployment, fixture creation, or cleanup. An independent protected `workflow_run: completed` cleanup workflow runs outside the PR-keyed cancellation group, including for cancelled runs; a scheduled janitor reconciles orphaned stacks and retries transient failures. Neither trusts a PR artifact for deletion targets. Both reconstruct the exact run tuple from GitHub's run record and controller inventory, list Cloudflare resources with deterministic names, confirm resolved IDs and cross-bindings, and delete only that run's resources. Old-run cleanup cannot select a newer run's names or IDs. Cleanup is idempotent and tolerates absent resources. If root state or proof is gone after cancellation, report that row-level disposal could not be asserted, then remove only the proven disposable databases; do not touch shared staging. A scheduled janitor uses a bounded age threshold and verifies the run is terminal before reclaiming, so it does not race a live controller. Close events request cleanup, and the janitor is the backstop if GitHub completion events are missed. [GitHub's cancellation behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation/) does not guarantee an in-job `finally` completes, and [`workflow_run`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows/) can run a separate privileged workflow after the first run completes; its untrusted-input warning still applies.

CI emits run key, source SHA, redacted resource IDs, test counts, exact expected/actual business values, passkey/Access gate outcomes, and final zero-row and teardown status. It never emits Cloudflare account tokens, Access client secrets, root cookies, activation grants, run proofs, credential plaintext, customer payloads, or raw traces. Playwright traces and screenshots may contain those values: keep them on the ephemeral runner by default; upload only a reviewed/redacted failure summary with restricted repository visibility and a seven-day retention. Short-lived credential artifacts expire after one day and are deleted at teardown where the API permits. If sanitization cannot be established, omit the attachment and retain the actionable test name, sanitized error, and correlation ID. Cleanup failures remain visible as failing checks and janitor alerts, never as success with leaked resources.

## Verification and rollout gate

Before enabling every-push deployment, the feasibility pilot and automated security tests must prove:

1. Route publication fails closed until both per-Worker Access policies exist; anonymous, wrong-stack token, and missing-token traffic are denied, while the matching token supports real browser passkey setup/sign-in.
2. A controller presented with a fork PR, stale SHA, altered artifact manifest, injected command/config, staging resource name/ID, or ambiguous Cloudflare lookup makes no shared-resource mutation.
3. Two PRs run concurrently with distinct Workers, D1 IDs, secrets, roots, Access policies, and run-owned rows; both full suites pass without cross-talk.
4. A rapid second push while the first is mid-fixture cancels the first, permits the new stack to finish, and cleans only the old stack. Repeat with failure or cancellation mid-deploy and mid-cleanup; verify janitor idempotence and exact-ID refusal on mismatch.
5. The cloud suite asserts the GAP-030/031 exact calculations, published persistence, signed redemption, idempotent retry, browser edit/publish persistence, failure-path disposal, and zero run-owned rows. Manual staging Workers, domains, D1, Secrets Store entries, and static demo are unchanged before and after.

The pilot is a prerequisite, not a production shortcut. After it passes, add the protected workflows, controller, `cloud-ci` mode, suite wiring, and matching CI/E2E/operations documentation in the same implementation change. The implementation plan must specify the exact Cloudflare API calls, IDs, permissions, artifact schema, name grammar, timeouts, retry bounds, and tests. This spec alone changes no deployed behavior.
