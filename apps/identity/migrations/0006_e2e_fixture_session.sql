-- Add an explicit, short-lived fixture authentication method. The authenticated
-- session row is still created by Better Auth; this schema merely permits its
-- method marker. This migration rebuilds the session table to replace the
-- SQLite CHECK constraint from 0002 without weakening existing methods.
DROP TRIGGER identity_audit_session_created;

CREATE TABLE session_next (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  authenticationMethod TEXT
    CHECK (authenticationMethod IN ('magic-link', 'passkey', 'recovery', 'e2e-fixture')),
  authenticatedAt INTEGER,
  recoveryOnly INTEGER CHECK (recoveryOnly IN (0, 1))
);
INSERT INTO session_next
  (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent,
   userId, authenticationMethod, authenticatedAt, recoveryOnly)
SELECT id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent,
  userId, authenticationMethod, authenticatedAt, recoveryOnly FROM session;
DROP TABLE session;
ALTER TABLE session_next RENAME TO session;
CREATE INDEX session_userId_idx ON session (userId);

CREATE TRIGGER identity_audit_session_created
AFTER INSERT ON session
BEGIN
  INSERT INTO identity_audit (
    id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
    target_id, outcome, correlation_id, metadata_json
  ) VALUES (
    lower(hex(randomblob(16))),
    NEW.createdAt,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM auth_profile
        WHERE user_id = NEW.userId AND subject_kind = 'root'
      ) THEN 'root'
      ELSE 'member'
    END,
    NEW.userId,
    (
      SELECT organizations.merchant_id
      FROM memberships
      JOIN organizations ON organizations.id = memberships.organization_id
      WHERE memberships.user_id = NEW.userId
        AND memberships.status = 'active'
        AND organizations.status = 'active'
      LIMIT 1
    ),
    'session.created',
    'session',
    NEW.id,
    'succeeded',
    lower(hex(randomblob(16))),
    NULL
  );
END;

-- Better Auth may slide its own session expiry forward. This independent,
-- immutable issuance record is the hard 15-minute cap and is removed when the
-- session or run-owned user is disposed.
CREATE TABLE e2e_fixture_sessions (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES e2e_run_claims(run_id),
  merchant_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  hard_expires_at INTEGER NOT NULL,
  CHECK (hard_expires_at = issued_at + 900000)
);
CREATE INDEX e2e_fixture_sessions_run_idx ON e2e_fixture_sessions(run_id);
