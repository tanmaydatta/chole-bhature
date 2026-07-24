# Staging activation run — 2026-07-21

**Status:** In progress — Tasks 1–9 of the Promo-selection correction and Task
10 review remediation are implemented and verified locally; the protected
cutover/recovery procedure is prepared, but reviewed merge, the
owner-controlled staging migration/deployment, and every new manual case remain
unrun

**Notion:** https://app.notion.com/p/3a5e5c7c2b8e81739dfed75f998e6489

**Follow-up register:** [Product follow-up register](../product/follow-up-register.md)

## Environment

- API health: Pass (`GET /v1/health` returned 200 with `{ "status": "ok" }`)
- Operator origin: Pass (dashboard loaded over HTTPS)
- Identity exposure: Pass (private Worker was not publicly reachable)
- Product/Auth migrations: Pass (no pending migrations after activation)
- Persisted Worker logs: Pass (API, Identity, and Operator Web redeployed with 100% staging log sampling)

## Completed manual checks

- Root activation grant exchange: Pass
- Root passkey registration and sign-in: Pass
- Recovery codes displayed and stored by the operator: Pass; values not recorded
- Client provisioning: Pass for two active staging clients
- Root client selection and refresh persistence: Pass for both clients
- Client-admin invitation creation and delivery: Pass
- Client-admin invitation acceptance: Pass
- Client-admin magic-link sign-in in a fresh browser profile: Pass
- Client-admin scope: Pass (no Root access banner or platform Clients navigation)
- Client-admin viewer onboarding: Pass (invitation delivered, accepted, membership active, and magic-link sign-in completed in an isolated browser)
- Viewer navigation and controls: Pass (schema and Promo reads available; customer, team, credential, platform-client, and mutation controls absent)
- Viewer protected routes: Pass (`/customers`, `/settings/team`, `/settings/credentials`, and `/platform/clients` denied)
- Viewer backend mutation enforcement: Pass (schema publication attempt returned HTTP 403 with `FORBIDDEN`)
- Client-admin Operator onboarding: Pass (invitation delivered, accepted, membership active, and magic-link sign-in completed in an isolated browser)
- Operator navigation and controls: Pass (schema, customer, and Promo management available; team, credential, and platform-client controls absent)
- Operator protected routes: Pass (`/settings/team`, `/settings/credentials`, and `/platform/clients` denied)
- Operator backend authorization: Pass (credential read attempt returned HTTP 403 with `FORBIDDEN`)
- Client schema authoring: Pass (required `customer.tier` and `context.channel` enum definitions saved in draft version 1)
- Client schema impact preview: Pass (stored-customer and referenced-program counts shown; required live-context warning shown for `context.channel`)
- Client schema publication: Pass (published version 1 persisted with both definitions)
- Published-definition deprecation safety: Partial (the published snapshot remained unchanged and the working list hid `context.channel`, but no draft version 2 was created)
- Exact customer lookup and creation: Pass (`gate-c-customer` returned the exact not-found state, then persisted a typed Tier value at version 1)
- Customer cross-session update and persistence: Pass (an authorized second session loaded the same record, saved a new typed value, and advanced the version)
- Customer stale-write protection: Pass (a stale authorized session received `VERSION_CONFLICT`, did not overwrite the canonical value, and exposed the refresh action)
- Customer conflict recovery and durable reload: Pass (refresh and subsequent hard-refresh returned the current canonical version and Tier)
- Promo revision 1 authoring: Pass (`gate-c-promo` persisted the complete typed/nested example with two ordered conditional rewards and a fallback)
- Promo revision 1 publication: Pass (draft revision 1 published as active revision 1)
- Promo revision 1 durable reload: Pass (hard-refresh preserved the external reference, reward order/effects, nested customer condition, fallback, limits, and active revision)
- Promo revision 2 authoring: Pass (the fixed logical reference produced draft revision 2 beside active revision 1; reward order changed and line-item fixed became line-item percent)
- Promo revision 2 publication and reload: Pass (revision 2 became active and retained the changed name, order, effect, conditions, and fallback after hard refresh)
- Promo lifecycle transitions: Pass (active revision 2 paused, resumed, and ended irreversibly; every state survived hard refresh and exposed only the valid next actions)
- Free-shipping Promo authoring retest: Pass (`gate-c-free-shipping-retest` saved without a monetary budget, published as active revision 1, and retained its conditioned `free_shipping` effect after hard refresh)
- Staging API credential creation: Pass (a staging secret credential was created with schema-read, evaluation-write, and redemption-write scopes; plaintext was handled only in the tester shell)
- Credential-authenticated published-schema read: Pass (published version 1 returned the expected required `customer.tier` and `context.channel` enum definitions)
- Auto-apply evaluation: Pass (the active free-shipping Promo qualified without a request `code`; the ended Promo returned unavailable)
- Redemption commit: Pass (the qualified free-shipping decision committed with a unique external-order reference and idempotency key)
- Redemption idempotent retry: Pass (an identical retry returned the same committed redemption rather than creating another use)
- Redemption idempotency conflict: Pass (reusing the same idempotency key with a different external-order reference returned HTTP 409 `VERSION_CONFLICT`, non-retryable)
- Evaluation before second commit: Pass (with one committed use and a per-customer cap of 2, a later evaluation still qualified because evaluations do not consume the cap)
- Second redemption commit: Pass (a new evaluation plus new external-order and idempotency identifiers committed the second use)
- Per-customer exhaustion: Pass (the next evaluation returned `exhausted`, no effects, `eligible: false`, `commitRequired: false`, and `PER_CUSTOMER_CAP_EXHAUSTED`)
- Manual-code draft persistence: Pass (`gate-c-manual-code` retained code-triggered mode and code `GATEC15` after a hard refresh and reopening the draft editor)
- Manual-code evaluation without a code: Pass for the current contract (the manual Promo returned `invalid_code`)
- Manual-code evaluation with an incorrect code: Pass for the current contract (the manual Promo remained `invalid_code`)
- Manual-code evaluation with the correct code: Pass (the manual Promo qualified and returned the configured 20% order-discount effect)
- Product-selection acceptance: Fail for the desired client contract (each response also exposed unrelated automatic/coded Promo outcomes, and the current redemption request commits one caller-selected program rather than a signed selected bundle)

The product-selection failure above is historical evidence from the deployed
2026-07-21 build, not the current local contract. Tasks 1–9 now implement the
clean-break `codes[]` request, private automatic/coded selection, ordered atomic
bundle redemption, structured failure logs, and explicit operator trigger
review locally. No staging pass is claimed until Task 10 is deployed and run by
the account owner.

## Schema deprecation discrepancy

- Manual expectation: deprecating `context.channel` after publishing version 1 creates draft version 2 while published version 1 remains unchanged.
- Observed UI: `context.channel` disappeared from the working list, but the page reported no draft and published version 1.
- Read-only remote D1 verification: schema version 1 remained published and its immutable snapshot still contained both `customer.tier` and `context.channel`; the version-1 `context.channel` definition row was marked `deprecated`; `customer.tier` remained `published`; no version-2 schema row existed.
- Database-write verification for diagnosis: zero rows written.
- Current implementation behavior: deprecation is stored immediately on the definition row, while the next draft is created lazily by a later authoring mutation.
- Follow-up decision: either create draft version 2 immediately when a published definition is deprecated, or explicitly specify and represent the lazy-deprecation model in the UI and manual guide. The immediate-draft model is recommended because it makes the unpublished working change and its publish lifecycle visible.

## Free-shipping authoring incident

- Affected flow: create `gate-c-free-shipping` from the live operator UI with one conditioned free-shipping reward, no fallback, and no monetary budget.
- Expected: clearing Budget currency and Budget minor units removes the optional budget and enables **Save draft**.
- Actual: Budget currency became blank, Budget minor units became `0`, and the editor continued to show **Complete every required field and ensure each conditional rule has a condition.**
- Root cause: each Budget input change always writes a `budget` object. Emptying the controls never sets `budget` to `undefined`, and the editor provides no explicit **Remove budget** action. The resulting empty-currency/zero-value budget fails client-side contract validation; a retained valid monetary budget would separately conflict with free shipping.
- Test result: Fail. The free-shipping create/publish/reload portion of `PROMO-02` is blocked through the client-facing UI.
- Required fix: represent “no budget” explicitly in the editor, allow an existing/default budget to be removed atomically, show field-specific validation, and add a browser-level regression covering a no-budget free-shipping save.
- Local resolution: implemented explicit **Add budget**/**Remove budget** actions, field-specific invalid-budget feedback, pre-submit free-shipping/budget conflict guidance, and a regression that verifies the saved request omits `budget`.
- Retest status: Pass after PR #8 was merged into `dev` and the API and
  Operator Web staging Workers were redeployed. A fresh conditioned
  free-shipping Promo saved with no budget, published as active revision 1,
  and survived a hard refresh with the canonical effect intact.

## Invitation incident

- Result before fix: Fail
- Safe response: HTTP 400, `INVALID_REQUEST`, non-retryable
- Correlation: `3d718b24-0ed9-4801-b5e5-a00f458f4f9d`
- Reproduction: the failure remained after correcting the recipient email
- Boundary evidence: Operator Web accepted the browser body and invoked Identity; Identity rejected the create-invitation RPC before invitation processing
- Root cause: an extra top-level `correlationId` violated strict `IdentityCreateInvitationRequestSchema`; the valid correlation ID already belonged inside `input`
- Code resolution: Merged in PR #7 and deployed to API, Identity, and Operator Web staging Workers
- Retest result: Pass; the invitation was created, delivered, accepted, and used for a fresh client-admin sign-in

## Evaluation observability incident

- Affected flow: credential-authenticated `POST /v1/evaluate`.
- Safe response: HTTP 503, `EVALUATION_UNAVAILABLE`, retryable, with the same
  correlation ID in the response body and `x-correlation-id` header.
- Confirmed runtime cause: `incentives-api-staging` had no
  `DECISION_SIGNING_SECRET`; credential generation and schema reads do not
  require that separate decision-integrity secret.
- Historical observability finding: the public API error boundary converted handled
  exceptions into safe canonical responses but did not explicitly emit a
  sanitized structured error log. The returned correlation ID therefore does
  not reliably locate the underlying exception in persisted Worker logs.
- Local code resolution: Task 7 added the centralized sanitized
  `api_request_failed` event and tests proving that the response header, error
  body, signed evaluation snapshot, and log event share the correlation ID.
  Tests also reject Authorization values, credentials, submitted codes, request
  bodies, customer attributes, decision/order/key identifiers, SQL details,
  and dependency stacks from production logs. `GAP-022` is fixed in code but
  awaits the Task 10 staging lookup in `OBS-API-01`.
- Runtime resolution: a fresh `DECISION_SIGNING_SECRET` was generated locally,
  uploaded to the staging API Worker as a secret, and the same
  credential-authenticated evaluation then succeeded.

## Promo selection and atomic-redemption discrepancy

- Affected flows: automatic evaluation, coded evaluation, compatible code
  stacking, and redemption commit.
- Observed automatic behavior: the response included decisions for every
  active Promo, including unrelated unavailable/exhausted programs.
- Observed coded behavior: missing and incorrect codes correctly produced
  `invalid_code`, and the configured code correctly qualified, but all three
  responses still included unrelated Promo decisions.
- Commit mismatch: `POST /v1/redemptions` requires a caller-selected
  `programRef`, so it cannot commit a complete signed stack as one operation.
- Product decision: automatic evaluation privately considers only automatic
  candidates and returns zero or one winner; coded evaluation suppresses
  automatic candidates and resolves only submitted distinct normalized codes;
  compatible coded Promos may stack; and redemption commits the complete signed
  selected bundle atomically.
- Local implementation status: Tasks 1–9 of `GAP-026` are implemented and
  focused verification passes. Task 10 review remediation adds protected
  Product-D1 confirmation/queries/export/status, the migration-equivalent
  legacy-redemption guard, the compatibility proof for old column-list
  inserts, and a forward-only cutover/recovery procedure. The plan remains
  **In progress** because final verification, reviewed merge,
  owner-controlled staging deployment, and manual evidence do not yet exist.
  See the
  [design](../superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md)
  and [plan](../superpowers/plans/2026-07-24-promo-selection-code-stacking.md).
- Retest requirement: after a reviewed merge and user-controlled staging
  migration/deployment, repeat automatic zero-or-one selection, missing/wrong/
  correct code isolation, mixed stackability, bundle idempotency, cap/budget
  concurrency, and tenant-isolation cases with fresh identifiers.

## UX follow-ups

- The authenticated dashboard does not identify the signed-in user. Add an account indicator that shows the current user's email, role, and selected client so operators can verify which session and scope they are using.
- Overview statistics and program rows are still hard-coded demo fixtures rather than staging data. Replace them with live tenant-scoped data or a clear empty state before client use; do not show fabricated codes, redemptions, or spend in the client operator product.
- The live Variables surface is functional but uses largely unstyled native table and button elements. The application stylesheet is loaded—the shell is styled—but the live operator pages need the established dashboard component styling before client use.
- The shared sign-in form offers “Sign in with passkey,” but passkey enrollment and management are currently root-only by design. Until member passkeys are implemented, label or present this action as root-only so invited employees are not given a misleading option.
- Opening Customers before the client has published its first variable schema produces a generic `NOT_FOUND` error with a retry action. Replace this with a prerequisite empty state that explains that a schema must be published and links authorized users to Variables.
- Publishing a schema does not clear the previously opened impact panel, leaving stale pre-publication counts and a duplicated warning alongside the new canonical version. Clear impact/removal state after successful publication.
- The Variables Lifecycle column labels editable, unreferenced client definitions as `Draft` even after their schema version is published. Expose and render the persisted definition/version lifecycle rather than inferring it from `readOnly` and `referenced` flags.
- Deprecating a published definition with no existing draft marks its definition row deprecated without creating a visible next draft. This hides the definition from authoring while the published schema still contains it, leaving operators unable to see or publish the pending schema change. Create and display the next draft immediately, or make the lazy state explicit.
- Promo detail shows active and draft revision numbers but provides no comparison between their configurations. Add a pre-publication review that highlights changed metadata, conditions, reward order/effects, fallback, limits, schedule, and stacking.
- Historical Promo revisions are retained in Product D1 with author/publication metadata, but the current operator contracts and UI expose only the active and single draft pointers. Add a read-only revision history with configuration inspection and clear active/draft markers before client use.
- The Promo lifecycle intentionally permits only one next draft per logical external reference. Keep this simple model for the first client unless parallel proposal/approval workflows become a demonstrated requirement; multiple named drafts would require explicit branching, ownership, comparison, and publish-selection semantics.
- A brand-new Promo editor was already populated with the complete sample configuration before the user selected **Use complete authoring example**. Task 8 now starts from an intentional minimal draft and makes the complete example an explicit action; staging verification remains pending.
- The Promo budget controls originally could not express the optional “no budget” state after a budget existed. PR #8 added explicit budget enable/remove controls and field-level errors, and the staging retest passed.
- `productRef` is an opaque technical value with no catalog lookup or integration mapping help. Keep the canonical reference but add a connector-backed selector/validation when the first commerce integration is chosen.
- Percentage reward fields expose internal basis points (`2000` for `20%`). Render a client-facing percentage control and perform the exact basis-point conversion at the boundary.
- Promo detail omitted both application mode and the configured manual code. Task 8 now shows Automatic/Code-triggered mode, authorized code visibility, stacking, priority, active/draft revision identity, and an explicit pre-publication review; staging verification remains pending.
- The live Promo selector cannot grant a Loyalty wallet asset. Future contracts can represent wallet accrual, but production publication must wait for a real ledger/fulfilment runtime; afterward, conditional Promos should be able to grant a merchant-configured Points/Credits/Miles/Stars/Cashback asset without coupling Promo to a specific Loyalty implementation.
- Accepting an invitation in a browser with another active account consumes the invitation and redirects without explaining the accepted identity or account handoff. Require or guide an isolated handoff and show an explicit success state.

The maintained identifiers, statuses, dispositions, and longer-term module
deferrals are in the linked Product follow-up register.

## Scope decision after the free-shipping finding

- Gate C retains the originally approved no-budget free-shipping behavior.
- The immediate Gate C fix is limited to representing and saving an optional absent budget, with field-specific validation.
- Optional free-shipping campaign budget, per-order cap, authoritative shipping costs, reservations, final commit, reversal, and provider-neutral storage are a separate follow-on design:
  `docs/superpowers/specs/2026-07-23-free-shipping-budget-authority-design.md`.
- That approved follow-on keeps budget and per-order cap optional, requires the
  client to supply actual shipping cost, permits a full waiver or none, uses a
  configurable reservation TTL defaulting to 15 minutes, treats
  expiry/failure recovery as money, and requires exact currency with no
  conversion. It will implement the same provider-neutral atomic coordinator
  port through a distributed adapter. Event-driven reversals and future
  event-triggered incentives remain planned, not implemented.
- Future event definitions/mappings and event-triggered Loyalty, Referral, and Affiliate behavior are preserved in that design but do not block Gate C.

## Task 10 local automated evidence

This evidence is local only. It was freshly established from the current Task
10 review-remediation candidate on 2026-07-24 and does not claim that migration
`0006`, either Worker deployment, or the fresh manual staging run has happened.

| Gate | Current review-remediation result |
| --- | --- |
| Six focused package suites (`contracts`, `engine`, `module-kit`, `promo`, `api`, `dashboard`) | Pass: 905/905 tests |
| Protected-runner suites (`staging-wrangler-resolution`, `staging-wrangler-runner`, `staging-wrangler-task10`) | Pass: 71/71 tests |
| `pnpm test` | Pass: 1,291/1,291 workspace tests |
| `pnpm build` | Pass; the existing dashboard main-chunk warning above 500 kB remains |
| `pnpm lint` | Pass; only the two existing dashboard Fast Refresh warnings remain (`ThemeProvider.tsx:9:14` and `Toast.tsx:15:17`) |
| `pnpm verify:clean-tests` | Pass against the committed review-remediation candidate, including the protected-runner and migration-compatibility tests |
| `apps/api/test/production-migration.test.ts` | Pass: 21/21 tests, including the production baseline, fail-loud legacy guards, readable legacy redemption backfill, and additive compatibility proof |
| Task 10 review | Rollout-safety findings remediated; final parent review and merge remain pending |

## Owner-controlled Task 10 staging rollout — prepared, not executed

> **Superseded rollout draft — do not execute the inline commands in this
> section.** The reviewed procedure is the
> [Task 10 protected staging cutover and recovery guide](./task10-staging-cutover.md).
> It routes every D1 export/query and deployment-status read through the
> generated mode-`0600` protected runner, adds the exact legacy-redemption
> precheck, requires a continuous quiet window and pre-deployment health check,
> and defines the forward-only recovery and sensitive-export disposition
> rules. Protected Worker rollback is deliberately disabled pending reviewed
> safe preflight/API tooling. This historical draft remains only to preserve
> the activation record.

**Status:** Not run. No Cloudflare query, export, migration, deployment,
secret operation, or manual staging case below was executed by the
implementation agent. The Cloudflare account owner runs one command at a time,
checks the stated output, records only safe evidence, and stops on any
deviation before continuing.

All commands start at the repository root. The rollout source must contain
`0f49908`, have no uncommitted tracked changes, and use the existing ignored
mode-`0600` `.env.staging`. Load that file without printing it, then run the
sanitized preflight:

```sh
git merge-base --is-ancestor 0f49908 HEAD
```

Expected: exit `0`.

```sh
git diff --quiet
```

Expected: exit `0`.

```sh
git diff --cached --quiet
```

Expected: exit `0`.

```sh
set -a
. ./.env.staging
set +a
```

Expected: no values are printed.

```sh
pnpm staging:preflight
```

Expected: exit `0`; sanitized JSON names the three staging Workers and two
databases, shows the approved origins and recipient count, and says
`"cloudflareWrites": false`. It must not print a D1 UUID, address, or secret.
The owner must also have authenticated Wrangler access and schedule the export
for a window in which its documented temporary D1 query unavailability is
acceptable.

### 1. Back up and query current Product staging data

Create a private directory outside the repository:

```sh
export TASK10_BACKUP_DIR="$(mktemp -d /tmp/incentives-task10-XXXXXX)"
```

Expected: the variable names a new mode-`0700` directory and nothing sensitive
is printed.

Run the account-owner-controlled remote export:

```sh
pnpm --filter @incentives/api exec wrangler d1 export incentives-staging \
  --remote \
  --output "$TASK10_BACKUP_DIR/incentives-staging-before-0006.sql"
```

Expected: exit `0` after the owner confirms the export; the SQL file is
non-empty inside the private directory. Do not open, paste, commit, or copy the
export into this record.

Query counts only:

```sh
pnpm --filter @incentives/api exec wrangler d1 execute incentives-staging \
  --remote \
  --json \
  --command "
SELECT
  (SELECT COUNT(*) FROM programs WHERE type = 'promo') AS promo_rows,
  (
    SELECT COUNT(*)
    FROM program_revisions AS revision
    INNER JOIN programs AS logical
      ON logical.merchant_id = revision.merchant_id
      AND logical.id = revision.program_id
    WHERE logical.type = 'promo'
  ) AS promo_revision_rows,
  (SELECT COUNT(*) FROM redemptions) AS redemption_rows,
  (
    SELECT COUNT(*)
    FROM d1_migrations
    WHERE name = '0006_promo_selection_redemption_bundles.sql'
  ) AS migration_0006_rows;
"
```

Expected before a first rollout: safe integer counts and
`migration_0006_rows = 0`. If that count is already `1`, stop and reconcile the
earlier migration/deployment evidence instead of treating this as a new run.

### 2. Validate legacy Promo rows

This query mirrors migration `0006`'s fail-loud trigger, normalization, and
overlap guards, but returns counts only. It does not reveal codes, customer
data, or recipient data.

```sh
pnpm --filter @incentives/api exec wrangler d1 execute incentives-staging \
  --remote \
  --json \
  --command "
WITH promo_configs AS (
  SELECT config_json
  FROM programs
  WHERE type = 'promo'
  UNION ALL
  SELECT revision.config_json
  FROM program_revisions AS revision
  INNER JOIN programs AS logical
    ON logical.merchant_id = revision.merchant_id
    AND logical.id = revision.program_id
  WHERE logical.type = 'promo'
),
invalid_triggers AS (
  SELECT 1
  FROM promo_configs
  WHERE CASE
    WHEN json_valid(config_json) = 0 THEN 1
    WHEN json_type(config_json, '\$') <> 'object' THEN 1
    WHEN COALESCE(json_extract(config_json, '\$.type'), '') <> 'promo' THEN 1
    WHEN COALESCE(json_type(config_json, '\$.autoApply'), 'missing')
      NOT IN ('true', 'false') THEN 1
    WHEN COALESCE(json_type(config_json, '\$.stackable'), 'missing')
      NOT IN ('true', 'false') THEN 1
    WHEN json_type(config_json, '\$.code') = 'text'
      AND instr(CAST(json_extract(config_json, '\$.code') AS BLOB), X'00') > 0
      THEN 1
    WHEN json_type(config_json, '\$.autoApply') = 'true'
      AND COALESCE(json_type(config_json, '\$.code'), 'text')
        NOT IN ('null', 'text') THEN 1
    WHEN json_type(config_json, '\$.autoApply') = 'false'
      AND (
        COALESCE(json_type(config_json, '\$.code'), 'missing') <> 'text'
        OR COALESCE(length(trim(json_extract(config_json, '\$.code'))), 0) = 0
        OR length(trim(json_extract(config_json, '\$.code'))) > 128
      ) THEN 1
    ELSE 0
  END = 1
),
unsafe_normalization AS (
  SELECT 1
  FROM promo_configs
  WHERE json_type(config_json, '\$.autoApply') = 'false'
    AND json_extract(config_json, '\$.code') GLOB '*[^ -~]*'
),
overlapping_claims AS (
  SELECT 1
  FROM programs AS left_program
  INNER JOIN program_revisions AS left_revision
    ON left_revision.merchant_id = left_program.merchant_id
    AND left_revision.program_id = left_program.id
    AND left_revision.revision = left_program.active_revision
  INNER JOIN programs AS right_program
    ON right_program.merchant_id = left_program.merchant_id
    AND right_program.id > left_program.id
  INNER JOIN program_revisions AS right_revision
    ON right_revision.merchant_id = right_program.merchant_id
    AND right_revision.program_id = right_program.id
    AND right_revision.revision = right_program.active_revision
  WHERE left_program.type = 'promo'
    AND right_program.type = 'promo'
    AND left_program.status IN ('active', 'scheduled', 'paused')
    AND right_program.status IN ('active', 'scheduled', 'paused')
    AND json_type(left_revision.config_json, '\$.autoApply') = 'false'
    AND json_type(right_revision.config_json, '\$.autoApply') = 'false'
    AND (
      json_extract(left_revision.config_json, '\$.endDate') IS NULL
      OR json_extract(left_revision.config_json, '\$.endDate') >= date('now')
    )
    AND (
      json_extract(right_revision.config_json, '\$.endDate') IS NULL
      OR json_extract(right_revision.config_json, '\$.endDate') >= date('now')
    )
    AND upper(trim(json_extract(left_revision.config_json, '\$.code')))
      = upper(trim(json_extract(right_revision.config_json, '\$.code')))
    AND COALESCE(
      json_extract(left_revision.config_json, '\$.endDate'),
      '9999-12-31'
    ) >= COALESCE(
      json_extract(right_revision.config_json, '\$.startDate'),
      '0001-01-01'
    )
    AND COALESCE(
      json_extract(right_revision.config_json, '\$.endDate'),
      '9999-12-31'
    ) >= COALESCE(
      json_extract(left_revision.config_json, '\$.startDate'),
      '0001-01-01'
    )
)
SELECT
  (SELECT COUNT(*) FROM invalid_triggers) AS invalid_trigger_rows,
  (SELECT COUNT(*) FROM unsafe_normalization) AS unsafe_normalization_rows,
  (SELECT COUNT(*) FROM overlapping_claims) AS overlapping_claim_pairs;
"
```

Expected: all three counts are `0`. Any non-zero count stops the rollout. Do
not query or record the affected code or configuration; reconcile it through a
separately reviewed, application-assisted process.

### 3. Apply and verify Product migration `0006`

Run the repository script, which resolves the API package's installed Wrangler
entrypoint and generates the protected staging config:

```sh
pnpm --filter @incentives/api db:migrate:staging
```

Expected: exit `0`; Wrangler reports
`0006_promo_selection_redemption_bundles.sql` applied to remote
`incentives-staging`. A failure stops the rollout; never attempt a destructive
D1 downgrade.

Verify only the applied migration name and target table count:

```sh
pnpm --filter @incentives/api exec wrangler d1 execute incentives-staging \
  --remote \
  --json \
  --command "
SELECT COUNT(*) AS migration_0006_rows
FROM d1_migrations
WHERE name = '0006_promo_selection_redemption_bundles.sql';
SELECT COUNT(*) AS migration_0006_target_tables
FROM sqlite_master
WHERE type = 'table'
  AND name IN (
    'promo_code_claims',
    'redemption_operations',
    'redemption_entries',
    'redemption_commit_guards'
  );
"
```

Expected: `migration_0006_rows = 1` and
`migration_0006_target_tables = 4`.

### 4. Deploy the API Worker

```sh
pnpm --filter @incentives/api deploy:staging
```

Expected: exit `0`; `incentives-api-staging` deploys to the configured API
custom domain and Wrangler prints the new version ID. Record the version ID,
not account identity or other deployment metadata.

### 5. Verify health and the clean-break OpenAPI

```sh
curl --silent --show-error --fail-with-body "$STAGING_API_ORIGIN/v1/health"
```

Expected: HTTP `200` and `{ "status": "ok" }`.

Fetch the generated document into the private rollout directory:

```sh
curl --silent --show-error --fail-with-body \
  --output "$TASK10_BACKUP_DIR/openapi.json" \
  "$STAGING_API_ORIGIN/v1/openapi.json"
```

Expected: HTTP `200` and a non-empty JSON file.

Validate the deployed request schemas without printing the document:

```sh
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
`{"evaluateCodes":true,"singularCode":false,"redemptionEvaluationId":true,"redemptionProgramRef":false}`.

### 6. Identity deployment decision

**Current decision: skip Identity.** At source `0f49908`, no Identity Worker
implementation, Identity RPC request/response schema, or staging binding
configuration changed. The Operator and Core changes therefore do not require
an `incentives-identity-staging` deployment.

Only if a later reviewed rollout revision changes that binding contract may
the account owner run:

```sh
pnpm --filter @incentives/identity deploy:staging
```

Expected if and only if that condition is met: exit `0`;
`incentives-identity-staging` remains private with no route or `workers.dev`
hostname, its Core service binding resolves, and Wrangler prints a new version
ID. Do not run this command for the currently prepared source.

### 7. Deploy the Operator Worker

```sh
pnpm --filter @incentives/operator-web deploy:staging
```

Expected: exit `0`; `incentives-operator-web-staging` deploys to the configured
Operator custom domain, both private service bindings resolve, and Wrangler
prints the new version ID.

### 8. Run the exact fresh Gate C manual

Handoff to the canonical
[Gate C manual end-to-end test](gate-c-manual-test.md), beginning at
**Per-run test data**. Generate its `GATE_C_RUN_SUFFIX` exactly once, execute
the complete derived-value export block, and use that one set for the entire
staging run. Do not reuse the 2026-07-21 values, regenerate only part of the
set, or substitute example values.

Every client identity, client name, customer reference, credential label,
program reference, Promo code, external order reference, and idempotency key
must carry that suffix. Copy only evaluation and redemption IDs returned by
this run. Complete the guide's full case sequence and final verdict; the
correction-specific cases `SELECT-AUTO-01` through `SELECT-AUTO-03`,
`SELECT-CODE-01` through `SELECT-CODE-04`, `REDEEM-BUNDLE-01` through
`REDEEM-BUNDLE-03`, `TENANT-API-01`, and `OBS-API-01` are mandatory.

### 9. Record deployed versions and safe evidence

Read back only the API deployment time, traffic percentage, and version ID:

```sh
pnpm --filter @incentives/api exec wrangler deployments status \
  --name incentives-api-staging \
  --json \
| node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
  const deployment = JSON.parse(raw);
  console.log(JSON.stringify({
    worker: "incentives-api-staging",
    createdOn: deployment.created_on,
    versions: deployment.versions.map(({ version_id, percentage }) => ({
      versionId: version_id,
      percentage,
    })),
  }, null, 2));
});
'
```

Expected: the just-deployed API version carries 100% traffic. Do not record
the unfiltered Wrangler JSON because it contains account metadata.

Read back the same safe fields for Operator Web:

```sh
pnpm --filter @incentives/operator-web exec wrangler deployments status \
  --name incentives-operator-web-staging \
  --json \
| node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
  const deployment = JSON.parse(raw);
  console.log(JSON.stringify({
    worker: "incentives-operator-web-staging",
    createdOn: deployment.created_on,
    versions: deployment.versions.map(({ version_id, percentage }) => ({
      versionId: version_id,
      percentage,
    })),
  }, null, 2));
});
'
```

Expected: the just-deployed Operator Web version carries 100% traffic.

Run the equivalent Identity readback only if Step 6's binding-change condition
was met and Identity was actually deployed:

```sh
pnpm --filter @incentives/identity exec wrangler deployments status \
  --name incentives-identity-staging \
  --json \
| node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { raw += chunk; });
process.stdin.on("end", () => {
  const deployment = JSON.parse(raw);
  console.log(JSON.stringify({
    worker: "incentives-identity-staging",
    createdOn: deployment.created_on,
    versions: deployment.versions.map(({ version_id, percentage }) => ({
      versionId: version_id,
      percentage,
    })),
  }, null, 2));
});
'
```

For every manual case, record expected versus actual result, HTTP status,
evaluation/redemption ID where applicable, correlation ID, the deployed Worker
version IDs, and any new gap with severity and follow-up owner. Do not record
the backup contents, recipient addresses, credentials, raw submitted codes,
customer attributes, request bodies, cookies, invitation/magic-link URLs,
activation grants, or recovery-code text.

## Remaining manual continuation

1. Finish Task 10 verification and review for the locally implemented
   `GAP-026` correction, then merge it through a PR into `dev`.
2. Have the account owner apply the reviewed staging migration/deployments one command
   at a time.
3. Repeat the automatic, coded, stacking, atomic-bundle, idempotency, and
   concurrency cases with fresh identifiers.
4. Complete the remaining tenant-isolation and security closeout checks.
5. Reconcile the canonical manual procedure, current-state roadmap, follow-up
   register, active plans, and their Notion mirrors with the final result.

External scope remains local/staging until separately approved. No production
deployment is authorized, and Shopify/manual commerce integration remains
uncommitted.

## Evidence policy

Do not add recipient addresses, secrets, cookies, links containing tokens, activation grants, or recovery-code text.
