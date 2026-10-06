import { describe, expect, test } from 'vitest';
import { assertCiStack } from '../src/ci-stack.js';
import type { OperatorWebWorkerEnv } from '../src/staging-secrets.js';

function valid(): OperatorWebWorkerEnv {
  return { APP_ENV: 'ci', CI_STACK_KEY: '0123456789abcdef0123',
    PUBLIC_APP_ORIGIN: 'https://cb-e2e-0123456789abcdef0123-operator.trusted.workers.dev',
    OPERATOR_SELECTION_SECRET: 'disposable-ci-selection-secret-at-least-32-characters',
    IDENTITY_AUTH: { fetch() {} }, ASSETS: { fetch() {} },
    IDENTITY: Object.fromEntries(['getE2eCapabilities', 'resolveBrowserPrincipal', 'listClients',
      'getProvisioningForRoot', 'listMembers', 'listInvitations', 'provisionClient',
      'getProvisioning', 'createInvitation', 'retryInvitation', 'acceptInvitation', 'removeMember',
      'changeMemberRole', 'previewE2eRun', 'disposeE2eRun', 'inspectE2eRun', 'createE2eAccount']
      .map(name => [name, () => {}])),
    CORE: Object.fromEntries(['createCredential', 'listCredentials', 'revokeCredential',
      'listSchemaDefinitions', 'getPublishedSchema', 'createSchemaDefinition', 'updateSchemaDefinition',
      'deleteSchemaDefinition', 'previewSchemaDefinitionImpact', 'deprecateSchemaDefinition',
      'publishSchema', 'getCustomer', 'upsertCustomer', 'listPrograms', 'createProgramDraft',
      'getProgram', 'updateProgramDraft', 'publishProgram', 'pauseProgram', 'resumeProgram', 'endProgram']
      .map(name => [name, () => {}])),
  } as OperatorWebWorkerEnv;
}

describe('operator-web CI configuration admission', () => {

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
    expect(() => assertCiStack({ ...valid(), OPERATOR_SELECTION_SECRET: secret } as OperatorWebWorkerEnv)).toThrow(/CI/u);
  });

  test('rejects staging secret bindings without reading them', () => {
    let read = false;
    expect(() => assertCiStack({ ...valid(), OPERATOR_SELECTION_SECRET_STORE: {
      get: async () => { read = true; return 'external'; } } })).toThrow(/CI/u);
    expect(read).toBe(false);
  });

  test.each(['IDENTITY_AUTH', 'ASSETS'])('requires forwarding fetch %s', binding => {
    const input = valid(); Reflect.set(input, binding, {});
    expect(() => assertCiStack(input)).toThrow(/CI/u);
  });
  test.each(['getE2eCapabilities', 'resolveBrowserPrincipal', 'listClients', 'getProvisioningForRoot',
    'listMembers', 'listInvitations', 'provisionClient', 'getProvisioning', 'createInvitation',
    'retryInvitation', 'acceptInvitation', 'removeMember', 'changeMemberRole', 'previewE2eRun',
    'disposeE2eRun', 'inspectE2eRun', 'createE2eAccount'])
    ('requires Identity method %s', method => {
      const input = valid(); Reflect.set(input.IDENTITY, method, undefined);
      expect(() => assertCiStack(input)).toThrow(/CI/u);
    });
  test.each(['createCredential', 'listCredentials', 'revokeCredential', 'listSchemaDefinitions',
    'getPublishedSchema', 'createSchemaDefinition', 'updateSchemaDefinition', 'deleteSchemaDefinition',
    'previewSchemaDefinitionImpact', 'deprecateSchemaDefinition', 'publishSchema', 'getCustomer',
    'upsertCustomer', 'listPrograms', 'createProgramDraft', 'getProgram', 'updateProgramDraft',
    'publishProgram', 'pauseProgram', 'resumeProgram', 'endProgram'])
    ('requires Core method %s', method => {
      const input = valid(); Reflect.set(input.CORE, method, undefined);
      expect(() => assertCiStack(input)).toThrow(/CI/u);
    });
});
