ALTER TABLE merchants ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE merchants ADD COLUMN provisioning_id TEXT;
ALTER TABLE merchants ADD COLUMN updated_at TEXT;

UPDATE merchants SET updated_at = created_at WHERE updated_at IS NULL;

CREATE UNIQUE INDEX merchants_provisioning_id_unique
  ON merchants (provisioning_id)
  WHERE provisioning_id IS NOT NULL;
ALTER TABLE variable_definitions ADD COLUMN deprecated_at TEXT;
ALTER TABLE variable_definitions ADD COLUMN deprecated_by TEXT;

CREATE TRIGGER variable_definitions_validate_deprecation_insert
BEFORE INSERT ON variable_definitions
BEGIN
  SELECT RAISE(ABORT, 'invalid variable definition deprecation state')
  WHERE NEW.state NOT IN ('draft', 'published', 'deprecated')
    OR NOT (
      (
        NEW.state = 'deprecated'
        AND NEW.deprecated_at IS NOT NULL
        AND NEW.deprecated_by IS NOT NULL
      )
      OR (
        NEW.state <> 'deprecated'
        AND NEW.deprecated_at IS NULL
        AND NEW.deprecated_by IS NULL
      )
    );
END;

CREATE TRIGGER variable_definitions_validate_deprecation_update
BEFORE UPDATE OF state, deprecated_at, deprecated_by ON variable_definitions
BEGIN
  SELECT RAISE(ABORT, 'invalid variable definition deprecation state')
  WHERE NEW.state NOT IN ('draft', 'published', 'deprecated')
    OR NOT (
      (
        NEW.state = 'deprecated'
        AND NEW.deprecated_at IS NOT NULL
        AND NEW.deprecated_by IS NOT NULL
      )
      OR (
        NEW.state <> 'deprecated'
        AND NEW.deprecated_at IS NULL
        AND NEW.deprecated_by IS NULL
      )
    );
END;

CREATE TABLE api_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  environment TEXT NOT NULL,
  kind TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  digest TEXT NOT NULL,
  suffix TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK (environment IN ('local', 'staging', 'production')),
  CHECK (kind IN ('publishable', 'secret')),
  CHECK (status IN ('active', 'revoked', 'expired')),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE UNIQUE INDEX api_credentials_digest_unique
  ON api_credentials (digest);
CREATE UNIQUE INDEX api_credentials_merchant_id_unique
  ON api_credentials (merchant_id, id);
CREATE INDEX api_credentials_merchant_created_at_index
  ON api_credentials (merchant_id, created_at, id);

ALTER TABLE programs ADD COLUMN active_revision INTEGER;
ALTER TABLE programs ADD COLUMN draft_revision INTEGER;

UPDATE programs SET active_revision = 1 WHERE status <> 'draft';
UPDATE programs SET draft_revision = 1 WHERE status = 'draft';

CREATE UNIQUE INDEX programs_merchant_id_unique
  ON programs (merchant_id, id);

CREATE TRIGGER programs_validate_revision_pointers_insert
BEFORE INSERT ON programs
BEGIN
  SELECT RAISE(ABORT, 'program revision pointers must be positive')
  WHERE (NEW.active_revision IS NOT NULL AND NEW.active_revision <= 0)
    OR (NEW.draft_revision IS NOT NULL AND NEW.draft_revision <= 0);
END;

CREATE TRIGGER programs_validate_revision_pointers_update
BEFORE UPDATE OF active_revision, draft_revision ON programs
BEGIN
  SELECT RAISE(ABORT, 'program revision pointers must be positive')
  WHERE (NEW.active_revision IS NOT NULL AND NEW.active_revision <= 0)
    OR (NEW.draft_revision IS NOT NULL AND NEW.draft_revision <= 0);
END;

CREATE TABLE program_revisions (
  program_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT,
  PRIMARY KEY (merchant_id, program_id, revision),
  CHECK (revision > 0),
  CHECK ((published_at IS NULL) = (published_by IS NULL)),
  FOREIGN KEY (merchant_id, program_id)
    REFERENCES programs(merchant_id, id)
    ON DELETE CASCADE
);
CREATE INDEX program_revisions_merchant_program_created_index
  ON program_revisions (merchant_id, program_id, created_at);

CREATE TABLE program_counters (
  program_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  max_uses INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  budget_remaining INTEGER,
  PRIMARY KEY (merchant_id, program_id),
  CHECK (max_uses IS NULL OR max_uses > 0),
  CHECK (usage_count >= 0),
  CHECK (max_uses IS NULL OR usage_count <= max_uses),
  CHECK (budget_remaining IS NULL OR budget_remaining >= 0),
  FOREIGN KEY (merchant_id, program_id)
    REFERENCES programs(merchant_id, id)
    ON DELETE CASCADE
);

INSERT INTO program_revisions (
  program_id, merchant_id, revision, config_json, created_at, created_by,
  published_at, published_by
)
SELECT
  id, merchant_id, 1, config_json, created_at, 'system:migration',
  created_at, 'system:migration'
FROM programs
WHERE status <> 'draft';

INSERT INTO program_revisions (
  program_id, merchant_id, revision, config_json, created_at, created_by,
  published_at, published_by
)
SELECT
  id, merchant_id, 1, config_json, created_at, 'system:migration', NULL, NULL
FROM programs
WHERE status = 'draft';

INSERT INTO program_counters (
  program_id, merchant_id, max_uses, usage_count, budget_remaining
)
SELECT id, merchant_id, max_uses, usage_count, budget_remaining
FROM programs;

CREATE TRIGGER programs_sync_revision_after_update
AFTER UPDATE OF config_json ON programs
BEGIN
  UPDATE program_revisions
  SET config_json = NEW.config_json
  WHERE merchant_id = NEW.merchant_id
    AND program_id = NEW.id
    AND revision = COALESCE(NEW.draft_revision, NEW.active_revision);
END;

CREATE TRIGGER programs_sync_counters_after_update
AFTER UPDATE OF max_uses, usage_count, budget_remaining ON programs
WHEN NEW.usage_count >= 0
  AND (NEW.max_uses IS NULL OR (NEW.max_uses > 0 AND NEW.usage_count <= NEW.max_uses))
  AND (NEW.budget_remaining IS NULL OR NEW.budget_remaining >= 0)
BEGIN
  UPDATE program_counters
  SET max_uses = NEW.max_uses,
      usage_count = NEW.usage_count,
      budget_remaining = NEW.budget_remaining
  WHERE merchant_id = NEW.merchant_id AND program_id = NEW.id;
END;

CREATE TABLE product_audit (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  merchant_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  metadata_json TEXT,
  CHECK (actor_kind IN ('root', 'member', 'credential', 'system')),
  CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE INDEX product_audit_merchant_occurred_index
  ON product_audit (merchant_id, occurred_at DESC, id);
CREATE INDEX product_audit_correlation_index
  ON product_audit (correlation_id);
