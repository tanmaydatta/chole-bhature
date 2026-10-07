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

function valid(): IdentityWorkerEnv {
  return { APP_ENV: 'ci', CI_STACK_KEY: '0123456789abcdef0123',
    PUBLIC_APP_ORIGIN: 'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev',
    AUTH_DB: { prepare() {}, batch() {} },
    AUTH_SECRET: 'disposable-ci-auth-secret-at-least-32-characters',
    EMAIL_MODE: 'local-capture', STAGING_ALLOWED_RECIPIENTS: '[]',
    PASSKEY_RP_ID: 'cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev',
    CORE: Object.fromEntries(['provisionMerchant', 'activateMerchant', 'getE2eCapabilities',
      'inspectE2eRun', 'previewE2eRun', 'disposeE2eRun'].map(name => [name, () => {}])),
  } as IdentityWorkerEnv;
}

describe('CI direct ephemeral secret resolution', () => {
  test('resolves the validated direct secret and rejects forbidden store configuration before reading it', async () => {
    const input = valid();
    expect((await resolveIdentitySecrets(input)).AUTH_SECRET).toBe(input.AUTH_SECRET);
    const get = vi.fn(async () => { throw new Error('external secret read'); });
    await expect(resolveIdentitySecrets({ ...input, AUTH_SECRET_STORE: { get } })).rejects.toThrow(/CI/u);
    expect(get).not.toHaveBeenCalled();
    input.PUBLIC_APP_ORIGIN = 'https://operator.example.test';
    await expect(resolveIdentitySecrets(input)).rejects.toThrow(/CI/u);
  });
  test('rejects a leaked marker in staging before a secret getter', async () => {
    const get = vi.fn(async () => 'staging-value');
    await expect(resolveIdentitySecrets({ ...valid(), APP_ENV: 'staging', AUTH_SECRET_STORE: { get } }))
      .rejects.toThrow(/CI/u);
    expect(get).not.toHaveBeenCalled();
  });
});
