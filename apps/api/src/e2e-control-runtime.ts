import { E2eControlRuntimeSchema, type E2eControlRuntime } from '@incentives/contracts';
import type { Env } from './env.js';

/** Deployment configuration, never a request-derived grant. */
export function controlRuntime(env: Env): E2eControlRuntime {
  if (env.CI_STACK_KEY !== undefined || (env.APP_ENV !== 'staging'
    && !(env.APP_ENV === 'local' && env.E2E_LOCAL_TEST_MODE === '1'))) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  if (env.APP_ENV === 'local') {
    const origin = new URL(env.PUBLIC_APP_ORIGIN ?? '');
    if (origin.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(origin.hostname)
      || !origin.port || origin.origin !== env.PUBLIC_APP_ORIGIN) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  }
  if (!['0','1'].includes(env.E2E_CONTROL_ENABLED ?? '')) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  return E2eControlRuntimeSchema.parse({ environment: env.APP_ENV,
    generation: env.E2E_CONTROL_GENERATION, targetId: env.E2E_CONTROL_TARGET_ID,
    enabled: env.E2E_CONTROL_ENABLED === '1', accountQuota: env.E2E_CONTROL_ACCOUNT_QUOTA === undefined ? 3 : Number(env.E2E_CONTROL_ACCOUNT_QUOTA),
    cleanupGenerations: JSON.parse(env.E2E_CONTROL_CLEANUP_GENERATIONS ?? '[]') as unknown });
}

/** Invalid control configuration leaves legacy tenants usable and marked tenants fenced. */
export function businessControlRuntime(env: Env): E2eControlRuntime | undefined {
  try { const runtime = controlRuntime(env); return runtime.enabled ? runtime : undefined; }
  catch { return undefined; }
}
