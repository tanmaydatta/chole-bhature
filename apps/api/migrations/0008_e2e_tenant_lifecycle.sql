-- A tombstone remains after disposal so retries can verify the same run proof.
-- No foreign key to merchants: merchant data is deleted during disposal.
CREATE TABLE e2e_run_claims (
  run_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL UNIQUE,
  provisioning_id TEXT NOT NULL UNIQUE,
  proof_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disposed')),
  created_at TEXT NOT NULL,
  disposed_at TEXT
);

CREATE TABLE e2e_run_disposal_audit (
  run_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  disposed_at TEXT NOT NULL
);
