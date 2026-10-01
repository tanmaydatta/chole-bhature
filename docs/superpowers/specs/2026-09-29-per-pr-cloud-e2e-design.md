# Per-PR Cloud E2E — Design Spec

**Status:** Approved design under local implementation. On 2026-10-01, the
Beta lifecycle amendment was approved for bounded mock-only planning and
validation; it is not approval for a live API call, pilot, deployment, or
workflow.

**Date:** 2026-09-29

**Notion mirror:** https://app.notion.com/p/Per-PR-Cloud-E2E-Design-Spec-3ebe5c7c2b8e8186866ef1e158bfd880

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
write refusal stays in force until the proposed lifecycle below receives
written design approval and mock-only validation; a live pilot has its own
separate approval gate. The proposal below is not an adopted API procedure.

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

The approved local scope records a separate `betaWorkerIds` map only after an
exact mock readback has the controller-derived name, a 32-lowercase-hex fixture
ID, explicit empty `routes`, and both disabled subdomain flags. This strict
fixture normalizer deliberately refuses absent/unknown routes or malformed
IDs; it is not a claim that it exhausts the provider schema. Legacy `workerIds`
remain legacy tags and cannot enter a Beta path. The local planners produce
fixed request descriptions only: initial create, ID-only GET/PATCH/DELETE, and
an inert non-deploying version request after exact API and Operator Access
readbacks. PATCH/DELETE additionally require the local mock protocol's exact
Worker observation and explicit `version:null` inert-state proof; this is not
claimed to come from Beta Worker GET, which does not prove outgoing bindings or
version absence. A separately complete version-observation adapter and live
schema proof remain gates. Changed routes, identity, deployment, or binding
state refuses. They never execute a transport. Incoming `references.workers` is
not inferred to prove outgoing D1/service bindings. Assets/JWT, service-name
remapping, Beta crash recovery/audit proof, version/preview reachability and
all live acceptance remain unresolved.

The connected local fixture harness records pre-create intent, then a disabled
create plan, immutable-ID checkpoint, Access gates, and inert version plan in
that order. It demonstrates the planner/observation interfaces only; no Task
5a controller orchestration enforces that ordering against a provider.

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
