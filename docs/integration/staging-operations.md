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

First apply the forward-only Product migrations:

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
that app's installed Wrangler entrypoint through the current absolute Node executable, removes the
temporary files on success or failure, and strips application secrets and `STAGING_*` inputs from
the Wrangler child environment. Staging `dev` commands may create a temporary `.dev.vars`; migrate
and deploy commands never put application secrets in the generated TOML.

Before every remote runner action, authenticated Wrangler resolves Product D1
through a separate generated API config pinned to `STAGING_PRODUCT_D1_ID`. The
runner compares that resolved UUID without printing either value and stops
before the requested action on any authentication, parsing, or identity
failure. The requested command then runs with `shell: false`, the reviewed
Worker/database name, and an exact argument allowlist.

Task 10 adds protected owner-run actions for count-only inventory, legacy Promo
and redemption prechecks, post-migration verification, cutover write markers,
Product D1 export, API/Operator deployment status, and an emergency API-only
rollback. Protected action output is parsed fail-closed and reduced to approved
counts, timestamps, deployment versions, or a generic completion message.
Wrangler stdout/stderr, D1 metadata, account details, and export signed URLs are
not forwarded. Product export additionally requires a caller-supplied absolute
path under an existing owner-controlled, non-symlink, mode-`0700` directory
with the fixed basename `incentives-staging-before-0006.sql`.

The canonical ordered commands, expected safe outputs, quiet-window rules,
pre-deployment health check, compatibility conditions, and explicit
export-retention/disposition steps are in the
[Task 10 protected staging cutover and recovery guide](../testing/task10-staging-cutover.md).
The dated activation record's older inline direct-Wrangler rollout draft is
historical and must not be executed.

### Failure and rollback rules

- A failed migration stops activation. Never attempt a destructive D1 downgrade.
- A failed Worker deployment leaves its previous deployed version active.
- Product migrations are forward-only. After migration, normal recovery is a
  quiet-window containment plus a reviewed forward fix.
- An emergency API Worker rollback is a separate owner-only Cloudflare
  mutation. It is permitted only when protected pre/post write markers prove
  zero evaluation/redemption writes after migration, the exact prior API
  version was captured, that version is mapped to reviewed local source, and
  local tests prove that source remains compatible with the migrated schema.
  Any write or uncertainty forbids rollback.
- Task 10 does not roll back Operator Web, Identity, Product D1, or the static
  demo.
- Identity must remain private. Stop if Cloudflare shows a public Identity route or hostname.
- The static demo is never an operator-platform rollback target and remains unchanged.
