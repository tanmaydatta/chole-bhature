import path from 'node:path';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RP_ID_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z0-9-]{2,63}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SENTINEL_DATABASE_IDS = new Set([
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000003',
]);

function required(environment, key) {
  const value = environment[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }
  return value.trim();
}

function databaseId(environment, key) {
  const value = required(environment, key).toLowerCase();
  if (!UUID_PATTERN.test(value) || SENTINEL_DATABASE_IDS.has(value)) {
    throw new Error(`${key} must be a real non-sentinel D1 UUID.`);
  }
  return value;
}

function operatorOrigin(environment) {
  const raw = required(environment, 'STAGING_OPERATOR_ORIGIN');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('STAGING_OPERATOR_ORIGIN must be a valid HTTPS origin.');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
    || parsed.hostname === 'invalid'
    || parsed.hostname.endsWith('.invalid')
  ) {
    throw new Error('STAGING_OPERATOR_ORIGIN must be a real HTTPS origin without a path.');
  }
  return parsed.origin;
}

function passkeyRpId(environment, origin) {
  const value = required(environment, 'STAGING_PASSKEY_RP_ID').toLowerCase();
  if (!RP_ID_PATTERN.test(value) || value === 'invalid' || value.endsWith('.invalid')) {
    throw new Error('STAGING_PASSKEY_RP_ID must be a real DNS hostname.');
  }
  if (new URL(origin).hostname !== value) {
    throw new Error('STAGING_PASSKEY_RP_ID must exactly match the staging origin hostname.');
  }
  return value;
}

function allowedRecipients(environment) {
  const raw = required(environment, 'STAGING_ALLOWED_RECIPIENTS');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('STAGING_ALLOWED_RECIPIENTS must be a JSON string array.');
  }
  if (
    !Array.isArray(parsed)
    || parsed.length === 0
    || !parsed.every(value =>
      typeof value === 'string'
      && EMAIL_PATTERN.test(value)
      && !value.toLowerCase().endsWith('.invalid')
    )
  ) {
    throw new Error('STAGING_ALLOWED_RECIPIENTS must contain real email addresses.');
  }
  return JSON.stringify([...new Set(parsed.map(value => value.trim().toLowerCase()))]);
}

export function loadStagingConfiguration(environment) {
  if (required(environment, 'STAGING_ENVIRONMENT') !== 'staging') {
    throw new Error('STAGING_ENVIRONMENT must be exactly "staging".');
  }
  const productDatabaseId = databaseId(environment, 'STAGING_PRODUCT_D1_ID');
  const authDatabaseId = databaseId(environment, 'STAGING_AUTH_D1_ID');
  if (productDatabaseId === authDatabaseId) {
    throw new Error('Product and Auth staging D1 IDs must be different.');
  }
  const origin = operatorOrigin(environment);
  return Object.freeze({
    productDatabaseId,
    authDatabaseId,
    operatorOrigin: origin,
    passkeyRpId: passkeyRpId(environment, origin),
    allowedRecipients: allowedRecipients(environment),
  });
}

export function loadIdentityStagingDevelopmentSecrets(environment) {
  const authSecret = required(environment, 'AUTH_SECRET');
  if (authSecret.length < 32) {
    throw new Error('AUTH_SECRET must contain at least 32 characters for staging development.');
  }
  return Object.freeze({
    authSecret,
    resendApiKey: required(environment, 'RESEND_API_KEY'),
    resendFrom: required(environment, 'RESEND_FROM'),
  });
}

export function renderIdentityStagingDevelopmentVars(secrets) {
  return `AUTH_SECRET=${JSON.stringify(secrets.authSecret)}
RESEND_API_KEY=${JSON.stringify(secrets.resendApiKey)}
RESEND_FROM=${JSON.stringify(secrets.resendFrom)}
`;
}

function tomlString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function renderStagingWranglerConfig(app, configuration, repositoryRoot) {
  if (app === 'api') {
    return `name = "incentives-api-staging"
main = ${tomlString(path.join(repositoryRoot, 'apps/api/src/worker.ts'))}
compatibility_date = "2026-07-18"

[[d1_databases]]
binding = "DB"
database_name = "incentives-staging"
database_id = "${configuration.productDatabaseId}"
migrations_dir = ${tomlString(path.join(repositoryRoot, 'apps/api/migrations'))}
`;
  }
  if (app !== 'identity') throw new Error('Unsupported staging application.');
  return `name = "incentives-identity-staging"
main = ${tomlString(path.join(repositoryRoot, 'apps/identity/src/worker.ts'))}
compatibility_date = "2026-07-20"
compatibility_flags = ["nodejs_compat"]
workers_dev = false
preview_urls = false

[vars]
APP_ENV = "staging"
PUBLIC_APP_ORIGIN = ${tomlString(configuration.operatorOrigin)}
COOKIE_PREFIX = "incentives-staging"
EMAIL_MODE = "resend"
MAGIC_LINK_TTL_SECONDS = "300"
EMAIL_RATE_LIMIT_MAX = "3"
EMAIL_RATE_LIMIT_WINDOW_SECONDS = "60"
STAGING_ALLOWED_RECIPIENTS = ${tomlString(configuration.allowedRecipients)}
PASSKEY_RP_ID = ${tomlString(configuration.passkeyRpId)}
PASSKEY_RP_NAME = "Incentives Operator (Staging)"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "incentives-auth-staging"
database_id = "${configuration.authDatabaseId}"
migrations_dir = ${tomlString(path.join(repositoryRoot, 'apps/identity/migrations'))}

[[services]]
binding = "CORE"
service = "incentives-api-staging"
entrypoint = "CoreOperatorService"
`;
}

export function stagingWranglerArguments(app, action, configPath) {
  if (!['api', 'identity'].includes(app) || !['dev', 'migrate', 'deploy'].includes(action)) {
    throw new Error('Unsupported staging Wrangler command.');
  }
  if (action === 'dev') return ['dev', '--remote', '--config', configPath];
  if (action === 'deploy') return ['deploy', '--config', configPath];
  return [
    'd1',
    'migrations',
    'apply',
    app === 'api' ? 'incentives-staging' : 'incentives-auth-staging',
    '--remote',
    '--config',
    configPath,
  ];
}
