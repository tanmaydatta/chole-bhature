import { describe, expect, test } from 'vitest';
import { assertCiStack } from '../src/ci-stack.js';
import type { Env } from '../src/env.js';

function valid(): Env {
  return { APP_ENV: 'ci', CI_STACK_KEY: '0123456789abcdef0123',
    PUBLIC_APP_ORIGIN: 'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev',
    DB: { prepare() {}, batch() {} }, DECISION_SIGNING_SECRET: 'disposable-ci-secret-at-least-32-characters',
  } as Env;
}

describe('api CI configuration admission', () => {

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
    'http://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev/',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev:443',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev:8443',
    'https://user@cb-e2e-0123456789abcdef0123-api.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev?x=1',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev#x',
    'https://cb-e2e-0123456789abcdef0123-api.trusted.workers.dev/path',
    'https://cb-e2e-ffffffffffffffffffff-api.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev',
    'https://operator.example.test', 'http://localhost:8787',
    'https://incentives-staging-operator.trusted.workers.dev',
    'https://cb-e2e-0123456789abcdef0123-api.extra.trusted.workers.dev',
  ])('rejects noncanonical or foreign origin %s', origin => {
    expect(() => assertCiStack({ ...valid(), PUBLIC_APP_ORIGIN: origin })).toThrow(/CI/u);
  });
  test.each([undefined, '', ' ', 'short', ' '.repeat(32)])('rejects absent/short direct secret %s', secret => {
    expect(() => assertCiStack({ ...valid(), DECISION_SIGNING_SECRET: secret } as Env)).toThrow(/CI/u);
  });


  test.each(['prepare', 'batch'])('requires D1 method %s', method => {
    const input = valid();
    Reflect.set(input.DB, method, undefined);
    expect(() => assertCiStack(input)).toThrow(/CI/u);
  });
});
