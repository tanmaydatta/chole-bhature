ALTER TABLE program_counters
  ADD COLUMN committed_spend INTEGER NOT NULL DEFAULT 0
  CHECK (committed_spend >= 0);

UPDATE program_counters AS counter
SET committed_spend = MAX(
  COALESCE((
    SELECT MAX(
      json_extract(revision.config_json, '$.budget.minorUnits')
        - counter.budget_remaining,
      0
    )
    FROM programs AS logical
    INNER JOIN program_revisions AS revision
      ON revision.merchant_id = logical.merchant_id
      AND revision.program_id = logical.id
      AND revision.revision = COALESCE(logical.active_revision, logical.draft_revision)
    WHERE logical.merchant_id = counter.merchant_id
      AND logical.id = counter.program_id
      AND counter.budget_remaining IS NOT NULL
  ), 0),
  COALESCE((
    SELECT SUM(redemption.discount_minor_units)
    FROM redemptions AS redemption
    INNER JOIN programs AS logical
      ON logical.merchant_id = redemption.merchant_id
      AND logical.external_ref = json_extract(
        redemption.result_json,
        '$.result.programRef'
      )
    WHERE logical.merchant_id = counter.merchant_id
      AND logical.id = counter.program_id
  ), 0)
);

DROP TRIGGER programs_sync_counters_after_update;

CREATE TRIGGER programs_sync_counters_after_update
AFTER UPDATE OF max_uses, usage_count, budget_remaining ON programs
WHEN NEW.usage_count >= 0
  AND (NEW.max_uses IS NULL OR (NEW.max_uses > 0 AND NEW.usage_count <= NEW.max_uses))
  AND (NEW.budget_remaining IS NULL OR NEW.budget_remaining >= 0)
BEGIN
  SELECT RAISE(ABORT, 'replacement budget is below committed spend')
  WHERE NEW.budget_remaining IS NOT NULL
    AND json_extract(NEW.config_json, '$.budget.minorUnits') IS NOT NULL
    AND json_extract(NEW.config_json, '$.budget.minorUnits') < MAX(
      COALESCE((
        SELECT committed_spend FROM program_counters
        WHERE merchant_id = NEW.merchant_id AND program_id = NEW.id
      ), 0),
      COALESCE((
        SELECT SUM(redemption.discount_minor_units)
        FROM redemptions AS redemption
        WHERE redemption.merchant_id = NEW.merchant_id
          AND json_valid(redemption.result_json)
          AND json_extract(redemption.result_json, '$.result.programRef')
            = NEW.external_ref
      ), 0)
    );

  UPDATE program_counters
  SET committed_spend = MAX(
        committed_spend,
        CASE
          WHEN NEW.budget_remaining IS NOT NULL
            AND json_extract(NEW.config_json, '$.budget.minorUnits') IS NOT NULL
          THEN MAX(
            json_extract(NEW.config_json, '$.budget.minorUnits')
              - NEW.budget_remaining,
            0
          )
          ELSE committed_spend
        END,
        COALESCE((
          SELECT SUM(redemption.discount_minor_units)
          FROM redemptions AS redemption
          WHERE redemption.merchant_id = NEW.merchant_id
            AND json_valid(redemption.result_json)
            AND json_extract(redemption.result_json, '$.result.programRef')
              = NEW.external_ref
        ), 0)
      ),
      max_uses = NEW.max_uses,
      usage_count = NEW.usage_count
  WHERE merchant_id = NEW.merchant_id AND program_id = NEW.id;

  UPDATE program_counters
  SET budget_remaining = CASE
        WHEN NEW.budget_remaining IS NOT NULL
          AND json_extract(NEW.config_json, '$.budget.minorUnits') IS NOT NULL
        THEN MIN(
          NEW.budget_remaining,
          json_extract(NEW.config_json, '$.budget.minorUnits') - committed_spend
        )
        ELSE NEW.budget_remaining
      END
  WHERE merchant_id = NEW.merchant_id AND program_id = NEW.id;
END;
