# Task 10 protected staging cutover and recovery

**Status:** Prepared; not executed

**Notion mirror:** https://app.notion.com/p/Task-10-protected-staging-cutover-and-recovery-3a7e5c7c2b8e817f9c0cf0acab3e8c2e

**Scope:** Product D1 migration `0006`, API Worker, and Operator Web Worker

This is the canonical Task 10 staging procedure. It replaces direct
`wrangler d1`, export, and deployment-status commands previously drafted in
the dated activation record. The Cloudflare account owner runs each
Cloudflare command, checks the stated result, and stops on any deviation. The
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
  approved counts, timestamps, deployment versions, the D1 Time Travel
  bookmark, or fixed structural completion summaries. It never prints remote
  migration/deployment logs, account metadata, or database metadata.

The runner can read the current Time Travel bookmark. It deliberately cannot
restore Product D1, roll back a Worker, or perform any other recovery write.

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
ledgers. It also ensures that an emergency Time Travel restore cannot discard
legitimate writes made after the pre-migration bookmark.

## 2. Capture protected pre-migration evidence

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
```

Expected:

```json
{"invalid_trigger_rows":0,"unsafe_normalization_rows":0,"overlapping_claim_pairs":0}
```

Then:

```sh
node scripts/staging-wrangler-runner.mjs api task10-precheck-redemptions
```

Expected:

```json
{"invalid_legacy_redemption_rows":0}
```

Any non-zero count stops the rollout. Do not query or record the underlying
codes, customer data, request payloads, or redemption receipts in this
procedure.

Capture the pre-cutover Product write marker:

```sh
node scripts/staging-wrangler-runner.mjs api task10-write-marker
```

Expected: only the protected target-confirmation line plus
evaluation/redemption counts and nullable latest-write timestamps. Record the
sanitized result in the private rollout record.

Capture the currently deployed versions:

```sh
node scripts/staging-wrangler-runner.mjs api task10-status
```

Expected: a sanitized API deployment time and version/traffic summary.

Then:

```sh
node scripts/staging-wrangler-runner.mjs operator-web task10-status
```

Expected: a sanitized Operator Web deployment time and version/traffic
summary. Record both version UUIDs as rollout evidence only. A UUID is not by
itself authorization to roll back or proof that a version is compatible with
the restored database. There is no Task 10 Identity deployment or Identity
status step.

Capture the Product D1 Time Travel bookmark last, immediately before applying
the migration:

```sh
node scripts/staging-wrangler-runner.mjs api task10-bookmark
```

Expected:

```text
Authenticated staging Product D1 target confirmed.
{"bookmark":"<opaque Cloudflare bookmark>"}
```

Store the exact bookmark in the private rollout record. Do not alter it,
commit it, or paste it into public tickets or chat. This is a read-only action.
The continuous quiet window makes this bookmark an exact pre-migration
recovery point rather than a point followed by unrecorded application writes.

## 3. Apply migration `0006`

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

Stop on any failure. Do not automatically restore the database. First preserve
the quiet window and use the recovery decision in section 7. The structural
success line confirms Wrangler exited successfully; the next protected query
is the authoritative schema-state verification.

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

## 4. Deploy and verify the API Worker

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

Stream OpenAPI directly into a local validator. This does not create an
evidence directory or leave a copy of the document on disk:

```sh
set -o pipefail
curl --silent --show-error --fail-with-body \
  "$STAGING_API_ORIGIN/v1/openapi.json" |
  node -e '
const { readFileSync } = require("node:fs");
const document = JSON.parse(readFileSync(0, "utf8"));
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
'
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

## 5. Deploy and verify Operator Web

Identity is deliberately omitted: Task 10 does not change its contract,
binding, or implementation.

```sh
pnpm --filter @incentives/operator-web deploy:staging
```

Expected: the package's local contracts/dashboard build output may appear
first. The protected deploy runner ends with exactly:

```text
Authenticated staging Product D1 target confirmed.
{"application":"operator-web","action":"deploy","status":"completed"}
```

Then:

```sh
node scripts/staging-wrangler-runner.mjs operator-web task10-status
```

Expected: the new Operator Web version receives `100` percent traffic.

## 6. Run the fresh manual Gate C cases

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
bodies, cookies, invitation links, activation grants, recovery codes, or D1
IDs.

After verification, capture the post-cutover write marker:

```sh
node scripts/staging-wrangler-runner.mjs api task10-write-marker
```

Record the sanitized result in the private rollout record. Only now may the
owner decide whether to reopen traffic. Reopen it only when the migration,
health/OpenAPI checks, both deployments, protected status checks, and required
manual cases all pass.

## 7. Recovery decision

### Normal recovery: contain and fix forward

The normal path is:

1. keep or restore the quiet window;
2. disable integrations and operator writes;
3. preserve the bookmark and sanitized before/after evidence;
4. leave Product D1 on the migrated schema; and
5. deploy a reviewed API/Operator correction.

This avoids discarding valid data written after the bookmark and is the
required path once traffic has reopened or the bookmark is outside
Cloudflare's retention window.

### Exceptional recovery: coordinated Time Travel restore

Use an in-place Time Travel restore only when all of the following are true:

- the quiet window remained continuous, or all post-bookmark writes are
  explicitly accepted as disposable;
- the exact pre-migration bookmark from this rollout is still within
  Cloudflare's retention period;
- migration `0006` or the new application release cannot safely be corrected
  forward within the incident window;
- the exact reviewed previous API and Operator source/version is known; and
- an owner explicitly approves the destructive database restore.

Then perform this coordinated sequence:

1. Keep the quiet window closed and stop every Product D1 reader and writer.
2. Verify the saved bookmark, retention eligibility, previous reviewed source,
   Worker bindings/secrets, and database compatibility without exposing
   secrets or D1 identifiers.
3. Restore the previous compatible API and Operator Workers while traffic is
   still stopped. The old Worker on the additive migrated database is the
   safer temporary ordering; do not let the new Worker run against the restored
   pre-`0006` database.
4. The owner performs a D1 Time Travel restore to the exact saved bookmark.
   Treat this as destructive: it restores Product D1 in place, discards every
   later Product D1 change, and can cancel in-flight queries.
5. Verify that `migration_0006_rows` and the target-table state match the
   expected pre-migration state. Then verify health and the previous
   application contract before reopening traffic.
6. Record the restore time, bookmark, source/version mapping, verification
   results, and owner approval in the private incident record.

Do not improvise the restore during rollout. The protected runner intentionally
does not expose Time Travel restore or Worker rollback actions; an incident
owner must prepare and review the exact Cloudflare restore/deployment commands
against the current Cloudflare interface before executing them.

Task 10 does not change Identity or the static demo. They remain untouched
during cutover and recovery.

## 8. Evidence retention

Keep these items in the private rollout record until the rollout is explicitly
accepted:

- the exact pre-migration Time Travel bookmark;
- sanitized pre- and post-cutover write markers;
- sanitized pre- and post-deployment version summaries;
- migration/precheck results; and
- the required manual case results.

Do not commit, paste, email, or automatically delete the bookmark or private
rollout record. This procedure creates no SQL export, OpenAPI file, write-marker
file, or temporary evidence directory, so it has no local cleanup step.
