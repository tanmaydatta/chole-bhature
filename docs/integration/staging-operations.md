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
service binding. Only the API and Operator Web Workers receive custom-domain routes. Identity's
`AUTH_SECRET`, `RESEND_API_KEY`, and `RESEND_FROM`, and Operator Web's
`OPERATOR_SELECTION_SECRET` are staging Secrets Store bindings. Local Workers continue to read
their direct `.dev.vars` values.

### E2E platform deployment order

The [GAP-030/031 automated scenario](../testing/gap-030-031-e2e.md) adds protected,
run-scoped fixture, inspection, and full-disposal behavior across **both** D1
databases. The earlier GAP guidance that Identity need not deploy is obsolete
for this release. On 2026-09-28, the owner completed this staging rollout:
Product `0007` required an approved migration-ledger repair after its exact
nullable `price_breakdown_json` `TEXT` schema was confirmed already present;
the protected Product migration then applied `0008`; Auth `0005` and `0006`
applied; and API, private Identity, and Operator Web deployed. Root passkey
sign-in followed, and the staging suite passed 4 tests with 1 local-only test
skipped in 29.3 seconds. See the
[GAP-030/031 automated end-to-end verification](../testing/gap-030-031-e2e.md)
for assertions and evidence limits.

For a later staging rollout or a different environment, these commands remain
an owner-reviewed release procedure, not authorization to deploy as part of a
local test run. Commit and push the reviewed matching source revision only
after explicit release approval; do not start a staging E2E run while a
migration/deployment is in progress or any Worker is on an older revision.

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

For a target where Product migration `0007_merchandise_price_breakdowns.sql`
is pending, the Product migration command must apply `0007` and then
`0008_e2e_tenant_lifecycle.sql`, in that order, before the Core deploy. In the
2026-09-28 staging rollout, `0007` was absent from the migration ledger even
though its schema was already present; the owner approved one exact ledger-row
repair before `0008` applied. This is a recorded exception, not permission for
an unreviewed direct D1 write. If schema and migration-ledger state disagree,
stop, confirm the exact schema and migration history, and obtain explicit
owner approval for any narrowly scoped repair. Auth migrations
`0005_e2e_tenant_lifecycle.sql` and `0006_e2e_fixture_session.sql` must be
present before the Identity deploy.
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
other recipe writes. The 2026-09-28 staging run completed this handshake and
subsequent applicable suite; repeat the procedure only with separately
approved source and release scope.

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
instructions with the distinct UUIDs returned when the databases were created. Set
`STAGING_SECRETS_STORE_ID` to the existing account Secrets Store ID (32 hex characters). Replace the
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
passkey RP ID, and an allowed-recipient count. It does not contain D1 or Secrets Store IDs,
addresses, or secret values.
Stop if any precondition fails.

### Legacy demo build isolation

The `vanshit-lakshay` demo Worker remains connected to its repository, but its Cloudflare Workers
Builds include path is exactly `demo/*` and its exclude paths are empty. The pattern is relative to
the repository root and has no leading slash. Demo files can still trigger demo deployments;
platform-only changes do not target the demo Worker.

Cloudflare can bypass path matching for an empty push, a push containing at least 3,000 changed
files, or a push containing at least 20 commits. Treat those cases as exceptional and inspect the
demo build before allowing it to deploy.

### Secrets Store staging cutover

Use the [Workers Secrets Store integration](https://developers.cloudflare.com/secrets-store/integrations/workers/)
and the installed Wrangler 4.112.0 command help for this cutover. Confirm the intended Cloudflare
account before writing. A Cloudflare account supports one Secrets Store in the current beta. Find
the existing store with `wrangler secrets-store store list --remote`; create one with
`wrangler secrets-store store create <name> --remote` only if none exists. Record its returned ID
in the ignored `.env.staging` as `STAGING_SECRETS_STORE_ID`, then reload the file and rerun
preflight. Do not put a secret value in the config, shell command arguments, or command output.

Create the four account secrets with Workers scope before deploying either changed Worker. The
transfer helper validates the named Bitwarden item's ID, folder, name, and value in memory; it
passes the value through a pipe to a quiet `expect` PTY that answers Wrangler's hidden prompt.
For `RESEND_FROM`, it reads the single validated sender from mode-`0600` `.env.staging`. It
rejects an absent prompt or failed Wrangler exit and prints only the secret name, store ID, and
status. Keep the Bitwarden vault unlocked and supply item IDs only:

```sh
pnpm staging:secret-transfer AUTH_SECRET "$AUTH_ITEM_ID"
pnpm staging:secret-transfer RESEND_API_KEY "$RESEND_ITEM_ID"
pnpm staging:secret-transfer RESEND_FROM
pnpm staging:secret-transfer OPERATOR_SELECTION_SECRET "$OPERATOR_ITEM_ID"
```

Do not use Wrangler's `--value` flag or direct noninteractive Wrangler invocation. The helper
does not pass a value in argv or child environment and never forwards Wrangler output. Check
each sanitized completion, then list the store with `wrangler secrets-store secret list "$STAGING_SECRETS_STORE_ID"
--remote` to confirm all four names and Workers scope without reading secret values. The
generated staging configs bind these names using the store ID; they contain no values. A missing
binding, failed `get()`, or empty value makes staging fail closed. Existing per-Worker secrets
may remain during cutover, but staging code does not fall back to them. Roll back a partial
cutover by redeploying the previous compatible source revision for **both** Identity and
Operator Web after checking current deployment state; do not delete Secrets Store entries or
rotate the values as a rollback step. Then validate fresh passkey sign-in, allowed-address mail
delivery, merchant selection, and the protected E2E handshake. Do not remove the old per-Worker
secrets until that behavior is verified and a separate cleanup is reviewed.

#### Completed staging evidence — 2026-09-29

The approved staging cutover reused the existing account Secrets Store and
activated all four entries at Workers scope. Identity deployed 100% to
`b247bae5-d34a-4e4a-ab21-5874089e1d3a`; Operator Web deployed 100% to
`9e9c9580-b915-4200-befb-502cdda750c0`; both originated from PR #15 head
`df05d8d`. PR #15 then merged into `dev` at
`0c5e5f1a068d942af8f091ab0fc4b7ff8bf44e9d`. The old per-Worker secrets were
deliberately retained.

A live root session and the read-only cross-Worker capability handshake passed.
The complete applicable staging Playwright suite had **4 passed, 1 local-only skipped, 0 failed** in **32.0 seconds**. Scenario-level cleanup asserted zero
run-owned rows in both Product and Auth; final inventories each reported zero
active or disposing claims, 10 disposed claims, and 10 audit rows. This cutover
did not run API/Core deployment or any D1 migration, and it does not verify
email delivery or a headed browser run.

### User-controlled Cloudflare activation

The owner-run procedure below is the default for future cutovers: the owner runs one command,
checks its result, and only then moves to the next. The one-time 2026-09-29 staging authorization
has been consumed and is recorded above. It did not cover Product or Auth D1 migrations, Core
deployment, production, unrelated resources, or future rotations and cutovers.

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

Deploy private Identity after the three Identity Secrets Store entries exist. This config has no
route and publishes no `workers.dev` hostname:

```sh
pnpm --filter @incentives/identity deploy:staging
```

Deploy Operator Web after its Secrets Store entry exists and attach its custom domain:

```sh
pnpm --filter @incentives/operator-web deploy:staging
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
Migrate and deploy commands never put application secret values in the generated TOML.

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

### Rotate existing staging secrets

This is an owner-run operation on the existing staging Workers. It does not authorize the
E2E migrations, source deployments, or fixture writes above. Confirm the staging account,
store ID, bound secret name and ID, and read-only preconditions above before each update.

1. Store each replacement value as a **new** Bitwarden item before putting it anywhere else.
   Generate distinct random values of at least 32 characters for `AUTH_SECRET` and
   `OPERATOR_SELECTION_SECRET` when rotating them. For `RESEND_API_KEY`, first confirm the
   `RESEND_FROM` sender domain is verified in Resend. Create a sending-only key restricted
   to that domain where available, and immediately store its one-time value in a new
   Bitwarden item. Do not create the key if its value cannot be captured safely. Keep the
   previous Resend key active while validating the replacement. Never edit, overwrite, or
   delete any existing Bitwarden item, even an erroneous one; create another new item for
   each correction or supersession. Read back and verify every new item in Bitwarden
   before copying its value elsewhere. Never display, log, commit, or send a value in chat.
2. Only after Bitwarden readback verification, copy the applicable values into the
   git-ignored, mode-`0600` `.env.staging` using a local editor. Set `RESEND_FROM` to the
   verified sender. Confirm the intended test address is already in the deployed staging
   recipient allowlist, and keep `STAGING_ALLOWED_RECIPIENTS` in the local file aligned as
   a JSON array of approved real addresses; editing the file does not change the deployed
   allowlist. For initial preparation while all three secret fields are still placeholders,
   the local helper below reads the named Bitwarden items through the unlocked CLI, verifies
   them, and replaces those fields without displaying their values. Supply item IDs only;
   it refuses to overwrite a populated field.

   ```sh
   node scripts/staging-vault-to-env.mjs \
     "$AUTH_ITEM_ID" "$OPERATOR_ITEM_ID" "$RESEND_ITEM_ID"
   ```
3. List Secrets Store entries with the remote `secrets-store secret list` command above and
   identify the exact secret ID. Run `wrangler secrets-store secret update
   "$STAGING_SECRETS_STORE_ID" --secret-id <ID> --remote` for only the applicable entry,
   entering its replacement value at Wrangler's hidden prompt and checking the result before
   the next update. A sender change also requires updating `RESEND_FROM`. Do not run the
   separate E2E deployment sequence for rotation. An account secret update changes the value
   consumed by the bound Workers; coordinate it as a live change.
4. Confirm a fresh staging sign-in, delivery to an allowed address from the verified
   sender, and a fresh merchant selection after rotating the Operator secret. Existing
   selection cookies will no longer verify. Avoid rotating the Operator secret during an
   active merchant-provisioning attempt because it also derives provisioning IDs.
5. Only after the new Resend key has delivered successfully, revoke the previous key in
   Resend.

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
