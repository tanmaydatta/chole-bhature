import { Hono } from 'hono';

import type { Env } from './env.js';

const app = new Hono<{ Bindings: Env }>();

export { createDatabase } from './db/client.js';
export { createRepositories } from './repositories/d1-repositories.js';
export type { Env } from './env.js';
export type * from './repositories/types.js';

export default app;
