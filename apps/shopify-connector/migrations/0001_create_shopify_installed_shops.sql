-- Migration: create shopify_installed_shops table
--
-- Access tokens, backend tokens, and per-tenant signing keys are stored
-- encrypted with TOKEN_ENCRYPTION_KEY (format: `enc:v1:<base64(iv|ciphertext)>`).
-- The `enc:` prefix lets legacy plaintext rows be read during migration.
CREATE TABLE IF NOT EXISTS shopify_installed_shops (
  shop_domain TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_signing_key TEXT NOT NULL,
  publishable_token TEXT,
  secret_token TEXT,
  status TEXT NOT NULL DEFAULT 'provisioning',
  automatic_discount_id TEXT,
  function_handle TEXT,
  schema_version INTEGER,
  webhook_registered_at TEXT,
  provisioning_error TEXT,
  installed_at TEXT,
  uninstalled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS shopify_installed_shops_tenant_index
  ON shopify_installed_shops (tenant_id);

CREATE INDEX IF NOT EXISTS shopify_installed_shops_status_index
  ON shopify_installed_shops (status);
