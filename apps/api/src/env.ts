import type { Repositories } from './repositories/types.js';
import type { AtomicRedemptionCoordinator } from './redemption/atomic-redemption-coordinator.js';

export interface Env {
  DB: D1Database;
  APP_ENV?: 'local' | 'staging' | 'ci';
  CI_STACK_KEY?: string;
  PUBLIC_APP_ORIGIN?: string;
  E2E_LOCAL_TEST_MODE?: string;
  E2E_CONTROL_ENABLED?: string;
  E2E_CONTROL_GENERATION?: string;
  E2E_CONTROL_TARGET_ID?: string;
  E2E_CONTROL_ACCOUNT_QUOTA?: string;
  E2E_CONTROL_CLEANUP_GENERATIONS?: string;
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
