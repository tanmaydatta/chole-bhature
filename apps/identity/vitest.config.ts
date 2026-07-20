import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  const wranglerConfig = await readFile(path.join(__dirname, 'wrangler.toml'), 'utf8');
  const hardeningMigration = await readFile(
    path.join(__dirname, 'migrations/0002_identity_hardening.sql'),
    'utf8',
  );
  const schemaSource = await readFile(path.join(__dirname, 'src/db/schema.ts'), 'utf8');

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          serviceBindings: {
            CORE: { network: { deny: ['0.0.0.0/0', '::/0'] } },
          },
          bindings: {
            TEST_MIGRATIONS: migrations,
            AUTH_SECRET: 'identity-test-secret-at-least-thirty-two-characters',
            PUBLIC_APP_ORIGIN: 'https://operator.example.test',
            PASSKEY_RP_ID: 'operator.example.test',
            WRANGLER_CONFIG_TEXT: wranglerConfig,
            HARDENING_MIGRATION_TEXT: hardeningMigration,
            IDENTITY_SCHEMA_TEXT: schemaSource,
          },
        },
      }),
    ],
    test: {
      fileParallelism: false,
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
