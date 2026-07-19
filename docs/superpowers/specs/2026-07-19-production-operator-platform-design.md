# Production Operator Platform and Integration Harness — Design Spec

**Date:** 2026-07-19

**Status:** Approved design; written-spec review pending

**Sequence:** Revised Plan 3, after Foundation, Runtime, and conditional reward rules

**Notion mirror:** https://app.notion.com/p/Production-Operator-Platform-and-Integration-Harness-Design-Spec-3a2e5c7c2b8e81e69cbae5bd9c704edb

## 1. Purpose

Build the reusable, production-safe operator platform needed before choosing a Shopify, manual, or other commerce integration. The first client and platform root must be able to configure, exercise, and diagnose the integration-neutral incentives core without embedding commerce-platform assumptions.

This replaces the original UI-only Plan 3 scope. Plans 1 and 2 delivered canonical contracts, a pure engine, typed schema publication, stored customers, Promo persistence, structured decisions, atomic idempotent redemption, and conditional reward rules. Plan 3 turns them into a tenant-aware, authenticated, deployable operator product.

## 2. Merged-state corrections

The merged runtime is the migration source, not the final architecture:

- `apps/api` always assigns the seeded `phase-0-merchant`.
- Publishable and secret tokens are shared environment variables, not merchant credentials.
- The dashboard remains demo-backed and has incompatible local types.
- No authenticated browser/backend-for-frontend boundary or suitable CORS boundary exists.
- Schema APIs exist, but deprecation and publication-impact contracts do not.
- Programs use one row, only drafts are editable, and live revision/lifecycle handling is incomplete.
- Promo now uses ordered `rewardRules` plus optional `fallbackReward`; the singular reward is gone.
- Exhausted redemption is a structured `409 EXHAUSTED`, not `{ status: "exhausted" }`.
- Affiliate, Referral, and Loyalty have conditional-reward configuration contracts, but only Promo has a production runtime.

Plan 3 explicitly migrates these boundaries rather than preserving Phase-0 shortcuts.

## 3. Client-visible outcomes

1. An invited employee signs in; public signup is unavailable.
2. The employee sees only their company and permitted operations.
3. An Admin invites and manages employees.
4. An Admin or Operator defines and publishes typed customer and live-context fields.
5. An Admin or Operator creates and publishes a Promo with conditional rewards.
6. Customer attributes are updated separately and loaded from our store during evaluation.
7. The dashboard runs evaluation and explains the decision, selected rule, reasons, and versions.
8. Any commerce adapter uses merchant-specific credentials and the canonical public API.
9. Local/staging can prove evaluate, apply, redeem, retry, and exhaustion end to end.
10. Root can select any client and inspect or modify its data during onboarding or incidents.

Production does not expose simulator redemption in the dashboard. Real integrations still use the production redemption API.

## 4. Worker and database topology

Every environment has three independently deployed Cloudflare Workers:

```text
Browser -> Operator Web Worker
             |-- service binding -> Identity Worker -> Auth D1
             `-- service binding -> Core API Worker -> Product D1

Commerce integration -- merchant API key -> Core API Worker -> Product D1
```

### Operator Web Worker

- Serves dashboard assets and same-origin BFF routes.
- Proxies `/auth/*` to Identity while preserving the public app origin for links and cookies.
- Converts a session into a provider-neutral `OperatorPrincipal` and enforces permissions.
- Derives merchant identity from membership or explicit root selection; browser tenant input is never authoritative.
- Has no D1 binding and calls Identity/Core only through service bindings.

### Identity Worker

- Runs self-hosted Better Auth and application-owned authorization adapters.
- Owns users, sessions, invitations, organizations, memberships, roles, and identity audit records in Auth D1.
- Has no Product D1 binding and no separate public application origin.
- Uses Resend for production invitation and login email.

### Core API Worker

- Owns merchants, schemas, customers, programs, evaluations, redemptions, API credentials, and product audit records in Product D1.
- Has no Auth D1 binding.
- Accepts trusted operator calls through its private service interface.
- Exposes versioned public integration endpoints authenticated by merchant API keys.
- Never trusts browser-supplied merchant, user, permission, or root headers.

Operator calls carry correlation id, actor user id/kind, merchant id, and the granted permission. Core accepts that context only over the private service interface and records it for audit. Canonical request/response types live in workspace packages, not dashboard-local interfaces.

## 5. Environment isolation

Local, staging, and production each have distinct Workers, Auth/Product D1 databases, domains, bindings, cookie names, secrets, Resend configuration, merchant credentials, logs, and data. Nothing crosses environments.

Local uses local D1 and an email capture adapter. Staging email is restricted to approved recipients. Production sends real email.

## 6. Identity and onboarding

### Authentication

- Better Auth is self-hosted; Better Auth managed infrastructure is not required.
- Client employees use short-lived, single-use passwordless email links.
- Public signup is disabled at route and policy layers; responses do not reveal whether an email exists.
- Email requests are rate-limited.
- Root uses a passkey plus one-time recovery codes, independent of email delivery.
- Client Admin passkeys are deferred. The principal records authentication method/time so later step-up policy does not change roles or permissions.

### Root bootstrap

An operations-only command creates one pending root for a supplied email and refuses when an active root exists. It never accepts or generates a password. Root activates, registers a passkey, and receives recovery codes. Root creation is unavailable through public/dashboard APIs. Recovery invalidates existing root sessions/material and is audited.

### Client provisioning

Root creates a client from the shared dashboard. One Identity organization maps one-to-one to one Core merchant via stable merchant id.

Because Auth and Product D1 cannot share a transaction, provisioning is an idempotent saga:

1. Operator Web creates a provisioning id and merchant id.
2. Core creates or returns a `provisioning` merchant.
3. Identity creates or returns the mapped organization.
4. Core marks the merchant `active` after both agree.
5. Invites stay disabled until activation.
6. Retry resumes the same saga; it never duplicates either record.
7. Root can inspect and retry failed provisioning.

### Invitations

- Root invites the first client Admin.
- Admins invite employees only within their organization.
- Invites are email-bound, single-use, expiring, and carry the initial role.
- Removal or demotion promptly invalidates sessions.
- The last Admin cannot remove or demote themselves.
- Root can recover client administration and operates as root, never by impersonating an employee.

## 7. Authorization

Better Auth supplies identity/session/organization primitives. Application authorization is provider-neutral and stored in Auth D1.

```ts
interface OperatorPrincipal {
  userId: string;
  sessionId: string;
  authenticationMethods: string[];
  authenticatedAt: string;
  platformRole?: 'root';
  organizationId?: string;
  merchantId?: string;
  membershipId?: string;
  permissions: PermissionKey[];
}
```

Business code checks stable action permissions, never role names. Initial keys cover members, schemas, customers, programs, evaluations, redemptions, credentials, and audit with read/manage/publish actions where applicable.

| Capability | Admin | Operator | Viewer |
|---|---:|---:|---:|
| Manage members/roles and credentials | Yes | No | No |
| Manage/publish schemas and programs | Yes | Yes | No |
| Manage customers | Yes | Yes | No |
| Run evaluations | Yes | Yes | Yes |
| Commit simulator redemption locally/in staging | Yes | Yes | No |
| Read configuration and audit data | Yes | Yes | Yes |

Root is a separate platform role with full cross-merchant authority. Root explicitly selects a merchant, the dashboard shows a root/merchant banner, and every root mutation records that merchant.

Permissions default to denied. A new permission requires a code registry entry and enforcement point. A later role can compose existing permissions from stored mappings. Plan 3 seeds Admin, Operator, and Viewer but defers the custom-role editor.

## 8. Merchant credentials

Shared environment tokens are replaced by merchant- and environment-specific credentials:

- `pk_` publishable keys may receive `schema:read` and `evaluations:write`; production activation requires exact allowed origins and browser rate limits.
- `sk_` secret keys may receive `schema:read`, `customers:write`, `evaluations:write`, and `redemptions:write`.

Each key has id, name, merchant/environment, scopes, optional expiry, actor/time, last-used time, status, and suffix. Full token material is shown once; only a digest is stored. Multiple active keys allow zero-downtime rotation. Revocation is immediate. Root/Admin manage keys; Operator/Viewer cannot.

The dashboard never uses merchant credentials for BFF calls. Exact-origin CORS applies only to publishable routes; secret routes do not opt into browser CORS. Scope, merchant, status, expiry, origin, and rate limit are checked before handlers.

## 9. Schema lifecycle

Variables cover customer, context, cart, line-item, event, and system sources. Promo conditions expose only facts available to Promo; event fields remain definable for future modules but unavailable in Promo authoring.

- Operators edit one draft based on the latest published schema.
- Evaluation/customer validation continue using the published version until the next publication succeeds.
- Publication creates an immutable numbered snapshot and validates programs plus stored-customer compatibility.
- Active programs use published fields. Draft programs may use draft fields but cannot publish first.
- Canonical/system fields are read-only.
- Custom key/source/type become immutable after first publication or reference.
- Breaking changes require a replacement field.
- Never-published, unreferenced draft fields may be deleted.
- Published/referenced fields may be deprecated, not deleted, and disappear from new conditions while existing revisions keep working.
- Labels, descriptions, and error messages remain editable.
- Removing a published enum value is breaking; adding one is allowed with a warning.

A required customer field publishes only when every stored customer has a valid value. Plan 3 reports incompatible counts and supports API remediation; bulk backfill UI is deferred. A required live-context field produces an integration-breaking warning.

The condition builder derives operators/value controls from field type and supports working nested `ALL`/`ANY` groups. Unknown fields and invalid operators are rejected in UI and contracts.

## 10. Customers

- Integrations upsert typed attributes by opaque `customerRef` with optimistic version checks.
- Evaluation loads the latest stored customer and never accepts attribute overrides.
- The dashboard offers exact-reference lookup, create/update, version, and update time for support; it is not a CRM/analytics browser.
- Logs and audit summaries never contain complete customer attributes.

## 11. Promo revisions and lifecycle

A Promo is a stable logical program with a merchant-unique external reference. Authored configuration lives in immutable numbered revisions.

- At most one editable draft revision exists.
- Publishing validates it and atomically makes it active; the prior active revision remains for audit/redemption diagnosis.
- Decisions record logical `programRef` and exact `programRevision`.
- Budget, usage, and per-customer counters belong to the logical Promo and do not reset on revision publication.
- A new logical Promo is the explicit way to start fresh counters.

Lifecycle operations are separate from config editing:

- `draft`: no active revision;
- `scheduled`: a valid revision has a future start;
- `active`: eligible within its effective dates;
- `paused`: reversible and unavailable for evaluation;
- `ended`: irreversible and unavailable.

Core evaluates effective time without relying on a browser. Publishing a replacement does not silently resume a paused/ended Promo.

Promo uses the implemented clean-break reward contract: program-wide `eligibility`, ordered first-match-wins `rewardRules`, and optional `fallbackReward`. At least one rule/fallback exists, ids are unique/stable, and decisions/redemptions expose `rewardRuleRef`.

The UI supports ordering, nesting, and all canonical Promo effects. Advisory analysis warns about obvious duplicate, unreachable, overlapping, or uncovered rules without claiming complete logical proof. Only contract-invalid states block publication.

Affiliate, Referral, and Loyalty retain conditional-reward configuration contracts. Their production authoring/runtime and configurable Loyalty terminology remain future work.

## 12. Dashboard

Retain the current visual design where practical, but mark demo data unambiguously. Live surfaces are authentication, root provisioning/merchant selection, team roles, credentials, schemas, exact-reference customers, Promo revisions/lifecycle, Evaluation Playground, and consolidated audit.

Affiliate, Referral, Loyalty, analytics, and retained static pages show `Demo data` and cannot call production mutation APIs.

The dashboard uses canonical contracts through a typed BFF client and handles loading, empty, stale response, conflict, unauthorized, forbidden, and safe error states. Errors preserve correlation ids.

## 13. Playground and CLI simulator

### Dashboard Playground

An authorized user enters/selects customer reference, canonical cart/line items, and schema-derived context; runs evaluation; inspects evaluation id/expiry, schema/customer versions, program/revision, outcome, selected rule, effects, reasons, and messages; and copies canonical JSON or a credential-free `curl` template.

Evaluation persists the normal short-lived decision snapshot but consumes no budget/cap. Production exposes no operator redemption route/button. Local/staging allow Admin/Operator to commit after explicit confirmation and show idempotent retry, expiry, conflict, and `409 EXHAUSTED` accurately.

### CLI simulator

The CLI imports only public contracts and connector kit, and maps deliberately non-canonical fake-commerce fields into the canonical envelope. It verifies that the required schema and Promo fixture are already published, then proves customer update, evaluation, effect mapping, redeem-before-capture, idempotent retry, cap exhaustion, and repricing after `409 EXHAUSTED`. Configuration setup remains an operator action rather than an integration-key capability.

The CLI reads an environment capability marker and refuses simulator redemption against production. Real production integrations remain able to redeem with a scoped secret key. Traces exclude credentials, magic links, and complete customer attributes.

## 14. Error handling and recovery

- One correlation id crosses all Workers; APIs return stable codes, safe messages, retryability, and that id.
- Identity failure makes authentication/authorization fail closed.
- Cross-merchant identifiers cannot leak another merchant's existence.
- Optimistic conflicts preserve submitted drafts for reload/retry.
- Failed email leaves a pending retryable invite, not an unauthenticated usable account.
- Failed provisioning remains visible and idempotently retryable.
- Session expiry returns to sign-in without discarding safe unsaved work.
- Lost credential plaintext requires rotation.
- Schema/program publication is atomic within Product D1.
- Redemption rechecks lifecycle, budgets, caps, snapshot integrity, and idempotency.

## 15. Audit and observability

Identity audits to Auth D1; Core audits to Product D1. Operator Web merges authorized queries without copying either store. Audit records contain actor/kind, merchant, action, target, outcome, time, correlation id, and safe version/status metadata—not tokens, magic links, complete customer attributes, carts, condition trees, or reward payloads.

Logs contain service/environment, route, status, latency, safe error code, actor/merchant/credential ids where applicable, and correlation id. Authentication failures, repeated authorization failures, credential misuse, Worker errors, and redemption exhaustion support alerts. Audit retention defaults to 12 months and is configurable.

## 16. Delivery and deployment

```text
feature branch -> reviewed PR into dev -> automatic staging deployment
dev -> reviewed PR into main -> manually approved production deployment
```

No direct pushes to `dev`/`main`. Production approval uses the GitHub environment gate. Secrets are environment-scoped and never enter dashboard assets.

D1 migrations are forward-only and expand/contract compatible. Production data is backed up first. Identity/Core deploy before Operator Web when contracts expand; Worker versions roll back independently without pretending destructive schema downgrades are safe.

Staging smoke tests cover sign-in, invitation, isolation, publication, evaluation, redemption, retry, and exhaustion. Production smoke tests cover authentication, isolation, reads, and evaluation diagnostics—never simulator redemption.

## 17. Verification

Required layers:

1. Canonical principal, permissions, credentials, revisions, audit, and BFF contract tests.
2. Better Auth adapter tests proving signup disabled and tenant-safe invitations/memberships.
3. Authorization matrix tests for root/Admin/Operator/Viewer, removed users, and cross-merchant requests.
4. Worker-boundary tests proving database isolation.
5. Core integration tests for credentials/origins, revisions/counter continuity, lifecycle, and audit.
6. Schema tests for publication, deprecation, breaking changes, customer compatibility, and program references.
7. Dashboard HTTP-boundary tests without duplicated React business logic.
8. Real local-D1 invite-to-evaluate and simulator redemption flows.
9. Fake connector conformance tests.
10. Clean and merged-Plan-2 migration tests.
11. Canonically parsed public documentation examples.
12. Environment-specific staging/production smoke suites.

All existing Foundation, Runtime, and conditional-reward tests remain green.

## 18. Deferred

- Production Shopify/manual/other connector and storefront UI.
- Client Admin passkeys/MFA and custom-role builder.
- Bulk customer import/backfill UI.
- Production redemption from Playground/simulator CLI.
- Affiliate/Referral/Loyalty production UIs/runtimes and Loyalty unit terminology.
- Billing, product analytics, CRM-style customer browsing, and generated SDKs.

## 19. Completion gate

Plan 3 completes only when seeded-merchant/shared-token assumptions are gone; three-Worker/two-D1 isolation exists in every environment; bootstrap/invites/roles/tenant isolation work end to end; schema and Promo revisions publish safely and persist; Promo counters survive revision changes; production Playground cannot redeem; local/staging CLI proves accepted/retry/exhaustion; credentials rotate/revoke safely; deployments/migrations/audit/rollback are exercised; repository/Notion match; and all tests and smoke checks are green.
