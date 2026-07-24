export const TASK10_COUNT_SQL = `
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
`.trim();

export const LEGACY_PROMO_PRECHECK_SQL = `
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
    WHEN json_type(config_json, '$') <> 'object' THEN 1
    WHEN COALESCE(json_extract(config_json, '$.type'), '') <> 'promo' THEN 1
    WHEN COALESCE(json_type(config_json, '$.autoApply'), 'missing')
      NOT IN ('true', 'false') THEN 1
    WHEN COALESCE(json_type(config_json, '$.stackable'), 'missing')
      NOT IN ('true', 'false') THEN 1
    WHEN json_type(config_json, '$.code') = 'text'
      AND instr(CAST(json_extract(config_json, '$.code') AS BLOB), X'00') > 0
      THEN 1
    WHEN json_type(config_json, '$.autoApply') = 'true'
      AND COALESCE(json_type(config_json, '$.code'), 'text')
        NOT IN ('null', 'text') THEN 1
    WHEN json_type(config_json, '$.autoApply') = 'false'
      AND (
        COALESCE(json_type(config_json, '$.code'), 'missing') <> 'text'
        OR COALESCE(length(trim(json_extract(config_json, '$.code'))), 0) = 0
        OR length(trim(json_extract(config_json, '$.code'))) > 128
      ) THEN 1
    ELSE 0
  END = 1
),
unsafe_normalization AS (
  SELECT 1
  FROM promo_configs
  WHERE json_type(config_json, '$.autoApply') = 'false'
    AND json_extract(config_json, '$.code') GLOB '*[^ -~]*'
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
    AND json_type(left_revision.config_json, '$.autoApply') = 'false'
    AND json_type(right_revision.config_json, '$.autoApply') = 'false'
    AND (
      json_extract(left_revision.config_json, '$.endDate') IS NULL
      OR json_extract(left_revision.config_json, '$.endDate') >= date('now')
    )
    AND (
      json_extract(right_revision.config_json, '$.endDate') IS NULL
      OR json_extract(right_revision.config_json, '$.endDate') >= date('now')
    )
    AND upper(trim(json_extract(left_revision.config_json, '$.code')))
      = upper(trim(json_extract(right_revision.config_json, '$.code')))
    AND COALESCE(
      json_extract(left_revision.config_json, '$.endDate'),
      '9999-12-31'
    ) >= COALESCE(
      json_extract(right_revision.config_json, '$.startDate'),
      '0001-01-01'
    )
    AND COALESCE(
      json_extract(right_revision.config_json, '$.endDate'),
      '9999-12-31'
    ) >= COALESCE(
      json_extract(left_revision.config_json, '$.startDate'),
      '0001-01-01'
    )
)
SELECT
  (SELECT COUNT(*) FROM invalid_triggers) AS invalid_trigger_rows,
  (SELECT COUNT(*) FROM unsafe_normalization) AS unsafe_normalization_rows,
  (SELECT COUNT(*) FROM overlapping_claims) AS overlapping_claim_pairs;
`.trim();

export const LEGACY_REDEMPTION_PRECHECK_SQL = `
SELECT COUNT(*) AS invalid_legacy_redemption_rows
FROM redemptions AS redemption
INNER JOIN evaluation_decisions AS decision
  ON decision.merchant_id = redemption.merchant_id
  AND decision.id = redemption.evaluation_id
WHERE CASE
    WHEN json_valid(redemption.result_json) = 0 THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.version'),
      'missing'
    ) <> 'integer' THEN 1
    WHEN json_extract(redemption.result_json, '$.version') IS NOT 1 THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.result'),
      'missing'
    ) <> 'object' THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.result.redemptionId'),
      'missing'
    ) <> 'text' THEN 1
    WHEN json_extract(redemption.result_json, '$.result.redemptionId')
      IS NOT redemption.id THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.result.evaluationId'),
      'missing'
    ) <> 'text' THEN 1
    WHEN json_extract(redemption.result_json, '$.result.evaluationId')
      IS NOT redemption.evaluation_id THEN 1
    WHEN json_extract(redemption.result_json, '$.result.externalOrderRef')
      IS NOT redemption.external_order_ref THEN 1
    WHEN json_extract(redemption.result_json, '$.result.idempotencyKey')
      IS NOT redemption.idempotency_key THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.result.status'),
      'missing'
    ) <> 'text' THEN 1
    WHEN json_extract(redemption.result_json, '$.result.status')
      IS NOT 'committed' THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.receiptIntegrityHash'),
      'missing'
    ) <> 'text' THEN 1
    WHEN length(json_extract(redemption.result_json, '$.receiptIntegrityHash'))
      IS NOT 64 THEN 1
    WHEN json_extract(redemption.result_json, '$.receiptIntegrityHash')
      GLOB '*[^0-9a-f]*' THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.result.programRef'),
      'missing'
    ) <> 'text' THEN 1
    WHEN length(json_extract(redemption.result_json, '$.result.programRef')) = 0 THEN 1
    WHEN COALESCE(
      json_type(redemption.result_json, '$.result.effects'),
      'missing'
    ) <> 'array' THEN 1
    WHEN json_valid(decision.decisions_json) = 0 THEN 1
    WHEN COALESCE(json_type(decision.decisions_json), 'missing') <> 'array' THEN 1
    WHEN (
      SELECT COUNT(*)
      FROM json_each(decision.decisions_json) AS candidate
      WHERE json_extract(candidate.value, '$.programRef')
        = json_extract(redemption.result_json, '$.result.programRef')
        AND json_extract(candidate.value, '$.outcome') = 'qualified'
        AND json_extract(candidate.value, '$.commitRequired') = 1
        AND json_type(candidate.value, '$.programRevision') = 'integer'
        AND json_extract(candidate.value, '$.programRevision') > 0
        AND json_extract(candidate.value, '$.rewardRuleRef')
          IS json_extract(redemption.result_json, '$.result.rewardRuleRef')
        AND json(json_extract(candidate.value, '$.effects'))
          = json(json_extract(redemption.result_json, '$.result.effects'))
    ) <> 1 THEN 1
    ELSE 0
  END = 1;
`.trim();

export const TASK10_POST_MIGRATION_SQL = `
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
`.trim();

export const TASK10_CUTOVER_WRITE_MARKER_SQL = `
SELECT
  (SELECT COUNT(*) FROM evaluation_decisions) AS evaluation_rows,
  (SELECT MAX(created_at) FROM evaluation_decisions) AS latest_evaluation_created_at,
  (SELECT COUNT(*) FROM redemptions) AS redemption_rows,
  (SELECT MAX(created_at) FROM redemptions) AS latest_redemption_created_at;
`.trim();
