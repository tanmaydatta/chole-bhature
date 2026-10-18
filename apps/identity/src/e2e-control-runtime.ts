import { E2eControlRuntimeSchema, type E2eControlRuntime } from '@incentives/contracts';
import type { IdentityWorkerEnv } from './staging-secrets.js';

export function controlRuntime(env: IdentityWorkerEnv): E2eControlRuntime {
  if (env.CI_STACK_KEY !== undefined || (env.APP_ENV !== 'staging'
    && !(env.APP_ENV === 'local' && env.E2E_LOCAL_TEST_MODE === '1'))) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  const origin = new URL(env.PUBLIC_APP_ORIGIN);
  if (origin.origin !== env.PUBLIC_APP_ORIGIN || (env.APP_ENV === 'local'
    ? origin.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || !origin.port
    : env.PUBLIC_APP_ORIGIN !== 'https://operator.staging.wastd.dev')) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  if (!['0','1'].includes(env.E2E_CONTROL_ENABLED ?? '')) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  return E2eControlRuntimeSchema.parse({ environment: env.APP_ENV,
    generation: env.E2E_CONTROL_GENERATION, targetId: env.E2E_CONTROL_TARGET_ID, enabled: env.E2E_CONTROL_ENABLED === '1',
    accountQuota: env.E2E_CONTROL_ACCOUNT_QUOTA === undefined ? 3 : Number(env.E2E_CONTROL_ACCOUNT_QUOTA),
    cleanupGenerations: JSON.parse(env.E2E_CONTROL_CLEANUP_GENERATIONS ?? '[]') as unknown });
}

export function businessControlRuntime(env: IdentityWorkerEnv): E2eControlRuntime | undefined {
  try { const runtime = controlRuntime(env); return runtime.enabled ? runtime : undefined; }
  catch { return undefined; }
}

export async function capabilityHash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
}

export async function matchesHash(value: string, expectedHash: string): Promise<boolean> {
  const supplied = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const expected = Uint8Array.from(expectedHash.match(/../gu) ?? [], byte => Number.parseInt(byte,16));
  const subtle = crypto.subtle;
  if (!supportsTimingSafeEqual(subtle)) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  return subtle.timingSafeEqual(supplied,expected);
}

// The configured Workers runtime implements this extension; DOM's SubtleCrypto
// declaration omits it. Detect the real API and fail closed without a fallback.
function supportsTimingSafeEqual(subtle: SubtleCrypto): subtle is SubtleCrypto & {
  timingSafeEqual(a:BufferSource,b:BufferSource):boolean;
} {
  return 'timingSafeEqual' in subtle && typeof subtle.timingSafeEqual === 'function';
}
