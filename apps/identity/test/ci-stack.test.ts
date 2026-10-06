import { describe, expect, test } from 'vitest';
import { assertCiStack } from '../src/ci-stack.js';
import type { IdentityWorkerEnv } from '../src/staging-secrets.js';

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

describe('identity CI configuration admission', () => {

  test('accepts the exact canonical CI stack and checks a supplied expected marker', () => {
    expect(() => assertCiStack(valid(), '0123456789abcdef0123')).not.toThrow();
    expect(() => assertCiStack(valid(), 'ffffffffffffffffffff')).toThrow(/CI/u);
    expect(() => assertCiStack(valid(), 'UPPERCASE')).toThrow(/CI/u);
  });
  test.each([undefined, '', 'ABCDEF0123456789abcd', '0123456789abcdef01234', 'foreign'])
    ('rejects missing or malformed marker %s', marker => {
      expect(() => assertCiStack({ ...valid(), CI_STACK_KEY: marker })).toThrow(/CI/u);
    });
  test.each(['local', 'staging'])('rejects marker leakage into %s', mode => {
    expect(() => assertCiStack({ ...valid(), APP_ENV: mode } as ReturnType<typeof valid>)).toThrow(/CI/u);
    expect(() => assertCiStack({ APP_ENV: mode } as ReturnType<typeof valid>)).not.toThrow();
  });
  test.each(['0', '1', ''])('rejects any local-test flag %s', flag => {
    expect(() => assertCiStack({ ...valid(), E2E_LOCAL_TEST_MODE: flag })).toThrow(/CI/u);
  });
  test('rechecks mutated configuration without caching authority', () => {
    const input = valid();
    assertCiStack(input);
    input.CI_STACK_KEY = 'ffffffffffffffffffff';
    expect(() => assertCiStack(input)).toThrow(/CI/u);
  });

  test.each([
    'http://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev/',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev:443',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev:8443',
    'https://user@cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev?x=1',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev#x',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev/path',
    'https://cb-e2e-ffffffffffffffffffff-operator.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev',
    'https://operator.example.test', 'http://localhost:8787',
    'https://incentives-staging-operator.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-operator.extra.trusted.workers.dev',
  ])('rejects noncanonical or foreign origin %s', origin => {
    expect(() => assertCiStack({ ...valid(), PUBLIC_APP_ORIGIN: origin })).toThrow(/CI/u);
  });
  test.each([undefined, '', ' ', 'short', ' '.repeat(32)])('rejects absent/short direct secret %s', secret => {
    expect(() => assertCiStack({ ...valid(), AUTH_SECRET: secret } as IdentityWorkerEnv)).toThrow(/CI/u);
  });

  test.each(['RESEND_API_KEY', 'RESEND_FROM', 'AUTH_SECRET_STORE', 'RESEND_API_KEY_STORE', 'RESEND_FROM_STORE'])
    ('rejects external/staging configuration %s without reading it', name => {
      let read = false;
      const input = { ...valid(), [name]: { get() { read = true; throw new Error('no read'); } } };
      expect(() => assertCiStack(input)).toThrow(/CI/u);
      expect(read).toBe(false);
    });
  test.each(['resend', '', undefined])('requires local-capture email %s', mode => {
    expect(() => assertCiStack({ ...valid(), EMAIL_MODE: mode } as IdentityWorkerEnv)).toThrow(/CI/u);
  });
  test.each(['["person@example.test"]', '{}', '', 'null'])
    ('requires empty recipient array %s', list => {
      expect(() => assertCiStack({ ...valid(), STAGING_ALLOWED_RECIPIENTS: list })).toThrow(/CI/u);
    });
  test('requires the RP host of the exact operator origin', () => {
    expect(() => assertCiStack({ ...valid(), PASSKEY_RP_ID: 'trusted.workers.dev' })).toThrow(/CI/u);
  });

  test.each(['prepare', 'batch'])('requires Auth D1 method %s', method => {
    const input = valid(); Reflect.set(input.AUTH_DB, method, undefined);
    expect(() => assertCiStack(input)).toThrow(/CI/u);
  });
  test.each(['provisionMerchant', 'activateMerchant', 'getE2eCapabilities', 'inspectE2eRun', 'previewE2eRun', 'disposeE2eRun'])
    ('requires Core method %s', method => {
      const input = valid(); Reflect.set(input.CORE, method, undefined);
      expect(() => assertCiStack(input)).toThrow(/CI/u);
    });
});
