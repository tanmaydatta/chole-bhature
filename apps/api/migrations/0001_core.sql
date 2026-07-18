PRAGMA foreign_keys = ON;

CREATE TABLE merchants (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE variable_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  required INTEGER NOT NULL,
  enum_values_json TEXT,
  description TEXT,
  default_error_message TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE UNIQUE INDEX variable_definitions_merchant_version_key_unique
  ON variable_definitions (merchant_id, schema_version, key);

CREATE TABLE schema_versions (
  merchant_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  published_at TEXT,
  definitions_json TEXT NOT NULL,
  PRIMARY KEY (merchant_id, version),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE UNIQUE INDEX customers_merchant_external_ref_unique
  ON customers (merchant_id, external_ref);

CREATE TABLE programs (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  priority INTEGER NOT NULL,
  max_uses INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  budget_remaining INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);
CREATE UNIQUE INDEX programs_merchant_external_ref_unique
  ON programs (merchant_id, external_ref);

CREATE TABLE evaluation_decisions (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  customer_ref TEXT,
  customer_version INTEGER,
  schema_version INTEGER NOT NULL,
  request_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  FOREIGN KEY (merchant_id, schema_version)
    REFERENCES schema_versions(merchant_id, version),
  FOREIGN KEY (merchant_id, customer_ref)
    REFERENCES customers(merchant_id, external_ref)
);
CREATE UNIQUE INDEX evaluation_decisions_merchant_id_id_unique
  ON evaluation_decisions (merchant_id, id);

CREATE TABLE redemptions (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  external_order_ref TEXT,
  idempotency_key TEXT,
  evaluation_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  discount_minor_units INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (external_order_ref IS NOT NULL OR idempotency_key IS NOT NULL),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id),
  FOREIGN KEY (merchant_id, evaluation_id)
    REFERENCES evaluation_decisions(merchant_id, id)
);
CREATE UNIQUE INDEX redemptions_merchant_external_order_ref_unique
  ON redemptions (merchant_id, external_order_ref)
  WHERE external_order_ref IS NOT NULL;
CREATE UNIQUE INDEX redemptions_merchant_idempotency_key_unique
  ON redemptions (merchant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
