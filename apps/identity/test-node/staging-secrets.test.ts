import { describe, expect, test, vi } from 'vitest';

import { resolveIdentitySecrets, type IdentityWorkerEnv } from '../src/staging-secrets.js';

function staging(overrides: Partial<IdentityWorkerEnv> = {}): IdentityWorkerEnv {
  return {
    APP_ENV: 'staging',
    AUTH_SECRET: 'legacy-direct-secret',
    RESEND_API_KEY: 'legacy-direct-key',
    RESEND_FROM: 'legacy-direct-sender',
    AUTH_SECRET_STORE: { get: vi.fn(async () => 'store-auth-secret') },
    RESEND_API_KEY_STORE: { get: vi.fn(async () => 'store-resend-key') },
    RESEND_FROM_STORE: { get: vi.fn(async () => 'Store Sender <mail@example.test>') },
    ...overrides,
  } as IdentityWorkerEnv;
}

describe('Identity staging Secrets Store resolution', () => {
  test('resolves every binding once and ignores legacy per-Worker secrets', async () => {
    const input = staging();
    const resolved = await resolveIdentitySecrets(input);
    expect(resolved.AUTH_SECRET).toBe('store-auth-secret');
    expect(resolved.RESEND_API_KEY).toBe('store-resend-key');
    expect(resolved.RESEND_FROM).toBe('Store Sender <mail@example.test>');
    expect(input.AUTH_SECRET_STORE?.get).toHaveBeenCalledTimes(1);
    expect(input.RESEND_API_KEY_STORE?.get).toHaveBeenCalledTimes(1);
    expect(input.RESEND_FROM_STORE?.get).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['missing binding', { AUTH_SECRET_STORE: undefined }],
    ['empty value', { RESEND_API_KEY_STORE: { get: async () => '   ' } }],
    ['rejected read', { RESEND_FROM_STORE: { get: async () => { throw new Error('missing'); } } }],
  ])('fails closed on %s despite direct secrets', async (_name, override) => {
    await expect(resolveIdentitySecrets(staging(override))).rejects.toThrow();
  });

  test('preserves direct secrets for local development', async () => {
    const input = { ...staging(), APP_ENV: 'local' as const };
    const resolved = await resolveIdentitySecrets(input);
    expect(resolved.AUTH_SECRET).toBe('legacy-direct-secret');
    expect(input.AUTH_SECRET_STORE?.get).not.toHaveBeenCalled();
  });
});
