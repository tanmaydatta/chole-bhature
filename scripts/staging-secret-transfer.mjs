import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStagingConfiguration } from './staging-wrangler-config.mjs';
import { readVaultItem } from './staging-vault-to-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedKeys = new Set(['AUTH_SECRET', 'RESEND_API_KEY', 'RESEND_FROM', 'OPERATOR_SELECTION_SECRET']);
const childKeys = [
  'PATH', 'HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE',
  'LC_ALL', 'LC_CTYPE', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
];

function senderFromFile(envPath) {
  const info = lstatSync(envPath);
  if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
    throw new Error('.env.staging must be a regular mode-0600 file.');
  }
  const matches = [...readFileSync(envPath, 'utf8').matchAll(/^RESEND_FROM='([^'\r\n]+)'$/gmu)];
  if (matches.length !== 1 || !/^Identity Staging <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/u.test(matches[0][1])) {
    throw new Error('RESEND_FROM must be a single validated sender in .env.staging.');
  }
  return matches[0][1];
}

export function transferStagingSecret({
  key,
  itemId,
  environment = process.env,
  repositoryRoot = root,
  bwPath = path.join(os.homedir(), 'bw'),
  expectPath = '/usr/bin/expect',
  envPath = path.join(repositoryRoot, '.env.staging'),
  wranglerPath,
} = {}) {
  if (!allowedKeys.has(key)) throw new Error('Unsupported staging secret name.');
  if (key === 'RESEND_FROM' ? itemId !== undefined : !itemId || !environment.BW_SESSION) {
    throw new Error('Expected a validated Bitwarden item ID for this secret.');
  }
  const configuration = loadStagingConfiguration(environment);
  const app = key === 'OPERATOR_SELECTION_SECRET' ? 'operator-web' : 'identity';
  const selectedWrangler = wranglerPath ?? path.join(
    repositoryRoot, 'apps', app, 'node_modules/wrangler/bin/wrangler.js',
  );
  if (!statSync(selectedWrangler).isFile() || !statSync(expectPath).isFile()) {
    throw new Error('Expected readable Wrangler and expect executables.');
  }
  const value = key === 'RESEND_FROM'
    ? senderFromFile(envPath)
    : readVaultItem(bwPath, itemId, key);
  const childEnvironment = {};
  for (const name of childKeys) {
    if (typeof environment[name] === 'string') childEnvironment[name] = environment[name];
  }
  const result = spawnSync(expectPath, [
    '-f', path.join(repositoryRoot, 'scripts/staging-secret-transfer.expect'),
    process.execPath, selectedWrangler, configuration.secretsStoreId, key,
  ], {
    input: `${value}\n`, encoding: 'utf8', env: childEnvironment,
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1024 * 1024, timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Secrets Store transfer failed for ${key} (status ${result.status ?? 'unavailable'}).`);
  }
  return { key, storeId: configuration.secretsStoreId, status: 'created' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = transferStagingSecret({ key: process.argv[2], itemId: process.argv[3] });
    process.stdout.write(`Secrets Store ${result.key} created in store ${result.storeId}.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown transfer error.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
