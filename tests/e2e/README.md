# End-to-end test workspace

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
pnpm e2e:local:headed
```

This opens system Chrome so you can watch the Promo draft, save, refresh, detail,
and publish flow. `pnpm e2e:local` runs the browser smoke plus the detailed API
flow headlessly. No pre-existing root session, ports, `.dev.vars`, or local D1
state is needed: Playwright builds the dashboard/dependencies once, allocates
unique loopback ports and Worker names, migrates two private temporary D1
stores, bootstraps a disposable root through the existing root CLI and actual
passkey UI with a virtual WebAuthn authenticator, then removes only that suite's
temporary files/processes. System Chrome must be installed; set
`E2E_BROWSER_CHANNEL=chromium` on the underlying Playwright command if you
have installed its pinned browser instead. The headed script intentionally
selects the browser project; the headless script runs all projects.

For staging, first apply a pending Product `0007` migration before Product
`0008`, then apply the matching Auth migrations and deploy the
[matching Workers](../../docs/integration/staging-operations.md#e2e-platform-deployment-order)
under the normal protected owner process. Create a private, ignored directory
for the owner's browser state and complete the ordinary passkey sign-in in the
headed Chrome window opened by the helper:

```sh
mkdir -p tests/e2e/.runs
chmod 700 tests/e2e/.runs
pnpm e2e:staging:login --output "$PWD/tests/e2e/.runs/staging-root.json"
```

The helper accepts only an absolute path under an existing owner-owned 0700
directory, pins `https://operator.staging.wastd.dev`, checks the resulting
session is root, and creates a new 0600 storage-state file without overwriting
another file. It never prints cookies. It does not create a root account or
use a test login backdoor. When the session expires, repeat the login with a
**new** output filename (or move the old file to an owner-only archive first).
Then run the visible browser check:

```sh
E2E_OPERATOR_STORAGE_STATE="$PWD/tests/e2e/.runs/staging-root.json" pnpm e2e:staging:headed
```

`pnpm e2e:staging` runs all projects headlessly. The stage command pins both
public origins, requires the explicit staging-enable flag, checks the storage
file, live root session, and exact cross-Worker/Product/Auth migration capability
before any fixture creation, and never creates an initial root. Re-authenticate
with a new file when the session expires.
Do not put cookies, proofs, bearer tokens, or credentials on a command line.
The stage command creates and irreversibly deletes only run-provenance tenants;
it fails before any write on old/mixed Workers or missing lifecycle migrations.
The storage-state **path** is safe to place in the shell command; keep the
file and its containing directory private.

## Recipes and ownership

`pnpm recipe:e2e <recipe> --input /absolute/path/input.json [--run e2e_...]`
accepts typed, validated JSON; `add-merchant` can generate the run ID and all
later recipes reuse it. Available recipes: `add-merchant`, `add-user`,
`add-admin`, `set-role`, `add-schema`, `add-customer`,
`create-api-credential`, `add-promo`, `publish-promo`, and `cleanup-run`.
Arguments must be in files rather than shell command lines. The credential
recipe saves its token to a private file and prints only its location.

`add-user` and `add-admin` require staging. They create fully active,
run-exclusive synthetic accounts in an E2E-owned merchant and verify actual
Better Auth session identity and permissions. They do **not** test invitation
email delivery or acceptance; local Identity tests cover ordinary email auth.
Fixture sessions have an immutable 15-minute issuance cap and are invalid
outside staging. `set-role` uses the authorized operator API. No recipe writes
remote D1 directly.

Each run gets a random 96-bit `e2e_` ID; merchant, user, Promo/code, customer,
order, and idempotency identifiers are run-scoped. A mode-0600 manifest in
`tests/e2e/.runs` records every created ID and its owner. The run proof,
cookies, and tokens are separate private files. Independent scenarios share
one suite bootstrap but not tenant state or browser contexts. Playwright uses
two bounded workers; API tests carry detailed assertions while one browser
spec exercises real UI interactions. The measured local baseline on
2026-09-25 was 5 Playwright tests in 23.9 seconds, including bootstrap,
two concurrent full scenarios, browser smoke, and two simultaneous independent
Worker/Auth D1 instances. CI may select `--project=api` or
`--project=browser`, or shard with Playwright's `--shard` flag; each shard
starts its own isolated stack.

## Cleanup and recovery

The scenario runner previews and disposes its claimed tenant in `finally`,
then reopens a root read-only inventory to assert **zero Product and Auth
run-owned rows** and checks every manifest resource is `cleaned`. This occurs
on success and after a scenario assertion fails. Product deletion precedes
Auth deletion in a resumable two-DB saga. Both databases retain only a
sanitized run ID/merchant ID/status/timestamp disposal audit tombstone; no
fixture customer or credential content remains. Disposal is irreversible.
The normal local Worker config has no disposal path; the temporary Playwright
stack alone sets `E2E_LOCAL_TEST_MODE=1` in its private generated configs.
Staging requires `APP_ENV=staging`, live root authority, exact run proof,
server-recorded provenance, and dry-run inventory. Production is closed.

If a stage run fails during cleanup, retain its private `.runs` files and
resume only that run:

```sh
E2E_TARGET=staging E2E_ENABLE_STAGING=1 E2E_OPERATOR_STORAGE_STATE=/absolute/private/root-state.json pnpm recipe:e2e cleanup-run --run e2e_REPLACE_WITH_RECORDED_ID
E2E_TARGET=staging E2E_ENABLE_STAGING=1 E2E_OPERATOR_STORAGE_STATE=/absolute/private/root-state.json pnpm recipe:e2e cleanup-run --run e2e_REPLACE_WITH_RECORDED_ID --execute
```

The first command is a read-only preview. The second executes scoped,
idempotent disposal; it refuses foreign resources/proofs. Never edit a remote
D1 database to repair a run. Keep the private manifest until the final
zero-row inventory succeeds; then follow the repository's test-artifact
retention policy. Ignored local `.runs` files from an earlier aborted
temporary stack can be discarded only after confirming that stack's state was
removed.

The exact GAP-030/031 values, assertions, and staging/local evidence boundary
are documented in [the scenario guide](../../docs/testing/gap-030-031-e2e.md).
