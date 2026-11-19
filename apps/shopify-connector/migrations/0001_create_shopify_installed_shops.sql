-- Migration: create shopify_installed_shops table
CREATE TABLE IF NOT EXISTS shopify_installed_shops (
  shop_domain TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_signing_key TEXT NOT NULL,
  publishable_token TEXT,
  secret_token TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
