import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FOLDER_ID = 'dc06af2c-bccd-4182-96b6-b4d00123948e';
const EXPECTED_NAMES = Object.freeze({
  AUTH_SECRET: 'AUTH_SECRET · incentives-identity-staging · 2026-09-25',
  OPERATOR_SELECTION_SECRET: 'OPERATOR_SELECTION_SECRET · incentives-operator-web-staging · 2026-09-25',
  RESEND_API_KEY: 'resend.com',
});
const ITEM_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const RANDOM_SECRET_PATTERN = /^[A-Za-z0-9_-]{64}$/u;
const RESEND_KEY_PATTERN = /^re_[A-Za-z0-9_-]{12,}$/u;

export function replacePlaceholderSecrets(original, secrets) {
  let updated = original;
  for (const key of Object.keys(EXPECTED_NAMES)) {
    const pattern = new RegExp(`^${key}=([^\\r\\n]*)$`, 'gmu');
    const matches = [...updated.matchAll(pattern)];
    if (matches.length !== 1 || !matches[0][1].startsWith('replace-with')) {
      throw new Error(`Expected one untouched ${key} placeholder.`);
    }
    updated = updated.replace(pattern, `${key}=${secrets[key]}`);
  }
  return updated;
}

export function readVaultItem(bwPath, id, key) {
  if (!ITEM_ID_PATTERN.test(id)) {
    throw new Error(`Invalid ${key} item ID.`);
  }
  const result = spawnSync(bwPath, ['get', 'item', id], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Bitwarden readback failed for ${key}.`);
  }
  let item;
  try {
    item = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Invalid Bitwarden response for ${key}.`);
  }
  const value = item.login?.password;
  const expectedPattern = key === 'RESEND_API_KEY'
    ? RESEND_KEY_PATTERN
    : RANDOM_SECRET_PATTERN;
  if (
    item.id !== id
    || item.folderId !== FOLDER_ID
    || item.name !== EXPECTED_NAMES[key]
    || typeof value !== 'string'
    || !expectedPattern.test(value)
  ) {
    throw new Error(`Bitwarden item validation failed for ${key}.`);
  }
  return value;
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 3 || !process.env.BW_SESSION) {
    throw new Error('Pass AUTH, OPERATOR, and RESEND item IDs with an unlocked vault.');
  }
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.staging');
  const info = fs.lstatSync(envPath);
  if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
    throw new Error('.env.staging must be a regular mode-0600 file.');
  }
  const original = fs.readFileSync(envPath, 'utf8');
  const bwPath = path.join(os.homedir(), 'bw');
  const secrets = Object.fromEntries(
    Object.keys(EXPECTED_NAMES).map((key, index) => [key, readVaultItem(bwPath, args[index], key)]),
  );
  if (secrets.AUTH_SECRET === secrets.OPERATOR_SELECTION_SECRET) {
    throw new Error('The random staging secrets must be distinct.');
  }
  const updated = replacePlaceholderSecrets(original, secrets);
  fs.writeFileSync(envPath, updated, { encoding: 'utf8', mode: 0o600, flag: 'w' });
  process.stdout.write('Bitwarden readback verified; three staging secret fields updated.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown transfer error.';
    process.stderr.write(`Staging vault transfer failed: ${message}\n`);
    process.exitCode = 1;
  }
}
