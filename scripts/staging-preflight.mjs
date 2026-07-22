import { pathToFileURL } from 'node:url';

import { loadStagingConfiguration } from './staging-wrangler-config.mjs';

export function stagingPreflightSummary(environment) {
  const configuration = loadStagingConfiguration(environment);
  return Object.freeze({
    environment: 'staging',
    workers: Object.freeze({
      api: 'incentives-api-staging',
      identity: 'incentives-identity-staging (private)',
      operatorWeb: 'incentives-operator-web-staging',
    }),
    databases: Object.freeze({
      product: 'incentives-staging',
      auth: 'incentives-auth-staging',
    }),
    apiOrigin: configuration.apiOrigin,
    operatorOrigin: configuration.operatorOrigin,
    passkeyRpId: configuration.passkeyRpId,
    allowedRecipientCount: JSON.parse(configuration.allowedRecipients).length,
    cloudflareWrites: false,
  });
}

export function main(environment = process.env) {
  try {
    process.stdout.write(`${JSON.stringify(stagingPreflightSummary(environment), null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Unknown staging configuration error.';
    process.stderr.write(`Staging preflight failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main();
}
