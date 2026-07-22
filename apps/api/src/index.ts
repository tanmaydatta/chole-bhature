import { createApp } from './app.js';

const app = createApp();

export { createApp } from './app.js';
export {
  requirePublishable,
  requirePublishableScope,
  requireSecret,
  requireSecretScope,
} from './auth/api-credentials.js';
export { createDatabase } from './db/client.js';
export * from './errors.js';
export { createRepositories } from './repositories/d1-repositories.js';
export {
  BUILTIN_VARIABLE_DEFINITIONS,
  buildPublishedSample,
  createSchemaService,
} from './services/schema-service.js';
export type { AppEnvironment, AppVariables, Env } from './env.js';
export type * from './repositories/types.js';
export { CoreOperatorService } from './worker.js';

export default app;
