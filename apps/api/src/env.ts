import type { Repositories } from './repositories/types.js';

export interface Env {
  DB: D1Database;
  PUBLISHABLE_TOKEN: string;
  SECRET_TOKEN: string;
  DECISION_SIGNING_SECRET?: string;
  EVALUATION_TTL_SECONDS?: string;
}

export interface AppVariables {
  correlationId: string;
  merchantId: string;
  repositories: Repositories;
}

export interface AppEnvironment {
  Bindings: Env;
  Variables: AppVariables;
}
