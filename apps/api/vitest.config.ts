import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  const controlMigration = await readFile(path.join(__dirname, 'migrations/0009_e2e_control_leases.sql'), 'utf8');

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            E2E_CONTROL_MIGRATION_TEXT: controlMigration,
            DECISION_SIGNING_SECRET: 'decision-signing-test-secret',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
