import type { OperatorWebWorkerEnv } from './staging-secrets.js';

function fail(message: string): never {
  throw new Error(`Invalid CI stack: ${message}`);
}

function methods(binding: unknown, names: readonly string[], name: string): void {
  if ((typeof binding !== 'object' && typeof binding !== 'function') || binding === null
    || names.some(method => typeof Reflect.get(binding, method) !== 'function')) {
    fail(`${name} is missing required binding methods`);
  }
}

/**
 * Guard trusted controller configuration before I/O. Naming and callable shape
 * do not certify provider ownership, remote binding IDs, or route protection.
 */
export function assertCiStack(env: OperatorWebWorkerEnv, expectedMarker?: string): void {
  if (env.APP_ENV !== 'ci') {
    if (env.CI_STACK_KEY !== undefined) fail('CI_STACK_KEY is forbidden outside CI');
    return;
  }
  const marker = env.CI_STACK_KEY;
  if (typeof marker !== 'string' || !/^[a-f0-9]{20}$/u.test(marker)) {
    fail('CI_STACK_KEY must be 20 lowercase hex characters');
  }
  if (expectedMarker !== undefined
    && (!/^[a-f0-9]{20}$/u.test(expectedMarker) || expectedMarker !== marker)) {
    fail('expected marker does not match CI_STACK_KEY');
  }
  if (env.E2E_LOCAL_TEST_MODE !== undefined) fail('local-test mode is forbidden');
  let origin: URL;
  try { origin = new URL(env.PUBLIC_APP_ORIGIN ?? ''); }
  catch { fail('PUBLIC_APP_ORIGIN must be a canonical HTTPS workers.dev origin'); }
  const suffix = '.workers.dev';
  const labels = origin.hostname.slice(0, -suffix.length).split('.');
  if (origin.protocol !== 'https:' || origin.port !== '' || origin.origin !== env.PUBLIC_APP_ORIGIN
    || !origin.hostname.endsWith(suffix) || labels.length !== 2
    || labels[0] !== `cb-e2e-${marker}-operator`
    || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(labels[1] ?? '')) {
    fail('PUBLIC_APP_ORIGIN must match the CI marker and operator role');
  }
  if (typeof env.OPERATOR_SELECTION_SECRET !== 'string' || env.OPERATOR_SELECTION_SECRET.trim().length < 32) {
    fail('OPERATOR_SELECTION_SECRET must be a direct nonblank secret of at least 32 characters');
  }
  if (env.OPERATOR_SELECTION_SECRET_STORE !== undefined) fail('staging secret bindings are forbidden');
  methods(env.IDENTITY_AUTH, ['fetch'], 'IDENTITY_AUTH');
  methods(env.ASSETS, ['fetch'], 'ASSETS');
  methods(env.IDENTITY, ['getE2eCapabilities', 'resolveBrowserPrincipal', 'listClients',
    'getProvisioningForRoot', 'listMembers', 'listInvitations', 'provisionClient',
    'getProvisioning', 'createInvitation', 'retryInvitation', 'acceptInvitation',
    'removeMember', 'changeMemberRole', 'previewE2eRun', 'disposeE2eRun',
    'inspectE2eRun', 'createE2eAccount'], 'IDENTITY');
  methods(env.CORE, ['createCredential', 'listCredentials', 'revokeCredential',
    'listSchemaDefinitions', 'getPublishedSchema', 'createSchemaDefinition',
    'updateSchemaDefinition', 'deleteSchemaDefinition', 'previewSchemaDefinitionImpact',
    'deprecateSchemaDefinition', 'publishSchema', 'getCustomer', 'upsertCustomer',
    'listPrograms', 'createProgramDraft', 'getProgram', 'updateProgramDraft',
    'publishProgram', 'pauseProgram', 'resumeProgram', 'endProgram'], 'CORE');
}
