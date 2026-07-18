import { drizzle } from 'drizzle-orm/d1';

import type { Env } from '../env.js';
import * as schema from './schema.js';

export function createDatabase(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
