ALTER TABLE recovery_flow ADD COLUMN purpose TEXT NOT NULL DEFAULT 'recovery'
  CHECK (purpose IN ('recovery', 'bootstrap'));

ALTER TABLE identity_audit ADD COLUMN merchant_id TEXT;

UPDATE identity_audit SET actor_kind = 'member' WHERE actor_kind = 'employee';

CREATE UNIQUE INDEX auth_profile_one_live_root
  ON auth_profile (subject_kind)
  WHERE subject_kind = 'root' AND status IN ('pending', 'active');

CREATE UNIQUE INDEX recovery_flow_one_open_bootstrap
  ON recovery_flow (user_id, purpose)
  WHERE purpose = 'bootstrap' AND completed_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE client_provisionings (
  provisioning_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL UNIQUE,
  organization_id TEXT UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'failed', 'active')),
  current_step TEXT NOT NULL,
  failed_step TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  correlation_id TEXT NOT NULL
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL UNIQUE,
  provisioning_id TEXT NOT NULL UNIQUE REFERENCES client_provisionings(provisioning_id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisioning', 'active')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (organization_id, user_id)
);
CREATE UNIQUE INDEX memberships_one_active_organization_per_user
  ON memberships (user_id)
  WHERE status = 'active';
CREATE INDEX memberships_organization_status_idx
  ON memberships (organization_id, status);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'sent', 'delivery_failed', 'accepted', 'revoked', 'expired')
  ),
  invited_by TEXT NOT NULL,
  accepted_by TEXT REFERENCES user(id),
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX invitations_one_pending_email_per_organization
  ON invitations (organization_id, email)
  WHERE status IN ('pending', 'sent', 'delivery_failed');
CREATE INDEX invitations_token_status_idx ON invitations (token_hash, status);
