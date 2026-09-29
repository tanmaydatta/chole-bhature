import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { transferStagingSecret } from './staging-secret-transfer.mjs';

const itemId = '79d7a4f5-6e79-4f12-9d41-df80b6a8303e';
const secretValue = 'A'.repeat(64);
const storeId = '8f7a1cdced6342c18d223ece462fd88d';

function fixture({ prompt = true, exitCode = 0, accountPrompt = false } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'staging-secret-transfer-'));
  const bwPath = path.join(directory, 'bw');
  const wranglerPath = path.join(directory, 'wrangler.mjs');
  const envPath = path.join(directory, '.env.staging');
  const capturePath = path.join(directory, 'capture.json');
  writeFileSync(bwPath, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  id: '${itemId}', folderId: 'dc06af2c-bccd-4182-96b6-b4d00123948e',
  name: 'AUTH_SECRET · incentives-identity-staging · 2026-09-25',
  login: { password: '${secretValue}' },
}));
`, { mode: 0o700 });
  writeFileSync(wranglerPath, `import fs from 'node:fs';
const capture = { args: process.argv.slice(2),
  hasBitwardenSession: Object.hasOwn(process.env, 'BW_SESSION'),
  hasAuthSecret: Object.hasOwn(process.env, 'AUTH_SECRET') };
${prompt ? `process.stdout.write('Enter a secret value: ');
process.stdin.setEncoding('utf8');
process.stdin.once('data', value => {
  capture.received = value.trim();
  fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(capture));
  ${accountPrompt ? `process.stdout.write('Select an account: ');
  setTimeout(() => process.exit(0), 1000);` : `process.exit(${exitCode});`}
});` : `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(capture));
process.exit(${exitCode});`}
`, { mode: 0o700 });
  writeFileSync(envPath, "RESEND_FROM='Identity Staging <mail@example.test>'\n", { mode: 0o600 });
  const environment = {
    ...process.env,
    STAGING_ENVIRONMENT: 'staging',
    STAGING_PRODUCT_D1_ID: 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1',
    STAGING_AUTH_D1_ID: '6a65017f-df57-474e-bebb-e676e09377e5',
    STAGING_SECRETS_STORE_ID: storeId,
    STAGING_OPERATOR_ORIGIN: 'https://operator.staging.example.com',
    STAGING_API_ORIGIN: 'https://api.staging.example.com',
    STAGING_PASSKEY_RP_ID: 'operator.staging.example.com',
    STAGING_ALLOWED_RECIPIENTS: '["mail@example.test"]',
    BW_SESSION: 'test-session-must-not-reach-wrangler',
    AUTH_SECRET: 'test-env-secret-must-not-reach-wrangler',
  };
  return { directory, bwPath, wranglerPath, envPath, capturePath, environment };
}

test('transfers a validated Bitwarden secret through the hidden prompt only', () => {
  const f = fixture();
  try {
    const result = transferStagingSecret({
      key: 'AUTH_SECRET', itemId, environment: f.environment,
      bwPath: f.bwPath, wranglerPath: f.wranglerPath, envPath: f.envPath,
    });
    assert.deepEqual(result, { key: 'AUTH_SECRET', storeId, status: 'created' });
    const capture = JSON.parse(readFileSync(f.capturePath, 'utf8'));
    assert.equal(capture.received, secretValue);
    assert.equal(capture.hasBitwardenSession, false);
    assert.equal(capture.hasAuthSecret, false);
    assert.deepEqual(capture.args, [
      'secrets-store', 'secret', 'create', storeId,
      '--name', 'AUTH_SECRET', '--scopes', 'workers', '--remote',
    ]);
    assert.equal(JSON.stringify(capture.args).includes(secretValue), false);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('refuses a Wrangler process that exits before showing the hidden prompt', () => {
  const f = fixture({ prompt: false });
  try {
    assert.throws(() => transferStagingSecret({
      key: 'AUTH_SECRET', itemId, environment: f.environment,
      bwPath: f.bwPath, wranglerPath: f.wranglerPath, envPath: f.envPath,
    }), /Secrets Store transfer failed for AUTH_SECRET/u);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('transfers the validated sender from the private staging environment file', () => {
  const f = fixture();
  try {
    const result = transferStagingSecret({
      key: 'RESEND_FROM', environment: f.environment,
      bwPath: f.bwPath, wranglerPath: f.wranglerPath, envPath: f.envPath,
    });
    assert.equal(result.status, 'created');
    const capture = JSON.parse(readFileSync(f.capturePath, 'utf8'));
    assert.equal(capture.received, 'Identity Staging <mail@example.test>');
    assert.equal(capture.args.includes('RESEND_FROM'), true);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('refuses a failed Wrangler process after the prompt', () => {
  const f = fixture({ exitCode: 1 });
  try {
    assert.throws(() => transferStagingSecret({
      key: 'AUTH_SECRET', itemId, environment: f.environment,
      bwPath: f.bwPath, wranglerPath: f.wranglerPath, envPath: f.envPath,
    }), /Secrets Store transfer failed for AUTH_SECRET/u);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('refuses an unexpected account-selection prompt after the secret prompt', () => {
  const f = fixture({ accountPrompt: true });
  try {
    assert.throws(() => transferStagingSecret({
      key: 'AUTH_SECRET', itemId, environment: f.environment,
      bwPath: f.bwPath, wranglerPath: f.wranglerPath, envPath: f.envPath,
    }), /Secrets Store transfer failed for AUTH_SECRET \(status 26\)/u);
  } finally {
    rmSync(f.directory, { recursive: true, force: true });
  }
});

test('rejects unsupported names before launching a child', () => {
  assert.throws(() => transferStagingSecret({ key: 'PRODUCTION_SECRET' }),
    /Unsupported staging secret name/u);
});
