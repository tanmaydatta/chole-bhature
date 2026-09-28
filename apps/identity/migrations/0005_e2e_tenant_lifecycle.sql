-- These claims are created only during staging root provisioning and survive
-- disposal to authenticate retries. They carry no customer or invitation data.
CREATE TABLE e2e_run_claims (
  run_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL UNIQUE,
  provisioning_id TEXT NOT NULL UNIQUE,
  proof_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disposing', 'disposed')),
  created_at INTEGER NOT NULL,
  disposed_at INTEGER
);

CREATE TABLE e2e_run_disposal_audit (
  run_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  disposed_at INTEGER NOT NULL
);
