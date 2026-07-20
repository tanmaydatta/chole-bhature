ALTER TABLE root_recovery_code ADD COLUMN recovery_flow_id TEXT;

CREATE TABLE recovery_flow (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  grant_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  exchanged_at INTEGER,
  session_id TEXT,
  passkey_registered_at INTEGER,
  completed_at INTEGER,
  rotation_id TEXT
);
CREATE UNIQUE INDEX recovery_flow_active_root_unique
  ON recovery_flow (user_id)
  WHERE completed_at IS NULL;
CREATE UNIQUE INDEX recovery_flow_session_unique
  ON recovery_flow (session_id)
  WHERE session_id IS NOT NULL;

CREATE TABLE session_context (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  authentication_method TEXT NOT NULL
    CHECK (authentication_method IN ('magic-link', 'passkey', 'recovery')),
  authenticated_at INTEGER NOT NULL,
  recovery_only INTEGER NOT NULL DEFAULT 0 CHECK (recovery_only IN (0, 1)),
  CHECK ((authentication_method = 'recovery') = (recovery_only = 1))
);

CREATE TABLE recovery_rate_limit (
  key_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0)
);
