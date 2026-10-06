import type { IdentityWorkerEnv } from './staging-secrets.js';

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
export function assertCiStack(env: IdentityWorkerEnv, expectedMarker?: string): void {
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
  if (typeof env.AUTH_SECRET !== 'string' || env.AUTH_SECRET.trim().length < 32) {
    fail('AUTH_SECRET must be a direct nonblank secret of at least 32 characters');
  }
  if (env.EMAIL_MODE !== 'local-capture') fail('EMAIL_MODE must be local-capture');
  let recipients: unknown;
  try { recipients = JSON.parse(env.STAGING_ALLOWED_RECIPIENTS); }
  catch { fail('STAGING_ALLOWED_RECIPIENTS must be an empty JSON array'); }
  if (!Array.isArray(recipients) || recipients.length !== 0) {
    fail('STAGING_ALLOWED_RECIPIENTS must be an empty JSON array');
  }
  if (env.PASSKEY_RP_ID !== origin.hostname) fail('PASSKEY_RP_ID must match the Operator host');
  if (env.RESEND_API_KEY !== undefined || env.RESEND_FROM !== undefined
    || env.AUTH_SECRET_STORE !== undefined || env.RESEND_API_KEY_STORE !== undefined
    || env.RESEND_FROM_STORE !== undefined) fail('external email and staging secret bindings are forbidden');
  methods(env.AUTH_DB, ['prepare', 'batch'], 'AUTH_DB');
  methods(env.CORE, ['provisionMerchant', 'activateMerchant', 'getE2eCapabilities',
    'inspectE2eRun', 'previewE2eRun', 'disposeE2eRun'], 'CORE');
}
