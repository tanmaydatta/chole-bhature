import type { Repositories } from './repositories/types.js';
import type { AtomicRedemptionCoordinator } from './redemption/atomic-redemption-coordinator.js';

export interface Env {
  DB: D1Database;
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
