import type { Repositories } from './repositories/types.js';
import type { AtomicRedemptionCoordinator } from './redemption/atomic-redemption-coordinator.js';

export interface Env {
  DB: D1Database;
  APP_ENV?: 'local' | 'staging' | 'ci';
  CI_STACK_KEY?: string;
  PUBLIC_APP_ORIGIN?: string;
  E2E_LOCAL_TEST_MODE?: string;
  DECISION_SIGNING_SECRET?: string;
  EVALUATION_TTL_SECONDS?: string;
}

export interface AppVariables {
  correlationId: string;
  merchantId: string;
  credentialId: string;
  repositories: Repositories;
  atomicRedemptions: AtomicRedemptionCoordinator;
}

export interface AppEnvironment {
  Bindings: Env;
  Variables: AppVariables;
}
