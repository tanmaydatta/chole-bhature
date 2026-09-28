import assert from 'node:assert/strict';
import test from 'node:test';

import { replacePlaceholderSecrets } from './staging-vault-to-env.mjs';

const original = `STAGING_PRODUCT_D1_ID=existing-product-id
STAGING_AUTH_D1_ID=existing-auth-id
RESEND_FROM='Identity Staging <no-reply@mail.staging.wastd.dev>'
AUTH_SECRET=replace-with-auth
RESEND_API_KEY=replace-with-resend
OPERATOR_SELECTION_SECRET=replace-with-operator
`;
const secrets = {
  AUTH_SECRET: 'generated-auth',
  OPERATOR_SELECTION_SECRET: 'generated-operator',
  RESEND_API_KEY: 're_generated-resend',
};

test('replaces only secret placeholders and preserves all other fields', () => {
  const result = replacePlaceholderSecrets(original, secrets);
  assert.match(result, /^STAGING_PRODUCT_D1_ID=existing-product-id$/mu);
  assert.match(result, /^STAGING_AUTH_D1_ID=existing-auth-id$/mu);
  assert.match(result, /^RESEND_FROM='Identity Staging <no-reply@mail.staging.wastd.dev>'$/mu);
  assert.match(result, /^AUTH_SECRET=generated-auth$/mu);
  assert.match(result, /^RESEND_API_KEY=re_generated-resend$/mu);
  assert.match(result, /^OPERATOR_SELECTION_SECRET=generated-operator$/mu);
});

test('refuses to overwrite an already populated secret', () => {
  assert.throws(
    () => replacePlaceholderSecrets(original.replace('replace-with-auth', 'already-set'), secrets),
    /untouched AUTH_SECRET placeholder/u,
  );
});

test('refuses duplicate secret fields', () => {
  assert.throws(
    () => replacePlaceholderSecrets(`${original}RESEND_API_KEY=replace-with-second\n`, secrets),
    /one untouched RESEND_API_KEY placeholder/u,
  );
});
