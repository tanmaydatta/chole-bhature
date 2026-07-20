import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const testEnv = env as typeof env & {
  AUTH_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(testEnv.AUTH_DB, testEnv.TEST_MIGRATIONS);
