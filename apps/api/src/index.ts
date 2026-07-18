import { createApp } from './app.js';

const app = createApp();

export { createApp } from './app.js';
export { requirePublishable, requireSecret, SEEDED_MERCHANT_ID } from './auth/static-token.js';
export { createDatabase } from './db/client.js';
export * from './errors.js';
export { createRepositories } from './repositories/d1-repositories.js';
export type { AppEnvironment, AppVariables, Env } from './env.js';
export type * from './repositories/types.js';

export default app;
