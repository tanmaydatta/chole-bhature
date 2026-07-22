import { describe, expect, test } from 'vitest';

import { stagingPreflightSummary } from '../../../scripts/staging-preflight.mjs';

describe('staging deployment preflight', () => {
  test('validates the fixed topology and redacts identifiers and recipients', () => {
    const productId = 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1';
    const authId = '6a65017f-df57-474e-bebb-e676e09377e5';
    const recipient = 'operator@wastd.dev';
    const summary = stagingPreflightSummary({
      STAGING_ENVIRONMENT: 'staging',
      STAGING_PRODUCT_D1_ID: productId,
      STAGING_AUTH_D1_ID: authId,
      STAGING_OPERATOR_ORIGIN: 'https://operator.staging.wastd.dev',
      STAGING_API_ORIGIN: 'https://api.staging.wastd.dev',
      STAGING_PASSKEY_RP_ID: 'operator.staging.wastd.dev',
      STAGING_ALLOWED_RECIPIENTS: JSON.stringify([recipient]),
    });

    expect(summary).toEqual({
      environment: 'staging',
      workers: {
        api: 'incentives-api-staging',
        identity: 'incentives-identity-staging (private)',
        operatorWeb: 'incentives-operator-web-staging',
      },
      databases: {
        product: 'incentives-staging',
        auth: 'incentives-auth-staging',
      },
      apiOrigin: 'https://api.staging.wastd.dev',
      operatorOrigin: 'https://operator.staging.wastd.dev',
      passkeyRpId: 'operator.staging.wastd.dev',
      allowedRecipientCount: 1,
      cloudflareWrites: false,
    });
    expect(JSON.stringify(summary)).not.toMatch(new RegExp(`${productId}|${authId}|${recipient}`));
  });
});
