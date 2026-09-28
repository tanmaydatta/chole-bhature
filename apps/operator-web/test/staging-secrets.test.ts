import { describe, expect, test, vi } from 'vitest';

import { resolveOperatorSecret, type OperatorWebWorkerEnv } from '../src/staging-secrets.js';

describe('Operator Web staging Secrets Store resolution', () => {
  test('reads once and supersedes the old per-Worker secret', async () => {
    const get = vi.fn(async () => 'store-selection-secret-with-at-least-32-characters');
    const env = {
      APP_ENV: 'staging', OPERATOR_SELECTION_SECRET: 'legacy-selection-secret',
      OPERATOR_SELECTION_SECRET_STORE: { get },
    } as OperatorWebWorkerEnv;
    const resolved = await resolveOperatorSecret(env);
    expect(resolved.OPERATOR_SELECTION_SECRET).toBe('store-selection-secret-with-at-least-32-characters');
    expect(get).toHaveBeenCalledTimes(1);
  });

  test.each([
    undefined,
    { get: async () => '' },
    { get: async () => 'short' },
    { get: async () => { throw new Error('missing'); } },
  ])('fails closed on absent or unusable store binding', async binding => {
    const env = {
      APP_ENV: 'staging', OPERATOR_SELECTION_SECRET: 'legacy-selection-secret',
      OPERATOR_SELECTION_SECRET_STORE: binding,
    } as OperatorWebWorkerEnv;
    await expect(resolveOperatorSecret(env)).rejects.toThrow();
  });

  test('keeps local direct-secret behavior', async () => {
    const env = { APP_ENV: 'local', OPERATOR_SELECTION_SECRET: 'local-secret' } as OperatorWebWorkerEnv;
    expect((await resolveOperatorSecret(env)).OPERATOR_SELECTION_SECRET).toBe('local-secret');
  });
});
