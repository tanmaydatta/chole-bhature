# Preauthenticated product E2E contract

Routine product E2E is proposed to use real, run-owned member sessions, with separate automation authority for fixture setup and disposal, so product tests need no owner login.

**Status:** PROPOSED, design only, 2026-10-12. No behavior, endpoint, credential or deployment is shipped by this document. Source baseline: `8ecc09b5eb84a1525e11bc3ba5f6a779a1c64e2e`.

## Product coverage

The routine suite must run automatically against real Workers and D1, inject a synthetic merchant admin through Playwright `storageState`, and exercise normal authenticated APIs and UI. Responses, persistence and authorization must not be mocked. Owner passkeys are absent from routine setup, capability checks, provisioning, inspection and cleanup.

Coverage retains Promo editing, reload persistence and publication; exact evaluation allocations and totals; signed redemption integrity, ledger, counters and budgets; identical and conflicting idempotency retries; admin/operator/viewer permissions; tenant isolation; concurrent runs; and success/failure cleanup. Independent local stacks verify distinct member identities and reject crossed state. Actual passkey activation/sign-in checks belong in a separate optional auth-smoke suite. Existing low-level auth/security regressions, including real-browser unit cases, remain in baseline verification. Separating suites must not remove authorization assertions.

## Setup trust and environments

The proposed trust anchor is a dedicated setup credential accepted only by a narrow control surface on the existing Operator Worker. Operator delegates to Identity, which delegates to Core through existing service bindings. No new cloud stack is required. The credential authorizes capability discovery, synthetic-run bootstrap and exact-run cleanup recovery; it never resolves to a browser principal, ordinary business authorization or ROOT session.

Shared staging requires a separately approved random credential, saved first in a new Bitwarden entry and then supplied through Cloudflare Secrets Store to Identity. A trusted owner-run setup process retrieves the vault value privately into memory and sends it only to the pinned control surface over HTTPS. Operator forwards it to Identity without storing it. Authentication is performed before database writes. Authentication secrets and decision-signing keys must never authorize setup; cookie signing remains inside Identity using its existing secret binding.

Managed local stacks generate a different random setup credential per stack, supplied through private temporary configuration to their own Identity Worker. Only explicit managed test mode, fresh private local D1 stores and exact allocated loopback origins are eligible. Ordinary local, production, unknown environments and caller-supplied environment overrides fail closed. Remote CI cloud mode remains parked.

Staging credentials are unavailable to browsers, arbitrary PR code, forks and ordinary PR jobs. Hosted staging automation and persistent CI proof recovery are deferred. Secrets never enter argv, logs, reports, traces or public artifacts. Control requests permit no cookie authentication or browser CORS, with limits of 16 KiB and eight active leases per target. Deployment-configured account quotas default to three per run. Failures use closed codes.

## Control protocol and bootstrap

The control protocol is distinct from ordinary platform routes. Every mutation requires matching protocol, release generation, environment and pinned target identity across Operator, Identity and Core. Deployment preflight must verify the actual account, Worker destinations and D1 bindings against the approved target; names or callable binding shapes are insufficient. An authenticated, read-only handshake traverses the live bindings and checks all three protocol implementations plus actual migration/schema readiness before any run write. Missing or mixed deployments refuse. Each mutation revalidates this contract.

The initial shared-staging runner is a trusted local process. Before setup it durably persists a unique run ID, independent 256-bit ownership proof and controller token, and request ID in a private directory/file with modes 0700/0600. Identity stores only proof/token hashes, allocates merchant/provisioning IDs and reserves their tuple, target, generation, expiry and phase before Product writes. Callers cannot select existing tenants or owners. Core records the tuple before merchant writes. Synthetic names/emails retain the run namespace.

Provisioning advances an idempotent ledger through reservation, Product provision, Auth organization/membership creation and activation. Each side verifies the tuple and its own recorded ownership. Existing provisioning services may share domain operations, but dedicated controller RPCs must validate controller authority; they must not manufacture a ROOT principal or broaden ordinary ROOT guards. The controller becomes usable and cookies are returned only after both claims and the active membership are verified.

Authenticated identical retries return recorded status without repeating completed mutations; unauthorized/stale replays, altered payloads, expired capabilities and mismatched generations refuse before writes. Interrupted setup resumes only recorded incomplete phases within its original lease. Unknown outcomes require exact-tuple readback; lost cookie delivery requires disposal and a new run. Ownership ambiguity quarantines only that run. Every partial mutation has a prior durable reservation; cross-database atomicity is not assumed.

## Controller and member sessions

The controller is a non-session opaque capability bound to one run, proof, merchant/provisioning tuple, target and generation. Its immutable creation lease expires 15 minutes after reservation. It permits only that run's account issuance, inspection and disposal; the setup credential handles provisioning. It grants no business/browser authority, arbitrary SQL or global tenant listing. Heartbeats cannot extend it; other runs/generations cannot reuse it.

Identity issues real Better Auth member sessions for synthetic admin/operator/viewer accounts with email login disabled. The browser receives only its member cookie, never the setup credential, controller token or ownership proof. Private state is published only after a fresh server session read confirms expected user, membership, merchant, role permissions and solely `e2e-fixture` authentication, with no platform role or merchant-selection requirement. Cookie attributes match the actual local/staging origin and existing server policy; browser state and contexts are isolated per scenario and role.

The existing immutable fixture record retains its exact issuance-plus-15-minute expiry constraint. New controller-owned sessions additionally expire at the creation lease deadline, even when issued later or Better Auth slides its session expiry. Both cookie/session resolution paths enforce this deadline, active ownership and generation. No automatic reissuance or renewal occurs within a scenario. Expiry fails the test; a new scenario requires a new run. Bootstrap occurs once per scenario; stack startup and initial readiness occur once per suite. Timing evidence must report these costs without assuming a speedup.

## Cancellation and disposal

Recorded cancellation or expiry revokes creation authority and member access; failed cancellation delivery remains a failure, with access bounded by expiry. Cleanup uses the setup credential plus retained exact-run proof/reservation. Recovery permits only inspection and monotonic disposal; it cannot resume provisioning, mint sessions, extend leases or author data. Each recovery invocation has a five-minute deadline and may be retried. Revoked/disposed runs can never reopen.

Disposal fences account/session and business writes before deletion. Core must enforce the recorded lease/status atomically with fixture-tenant mutations, including public-token redemption, preventing in-flight writes after disposal. Product removal is verified before Auth deletion. Partial setup uses reservation phases and exact readback, including confirmed absence. Cleanup preserves ledger/proof for resumption, serializes per tuple and is idempotent; foreign/manual tenants remain untouched. Compatible matching releases may recover an older generation solely for cleanup. Only sanitized ownership/disposal tombstones remain after zero-row verification.

Teardown attempts cleanup after success, failure, timeout and cancellation; cleanup failure fails the test. After process death, access expires and a subsequent trusted invocation reconciles reservations using retained private proofs. Genuine proof loss quarantines that run for an owner-reviewed recovery decision; a hash cannot recover its proof. Unrelated runs continue within capacity; expired quarantines do not globally block admission. Global deletion and manual-tenant fallback are forbidden. Additive migrations preserve legacy ROOT claims and authorized disposal.

## Initial milestone acceptance

**Table — Required local and shared-staging evidence**

| Boundary | Acceptance |
|---|---|
| Automatic entry | Fresh setup reaches a verified admin UI with no human login, ROOT cookie or virtual authenticator; real API and browser persistence assertions pass. |
| Business | Exact Promo/evaluation/redemption, ledger/budget and both idempotency behaviors retain current assertions. |
| Authorization | Unauthenticated, production, ordinary-local, wrong target/scope, unauthorized/stale replay, crossed run/state, old generation and expired/cancelled authority fail before writes; role denials remain. |
| Concurrency | Two Playwright workers, two simultaneous scenarios and independent stacks retain isolated identities, claims, allocations and cleanup; manual staging data is unchanged. |
| Failure lifecycle | Setup/disposal faults, cancellation, expiry and runner death with retained proof permit only exact-run cleanup; verify zero owned rows/no foreign deletions. Lost proof quarantines only its run. |
| Release/privacy | Missing migrations and mixed Worker releases reject before fixtures; no credential/state leakage; baseline auth/security checks pass. |

The minimum implementation covers managed local and the existing shared staging target, including recovery. Optional auth-smoke integration and per-PR cloud provisioning are deferred. Future implementation must update the E2E README and matching testing documentation in the same change.

## Approval and rollout boundary

Written-spec approval permits implementation planning only. Separate approval is required for adding the control endpoint/RPCs and additive ledger/lease migrations, creating the new vault credential and Secrets Store binding, applying staging migrations, and deploying matching Workers. No current approval authorizes those writes. After implementation review, fresh baseline and routine-product CI must pass on the proposed revision; an approved PR/release and target preflight precede staging rollout. Fixture writes remain closed throughout mixed-release deployment, then both-environment acceptance is required.

## Code references

- Current ROOT gates: [Identity Worker](../../../apps/identity/src/worker.ts), lines 150–304; [Operator Worker](../../../apps/operator-web/src/worker.ts), lines 433–529; [Core Worker](../../../apps/api/src/worker.ts), lines 105–153.
- Provisioning/ownership: [Organization service](../../../apps/identity/src/services/organizations.ts), lines 340–550; [Auth disposal](../../../apps/identity/src/services/e2e-lifecycle.ts), lines 161–217; [Product disposal](../../../apps/api/src/services/e2e-lifecycle.ts), lines 91–139.
- Session issuance/guards: [Auth](../../../apps/identity/src/auth.ts), lines 421–442, 650–668, 790, 831–873; [Member resolution](../../../apps/identity/src/services/organizations.ts), lines 287–316; [Fixture-session migration](../../../apps/identity/migrations/0006_e2e_fixture_session.sql), lines 65–77.
- Secret source: [Identity secret resolution](../../../apps/identity/src/staging-secrets.ts), lines 23–39. Current fixture issuance and member gates exclude local and require coordinated explicit managed-local support.
- Harness: [Global setup](../../../tests/e2e/playwright.global-setup.ts), lines 8–40; [Scenario lifecycle](../../../tests/e2e/src/scenario-run.ts), lines 13–88; [Browser Promo assertions](../../../tests/e2e/test/playwright/promo.browser.spec.ts), lines 11–78.

## Related

- [Local PR E2E CI](../../testing/local-pr-e2e-ci.md)
- [Per-PR Cloud E2E pilot ledger](../../testing/per-pr-cloud-e2e.md)
