# Staging Worker operations

**Notion mirror:** https://app.notion.com/p/3a5e5c7c2b8e81bd810ce6fe5fc3d355

## Local three-Worker stack

Run the complete local stack from the repository root:

```sh
cp apps/operator-web/.dev.vars.example apps/operator-web/.dev.vars
pnpm dev:local
```

The command builds the canonical contracts and dashboard, then starts Core on port `8787`,
Identity on `8788`, and the public Operator Web Worker on `5173`. Wrangler resolves the
`incentives-api`, `incentives-identity-local`, and `incentives-operator-web-local` service names
through its local service registry. Open `http://localhost:5173`; Core and Identity are private
service dependencies rather than browser entrypoints.

## Staging

### Fixed resources and boundaries

The staging platform is separate from the existing `vanshit-lakshay` static demo. These commands
must never deploy to, bind a database to, attach a route to, roll back, or delete that demo Worker.

Staging contains:

- `incentives-api-staging` at `https://api.staging.wastd.dev`;
- private `incentives-identity-staging`, with no public route;
- `incentives-operator-web-staging` at `https://operator.staging.wastd.dev`;
- Product D1 `incentives-staging`; and
- Auth D1 `incentives-auth-staging`.

Operator Web reaches Identity and Core through service bindings. Identity reaches Core through a
service binding. Only the API and Operator Web Workers receive custom-domain routes.

### E2E platform deployment order

The [GAP-030/031 automated scenario](../testing/gap-030-031-e2e.md) adds protected,
run-scoped fixture, inspection, and full-disposal behavior across **both** D1
databases. The earlier GAP guidance that Identity need not deploy is obsolete
for this release. These commands are an owner-reviewed **future deployment
plan**, not authorization to deploy as part of a local test run. Commit and
push the reviewed matching source revision only after explicit release
approval; do not start a staging E2E run while a migration/deployment is in
progress or any Worker is on an older revision.

After the read-only preflight and repository gates below pass, the owner runs
one command at a time and checks the protected, sanitized result before the
next:

```sh
pnpm --filter @incentives/api db:migrate:staging
pnpm --filter @incentives/identity db:migrate:staging
pnpm --filter @incentives/api deploy:staging
pnpm --filter @incentives/identity deploy:staging
pnpm --filter @incentives/operator-web deploy:staging
```

Product migration `0007_merchandise_price_breakdowns.sql` may still be pending
in staging. The Product migration command must therefore apply `0007` and then
`0008_e2e_tenant_lifecycle.sql`, in that order, before the Core deploy. Auth migrations `0005_e2e_tenant_lifecycle.sql` and
`0006_e2e_fixture_session.sql` must be present before the Identity deploy.
Operator deploys last because its root-only capability, fixture, inventory,
and inspection BFF routes depend on both private services. The generated
staging Wrangler configs preserve the private Identity/Core bindings and
exact `APP_ENV=staging` guard; do not expose Identity publicly. Existing
staging secrets remain required. No raw remote D1 write or arbitrary-merchant
deletion is part of the E2E client.

After all five actions, use the ordinary owner passkey to create a private
short-lived Playwright state, then run the **read-only handshake before any
fixture write** as part of the E2E command:

```sh
mkdir -p tests/e2e/.runs
chmod 700 tests/e2e/.runs
pnpm e2e:staging:login --output "$PWD/tests/e2e/.runs/staging-root.json"
E2E_OPERATOR_STORAGE_STATE="$PWD/tests/e2e/.runs/staging-root.json" pnpm e2e:staging
```

For a visible browser-only pass, replace the last command with
`E2E_OPERATOR_STORAGE_STATE="$PWD/tests/e2e/.runs/staging-root.json" pnpm e2e:staging:headed`.
The login helper does not create an account: it opens Chrome for the real
passkey flow, verifies root authority, and writes a new 0600 state file in an
owner-only directory. Re-run with a new filename after expiry. The E2E global
setup checks the exact versioned Operator→Identity→Core capability protocol,
Product 0008/Auth 0005+0006 migration markers and required tables, and a live
root session. An old/mixed release fails **before** `add-merchant` or any
other recipe writes. No staging E2E execution is claimed until these commands
have been separately approved and actually run.

Both migrations are forward-only. Do not attempt to undo a migration or roll
back only one Worker while E2E tenants exist: fixture sessions, provenance,
inspection, and two-DB disposal would be version-incompatible. Stop new runs,
retain each private run manifest/proof, preview and resume scoped disposal
through the current compatible Workers, and use a reviewed forward fix for a
partial deployment. Product disposal commits before Auth; interruption is
resumable with the same run proof. A successful disposal leaves only sanitized
audit tombstones. Any exceptional database restore requires the separate
quiet-window/owner-approved recovery procedure below, not a direct E2E
client SQL command.

### Prepare the ignored environment file

Copy `.env.staging.example` to `.env.staging` with owner-only permissions. Replace the two D1
instructions with the distinct UUIDs returned when the databases were created. Replace the
recipient instruction with a JSON array containing only real addresses approved for staging
email. Replace the four secret instructions locally; never commit, print, or paste those values
into chat.

```sh
umask 077
cp -n .env.staging.example .env.staging
chmod 600 .env.staging
${EDITOR:-vi} .env.staging
```

The fixed public values are:

```dotenv
STAGING_OPERATOR_ORIGIN=https://operator.staging.wastd.dev
STAGING_API_ORIGIN=https://api.staging.wastd.dev
STAGING_PASSKEY_RP_ID=operator.staging.wastd.dev
```

Load the file into the current shell without printing it:

```sh
set -a
. ./.env.staging
set +a
```

### Read-only preconditions

Run these before any Cloudflare change:

```sh
pnpm staging:preflight
pnpm build
pnpm lint
CI=true pnpm test
```

The preflight output is deliberately sanitized. It lists resource names, public origins, the
passkey RP ID, and an allowed-recipient count. It does not contain D1 UUIDs, addresses, or secrets.
Stop if any precondition fails.

### Legacy demo build isolation

The `vanshit-lakshay` demo Worker remains connected to its repository, but its Cloudflare Workers
Builds include path is exactly `demo/*` and its exclude paths are empty. The pattern is relative to
the repository root and has no leading slash. Demo files can still trigger demo deployments;
platform-only changes do not target the demo Worker.

Cloudflare can bypass path matching for an empty push, a push containing at least 3,000 changed
files, or a push containing at least 20 commits. Treat those cases as exceptional and inspect the
demo build before allowing it to deploy.

### User-controlled Cloudflare activation

The assistant must not run these Cloudflare-changing commands. The user runs exactly one command,
checks its result, and only then moves to the next command.

First apply the forward-only Product migrations. It applies pending Product
`0007` before `0008`; do not deploy Core between those migrations:

```sh
pnpm --filter @incentives/api db:migrate:staging
```

Then apply the forward-only Auth migrations:

```sh
pnpm --filter @incentives/identity db:migrate:staging
```

Deploy Core and attach its API custom domain:

```sh
pnpm --filter @incentives/api deploy:staging
```

Deploy private Identity. This config has no route and publishes no `workers.dev` hostname:

```sh
pnpm --filter @incentives/identity deploy:staging
```

Enter each Identity value only at Wrangler's hidden prompt. Do not include a value in the command
or paste one into chat:

```sh
pnpm --filter @incentives/identity exec wrangler secret put AUTH_SECRET \
  --name incentives-identity-staging
pnpm --filter @incentives/identity exec wrangler secret put RESEND_API_KEY \
  --name incentives-identity-staging
pnpm --filter @incentives/identity exec wrangler secret put RESEND_FROM \
  --name incentives-identity-staging
```

Deploy Operator Web and attach its custom domain:

```sh
pnpm --filter @incentives/operator-web deploy:staging
```

Enter the Operator selection secret only at Wrangler's hidden prompt:

```sh
pnpm --filter @incentives/operator-web exec wrangler secret put OPERATOR_SELECTION_SECRET \
  --name incentives-operator-web-staging
```

The staging runner generates a mode-`0600` temporary Wrangler config for the selected app, invokes
that app's installed Wrangler entrypoint through the current absolute Node executable, and removes
the temporary files on success or failure. Its child environment is a fail-closed allowlist:
required platform/temp/locale values and Cloudflare API token/account values only. It does not
forward `NODE_OPTIONS`, `NODE_PATH`, endpoint or `WRANGLER_*` controls, proxy/output controls,
unrelated cloud/service credentials, application secrets, or `STAGING_*` inputs. OAuth login still
works through the allowed home/config paths. Remote staging `dev` is intentionally unsupported:
an interactive, indefinite Wrangler session cannot be buffered without either leaking remote
metadata or hiding useful development output. Use the local three-Worker stack for development.
Migrate and deploy commands never put application secrets in the generated TOML.

Before every remote runner action, authenticated Wrangler resolves Product D1
through a separate generated API config pinned to `STAGING_PRODUCT_D1_ID`. The
runner compares that resolved UUID without printing either value and stops
before the requested action on any authentication, parsing, or identity
failure. The requested command then runs with `shell: false`, the reviewed
Worker/database name, and an exact argument allowlist.

All supported non-interactive remote actions capture Wrangler stdout/stderr.
Migration and deployment success is rebuilt as a fixed structural summary;
failure returns only a generic message while retaining Wrangler's non-zero
exit status. Raw account, author, database, resource, and deployment metadata
is never forwarded.

Task 10 adds protected owner-run actions for count-only inventory, legacy Promo
and redemption prechecks, post-migration verification, cutover write markers,
a read-only Product D1 Time Travel bookmark, and API/Operator deployment
status. Protected action output is parsed fail-closed and reduced to approved
counts, timestamps, canonical Cloudflare version UUIDs, traffic percentages,
the validated opaque bookmark, or a generic completion message. Empty,
malformed, or case-insensitively duplicated version IDs fail closed.
Wrangler stdout/stderr, D1 metadata, and account details are not forwarded.
The runner deliberately exposes no Time Travel restore or Worker rollback
action.

The canonical ordered commands, expected safe outputs, quiet-window rules,
pre-deployment health check, compatibility conditions, coordinated exceptional
restore sequence, and evidence-retention rules are in the
[Task 10 protected staging cutover and recovery guide](../testing/task10-staging-cutover.md).
The dated activation record's older inline direct-Wrangler rollout draft is
historical and must not be executed.

### Failure and recovery rules

- A failed migration stops activation. Do not automatically restore Product D1.
- A failed Worker deployment leaves its previous deployed version active.
- Normal Product D1 recovery is quiet-window containment plus a reviewed
  forward migration/fix. A Time Travel restore is exceptional and requires
  continuous write isolation, an in-retention exact pre-migration bookmark,
  known compatible previous Worker source, and explicit owner approval.
- Protected Task 10 Worker rollback is deliberately disabled. The runner
  rejects rollback before spawning Wrangler. Do not bypass it with direct
  Wrangler rollback commands: interactive confirmation, version-to-source
  mapping, bindings, and secret compatibility are not safely preflighted.
- The runner also rejects D1 restore. Any approved exceptional restore must
  follow the coordinated ordering in the canonical cutover guide.
- API and Operator Web normal recovery is containment plus a reviewed forward
  deployment.
- Identity and the static demo are unchanged by Task 10. Do not deploy, roll
  back, or otherwise modify either one as part of Task 10 recovery.
- Identity must remain private. Stop if Cloudflare shows a public Identity route or hostname.
- The static demo is never an operator-platform rollback target and remains unchanged.
