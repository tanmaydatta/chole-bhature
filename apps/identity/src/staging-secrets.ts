import type { Env } from './worker.js';
import { assertCiStack } from './ci-stack.js';

export type IdentityWorkerEnv = Omit<Env, 'AUTH_SECRET' | 'RESEND_API_KEY' | 'RESEND_FROM'> & {
  AUTH_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  AUTH_SECRET_STORE?: SecretsStoreSecret;
  RESEND_API_KEY_STORE?: SecretsStoreSecret;
  RESEND_FROM_STORE?: SecretsStoreSecret;
  E2E_SETUP_SECRET_STORE?: SecretsStoreSecret;
};

/** Dedicated setup authority is resolved only by the private control service. */
export async function resolveSetupSecret(env: IdentityWorkerEnv): Promise<string> {
  if (env.APP_ENV === 'staging') {
    if (env.E2E_SETUP_SECRET !== undefined) throw new Error('E2E_CONTROL_INCOMPATIBLE');
    return requiredSecret(env.E2E_SETUP_SECRET_STORE,'E2E_SETUP_SECRET');
  }
  if (env.APP_ENV !== 'local' || env.E2E_LOCAL_TEST_MODE !== '1' || env.E2E_SETUP_SECRET_STORE !== undefined
    || typeof env.E2E_SETUP_SECRET !== 'string' || !env.E2E_SETUP_SECRET.trim()) throw new Error('E2E_CONTROL_UNAVAILABLE');
  return env.E2E_SETUP_SECRET;
}

async function requiredSecret(binding: SecretsStoreSecret | undefined, name: string): Promise<string> {
  if (!binding || typeof binding.get !== 'function') {
    throw new Error(`${name} Secrets Store binding is unavailable`);
  }
  const value = await binding.get();
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} Secrets Store value is empty`);
  }
  return value;
}

export async function resolveIdentitySecrets(env: IdentityWorkerEnv): Promise<Env> {
  assertCiStack(env);
  if (env.APP_ENV === 'ci') return { ...env, AUTH_SECRET: env.AUTH_SECRET! };
  if (env.APP_ENV === 'staging') {
    const [authSecret, resendApiKey, resendFrom] = await Promise.all([
      requiredSecret(env.AUTH_SECRET_STORE, 'AUTH_SECRET'),
      requiredSecret(env.RESEND_API_KEY_STORE, 'RESEND_API_KEY'),
      requiredSecret(env.RESEND_FROM_STORE, 'RESEND_FROM'),
    ]);
    return { ...env, AUTH_SECRET: authSecret, RESEND_API_KEY: resendApiKey, RESEND_FROM: resendFrom };
  }
  if (env.APP_ENV !== 'local' || !env.AUTH_SECRET?.trim()) {
    throw new Error('Local AUTH_SECRET is unavailable');
  }
  return { ...env, AUTH_SECRET: env.AUTH_SECRET };
}
