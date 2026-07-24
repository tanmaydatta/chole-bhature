CREATE TABLE promo_trigger_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

CREATE TRIGGER promo_trigger_migration_guard_abort
BEFORE INSERT ON promo_trigger_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'ambiguous legacy promo trigger configuration');
END;

INSERT INTO promo_trigger_migration_guard (valid)
SELECT 0
FROM programs
WHERE type = 'promo'
  AND CASE
    WHEN json_valid(config_json) = 0 THEN 1
    WHEN json_type(config_json, '$') <> 'object' THEN 1
    WHEN COALESCE(json_extract(config_json, '$.type'), '') <> 'promo' THEN 1
    WHEN COALESCE(
      json_type(config_json, '$.autoApply'),
      'missing'
    ) NOT IN ('true', 'false') THEN 1
    WHEN COALESCE(
      json_type(config_json, '$.stackable'),
      'missing'
    ) NOT IN ('true', 'false') THEN 1
    WHEN json_type(config_json, '$.autoApply') = 'true'
      AND COALESCE(json_type(config_json, '$.code'), 'text') NOT IN ('null', 'text')
      THEN 1
    WHEN json_type(config_json, '$.autoApply') = 'false'
      AND (
        COALESCE(json_type(config_json, '$.code'), 'missing') <> 'text'
        OR COALESCE(length(trim(json_extract(config_json, '$.code'))), 0) = 0
        OR length(trim(json_extract(config_json, '$.code'))) > 128
      )
      THEN 1
    ELSE 0
  END = 1
LIMIT 1;

INSERT INTO promo_trigger_migration_guard (valid)
SELECT 0
FROM program_revisions AS revision
INNER JOIN programs AS logical
  ON logical.merchant_id = revision.merchant_id
  AND logical.id = revision.program_id
WHERE logical.type = 'promo'
  AND CASE
    WHEN json_valid(revision.config_json) = 0 THEN 1
    WHEN json_type(revision.config_json, '$') <> 'object' THEN 1
    WHEN COALESCE(json_extract(revision.config_json, '$.type'), '') <> 'promo' THEN 1
    WHEN COALESCE(
      json_type(revision.config_json, '$.autoApply'),
      'missing'
    ) NOT IN ('true', 'false') THEN 1
    WHEN COALESCE(
      json_type(revision.config_json, '$.stackable'),
      'missing'
    ) NOT IN ('true', 'false') THEN 1
    WHEN json_type(revision.config_json, '$.autoApply') = 'true'
      AND COALESCE(
        json_type(revision.config_json, '$.code'),
        'text'
      ) NOT IN ('null', 'text')
      THEN 1
    WHEN json_type(revision.config_json, '$.autoApply') = 'false'
      AND (
        COALESCE(json_type(revision.config_json, '$.code'), 'missing') <> 'text'
        OR COALESCE(
          length(trim(json_extract(revision.config_json, '$.code'))),
          0
        ) = 0
        OR length(trim(json_extract(revision.config_json, '$.code'))) > 128
      )
      THEN 1
    ELSE 0
  END = 1
LIMIT 1;

CREATE TABLE promo_code_normalization_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

CREATE TRIGGER promo_code_normalization_migration_guard_abort
BEFORE INSERT ON promo_code_normalization_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(
    ABORT,
    'legacy promo code requires application-assisted normalization'
  );
END;

INSERT INTO promo_code_normalization_migration_guard (valid)
SELECT 0
FROM programs
WHERE type = 'promo'
  AND json_type(config_json, '$.autoApply') = 'false'
  AND json_extract(config_json, '$.code') GLOB '*[^ -~]*'
LIMIT 1;

INSERT INTO promo_code_normalization_migration_guard (valid)
SELECT 0
FROM program_revisions AS revision
INNER JOIN programs AS logical
  ON logical.merchant_id = revision.merchant_id
  AND logical.id = revision.program_id
WHERE logical.type = 'promo'
  AND json_type(revision.config_json, '$.autoApply') = 'false'
  AND json_extract(revision.config_json, '$.code') GLOB '*[^ -~]*'
LIMIT 1;

DROP TABLE promo_code_normalization_migration_guard;

CREATE TABLE promo_code_overlap_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

CREATE TRIGGER promo_code_overlap_migration_guard_abort
BEFORE INSERT ON promo_code_overlap_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(
    ABORT,
    'overlapping legacy promo code claims require reconciliation'
  );
END;

INSERT INTO promo_code_overlap_migration_guard (valid)
SELECT 0
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
LIMIT 1;

DROP TABLE promo_code_overlap_migration_guard;

UPDATE program_revisions
SET config_json = CASE json_type(config_json, '$.autoApply')
  WHEN 'true' THEN json_remove(
    json_set(
      json_remove(config_json, '$.stackingGroup'),
      '$.stackable',
      json('false')
    ),
    '$.code'
  )
  ELSE json_set(
    json_remove(config_json, '$.stackingGroup'),
    '$.code',
    trim(json_extract(config_json, '$.code'))
  )
END
WHERE EXISTS (
  SELECT 1
  FROM programs AS logical
  WHERE logical.merchant_id = program_revisions.merchant_id
    AND logical.id = program_revisions.program_id
    AND logical.type = 'promo'
);

UPDATE programs
SET config_json = CASE json_type(config_json, '$.autoApply')
  WHEN 'true' THEN json_remove(
    json_set(
      json_remove(config_json, '$.stackingGroup'),
      '$.stackable',
      json('false')
    ),
    '$.code'
  )
  ELSE json_set(
    json_remove(config_json, '$.stackingGroup'),
    '$.code',
    trim(json_extract(config_json, '$.code'))
  )
END
WHERE type = 'promo';

DROP TABLE promo_trigger_migration_guard;

ALTER TABLE evaluation_decisions
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'automatic'
  CHECK (mode IN ('automatic', 'coded'));
ALTER TABLE evaluation_decisions
  ADD COLUMN submitted_codes_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(submitted_codes_json) AND json_type(submitted_codes_json) = 'array');
ALTER TABLE evaluation_decisions
  ADD COLUMN code_results_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(code_results_json) AND json_type(code_results_json) = 'array');
ALTER TABLE evaluation_decisions
  ADD COLUMN request_digest TEXT NOT NULL DEFAULT 'legacy:unknown'
  CHECK (length(request_digest) > 0);
ALTER TABLE evaluation_decisions
  ADD COLUMN correlation_id TEXT NOT NULL DEFAULT 'migration:unknown'
  CHECK (length(correlation_id) > 0);

UPDATE evaluation_decisions
SET mode = 'automatic',
    submitted_codes_json = '[]',
    code_results_json = '[]',
    request_digest = 'legacy:' || id,
    correlation_id = 'migration:' || id;

CREATE INDEX evaluation_decisions_merchant_created_index
  ON evaluation_decisions (merchant_id, created_at, id);

CREATE TABLE promo_code_claims (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  program_ref TEXT NOT NULL,
  active_revision INTEGER NOT NULL,
  display_code TEXT NOT NULL,
  normalized_code TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (active_revision > 0),
  CHECK (length(display_code) > 0),
  CHECK (length(normalized_code) > 0),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  FOREIGN KEY (merchant_id, program_id)
    REFERENCES programs(merchant_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (merchant_id, program_id, active_revision)
    REFERENCES program_revisions(merchant_id, program_id, revision)
    ON DELETE CASCADE
);

CREATE INDEX promo_code_claims_lookup
  ON promo_code_claims (merchant_id, normalized_code, released_at);
CREATE INDEX promo_code_claims_program_index
  ON promo_code_claims (merchant_id, program_id, active_revision);

INSERT INTO promo_code_claims (
  id, merchant_id, program_id, program_ref, active_revision,
  display_code, normalized_code, starts_at, ends_at, released_at, created_at
)
SELECT
  'promo-code-claim:' || json_array(
    logical.merchant_id,
    logical.id,
    logical.active_revision
  ),
  logical.merchant_id,
  logical.id,
  logical.external_ref,
  logical.active_revision,
  trim(json_extract(active.config_json, '$.code')),
  upper(trim(json_extract(active.config_json, '$.code'))),
  json_extract(active.config_json, '$.startDate'),
  json_extract(active.config_json, '$.endDate'),
  CASE
    WHEN logical.status = 'ended' THEN COALESCE(
      json_extract(active.config_json, '$.endDate'),
      logical.updated_at
    )
    WHEN logical.status NOT IN ('active', 'scheduled', 'paused')
      THEN logical.updated_at
    WHEN json_extract(active.config_json, '$.endDate') < date('now')
      THEN json_extract(active.config_json, '$.endDate')
    ELSE NULL
  END,
  COALESCE(active.published_at, active.created_at)
FROM programs AS logical
INNER JOIN program_revisions AS active
  ON active.merchant_id = logical.merchant_id
  AND active.program_id = logical.id
  AND active.revision = logical.active_revision
WHERE logical.type = 'promo'
  AND json_type(active.config_json, '$.autoApply') = 'false';

ALTER TABLE redemptions
  ADD COLUMN request_digest TEXT NOT NULL DEFAULT 'legacy:unknown'
  CHECK (length(request_digest) > 0);

UPDATE redemptions
SET request_digest = 'legacy:' || id;

CREATE UNIQUE INDEX redemptions_merchant_id_unique
  ON redemptions (merchant_id, id);
CREATE INDEX redemptions_merchant_evaluation_index
  ON redemptions (merchant_id, evaluation_id, created_at, id);

CREATE TABLE legacy_redemption_migration_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

CREATE TRIGGER legacy_redemption_migration_guard_abort
BEFORE INSERT ON legacy_redemption_migration_guard
WHEN NEW.valid <> 1
BEGIN
  SELECT RAISE(ABORT, 'invalid legacy redemption requires reconciliation');
END;

INSERT INTO legacy_redemption_migration_guard (valid)
SELECT 0
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
  END = 1
LIMIT 1;

CREATE TABLE redemption_operations (
  merchant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  external_order_ref TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'committed', 'rejected')),
  terminal_error_code TEXT,
  retryable INTEGER,
  redemption_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, idempotency_key),
  CHECK (length(idempotency_key) > 0),
  CHECK (length(external_order_ref) > 0),
  CHECK (length(request_digest) > 0),
  CHECK (
    (
      state = 'pending'
      AND terminal_error_code IS NULL
      AND retryable IS NULL
      AND redemption_id IS NULL
    )
    OR (
      state = 'committed'
      AND terminal_error_code IS NULL
      AND retryable IS NULL
      AND redemption_id IS NOT NULL
    )
    OR (
      state = 'rejected'
      AND terminal_error_code IS NOT NULL
      AND retryable = 0
      AND redemption_id IS NULL
    )
  ),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  FOREIGN KEY (merchant_id, evaluation_id)
    REFERENCES evaluation_decisions(merchant_id, id),
  FOREIGN KEY (merchant_id, redemption_id)
    REFERENCES redemptions(merchant_id, id)
);

CREATE UNIQUE INDEX redemption_operations_merchant_external_order_unique
  ON redemption_operations (merchant_id, external_order_ref);
CREATE INDEX redemption_operations_merchant_evaluation_index
  ON redemption_operations (merchant_id, evaluation_id, state);

INSERT INTO redemption_operations (
  merchant_id, idempotency_key, external_order_ref, evaluation_id,
  request_digest, state, terminal_error_code, retryable, redemption_id,
  created_at, updated_at
)
SELECT
  merchant_id,
  idempotency_key,
  external_order_ref,
  evaluation_id,
  request_digest,
  'committed',
  NULL,
  NULL,
  id,
  created_at,
  created_at
FROM redemptions
WHERE idempotency_key IS NOT NULL
  AND external_order_ref IS NOT NULL;

CREATE TABLE redemption_entries (
  merchant_id TEXT NOT NULL,
  redemption_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  program_ref TEXT NOT NULL,
  program_revision INTEGER NOT NULL,
  reward_rule_ref TEXT,
  effects_json TEXT NOT NULL,
  discount_minor_units INTEGER NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (redemption_id, position),
  CHECK (position >= 0),
  CHECK (program_revision > 0),
  CHECK (length(program_ref) > 0),
  CHECK (json_valid(effects_json) AND json_type(effects_json) = 'array'),
  CHECK (discount_minor_units >= 0),
  CHECK (currency GLOB '[A-Z][A-Z][A-Z]' AND length(currency) = 3),
  FOREIGN KEY (merchant_id, redemption_id)
    REFERENCES redemptions(merchant_id, id)
    ON DELETE CASCADE
);

CREATE INDEX redemption_entries_merchant_redemption_order_index
  ON redemption_entries (merchant_id, redemption_id, position);
CREATE INDEX redemption_entries_merchant_program_counts_index
  ON redemption_entries (merchant_id, program_ref, redemption_id, position);

INSERT INTO redemption_entries (
  merchant_id, redemption_id, position, program_ref, program_revision,
  reward_rule_ref, effects_json, discount_minor_units, currency
)
SELECT
  redemption.merchant_id,
  redemption.id,
  0,
  json_extract(redemption.result_json, '$.result.programRef'),
  (
    SELECT json_extract(candidate.value, '$.programRevision')
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
    LIMIT 1
  ),
  json_extract(redemption.result_json, '$.result.rewardRuleRef'),
  json(json_extract(redemption.result_json, '$.result.effects')),
  redemption.discount_minor_units,
  redemption.currency
FROM redemptions AS redemption
INNER JOIN evaluation_decisions AS decision
  ON decision.merchant_id = redemption.merchant_id
  AND decision.id = redemption.evaluation_id;

DROP TABLE legacy_redemption_migration_guard;

CREATE TABLE redemption_commit_guards (
  redemption_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  changed_rows INTEGER NOT NULL CHECK (changed_rows = 1),
  PRIMARY KEY (redemption_id, position)
);
