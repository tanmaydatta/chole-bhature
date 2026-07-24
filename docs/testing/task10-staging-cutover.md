# Task 10 protected staging cutover and recovery

**Status:** Prepared; not executed

**Notion mirror:** https://app.notion.com/p/Task-10-protected-staging-cutover-and-recovery-3a7e5c7c2b8e817f9c0cf0acab3e8c2e

**Scope:** Product D1 migration `0006`, API Worker, and Operator Web Worker

This is the canonical Task 10 staging procedure. It replaces direct
`wrangler d1`, export, and deployment-status commands previously drafted in
the dated activation record. The Cloudflare account owner runs each
command, checks the stated result, and stops on any deviation. The
implementation agent does not run Cloudflare reads or writes.

The protected runner:

- generates mode-`0600` Wrangler configuration pinned to the reviewed staging
  Worker name and `STAGING_PRODUCT_D1_ID`;
- separately asks authenticated Wrangler to resolve Product D1 before every
  remote operation and compares that identity without printing either ID;
- invokes the installed Wrangler entrypoint with `shell: false`, an exact
  argument allowlist, and a minimal child environment containing only required
  platform/temp/locale values plus Cloudflare authentication;
- excludes `NODE_OPTIONS`, `NODE_PATH`, endpoint and `WRANGLER_*` controls,
  proxy/output controls, unrelated cloud credentials, application secrets, and
  `STAGING_*` values;
- fails closed on malformed Wrangler JSON; and
- captures every supported non-interactive remote action and prints only
  approved count, timestamp, deployment-version, or fixed structural
  completion summaries. In particular, it never prints remote migration or
  deployment logs, account metadata, or D1 export signed URLs.

## 1. Approve the source and open a quiet window

Start at the repository root. Confirm that `HEAD` is the reviewed Task 10
rollout commit and that tracked files are clean:

```sh
git rev-parse HEAD
git status --short
```

Expected: the commit matches the approved PR/rollout record. `git status`
contains no tracked changes. Untracked local tooling must be reviewed
separately and must never be passed to deployment commands.

Prepare and load the ignored owner-only environment file without printing it:

```sh
test -f .env.staging
test "$(stat -f '%Lp' .env.staging)" = "600"
set -a
. ./.env.staging
set +a
pnpm staging:preflight
```

Expected: every command exits `0`; the preflight is sanitized and reports
`"cloudflareWrites": false`.

Before the first protected remote query, establish a deployment quiet window.
Keep it in place through migration, both Worker deployments, post-deployment
verification, and the final write-marker decision:

- stop client API traffic and integration retries;
- stop background jobs that evaluate or redeem incentives;
- ask operators not to change schemas, customers, Promos, credentials, or
  tenant settings; and
- confirm no other deployment or migration is in progress.

The quiet window matters even though migration `0006` is additive. A
pre-`0006` API Worker can still write its legacy evaluation/redemption rows
after migration, but those writes bypass the new atomic operation and entry
ledgers.

## 2. Create the private evidence directory

Create an owner-controlled, non-symlink, mode-`0700` directory outside the
repository. The runner accepts only an absolute path with the fixed export
basename:

```sh
umask 077
TASK10_BACKUP_DIR="$(mktemp -d "${TMPDIR%/}/incentives-task10.XXXXXX")"
chmod 700 "$TASK10_BACKUP_DIR"
TASK10_BACKUP_DIR="$(cd "$TASK10_BACKUP_DIR" && pwd -P)"
TASK10_BACKUP_PATH="$TASK10_BACKUP_DIR/incentives-staging-before-0006.sql"
export TASK10_BACKUP_DIR TASK10_BACKUP_PATH
```

Expected: no value is printed. Do not place this directory inside the
repository, use a symlink, relax its permissions, or pre-create the SQL file.

## 3. Capture protected pre-migration evidence

Run the count-only inventory:

```sh
node scripts/staging-wrangler-runner.mjs api task10-counts
```

Expected before the first rollout:

- authenticated Product D1 confirmation;
- non-negative integer counts; and
- `migration_0006_rows` equal to `0`.

If migration `0006` is already recorded, stop and reconcile the earlier
rollout evidence. Do not re-run this as a first cutover.

Run both fail-loud migration-equivalent prechecks:

```sh
node scripts/staging-wrangler-runner.mjs api task10-precheck-promos
node scripts/staging-wrangler-runner.mjs api task10-precheck-redemptions
```

Expected:

```json
{"invalid_trigger_rows":0,"unsafe_normalization_rows":0,"overlapping_claim_pairs":0}
{"invalid_legacy_redemption_rows":0}
```

Any non-zero count stops the rollout. Do not query or record the underlying
codes, customer data, request payloads, or redemption receipts in this
procedure.

Capture the pre-cutover Product write marker:

```sh
node scripts/staging-wrangler-runner.mjs api task10-write-marker \
  > "$TASK10_BACKUP_DIR/write-marker-before.txt"
```

Expected: the file contains only the protected target-confirmation line plus
evaluation/redemption counts and nullable latest-write timestamps.

Capture the currently deployed versions:

```sh
node scripts/staging-wrangler-runner.mjs api task10-status
node scripts/staging-wrangler-runner.mjs operator-web task10-status
```

Expected: sanitized deployment time and version/traffic summaries. Record the
version UUIDs as rollout evidence only. They are not rollback authorization or
an executable recovery target. There is no Task 10 Identity deployment or
Identity status step.

Export Product D1:

```sh
node scripts/staging-wrangler-runner.mjs api task10-export \
  "$TASK10_BACKUP_PATH"
test -s "$TASK10_BACKUP_PATH"
test ! -L "$TASK10_BACKUP_PATH"
chmod 600 "$TASK10_BACKUP_PATH"
```

Expected: the runner reports only `Product D1 export completed.` and the file
is a non-empty regular file. It suppresses Wrangler's temporary signed URL.
Treat both the URL and the export as sensitive even though the URL is not
shown.

## 4. Apply migration `0006`

Run the repository migration command:

```sh
pnpm --filter @incentives/api db:migrate:staging
```

Expected: authenticated Product D1 confirmation followed by a successful
application of `0006_promo_selection_redemption_bundles.sql`. The protected
runner's complete output is exactly:

```text
Authenticated staging Product D1 target confirmed.
{"application":"api","action":"migrate","status":"completed"}
```

Stop on any failure. Product D1 migrations are forward-only; never attempt a
schema downgrade or import the pre-migration export over the migrated
database. The structural success line confirms Wrangler exited successfully;
the next protected query is the authoritative schema-state verification.

Verify only the migration and target-table counts:

```sh
node scripts/staging-wrangler-runner.mjs api task10-post-migration
```

Expected:

```json
{"migration_0006_rows":1,"migration_0006_target_tables":4}
```

While the previous API Worker is still deployed, perform a read-only health
check:

```sh
curl --silent --show-error --fail-with-body \
  "$STAGING_API_ORIGIN/v1/health"
```

Expected: HTTP `200` and `{"status":"ok"}`. This is only a pre-deployment
availability check. It does not authorize reopening traffic or prove that the
old Worker populates the new ledgers; keep the quiet window in place.

## 5. Deploy and verify the API Worker

```sh
pnpm --filter @incentives/api deploy:staging
```

Expected: authenticated Product D1 confirmation and a successful deployment
of `incentives-api-staging` only. The package's local dependency-build output
may appear first. The protected runner's final output is exactly:

```text
Authenticated staging Product D1 target confirmed.
{"application":"api","action":"deploy","status":"completed"}
```

This summary does not expose a deployment version. The health, OpenAPI, and
protected deployment-status checks below verify the deployed behavior and
version.

Verify health:

```sh
curl --silent --show-error --fail-with-body \
  "$STAGING_API_ORIGIN/v1/health"
```

Expected: HTTP `200` and `{"status":"ok"}`.

Fetch OpenAPI into the private directory and validate only the clean-break
schema facts:

```sh
curl --silent --show-error --fail-with-body \
  --output "$TASK10_BACKUP_DIR/openapi.json" \
  "$STAGING_API_ORIGIN/v1/openapi.json"
node -e '
const { readFileSync } = require("node:fs");
const document = JSON.parse(readFileSync(process.argv[1], "utf8"));
const evaluation = document.components?.schemas?.EvaluationRequest;
const redemption = document.components?.schemas?.RedemptionRequest;
if (
  document.paths?.["/v1/evaluate"]?.post === undefined
  || document.paths?.["/v1/redemptions"]?.post === undefined
  || evaluation?.properties?.codes === undefined
  || Object.hasOwn(evaluation?.properties ?? {}, "code")
  || evaluation?.additionalProperties !== false
  || redemption?.properties?.evaluationId === undefined
  || Object.hasOwn(redemption?.properties ?? {}, "programRef")
  || redemption?.additionalProperties !== false
) {
  throw new Error("Deployed OpenAPI does not match the Task 10 clean-break contract");
}
console.log(JSON.stringify({
  evaluateCodes: true,
  singularCode: false,
  redemptionEvaluationId: true,
  redemptionProgramRef: false
}));
' "$TASK10_BACKUP_DIR/openapi.json"
```

Expected:

```json
{"evaluateCodes":true,"singularCode":false,"redemptionEvaluationId":true,"redemptionProgramRef":false}
```

Read back the protected API deployment summary:

```sh
node scripts/staging-wrangler-runner.mjs api task10-status
```

Expected: the new API version receives `100` percent traffic.

## 6. Deploy and verify Operator Web

Identity is deliberately omitted: Task 10 does not change its contract,
binding, or implementation.

```sh
pnpm --filter @incentives/operator-web deploy:staging
node scripts/staging-wrangler-runner.mjs operator-web task10-status
```

Expected: the package's local contracts/dashboard build output may appear
first. The protected deploy runner ends with exactly:

```text
Authenticated staging Product D1 target confirmed.
{"application":"operator-web","action":"deploy","status":"completed"}
```

The following protected status command must show the new Operator Web version
receiving `100` percent traffic.

## 7. Run the fresh manual Gate C cases

Follow the canonical
[Gate C manual end-to-end test](./gate-c-manual-test.md) from **Per-run test
data**. Generate one new run suffix and use its complete derived value set.
Do not reuse the 2026-07-21 client, program, customer, order, evaluation,
redemption, or idempotency values.

The mandatory correction cases are:

- `SELECT-AUTO-01` through `SELECT-AUTO-03`;
- `SELECT-CODE-01` through `SELECT-CODE-04`;
- `REDEEM-BUNDLE-01` through `REDEEM-BUNDLE-03`;
- `TENANT-API-01`; and
- `OBS-API-01`.

Record expected versus actual status, safe evaluation/redemption identifiers,
correlation IDs, and deployed API/Operator version IDs. Never record bearer
tokens, credential plaintext/digests, codes, customer attributes, request
bodies, cookies, invitation links, activation grants, recovery codes, D1 IDs,
or the export contents.

After verification, capture the post-cutover write marker:

```sh
node scripts/staging-wrangler-runner.mjs api task10-write-marker \
  > "$TASK10_BACKUP_DIR/write-marker-after.txt"
```

Only now may the owner decide whether to reopen traffic. Reopen it only when
the migration, health/OpenAPI checks, both deployments, protected status
checks, and required manual cases all pass.

## 8. Recovery decision

Migration `0006` is forward-only. The normal recovery path is containment plus
a reviewed forward fix:

1. keep or restore the quiet window;
2. disable integrations and operator writes;
3. preserve the private export and safe evidence;
4. leave Product D1 on the migrated schema; and
5. deploy a reviewed API/Operator correction.

Protected Task 10 Worker rollback is deliberately disabled. The runner rejects
every rollback action before it can spawn Wrangler. Do not use direct Wrangler
rollback commands as a workaround: interactive confirmation can be
misinterpreted or silently answered, deployed-version metadata does not prove
which reviewed source produced a version, and an older Worker may have
incompatible bindings, secrets, or behavior even when the D1 migration is
additive.

Until a reviewed fail-closed preflight or Cloudflare API tool can prove the
exact version-to-source mapping, binding/secret compatibility, target account,
and confirmation semantics, all Task 10 recovery is containment plus a
reviewed forward fix. Preserve the before/after write markers and sanitized
deployment-version summaries as incident evidence only.

Task 10 does not change Identity or the static demo. They remain untouched
during cutover and recovery; neither is a Task 10 forward-deployment or
rollback target.

## 9. Export retention and explicit disposition

Retain the export and private evidence until the rollout evidence is reviewed
and explicitly accepted by the owner. Do not commit, paste, email, or
automatically delete them. The owner chooses either an approved encrypted
archive with a documented retention date or explicit deletion after evidence
acceptance.

For deletion, first verify the exact fixed targets:

```sh
test -n "${TASK10_BACKUP_DIR:-}"
test -n "${TASK10_BACKUP_PATH:-}"
test "$TASK10_BACKUP_PATH" = \
  "$TASK10_BACKUP_DIR/incentives-staging-before-0006.sql"
test ! -L "$TASK10_BACKUP_DIR"
test ! -L "$TASK10_BACKUP_PATH"
```

Only after all checks pass and the owner has accepted the evidence may the
owner explicitly remove the known files and empty directory:

```sh
rm -- "$TASK10_BACKUP_PATH"
rm -- "$TASK10_BACKUP_DIR/openapi.json"
rm -- "$TASK10_BACKUP_DIR/write-marker-before.txt"
rm -- "$TASK10_BACKUP_DIR/write-marker-after.txt"
rmdir -- "$TASK10_BACKUP_DIR"
unset TASK10_BACKUP_PATH TASK10_BACKUP_DIR
```

No script or agent performs this deletion automatically.
