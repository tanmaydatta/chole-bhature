# Staging Deployment Activation Design

**Status:** Approved design; implementation pending

**Date:** 2026-07-21

**Extends:** `2026-07-19-production-operator-platform-design.md`

**Notion mirror:** https://app.notion.com/p/3a4e5c7c2b8e81eaa9f4d7b9a54e91b6

## 1. Purpose

Activate the production-operator platform in a real Cloudflare staging environment without
changing or deleting the existing `vanshit-lakshay` static demo Worker. Replace the obsolete
single-Worker repository deployment assumption with the approved three-Worker, two-database
topology.

## 2. Fixed staging topology

Staging uses three independently deployable Workers:

```text
Browser -> operator.staging.wastd.dev
             |
             |-- service binding -> incentives-identity-staging -> Auth D1
             `-- service binding -> incentives-api-staging -> Product D1

Client integration -> api.staging.wastd.dev -> incentives-api-staging -> Product D1
```

- `incentives-operator-web-staging` serves the shared dashboard and same-origin BFF.
- `incentives-identity-staging` has no public route and is reachable only through service
  bindings.
- `incentives-api-staging` exposes the integration API at `api.staging.wastd.dev` and its private
  operator entrypoint through a service binding.
- `operator.staging.wastd.dev` is the exact public application origin and passkey RP ID.
- `wastd.dev` is already registered in the same Cloudflare account as the staging resources.
- The account's `tanmaydatta.workers.dev` subdomain is not used for the stable staging origins.

The existing `vanshit-lakshay` Worker and its current URL remain available as the static demo.
It does not receive the new D1 bindings, service bindings, routes, or application secrets.

## 3. Data isolation

Staging uses two new, distinct D1 databases:

- `incentives-staging` for product data.
- `incentives-auth-staging` for users, sessions, organizations, roles, invitations, and identity
  audit data.

Their real UUIDs belong only in the git-ignored `.env.staging` file and deployment environment;
checked-in examples retain non-deployable placeholders. No existing database is reused or
modified.

Product and Identity migrations remain forward-only and are applied to their corresponding
database before the first application deployment. A migration failure stops the process before
Workers are deployed.

## 4. Secrets and email

The deployment requires four Worker secrets:

- Identity: `AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM`.
- Operator Web: `OPERATOR_SELECTION_SECRET`.

`AUTH_SECRET` and `OPERATOR_SELECTION_SECRET` are generated locally with cryptographically secure
random values. Resend credentials are supplied by the user. Secrets are never committed, printed
in command output, or pasted into chat. Staging email remains restricted by
`STAGING_ALLOWED_RECIPIENTS`, which must contain the real addresses explicitly approved for
testing.

## 5. Deployment control and order

During staging activation, every Cloudflare mutation is run by the user. The assistant may run
read-only Cloudflare commands, but it must not create, update, migrate, deploy, set secrets, attach
domains, or delete Cloudflare resources. It provides one mutating command at a time, explains its
effect, and waits for the user to run it and return the non-secret result.

The activation order is:

1. Validate local configuration and run the repository build/tests.
2. Apply Product D1 migrations.
3. Apply Auth D1 migrations.
4. Deploy Core API and confirm `api.staging.wastd.dev`.
5. Deploy Identity, which remains private.
6. Configure Identity secrets without exposing their values.
7. Deploy Operator Web and confirm `operator.staging.wastd.dev`.
8. Configure the Operator selection secret without exposing its value.
9. Bootstrap the root user and perform the staging smoke flow.

The service-binding dependency order prevents Operator Web from being activated before Core and
Identity exist. Each command targets an explicit generated staging configuration; no command runs
Wrangler from the monorepo root without selecting an application.

## 6. Legacy build correction

The failed `Workers Builds: vanshit-lakshay` PR check belongs to the static demo's legacy
single-Worker repository connection. The monorepo root now contains three applications, so a root
Wrangler deployment fails application detection before upload.

The user will disconnect or disable automatic repository builds for the legacy demo Worker while
leaving its last successful deployment online. Pull requests will use repository build, lint, and
test checks only. Staging Cloudflare deployment remains a deliberate user-run operation until the
user separately approves automatic Cloudflare writes.

## 7. Error handling and rollback

- Any missing, placeholder, equal, or malformed D1 UUID fails before Wrangler is launched.
- Origins must be distinct exact HTTPS origins; the passkey RP ID must exactly equal
  `operator.staging.wastd.dev`.
- Identity deploys without a public route. A configuration that exposes it publicly is invalid.
- Failed migrations stop deployment and are not rolled back destructively.
- Failed Worker deployment leaves the last deployed Worker version active.
- Worker code can be rolled back independently with Wrangler, while database migrations remain
  forward-only.
- The static demo is not a rollback target for the operator platform and is never modified by
  staging commands.

## 8. Verification

Before any Cloudflare write, targeted tests must prove the generated configs contain the exact
Worker names, D1 bindings, service bindings, custom domains, public origin, and passkey RP ID.
The full clean test gate must also pass.

After deployment, read-only checks and browser testing must prove:

1. Both public custom domains resolve over HTTPS.
2. Identity has no public route.
3. Product and Auth migrations exist only in their intended databases.
4. Root sign-in, passkey registration, and client provisioning work.
5. An Admin can invite an allowed recipient and the recipient can sign in.
6. Schema publication, customer update, conditional Promo evaluation, redemption, idempotent
   retry, and exhaustion match the manual end-to-end guide.
7. The existing static demo URL still serves its previous deployment.

Any mismatch is recorded in the testing findings before a fix is attempted.

## 9. Completion criteria

The activation is complete when all three new staging Workers exist with the intended visibility,
both D1 databases are migrated and isolated, secrets are configured without disclosure, both
custom domains pass smoke testing, the legacy demo remains unchanged, the obsolete external PR
build no longer targets the monorepo, and local/Notion deployment documentation reflects the
verified procedure.
