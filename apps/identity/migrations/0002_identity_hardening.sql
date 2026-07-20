ALTER TABLE root_recovery_code ADD COLUMN recovery_flow_id TEXT;

ALTER TABLE session ADD COLUMN authenticationMethod TEXT
  CHECK (authenticationMethod IN ('magic-link', 'passkey', 'recovery'));
ALTER TABLE session ADD COLUMN authenticatedAt INTEGER;
ALTER TABLE session ADD COLUMN recoveryOnly INTEGER
  CHECK (recoveryOnly IN (0, 1));

-- Migration 0002 has not shipped. Revoke any session created by 0001 so no
-- legacy/contextless row can survive the authorization-context expansion.
DELETE FROM session;

CREATE TABLE recovery_flow (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  grant_hash TEXT NOT NULL UNIQUE,
  initiating_code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  exchanged_at INTEGER,
  session_id TEXT,
  passkey_registered_at INTEGER,
  replacement_passkey_id TEXT,
  completed_at INTEGER,
  rotation_id TEXT,
  cancelled_at INTEGER,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX recovery_flow_active_root_unique
  ON recovery_flow (user_id)
  WHERE completed_at IS NULL AND cancelled_at IS NULL;
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
