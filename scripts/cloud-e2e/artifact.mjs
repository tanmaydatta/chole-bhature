import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseStackKey } from './key.mjs';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_MIGRATION_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const BUILD_SHA = /^[a-f0-9]{40}$/u;
const requiredWorkers = new Set(['workers/api.mjs', 'workers/identity.mjs', 'workers/operator.mjs']);
const safePart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
// Pinned Wrangler serializes upload FormData with this opening metadata part.
// Inspect only the bounded envelope prefix; never parse or execute Worker source.
const serializedWorkerPrefix = /^------formdata-undici-[0-9]{12}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n/u;

export class BundleVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BundleVerificationError';
  }
}

function fail(message) {
  throw new BundleVerificationError(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(message);
  return value;
}

function requireExactKeys(value, keys, message) {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) fail(message);
}

function validatePath(value, { archive = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.startsWith('/') || value.includes(String.fromCharCode(0))) {
    fail('Archive path is invalid.');
  }
  const parts = value.split('/');
  if (parts.some(part => !safePart.test(part) || part === '.' || part === '..')) fail('Archive path is invalid.');
  if (archive && value === 'manifest.json') return value;
  if (requiredWorkers.has(value)) return value;
  if (parts[0] === 'assets' && parts.length >= 2) return value;
  if ((parts[0] === 'migrations') && parts.length === 3 && (parts[1] === 'api' || parts[1] === 'identity') && parts[2].endsWith('.sql')) return value;
  fail('Archive path is not allowed.');
}

function parseOctal(header, start, length, message) {
  const field = header.subarray(start, start + length).toString('ascii');
  let end = field.length;
  while (end > 0 && (field.charCodeAt(end - 1) === 0 || field[end - 1] === ' ')) end -= 1;
  const raw = field.slice(0, end);
  if (!/^[0-7]+$/u.test(raw)) fail(message);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail(message);
  return value;
}

function validateChecksum(header) {
  const expected = parseOctal(header, 148, 8, 'Archive header checksum is invalid.');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) actual += index >= 148 && index < 156 ? 32 : header[index];
  if (actual !== expected) fail('Archive header checksum is invalid.');
}

function tarString(header, start, length) {
  const value = header.subarray(start, start + length);
  const end = value.indexOf(0);
  return value.subarray(0, end === -1 ? value.length : end).toString('utf8');
}

function parseTar(bytes) {
  const entries = [];
  const seen = new Set();
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 512 > bytes.length) fail('Archive is truncated.');
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > bytes.length || !bytes.subarray(offset + 512, offset + 1024).every(byte => byte === 0)) {
        fail('Archive terminator is invalid.');
      }
      if (!bytes.subarray(offset + 1024).every(byte => byte === 0)) fail('Archive has data after its terminator.');
      return entries;
    }
    validateChecksum(header);
    const prefix = tarString(header, 345, 155);
    const localName = tarString(header, 0, 100);
    const name = prefix.length === 0 ? localName : `${prefix}/${localName}`;
    validatePath(name, { archive: true });
    if (seen.has(name)) fail(`Archive contains duplicate path: ${name}.`);
    seen.add(name);
    const type = header[156];
    if (type !== 0 && type !== 48) fail(`Archive entry must be a regular file: ${name}.`);
    const size = parseOctal(header, 124, 12, 'Archive file size is invalid.');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const nextOffset = dataEnd + ((512 - (size % 512)) % 512);
    if (nextOffset > bytes.length) fail('Archive is truncated.');
    entries.push({ name, bytes: bytes.subarray(dataStart, dataEnd) });
    offset = nextOffset;
  }
  fail('Archive is missing its terminator.');
}

function parseExpectedRun(value) {
  const run = requireObject(value, 'Expected controller run identity.');
  requireExactKeys(run, ['run_id', 'attempt'], 'Expected controller run identity.');
  if (!Number.isSafeInteger(run.run_id) || run.run_id <= 0 || !Number.isSafeInteger(run.attempt) || run.attempt <= 0) {
    fail('Expected controller run identity.');
  }
  return run;
}

function parseManifest(bytes, key, run) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('Manifest is not valid JSON.');
  }
  requireObject(manifest, 'Manifest must be an object.');
  requireExactKeys(manifest, ['schema', 'key', 'build_sha', 'run', 'files'], 'Manifest contains unexpected configuration.');
  if (manifest.schema !== 1) fail('Manifest schema must be 1.');
  let manifestKey;
  try {
    manifestKey = parseStackKey(manifest.key);
  } catch {
    fail('Manifest StackKeyV1 is invalid.');
  }
  if (!equalJson(manifestKey, key)) fail('Manifest StackKeyV1 does not match the current run.');
  if (typeof manifest.build_sha !== 'string' || !BUILD_SHA.test(manifest.build_sha) || manifest.build_sha !== key.head_sha) {
    fail('Manifest build SHA does not match the current PR SHA.');
  }
  const manifestRun = parseExpectedRun(manifest.run);
  if (!equalJson(manifestRun, run) || manifestRun.run_id !== key.run_id || manifestRun.attempt !== key.attempt) {
    fail('Manifest run identity does not match the current run.');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('Manifest files must be a non-empty array.');
  const files = new Map();
  let total = 0;
  for (const item of manifest.files) {
    requireObject(item, 'Manifest file entry is invalid.');
    requireExactKeys(item, ['path', 'size', 'sha256'], 'Manifest file entry is invalid.');
    const filePath = validatePath(item.path);
    if (files.has(filePath)) fail(`Manifest contains duplicate path: ${filePath}.`);
    if (!Number.isSafeInteger(item.size) || item.size < 0) fail('Manifest file size is invalid.');
    if (item.size > MAX_FILE_BYTES) fail('Manifest file exceeds the 20 MiB cap.');
    if (filePath.startsWith('migrations/') && item.size > MAX_MIGRATION_BYTES) fail('Migration exceeds the 1 MiB cap.');
    if (typeof item.sha256 !== 'string' || !SHA256.test(item.sha256)) fail('Manifest SHA-256 is invalid.');
    total += item.size;
    if (total > MAX_TOTAL_BYTES) fail('Manifest files exceed the 64 MiB cap.');
    files.set(filePath, { size: item.size, sha256: item.sha256 });
  }
  for (const worker of requiredWorkers) if (!files.has(worker)) fail(`Manifest is missing required Worker: ${worker}.`);
  if (!files.has('assets/index.html')) fail('Manifest is missing the Operator SPA index.html asset.');
  return { manifestKey, files };
}

async function readArchive(archive) {
  if (typeof archive !== 'string' || !path.isAbsolute(archive)) fail('Archive path must be absolute.');
  const stat = await lstat(archive);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('Archive must be a regular file.');
  if (stat.size > MAX_ARCHIVE_BYTES) fail('Archive exceeds the maximum safe size.');
  return readFile(archive);
}

export async function verifyBundleV1({ archive, expectedKey, expectedRun, destination }) {
  let key;
  try {
    key = parseStackKey(expectedKey);
  } catch {
    fail('Expected controller StackKeyV1 is invalid.');
  }
  const run = parseExpectedRun(expectedRun);
  if (run.run_id !== key.run_id || run.attempt !== key.attempt) fail('Expected controller run identity does not match StackKeyV1.');
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) fail('Destination must be an absolute controller-owned path.');
  try {
    await lstat(destination);
    fail('Destination must not already exist.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const entries = parseTar(await readArchive(archive));
  const manifestEntry = entries.find(entry => entry.name === 'manifest.json');
  if (!manifestEntry) fail('Archive is missing manifest.json.');
  const { manifestKey, files } = parseManifest(manifestEntry.bytes, key, run);
  if (entries.length !== files.size + 1) fail('Archive contains an unlisted file.');
  const verified = [];
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    const declared = files.get(entry.name);
    if (!declared) fail(`Archive file is unlisted: ${entry.name}.`);
    if (entry.bytes.length !== declared.size) fail(`Archive file size does not match manifest: ${entry.name}.`);
    const digest = sha256(entry.bytes);
    if (digest !== declared.sha256) fail(`Archive file SHA-256 does not match manifest: ${entry.name}.`);
    if (requiredWorkers.has(entry.name) && serializedWorkerPrefix.test(entry.bytes.subarray(0, 128).toString('latin1'))) {
      fail(`Worker file contains serialized multipart upload data: ${entry.name}.`);
    }
    verified.push({ relativePath: entry.name, bytes: entry.bytes, size: declared.size, sha256: digest });
  }
  if (verified.length !== files.size) fail('Archive is missing a manifest-listed file.');

  await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const file of verified) {
    const output = path.join(destination, file.relativePath);
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await writeFile(output, file.bytes, { flag: 'wx', mode: 0o600 });
    file.path = output;
    delete file.bytes;
    delete file.relativePath;
  }
  return { key: manifestKey, buildSha: key.head_sha, run, files: verified };
}

export const artifactLimits = Object.freeze({
  fileBytes: MAX_FILE_BYTES,
  migrationBytes: MAX_MIGRATION_BYTES,
  totalBytes: MAX_TOTAL_BYTES,
});
