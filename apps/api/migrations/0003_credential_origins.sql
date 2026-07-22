ALTER TABLE api_credentials
  ADD COLUMN allowed_origins_json TEXT NOT NULL DEFAULT '[]';
