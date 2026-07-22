import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const testEnv = env as typeof env & {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

const encoder = new TextEncoder();
const publishableToken = 'pk_test_publishable_credential_material_00000001';
const secretToken = 'sk_test_secret_credential_material_000000000001';

async function digest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

await testEnv.DB.batch([
  testEnv.DB.prepare(`
    INSERT INTO api_credentials (
      id, merchant_id, name, environment, kind, scopes_json,
      allowed_origins_json, requests_per_minute, digest, suffix, status,
      expires_at, created_at, created_by
    ) VALUES (
      'test-publishable-credential', 'phase-0-merchant', 'Test publishable', 'local',
      'publishable', '["schema:read","evaluations:write"]', '["https://shop.example"]',
      10000, ?1, ?2, 'active', '2099-01-01T00:00:00.000Z',
      '2026-07-18T00:00:00.000Z', 'test-setup'
    )
  `).bind(await digest(publishableToken), publishableToken.slice(-8)),
  testEnv.DB.prepare(`
    INSERT INTO api_credentials (
      id, merchant_id, name, environment, kind, scopes_json,
      allowed_origins_json, requests_per_minute, digest, suffix, status,
      expires_at, created_at, created_by
    ) VALUES (
      'test-secret-credential', 'phase-0-merchant', 'Test secret', 'local',
      'secret', '["schema:read","customers:write","evaluations:write","redemptions:write"]',
      '[]', NULL, ?1, ?2, 'active', '2099-01-01T00:00:00.000Z',
      '2026-07-18T00:00:00.000Z', 'test-setup'
    )
  `).bind(await digest(secretToken), secretToken.slice(-8)),
]);
