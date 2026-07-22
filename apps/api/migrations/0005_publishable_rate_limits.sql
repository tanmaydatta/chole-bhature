ALTER TABLE api_credentials ADD COLUMN requests_per_minute INTEGER;

UPDATE api_credentials
SET requests_per_minute = 60
WHERE kind = 'publishable';

CREATE TRIGGER api_credentials_validate_rate_policy_insert
BEFORE INSERT ON api_credentials
BEGIN
  SELECT RAISE(ABORT, 'invalid credential rate-limit policy')
  WHERE NOT (
    (
      NEW.kind = 'publishable'
      AND NEW.requests_per_minute BETWEEN 1 AND 10000
    )
    OR (
      NEW.kind = 'secret'
      AND NEW.requests_per_minute IS NULL
    )
  );
END;

CREATE TRIGGER api_credentials_validate_rate_policy_update
BEFORE UPDATE OF kind, requests_per_minute ON api_credentials
BEGIN
  SELECT RAISE(ABORT, 'invalid credential rate-limit policy')
  WHERE NOT (
    (
      NEW.kind = 'publishable'
      AND NEW.requests_per_minute BETWEEN 1 AND 10000
    )
    OR (
      NEW.kind = 'secret'
      AND NEW.requests_per_minute IS NULL
    )
  );
END;

CREATE TABLE credential_rate_limit_windows (
  credential_id TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  CHECK (window_started_at >= 0),
  CHECK (window_started_at % 60000 = 0),
  CHECK (request_count > 0),
  FOREIGN KEY (credential_id) REFERENCES api_credentials(id) ON DELETE CASCADE
);

CREATE TRIGGER credential_rate_limit_windows_publishable_only_insert
BEFORE INSERT ON credential_rate_limit_windows
BEGIN
  SELECT RAISE(ABORT, 'rate-limit windows require a publishable credential')
  WHERE NOT EXISTS (
    SELECT 1 FROM api_credentials
    WHERE id = NEW.credential_id AND kind = 'publishable'
  );
END;

DROP TRIGGER programs_sync_revision_after_update;

CREATE TRIGGER programs_sync_revision_after_update
AFTER UPDATE OF config_json ON programs
WHEN NEW.active_revision IS NULL AND NEW.draft_revision IS NOT NULL
BEGIN
  UPDATE program_revisions
  SET config_json = NEW.config_json
  WHERE merchant_id = NEW.merchant_id
    AND program_id = NEW.id
    AND revision = NEW.draft_revision;
END;
