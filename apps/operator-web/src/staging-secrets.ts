import type { OperatorWebEnv } from './routes/types.js';

export type OperatorWebWorkerEnv = Omit<OperatorWebEnv, 'OPERATOR_SELECTION_SECRET'> & {
  OPERATOR_SELECTION_SECRET?: string;
  OPERATOR_SELECTION_SECRET_STORE?: SecretsStoreSecret;
};

export async function resolveOperatorSecret(env: OperatorWebWorkerEnv): Promise<OperatorWebEnv> {
  if (env.APP_ENV === 'staging') {
    const binding = env.OPERATOR_SELECTION_SECRET_STORE;
    if (!binding || typeof binding.get !== 'function') {
      throw new Error('OPERATOR_SELECTION_SECRET Secrets Store binding is unavailable');
    }
    const value = await binding.get();
    if (typeof value !== 'string' || value.trim().length < 32) {
      throw new Error('OPERATOR_SELECTION_SECRET Secrets Store value is invalid');
    }
    return { ...env, OPERATOR_SELECTION_SECRET: value };
  }
  if (env.APP_ENV !== 'local' || !env.OPERATOR_SELECTION_SECRET?.trim()) {
    throw new Error('Local OPERATOR_SELECTION_SECRET is unavailable');
  }
  return { ...env, OPERATOR_SELECTION_SECRET: env.OPERATOR_SELECTION_SECRET };
}
