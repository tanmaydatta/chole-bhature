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
    (g.intent='provision' AND r.phase IN ('reserved','product-provisioned','auth-provisioned')) OR
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
 SELECT CASE WHEN EXISTS(SELECT 1 FROM e2e_run_claims WHERE run_id=NEW.run_id OR merchant_id=NEW.merchant_id OR provisioning_id=NEW.provisioning_id)
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
ALTER TABLE merchants ADD COLUMN e2e_control_run_id TEXT;
ALTER TABLE redemption_commit_guards ADD COLUMN merchant_id TEXT;
CREATE VIEW e2e_control_merchant_scopes AS
 SELECT id AS merchant_id,e2e_control_run_id AS run_id FROM merchants WHERE e2e_control_run_id IS NOT NULL
 UNION SELECT merchant_id,run_id FROM e2e_run_claims WHERE control_version=2
 UNION SELECT merchant_id,run_id FROM e2e_control_runs;
CREATE TRIGGER e2e_control_merchant_marker BEFORE UPDATE ON merchants
WHEN NEW.e2e_control_run_id IS NOT OLD.e2e_control_run_id OR
 (OLD.e2e_control_run_id IS NOT NULL AND (NEW.id<>OLD.id OR NEW.provisioning_id IS NOT OLD.provisioning_id))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_MARKER_IMMUTABLE'); END;
CREATE TRIGGER e2e_control_merchant_reservation BEFORE INSERT ON merchants
WHEN NEW.e2e_control_run_id IS NOT NULL OR (EXISTS(SELECT 1 FROM e2e_run_claims c WHERE c.merchant_id=NEW.id AND c.control_version=2)
 OR EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.merchant_id=NEW.id)
 OR EXISTS(SELECT 1 FROM merchants m WHERE m.id=NEW.id AND m.e2e_control_run_id IS NOT NULL))
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM e2e_control_runs r
 WHERE r.run_id=NEW.e2e_control_run_id AND r.merchant_id=NEW.id AND r.provisioning_id=NEW.provisioning_id)
 THEN RAISE(ABORT,'E2E_CONTROL_MARKER_REQUIRED') END; END;
CREATE TRIGGER e2e_control_merchants_insert BEFORE INSERT ON merchants
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_merchants_update BEFORE UPDATE ON merchants
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision','activate'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('provision','activate')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_merchants_delete BEFORE DELETE ON merchants
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_variable_definitions_insert BEFORE INSERT ON variable_definitions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_variable_definitions_update BEFORE UPDATE ON variable_definitions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_variable_definitions_delete BEFORE DELETE ON variable_definitions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_schema_versions_insert BEFORE INSERT ON schema_versions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_schema_versions_update BEFORE UPDATE ON schema_versions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_schema_versions_delete BEFORE DELETE ON schema_versions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_customers_insert BEFORE INSERT ON customers
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_customers_update BEFORE UPDATE ON customers
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_customers_delete BEFORE DELETE ON customers
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_programs_insert BEFORE INSERT ON programs
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_programs_update BEFORE UPDATE ON programs
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_programs_delete BEFORE DELETE ON programs
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_program_revisions_insert BEFORE INSERT ON program_revisions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_program_revisions_update BEFORE UPDATE ON program_revisions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_program_revisions_delete BEFORE DELETE ON program_revisions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_program_counters_insert BEFORE INSERT ON program_counters
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_program_counters_update BEFORE UPDATE ON program_counters
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_program_counters_delete BEFORE DELETE ON program_counters
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_api_credentials_insert BEFORE INSERT ON api_credentials
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_api_credentials_update BEFORE UPDATE ON api_credentials
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_api_credentials_delete BEFORE DELETE ON api_credentials
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_product_audit_insert BEFORE INSERT ON product_audit
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE (scope.merchant_id=NEW.merchant_id OR (NEW.target_type='merchant' AND scope.merchant_id=NEW.target_id))
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_product_audit_update BEFORE UPDATE ON product_audit
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE (scope.merchant_id=OLD.merchant_id OR (OLD.target_type='merchant' AND scope.merchant_id=OLD.target_id))
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE (scope.merchant_id=NEW.merchant_id OR (NEW.target_type='merchant' AND scope.merchant_id=NEW.target_id))
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_product_audit_delete BEFORE DELETE ON product_audit
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE (scope.merchant_id=OLD.merchant_id OR (OLD.target_type='merchant' AND scope.merchant_id=OLD.target_id))
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_evaluation_decisions_insert BEFORE INSERT ON evaluation_decisions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_evaluation_decisions_update BEFORE UPDATE ON evaluation_decisions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_evaluation_decisions_delete BEFORE DELETE ON evaluation_decisions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemptions_insert BEFORE INSERT ON redemptions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemptions_update BEFORE UPDATE ON redemptions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemptions_delete BEFORE DELETE ON redemptions
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_entries_insert BEFORE INSERT ON redemption_entries
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_entries_update BEFORE UPDATE ON redemption_entries
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_entries_delete BEFORE DELETE ON redemption_entries
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_operations_insert BEFORE INSERT ON redemption_operations
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_operations_update BEFORE UPDATE ON redemption_operations
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_operations_delete BEFORE DELETE ON redemption_operations
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_promo_code_claims_insert BEFORE INSERT ON promo_code_claims
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_promo_code_claims_update BEFORE UPDATE ON promo_code_claims
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_promo_code_claims_delete BEFORE DELETE ON promo_code_claims
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_commit_guards_insert BEFORE INSERT ON redemption_commit_guards
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_commit_guards_update BEFORE UPDATE ON redemption_commit_guards
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=NEW.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_commit_guards_delete BEFORE DELETE ON redemption_commit_guards
WHEN EXISTS(SELECT 1 FROM e2e_control_merchant_scopes scope WHERE scope.merchant_id=OLD.merchant_id
  AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g WHERE g.run_id=scope.run_id
   AND g.merchant_id=scope.merchant_id AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_rate_window_insert BEFORE INSERT ON credential_rate_limit_windows
WHEN EXISTS(SELECT 1 FROM api_credentials c JOIN e2e_control_merchant_scopes scope ON scope.merchant_id=c.merchant_id
 WHERE c.id=NEW.credential_id AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g
 WHERE g.run_id=scope.run_id AND g.merchant_id=scope.merchant_id
 AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_rate_window_update BEFORE UPDATE ON credential_rate_limit_windows
WHEN EXISTS(SELECT 1 FROM api_credentials c JOIN e2e_control_merchant_scopes scope ON scope.merchant_id=c.merchant_id
 WHERE c.id=OLD.credential_id AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g
 WHERE g.run_id=scope.run_id AND g.merchant_id=scope.merchant_id
 AND g.intent IN ('business','provision'))) OR EXISTS(SELECT 1 FROM api_credentials c JOIN e2e_control_merchant_scopes scope ON scope.merchant_id=c.merchant_id
 WHERE c.id=NEW.credential_id AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g
 WHERE g.run_id=scope.run_id AND g.merchant_id=scope.merchant_id
 AND g.intent IN ('business','provision')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_rate_window_delete BEFORE DELETE ON credential_rate_limit_windows
WHEN EXISTS(SELECT 1 FROM api_credentials c JOIN e2e_control_merchant_scopes scope ON scope.merchant_id=c.merchant_id
 WHERE c.id=OLD.credential_id AND NOT EXISTS(SELECT 1 FROM e2e_control_valid_write_guards g
 WHERE g.run_id=scope.run_id AND g.merchant_id=scope.merchant_id
 AND g.intent IN ('business','provision','dispose')))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_ROW_FENCED'); END;
CREATE TRIGGER e2e_control_redemption_guard_scope BEFORE INSERT ON redemption_commit_guards
WHEN (NEW.merchant_id IS NULL AND EXISTS(SELECT 1 FROM e2e_control_write_guards))
 OR (EXISTS(SELECT 1 FROM redemptions p JOIN e2e_control_merchant_scopes scope ON scope.merchant_id=p.merchant_id
     WHERE p.id=NEW.redemption_id AND (NEW.merchant_id IS NULL OR NEW.merchant_id<>p.merchant_id)))
BEGIN SELECT RAISE(ABORT,'E2E_CONTROL_GUARD_SCOPE'); END;
