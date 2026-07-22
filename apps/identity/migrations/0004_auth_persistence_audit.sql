-- Authentication credentials must never become durable without their canonical
-- persistence audit. SQLite executes each AFTER trigger in the same statement
-- transaction, so an identity_audit failure aborts the session/passkey insert.

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

CREATE TRIGGER identity_audit_passkey_created
AFTER INSERT ON passkey
BEGIN
  INSERT INTO identity_audit (
    id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
    target_id, outcome, correlation_id, metadata_json
  ) VALUES (
    lower(hex(randomblob(16))),
    COALESCE(NEW.createdAt, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
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
    'passkey.created',
    'passkey',
    NEW.id,
    'succeeded',
    lower(hex(randomblob(16))),
    NULL
  );
END;
