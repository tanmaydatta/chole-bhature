-- Short-lived budget leases reserved at evaluation time.
-- Available budget is computed as:
--   program_counters.budget_remaining + tolerance - SUM(active leases)
-- Expired leases are deleted lazily by the lease service before new reservations.
CREATE TABLE IF NOT EXISTS budget_leases (
  lease_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  program_ref TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  evaluation_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_leases_evaluation_program_unique
  ON budget_leases (merchant_id, evaluation_id, program_ref);

CREATE INDEX IF NOT EXISTS budget_leases_active_index
  ON budget_leases (merchant_id, program_ref, expires_at);
