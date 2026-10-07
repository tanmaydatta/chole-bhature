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

describe('CI direct ephemeral secret resolution', () => {
  test('resolves the validated direct secret and rejects forbidden store configuration before reading it', async () => {
    const input = valid();
    expect((await resolveOperatorSecret(input)).OPERATOR_SELECTION_SECRET).toBe(input.OPERATOR_SELECTION_SECRET);
    const get = vi.fn(async () => { throw new Error('external secret read'); });
    await expect(resolveOperatorSecret({ ...input, OPERATOR_SELECTION_SECRET_STORE: { get } })).rejects.toThrow(/CI/u);
    expect(get).not.toHaveBeenCalled();
    input.PUBLIC_APP_ORIGIN = 'https://operator.example.test';
    await expect(resolveOperatorSecret(input)).rejects.toThrow(/CI/u);
  });
  test('rejects a leaked marker in staging before a secret getter', async () => {
    const get = vi.fn(async () => 'staging-value');
    await expect(resolveOperatorSecret({ ...valid(), APP_ENV: 'staging', OPERATOR_SELECTION_SECRET_STORE: { get } }))
      .rejects.toThrow(/CI/u);
    expect(get).not.toHaveBeenCalled();
  });
});
