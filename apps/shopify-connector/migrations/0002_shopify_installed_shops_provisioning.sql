-- Migration: add provisioning provenance and Shopify node tracking.
ALTER TABLE shopify_installed_shops ADD COLUMN provisioning_id TEXT;
ALTER TABLE shopify_installed_shops ADD COLUMN automatic_discount_id TEXT;
ALTER TABLE shopify_installed_shops ADD COLUMN function_handle TEXT;
ALTER TABLE shopify_installed_shops ADD COLUMN schema_version INTEGER;
ALTER TABLE shopify_installed_shops ADD COLUMN webhook_registered_at TEXT;
ALTER TABLE shopify_installed_shops ADD COLUMN provisioning_error TEXT;
ALTER TABLE shopify_installed_shops ADD COLUMN installed_at TEXT;
ALTER TABLE shopify_installed_shops ADD COLUMN uninstalled_at TEXT;

CREATE INDEX IF NOT EXISTS shopify_installed_shops_tenant_index
  ON shopify_installed_shops (tenant_id);

CREATE INDEX IF NOT EXISTS shopify_installed_shops_status_index
  ON shopify_installed_shops (status);
