-- Durable v2 ownership survives tenant deletion; no FK to disposable business rows.
CREATE TABLE e2e_control_runs (
 run_id TEXT PRIMARY KEY NOT NULL,
 merchant_id TEXT NOT NULL UNIQUE,
 provisioning_id TEXT NOT NULL UNIQUE,
 organization_id TEXT UNIQUE,
 generation TEXT NOT NULL CHECK(length(generation)=40 AND generation NOT GLOB '*[^a-f0-9]*'),
 target_id TEXT NOT NULL CHECK(length(target_id)=64 AND target_id NOT GLOB '*[^a-f0-9]*'),
 issued_at INTEGER NOT NULL CHECK(issued_at >= 0),
 expires_at INTEGER NOT NULL CHECK(expires_at = issued_at + 900000),
 phase TEXT NOT NULL CHECK(phase IN ('reserved','product-provisioned','auth-provisioned','active','fencing','disposing','disposed','quarantined')),
 proof_hash TEXT NOT NULL CHECK(length(proof_hash)=64 AND proof_hash NOT GLOB '*[^a-f0-9]*'),
 controller_hash TEXT NOT NULL CHECK(length(controller_hash)=64 AND controller_hash NOT GLOB '*[^a-f0-9]*'),
 request_id TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64 AND payload_hash NOT GLOB '*[^a-f0-9]*'),
 account_quota INTEGER NOT NULL CHECK(account_quota BETWEEN 1 AND 32)
);
CREATE INDEX e2e_control_live_admission ON e2e_control_runs(target_id,expires_at)
 WHERE phase <> 'disposed';
CREATE TABLE e2e_control_requests (
 run_id TEXT NOT NULL REFERENCES e2e_control_runs(run_id),
 request_id TEXT NOT NULL, action TEXT NOT NULL,
 payload_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('reserved','completed','rejected')),
 PRIMARY KEY(run_id,request_id,action)
);
CREATE TABLE e2e_control_cleanup (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES e2e_control_runs(run_id),
 proof_hash TEXT NOT NULL, current_generation TEXT NOT NULL, request_id TEXT NOT NULL,
 issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at = issued_at + 300000),
 UNIQUE(run_id,request_id)
);
-- These rows exist only within one atomic D1 batch. No ambient bypass.
CREATE TABLE e2e_control_write_guards (
 id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
 provisioning_id TEXT NOT NULL, organization_id TEXT, generation TEXT NOT NULL,
 target_id TEXT NOT NULL, proof_hash TEXT NOT NULL,
 intent TEXT NOT NULL CHECK(intent IN ('business','provision','activate','fence','dispose')),
 current_generation TEXT NOT NULL, cleanup_id TEXT, cleanup_issued_at INTEGER, cleanup_expires_at INTEGER,
 checked INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE e2e_run_claims ADD COLUMN control_version INTEGER NOT NULL DEFAULT 1 CHECK(control_version IN (1,2));
-- Validate canonical ownership once; scope views below detect markers even without this join.
CREATE VIEW e2e_control_valid_runs AS SELECT r.*,c.status AS claim_status
 FROM e2e_control_runs r JOIN e2e_run_claims c ON c.run_id=r.run_id
 WHERE c.control_version=2 AND c.merchant_id=r.merchant_id
 AND c.provisioning_id=r.provisioning_id AND c.proof_hash=r.proof_hash AND r.expires_at = r.issued_at + 900000 AND r.account_quota BETWEEN 1 AND 32
 AND length(r.generation) = 40 AND r.generation NOT GLOB '*[^a-f0-9]*'
 AND length(r.target_id) = 64 AND r.target_id NOT GLOB '*[^a-f0-9]*'
 AND length(r.proof_hash) = 64 AND r.proof_hash NOT GLOB '*[^a-f0-9]*'
 AND length(r.controller_hash) = 64 AND r.controller_hash NOT GLOB '*[^a-f0-9]*'
 AND length(r.payload_hash) = 64 AND r.payload_hash NOT GLOB '*[^a-f0-9]*';
CREATE VIEW e2e_control_valid_write_guards AS
 SELECT g.* FROM e2e_control_write_guards g JOIN e2e_control_valid_runs r ON r.run_id=g.run_id
 WHERE (r.merchant_id=g.merchant_id AND r.provisioning_id=g.provisioning_id
  AND r.organization_id IS g.organization_id AND r.generation=g.generation
  AND r.target_id=g.target_id AND r.proof_hash=g.proof_hash)
 AND (
  (g.cleanup_id IS NULL AND g.current_generation=r.generation AND r.claim_status='active'
   AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER) AND (
    (g.intent='business' AND r.phase='active') OR
    (g.intent='provision' AND r.phase IN ('reserved','product-provisioned','auth-provisioned','active')) OR
    (g.intent='activate' AND r.phase IN ('product-provisioned','auth-provisioned')) OR
    (g.intent='fence' AND r.phase<>'disposed')))
  OR (g.intent IN ('fence','dispose') AND g.cleanup_id IS NOT NULL
   AND (g.intent='fence' OR r.phase IN ('fencing','disposing','disposed','quarantined'))
   AND EXISTS(SELECT 1 FROM e2e_control_cleanup k WHERE k.id=g.cleanup_id
    AND k.run_id=r.run_id AND k.proof_hash=r.proof_hash AND k.current_generation=g.current_generation
    AND k.issued_at=g.cleanup_issued_at AND k.expires_at=g.cleanup_expires_at
    AND k.expires_at=k.issued_at+300000 AND k.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)))
 );
CREATE TRIGGER e2e_control_admission BEFORE INSERT ON e2e_control_runs
WHEN NOT EXISTS(SELECT 1 FROM e2e_control_runs WHERE run_id=NEW.run_id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM e2e_run_claims WHERE control_version=2 AND (run_id=NEW.run_id OR merchant_id=NEW.merchant_id OR provisioning_id=NEW.provisioning_id))
  OR NEW.phase <> 'reserved' OR NEW.expires_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.issued_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR (SELECT COUNT(*) FROM e2e_control_runs
      WHERE target_id=NEW.target_id AND phase <> 'disposed' AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)) >= 8
 THEN RAISE(ABORT,'E2E_CONTROL_ADMISSION') END;
END;
CREATE TRIGGER e2e_control_run_immutable BEFORE UPDATE ON e2e_control_runs
BEGIN
 SELECT CASE WHEN NEW.run_id <> OLD.run_id OR NEW.merchant_id <> OLD.merchant_id
  OR NEW.provisioning_id <> OLD.provisioning_id OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.generation <> OLD.generation OR NEW.target_id <> OLD.target_id
  OR NEW.issued_at <> OLD.issued_at OR NEW.expires_at <> OLD.expires_at
  OR NEW.proof_hash <> OLD.proof_hash OR NEW.controller_hash <> OLD.controller_hash
  OR NEW.request_id <> OLD.request_id OR NEW.payload_hash <> OLD.payload_hash
  OR NEW.account_quota <> OLD.account_quota
 THEN RAISE(ABORT,'E2E_CONTROL_IMMUTABLE') END;
 SELECT CASE WHEN NEW.phase <> OLD.phase AND NOT (
  (OLD.phase='reserved' AND NEW.phase='product-provisioned') OR
  (OLD.phase='product-provisioned' AND NEW.phase='auth-provisioned') OR
  (OLD.phase='auth-provisioned' AND NEW.phase='active') OR
  (OLD.phase IN ('reserved','product-provisioned','auth-provisioned','active','quarantined') AND NEW.phase='fencing') OR
  (OLD.phase IN ('fencing','quarantined') AND NEW.phase='disposing') OR
  (OLD.phase='disposing' AND NEW.phase='disposed') OR
  (OLD.phase NOT IN ('disposed','quarantined') AND NEW.phase='quarantined'))
 THEN RAISE(ABORT,'E2E_CONTROL_PHASE') END;
 SELECT CASE WHEN NEW.phase <> OLD.phase AND NEW.phase IN ('product-provisioned','auth-provisioned','active')
  AND OLD.expires_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER) THEN RAISE(ABORT,'E2E_CONTROL_EXPIRED') END;
END;
CREATE TRIGGER e2e_control_run_retained BEFORE DELETE ON e2e_control_runs
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_RETAINED'); END;
CREATE TRIGGER e2e_control_request_immutable BEFORE UPDATE ON e2e_control_requests
BEGIN
 SELECT CASE WHEN NEW.run_id<>OLD.run_id OR NEW.request_id<>OLD.request_id
  OR NEW.action<>OLD.action OR NEW.payload_hash<>OLD.payload_hash
  OR (OLD.status<>'reserved' AND NEW.status<>OLD.status)
 THEN RAISE(ABORT,'E2E_CONTROL_REQUEST_IMMUTABLE') END;
END;
CREATE TRIGGER e2e_control_request_retained BEFORE DELETE ON e2e_control_requests
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_RETAINED'); END;
CREATE TRIGGER e2e_control_cleanup_insert BEFORE INSERT ON e2e_control_cleanup
BEGIN
 SELECT CASE WHEN NEW.issued_at > CAST(unixepoch('subsec') * 1000 AS INTEGER) OR NEW.expires_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR length(NEW.current_generation)<>40 OR NEW.current_generation GLOB '*[^a-f0-9]*'
  OR NOT EXISTS(SELECT 1 FROM e2e_control_runs r JOIN e2e_run_claims c ON c.run_id=r.run_id
    WHERE r.run_id=NEW.run_id AND r.proof_hash=NEW.proof_hash AND r.expires_at = r.issued_at + 900000 AND r.account_quota BETWEEN 1 AND 32
 AND length(r.generation) = 40 AND r.generation NOT GLOB '*[^a-f0-9]*'
 AND length(r.target_id) = 64 AND r.target_id NOT GLOB '*[^a-f0-9]*'
 AND length(r.proof_hash) = 64 AND r.proof_hash NOT GLOB '*[^a-f0-9]*'
 AND length(r.controller_hash) = 64 AND r.controller_hash NOT GLOB '*[^a-f0-9]*'
 AND length(r.payload_hash) = 64 AND r.payload_hash NOT GLOB '*[^a-f0-9]*'
    AND c.control_version=2 AND c.merchant_id=r.merchant_id
    AND c.provisioning_id=r.provisioning_id AND c.proof_hash=r.proof_hash)
 THEN RAISE(ABORT,'E2E_CONTROL_CLEANUP') END;
END;
CREATE TRIGGER e2e_control_cleanup_immutable BEFORE UPDATE ON e2e_control_cleanup
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_IMMUTABLE'); END;
CREATE TRIGGER e2e_control_cleanup_retained BEFORE DELETE ON e2e_control_cleanup
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_RETAINED'); END;
-- AFTER INSERT sees the actual operation row; ABORT still rolls back the entire D1 batch.
CREATE TRIGGER e2e_control_guard_insert AFTER INSERT ON e2e_control_write_guards
BEGIN SELECT CASE WHEN NEW.checked<>0 OR NOT EXISTS(
 SELECT 1 FROM e2e_control_valid_write_guards WHERE id=NEW.id)
 THEN RAISE(ABORT,'E2E_CONTROL_FENCED') END; END;
CREATE TRIGGER e2e_control_guard_final BEFORE UPDATE ON e2e_control_write_guards
BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.run_id<>OLD.run_id OR NEW.merchant_id<>OLD.merchant_id
 OR NEW.provisioning_id<>OLD.provisioning_id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.generation<>OLD.generation OR NEW.target_id<>OLD.target_id OR NEW.proof_hash<>OLD.proof_hash
 OR NEW.intent<>OLD.intent OR NEW.current_generation<>OLD.current_generation OR NEW.cleanup_id IS NOT OLD.cleanup_id
 OR NEW.cleanup_issued_at IS NOT OLD.cleanup_issued_at OR NEW.cleanup_expires_at IS NOT OLD.cleanup_expires_at OR NEW.checked<>1
 THEN RAISE(ABORT,'E2E_CONTROL_IMMUTABLE') END;
 -- SQL clock is evaluated again after every business statement.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards WHERE id=OLD.id)
 THEN RAISE(ABORT,'E2E_CONTROL_FENCED') END;
END;
CREATE TRIGGER e2e_control_claim_immutable BEFORE UPDATE ON e2e_run_claims
WHEN OLD.control_version=2 OR NEW.control_version=2
BEGIN
 SELECT CASE WHEN NEW.control_version<>OLD.control_version OR NEW.run_id<>OLD.run_id
  OR NEW.merchant_id<>OLD.merchant_id OR NEW.provisioning_id<>OLD.provisioning_id
  OR NEW.proof_hash<>OLD.proof_hash OR NEW.created_at<>OLD.created_at
  OR NOT EXISTS(SELECT 1 FROM e2e_control_write_guards g WHERE g.run_id=OLD.run_id
    AND g.intent='dispose' AND EXISTS(SELECT 1 FROM e2e_control_valid_write_guards valid WHERE valid.id=g.id))
 THEN RAISE(ABORT,'E2E_CONTROL_CLAIM_IMMUTABLE') END;
END;
CREATE TRIGGER e2e_control_claim_retained BEFORE DELETE ON e2e_run_claims
WHEN OLD.control_version=2
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_RETAINED'); END;
CREATE TRIGGER e2e_control_claim_insert BEFORE INSERT ON e2e_run_claims
WHEN NEW.control_version=2 OR EXISTS(SELECT 1 FROM e2e_control_runs WHERE merchant_id=NEW.merchant_id OR run_id=NEW.run_id OR provisioning_id=NEW.provisioning_id)
BEGIN
 SELECT CASE WHEN NEW.control_version<>2 OR NOT EXISTS(SELECT 1 FROM e2e_control_runs r
  WHERE r.run_id=NEW.run_id AND r.merchant_id=NEW.merchant_id
    AND r.provisioning_id=NEW.provisioning_id AND r.proof_hash=NEW.proof_hash AND r.expires_at = r.issued_at + 900000 AND r.account_quota BETWEEN 1 AND 32
 AND length(r.generation) = 40 AND r.generation NOT GLOB '*[^a-f0-9]*'
 AND length(r.target_id) = 64 AND r.target_id NOT GLOB '*[^a-f0-9]*'
 AND length(r.proof_hash) = 64 AND r.proof_hash NOT GLOB '*[^a-f0-9]*'
 AND length(r.controller_hash) = 64 AND r.controller_hash NOT GLOB '*[^a-f0-9]*'
 AND length(r.payload_hash) = 64 AND r.payload_hash NOT GLOB '*[^a-f0-9]*')
 THEN RAISE(ABORT,'E2E_CONTROL_CLAIM') END;
END;
ALTER TABLE organizations ADD COLUMN e2e_control_run_id TEXT;
ALTER TABLE user ADD COLUMN e2e_control_run_id TEXT;
CREATE TABLE e2e_control_accounts (
 run_id TEXT NOT NULL REFERENCES e2e_control_runs(run_id),
 slug TEXT NOT NULL CHECK(length(slug) BETWEEN 1 AND 40 AND slug NOT GLOB '*[^a-z0-9_]*' AND substr(slug,1,1) GLOB '[a-z]'),
 user_id TEXT NOT NULL UNIQUE, membership_id TEXT NOT NULL UNIQUE,
 session_id TEXT UNIQUE, generation TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
 state TEXT NOT NULL CHECK(state IN ('reserved','issuing','issued','revoked')),
 PRIMARY KEY(run_id,slug)
);
CREATE VIEW e2e_control_organization_scopes AS
 SELECT id AS organization_id,merchant_id,e2e_control_run_id AS run_id FROM organizations WHERE e2e_control_run_id IS NOT NULL
 UNION SELECT organization_id,merchant_id,run_id FROM e2e_control_runs WHERE organization_id IS NOT NULL;
CREATE VIEW e2e_control_user_scopes AS
 SELECT u.id AS user_id,u.e2e_control_run_id AS run_id,c.merchant_id
 FROM user u LEFT JOIN e2e_run_claims c ON c.run_id=u.e2e_control_run_id AND c.control_version=2
 WHERE u.e2e_control_run_id IS NOT NULL
 UNION SELECT a.user_id,a.run_id,c.merchant_id FROM e2e_control_accounts a
 LEFT JOIN e2e_run_claims c ON c.run_id=a.run_id AND c.control_version=2;
CREATE VIEW e2e_control_merchant_scopes AS
 SELECT merchant_id,run_id FROM e2e_run_claims WHERE control_version=2
 UNION SELECT merchant_id,run_id FROM e2e_control_runs
 UNION SELECT merchant_id,e2e_control_run_id FROM organizations WHERE e2e_control_run_id IS NOT NULL;
-- Literal prefixes (not LIKE patterns) survive deleted parents and missing ledgers.
CREATE VIEW e2e_control_email_namespaces AS
 SELECT run_id,merchant_id,'e2e+'||run_id||'_' AS prefix FROM e2e_control_merchant_scopes
 UNION SELECT run_id,merchant_id,'e2e+'||run_id||'_' FROM e2e_control_user_scopes;
CREATE VIEW e2e_control_invitation_mail AS
 SELECT lower(i.email) AS recipient,i.organization_id,r.run_id,r.merchant_id
 FROM invitations i JOIN organizations o ON o.id=i.organization_id
 JOIN e2e_control_valid_runs r ON r.organization_id=o.id
 WHERE o.e2e_control_run_id=r.run_id AND o.merchant_id=r.merchant_id
 AND o.provisioning_id=r.provisioning_id AND o.status='active'
 AND r.claim_status='active' AND r.phase='active'
 AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)
 AND i.status='pending' AND i.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)
 AND substr(lower(i.email),1,length('e2e+'||r.run_id||'_'))='e2e+'||r.run_id||'_'
 AND substr(lower(i.email),-12)='@e2e.invalid'
 AND (SELECT COUNT(*) FROM e2e_control_email_namespaces n
   WHERE substr(lower(i.email),1,length(n.prefix))=n.prefix)=1
 AND (SELECT COUNT(*) FROM invitations pending WHERE lower(pending.email)=lower(i.email)
   AND pending.status IN ('pending','sent','delivery_failed')
   AND pending.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER))=1
 AND NOT EXISTS(SELECT 1 FROM e2e_control_accounts a
   WHERE lower(i.email)='e2e+'||a.run_id||'_'||a.slug||'@e2e.invalid')
 AND NOT EXISTS(SELECT 1 FROM user u JOIN e2e_control_user_scopes scope ON scope.user_id=u.id
   WHERE lower(u.email)=lower(i.email));
CREATE TRIGGER e2e_control_account_reserve BEFORE INSERT ON e2e_control_accounts
BEGIN SELECT CASE WHEN NEW.state<>'reserved' OR NEW.session_id IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM e2e_control_valid_runs r WHERE r.run_id=NEW.run_id AND r.generation=NEW.generation
 AND r.claim_status='active' AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)
 AND r.phase IN ('reserved','product-provisioned','auth-provisioned','active')
 AND (SELECT COUNT(*) FROM e2e_control_accounts a WHERE a.run_id=r.run_id)<r.account_quota)
 THEN RAISE(ABORT,'E2E_CONTROL_ACCOUNT_RESERVATION') END; END;
CREATE TRIGGER e2e_control_account_immutable BEFORE UPDATE ON e2e_control_accounts
BEGIN
 SELECT CASE WHEN NEW.run_id<>OLD.run_id OR NEW.slug<>OLD.slug OR NEW.user_id<>OLD.user_id
 OR NEW.membership_id<>OLD.membership_id OR NEW.generation<>OLD.generation OR NEW.role<>OLD.role
 OR (OLD.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id)
 OR (OLD.session_id IS NULL AND NEW.session_id IS NOT NULL AND NEW.state<>'issuing')
 OR (NEW.state<>OLD.state AND NOT ((OLD.state='reserved' AND NEW.state='issuing' AND NEW.session_id IS NOT NULL)
 OR (OLD.state='issuing' AND NEW.state='issued') OR (OLD.state<>'revoked' AND NEW.state='revoked')))
 THEN RAISE(ABORT,'E2E_CONTROL_ACCOUNT_IMMUTABLE') END;
 SELECT CASE WHEN NEW.state<>'revoked' AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g
 WHERE g.run_id=NEW.run_id AND g.generation=NEW.generation AND g.intent='provision')
 THEN RAISE(ABORT,'E2E_CONTROL_ACCOUNT_ISSUANCE') END;
END;
CREATE TRIGGER e2e_control_account_retained BEFORE DELETE ON e2e_control_accounts
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_RETAINED'); END;
CREATE TRIGGER e2e_control_organization_marker BEFORE UPDATE ON organizations
WHEN NEW.e2e_control_run_id IS NOT OLD.e2e_control_run_id OR
 (OLD.e2e_control_run_id IS NOT NULL AND (NEW.id<>OLD.id OR NEW.merchant_id<>OLD.merchant_id OR NEW.provisioning_id<>OLD.provisioning_id))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_MARKER_IMMUTABLE'); END;
CREATE TRIGGER e2e_control_organization_reservation BEFORE INSERT ON organizations
WHEN NEW.e2e_control_run_id IS NOT NULL OR (EXISTS(SELECT 1 FROM e2e_run_claims c WHERE c.merchant_id=NEW.merchant_id AND c.control_version=2)
 OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.merchant_id=NEW.merchant_id)
 )
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=NEW.e2e_control_run_id
 AND r.organization_id=NEW.id AND r.merchant_id=NEW.merchant_id AND r.provisioning_id=NEW.provisioning_id)
 THEN RAISE(ABORT,'E2E_CONTROL_MARKER_REQUIRED') END; END;
CREATE TRIGGER e2e_control_organizations_insert BEFORE INSERT ON organizations
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_organizations_update BEFORE UPDATE ON organizations
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=OLD.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision','activate') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active')))) OR EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision','activate') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_organizations_delete BEFORE DELETE ON organizations
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=OLD.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_client_provisionings_insert BEFORE INSERT ON client_provisionings
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_client_provisionings_update BEFORE UPDATE ON client_provisionings
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision','activate') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active')))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision','activate') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_client_provisionings_delete BEFORE DELETE ON client_provisionings
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose') AND (g.intent<>'provision' OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=g.run_id AND r.phase<>'active'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_memberships_insert BEFORE INSERT ON memberships
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=NEW.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_memberships_update BEFORE UPDATE ON memberships
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=OLD.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business'))) OR EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=NEW.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_memberships_delete BEFORE DELETE ON memberships
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=OLD.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_invitations_insert BEFORE INSERT ON invitations
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=NEW.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_invitations_update BEFORE UPDATE ON invitations
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=OLD.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business'))) OR EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=NEW.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_invitations_delete BEFORE DELETE ON invitations
WHEN EXISTS(SELECT 1 FROM e2e_control_organization_scopes scope WHERE scope.organization_id=OLD.organization_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_auth_profile_insert BEFORE INSERT ON auth_profile
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_auth_profile_update BEFORE UPDATE ON auth_profile
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business'))) OR EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_auth_profile_delete BEFORE DELETE ON auth_profile
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_user_insert BEFORE INSERT ON user
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_user_update BEFORE UPDATE ON user
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business'))) OR EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_user_delete BEFORE DELETE ON user
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_user_marker BEFORE UPDATE ON user
WHEN NEW.e2e_control_run_id IS NOT OLD.e2e_control_run_id
 OR (OLD.e2e_control_run_id IS NOT NULL AND (NEW.id<>OLD.id OR NEW.email<>OLD.email OR NEW.emailVerified<>OLD.emailVerified))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_MARKER_IMMUTABLE'); END;
CREATE TRIGGER e2e_control_user_reservation BEFORE INSERT ON user
WHEN NEW.e2e_control_run_id IS NOT NULL OR EXISTS(SELECT 1 FROM e2e_control_accounts a WHERE a.user_id=NEW.id)
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_accounts a
 WHERE a.user_id=NEW.id AND a.run_id=NEW.e2e_control_run_id AND a.state='reserved'
 AND NEW.email='e2e+'||a.run_id||'_'||a.slug||'@e2e.invalid' AND NEW.emailVerified=0)
 THEN RAISE(ABORT,'E2E_CONTROL_MARKER_REQUIRED') END; END;
CREATE TRIGGER e2e_control_membership_tuple BEFORE INSERT ON memberships
WHEN EXISTS(SELECT 1 FROM e2e_control_accounts WHERE user_id=NEW.user_id)
 OR EXISTS(SELECT 1 FROM organizations WHERE id=NEW.organization_id AND e2e_control_run_id IS NOT NULL)
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_accounts a
 JOIN e2e_control_runs r ON r.run_id=a.run_id JOIN user u ON u.id=a.user_id
 WHERE a.user_id=NEW.user_id AND a.membership_id=NEW.id AND r.organization_id=NEW.organization_id
 AND u.e2e_control_run_id=r.run_id AND a.generation=r.generation AND NEW.role=a.role)
 THEN RAISE(ABORT,'E2E_CONTROL_MEMBERSHIP_TUPLE') END; END;
CREATE TRIGGER e2e_control_membership_identity BEFORE UPDATE ON memberships
WHEN (EXISTS(SELECT 1 FROM e2e_control_accounts WHERE user_id=OLD.user_id) OR
 EXISTS(SELECT 1 FROM organizations WHERE id=OLD.organization_id AND e2e_control_run_id IS NOT NULL))
 AND (NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.organization_id<>OLD.organization_id)
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_MARKER_IMMUTABLE'); END;
CREATE TRIGGER e2e_control_profile_invariant BEFORE INSERT ON auth_profile
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes WHERE user_id=NEW.user_id)
 AND (NEW.subject_kind<>'employee' OR NEW.status<>'active' OR NEW.email_login_enabled<>0)
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_PROFILE'); END;
CREATE TRIGGER e2e_control_profile_update BEFORE UPDATE ON auth_profile
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes WHERE user_id=OLD.user_id)
 AND (NEW.user_id<>OLD.user_id OR NEW.subject_kind<>'employee' OR NEW.email_login_enabled<>0)
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_PROFILE'); END;
CREATE TRIGGER e2e_control_session_insert BEFORE INSERT ON session
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes WHERE user_id=NEW.userId)
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_accounts a
 JOIN e2e_control_valid_runs r ON r.run_id=a.run_id JOIN user u ON u.id=a.user_id
 JOIN memberships m ON m.id=a.membership_id JOIN organizations o ON o.id=m.organization_id
 JOIN auth_profile p ON p.user_id=u.id
 WHERE (a.user_id=NEW.userId AND a.session_id=NEW.id AND a.state IN ('issuing') AND a.generation=r.generation)
 AND (u.e2e_control_run_id=r.run_id AND o.id=r.organization_id AND o.e2e_control_run_id=r.run_id
   AND o.status='active' AND m.user_id=u.id AND m.status='active' AND m.role=a.role)
 AND (r.claim_status='active' AND r.phase IN ('auth-provisioned','active') AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER))
 AND (p.subject_kind='employee' AND p.status='active' AND p.email_login_enabled=0)
 AND (NEW.authenticationMethod='e2e-fixture' AND NEW.recoveryOnly=0
  AND NEW.expiresAt<=r.expires_at AND NEW.expiresAt<=NEW.createdAt+900000 AND NEW.expiresAt>CAST(unixepoch('subsec') * 1000 AS INTEGER)))
 THEN RAISE(ABORT,'E2E_CONTROL_SESSION') END; END;
CREATE TRIGGER e2e_control_session_update BEFORE UPDATE ON session
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes WHERE user_id=OLD.userId OR user_id=NEW.userId)
BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.userId<>OLD.userId OR NEW.token<>OLD.token OR NEW.expiresAt<>OLD.expiresAt
 OR NEW.createdAt<>OLD.createdAt OR NEW.authenticationMethod IS NOT OLD.authenticationMethod
 OR NEW.authenticatedAt IS NOT OLD.authenticatedAt OR NEW.recoveryOnly IS NOT OLD.recoveryOnly
 THEN RAISE(ABORT,'E2E_CONTROL_SESSION_IMMUTABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_accounts a
 JOIN e2e_control_valid_runs r ON r.run_id=a.run_id JOIN user u ON u.id=a.user_id
 JOIN memberships m ON m.id=a.membership_id JOIN organizations o ON o.id=m.organization_id
 JOIN auth_profile p ON p.user_id=u.id
 WHERE (a.user_id=NEW.userId AND a.session_id=NEW.id AND a.state IN ('issuing','issued') AND a.generation=r.generation)
 AND (u.e2e_control_run_id=r.run_id AND o.id=r.organization_id AND o.e2e_control_run_id=r.run_id
   AND o.status='active' AND m.user_id=u.id AND m.status='active' AND m.role=a.role)
 AND (r.claim_status='active' AND r.phase IN ('auth-provisioned','active') AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER))
 AND (p.subject_kind='employee' AND p.status='active' AND p.email_login_enabled=0)
 AND (NEW.authenticationMethod='e2e-fixture' AND NEW.recoveryOnly=0
  AND NEW.expiresAt<=r.expires_at AND NEW.expiresAt<=NEW.createdAt+900000 AND NEW.expiresAt>CAST(unixepoch('subsec') * 1000 AS INTEGER)))
 THEN RAISE(ABORT,'E2E_CONTROL_SESSION') END;
END;
CREATE TRIGGER e2e_control_audit_insert BEFORE INSERT ON identity_audit
WHEN NEW.action<>'session.created' AND (EXISTS(SELECT 1 FROM (SELECT scope.run_id,scope.merchant_id FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope
 WHERE scope.user_id=NEW.actor_id OR (NEW.target_type='user' AND scope.user_id=NEW.target_id)
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope JOIN e2e_control_accounts a ON a.user_id=scope.user_id
 WHERE NEW.target_type='session' AND a.session_id=NEW.target_id) scope
 WHERE NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
 AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','activate'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_audit_update BEFORE UPDATE ON identity_audit
WHEN (EXISTS(SELECT 1 FROM (SELECT scope.run_id,scope.merchant_id FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope
 WHERE scope.user_id=OLD.actor_id OR (OLD.target_type='user' AND scope.user_id=OLD.target_id)
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope JOIN e2e_control_accounts a ON a.user_id=scope.user_id
 WHERE OLD.target_type='session' AND a.session_id=OLD.target_id) scope
 WHERE NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
 AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','activate'))) OR EXISTS(SELECT 1 FROM (SELECT scope.run_id,scope.merchant_id FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope
 WHERE scope.user_id=NEW.actor_id OR (NEW.target_type='user' AND scope.user_id=NEW.target_id)
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope JOIN e2e_control_accounts a ON a.user_id=scope.user_id
 WHERE NEW.target_type='session' AND a.session_id=NEW.target_id) scope
 WHERE NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
 AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','activate'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_audit_delete BEFORE DELETE ON identity_audit
WHEN (EXISTS(SELECT 1 FROM (SELECT scope.run_id,scope.merchant_id FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope
 WHERE scope.user_id=OLD.actor_id OR (OLD.target_type='user' AND scope.user_id=OLD.target_id)
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope JOIN e2e_control_accounts a ON a.user_id=scope.user_id
 WHERE OLD.target_type='session' AND a.session_id=OLD.target_id) scope
 WHERE NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
 AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','activate','dispose'))))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_session_audit BEFORE INSERT ON identity_audit
WHEN NEW.action='session.created' AND EXISTS(SELECT 1 FROM (SELECT scope.run_id,scope.merchant_id FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope
 WHERE scope.user_id=NEW.actor_id OR (NEW.target_type='user' AND scope.user_id=NEW.target_id)
 UNION SELECT scope.run_id,scope.merchant_id FROM e2e_control_user_scopes scope JOIN e2e_control_accounts a ON a.user_id=scope.user_id
 WHERE NEW.target_type='session' AND a.session_id=NEW.target_id))
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM session s JOIN e2e_control_accounts a ON a.session_id=s.id AND a.user_id=s.userId
 JOIN e2e_control_valid_runs r ON r.run_id=a.run_id JOIN user u ON u.id=s.userId
 WHERE (NEW.target_type='session' AND NEW.target_id=s.id AND NEW.actor_id=s.userId
  AND NEW.merchant_id=r.merchant_id AND NEW.occurred_at=s.createdAt AND NEW.outcome='succeeded')
 AND (a.state='issuing' AND a.generation=r.generation AND u.e2e_control_run_id=r.run_id)
 AND (r.claim_status='active' AND r.phase IN ('auth-provisioned','active') AND r.expires_at>CAST(unixepoch('subsec') * 1000 AS INTEGER)
  AND s.authenticationMethod='e2e-fixture' AND s.expiresAt<=r.expires_at AND s.expiresAt>CAST(unixepoch('subsec') * 1000 AS INTEGER))
 AND NOT EXISTS(SELECT 1 FROM identity_audit prior WHERE prior.action='session.created' AND prior.target_type='session' AND prior.target_id=NEW.target_id))
 THEN RAISE(ABORT,'E2E_CONTROL_SESSION_AUDIT') END; END;
CREATE TRIGGER e2e_control_account_insert BEFORE INSERT ON account
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_account_update BEFORE UPDATE ON account
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never'))) OR EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_account_delete BEFORE DELETE ON account
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_passkey_insert BEFORE INSERT ON passkey
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_passkey_update BEFORE UPDATE ON passkey
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never'))) OR EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_passkey_delete BEFORE DELETE ON passkey
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.userId
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_e2e_fixture_sessions_insert BEFORE INSERT ON e2e_fixture_sessions
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision') AND EXISTS(SELECT 1 FROM session s WHERE s.id=NEW.session_id)))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_e2e_fixture_sessions_update BEFORE UPDATE ON e2e_fixture_sessions
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never') AND EXISTS(SELECT 1 FROM session s WHERE s.id=OLD.session_id))) OR EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=NEW.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('never') AND EXISTS(SELECT 1 FROM session s WHERE s.id=NEW.session_id)))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_e2e_fixture_sessions_delete BEFORE DELETE ON e2e_fixture_sessions
WHEN EXISTS(SELECT 1 FROM session WHERE id=OLD.session_id) AND EXISTS(SELECT 1 FROM e2e_control_user_scopes scope WHERE scope.user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose') AND EXISTS(SELECT 1 FROM session s WHERE s.id=OLD.session_id)))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_email_insert BEFORE INSERT ON local_email_capture
WHEN EXISTS(SELECT 1 FROM e2e_control_email_namespaces scope
 WHERE substr(lower(NEW.recipient),1,length(scope.prefix))=scope.prefix
 AND substr(lower(NEW.recipient),-12)='@e2e.invalid'
 AND NOT EXISTS(SELECT 1 FROM e2e_control_invitation_mail mail
 JOIN e2e_control_valid_write_guards g ON g.run_id=mail.run_id AND g.merchant_id=mail.merchant_id
 WHERE mail.recipient=lower(NEW.recipient) AND mail.run_id=scope.run_id
 AND mail.merchant_id=scope.merchant_id AND g.intent='business'))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_email_update BEFORE UPDATE ON local_email_capture
WHEN EXISTS(SELECT 1 FROM e2e_control_email_namespaces scope
 WHERE (substr(lower(OLD.recipient),1,length(scope.prefix))=scope.prefix AND substr(lower(OLD.recipient),-12)='@e2e.invalid')
 OR (substr(lower(NEW.recipient),1,length(scope.prefix))=scope.prefix AND substr(lower(NEW.recipient),-12)='@e2e.invalid'))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_email_delete BEFORE DELETE ON local_email_capture
WHEN EXISTS(SELECT 1 FROM e2e_control_email_namespaces scope
 WHERE substr(lower(OLD.recipient),1,length(scope.prefix))=scope.prefix
 AND substr(lower(OLD.recipient),-12)='@e2e.invalid'
 AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
 AND g.merchant_id=scope.merchant_id AND g.intent='dispose'))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_fixture_session_tuple BEFORE INSERT ON e2e_fixture_sessions
WHEN EXISTS(SELECT 1 FROM e2e_control_user_scopes WHERE user_id=NEW.user_id)
 OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes WHERE merchant_id=NEW.merchant_id)
BEGIN SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM e2e_control_accounts a JOIN e2e_control_valid_runs r ON r.run_id=a.run_id
 JOIN session s ON s.id=a.session_id AND s.userId=a.user_id
 WHERE (a.user_id=NEW.user_id AND a.session_id=NEW.session_id AND a.run_id=NEW.run_id
  AND a.generation=r.generation AND a.state IN ('issuing','issued'))
 AND (r.merchant_id=NEW.merchant_id AND s.createdAt=NEW.issued_at
  AND NEW.hard_expires_at=s.createdAt+900000 AND s.expiresAt<=r.expires_at
  AND s.authenticationMethod='e2e-fixture'))
 THEN RAISE(ABORT,'E2E_CONTROL_FIXTURE_SESSION_TUPLE') END; END;
