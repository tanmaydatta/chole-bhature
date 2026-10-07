import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { artifactLimits } from './artifact.mjs';
import { validateInventory } from './inventory.mjs';
import { parseStackKey } from './key.mjs';

const roles = ['api', 'identity', 'operator'];
const workerPaths = roles.map(role => `workers/${role}.mjs`);
const safePart = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const integrityHash = /^[a-f0-9]{64}$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const betaId = /^[a-f0-9]{32}$/u;
const multipart = /^------formdata-undici-[0-9]{12}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n/u;
const specialAssets = new Set(['_headers', '_redirects', '.assetsignore']);
const maxAge = 5 * 60 * 1000;
const assetProfile = { binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/auth/*', '/internal/*', '/operator/v1/*'] };
const blockers = ['service-binding-remapping-unresolved', 'asset-session-name-target-unproven', 'asset-upload-hash-contract-unproven', 'asset-completion-scope-unproven'];

function fail() { throw new TypeError('Operator diagnostic evidence is invalid or mismatched.'); }
function requireCondition(condition) { if (!condition) fail(); }
function object(value) {
  requireCondition(value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  return value;
}
function exact(value, keys) {
  object(value);
  requireCondition(Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function checkedKey(value) {
  try { return parseStackKey(value); } catch { fail(); }
}
function sameKey(left, right) { requireCondition(isDeepStrictEqual(checkedKey(left), checkedKey(right))); }
function string(value) { requireCondition(typeof value === 'string' && value.trim().length > 0); }
function records(value) {
  requireCondition(Array.isArray(value) && Reflect.ownKeys(value).length === value.length + 1);
  for (let index = 0; index < value.length; index++) requireCondition(Object.hasOwn(value, index));
}
function sizeHash(value, migration = false) {
  requireCondition(Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= artifactLimits.fileBytes
    && (!migration || value.size <= artifactLimits.migrationBytes));
  requireCondition(typeof value.sha256 === 'string' && integrityHash.test(value.sha256));
}
function relativePath(value) {
  requireCondition(typeof value === 'string' && !value.includes('\\') && !value.includes('\0'));
  const parts = value.split('/');
  requireCondition(parts.every(part => safePart.test(part) && part !== '.' && part !== '..'));
  if (workerPaths.includes(value)) return value;
  if (parts[0] === 'assets' && parts.length >= 2) {
    requireCondition(!parts.some(part => specialAssets.has(part)));
    return value;
  }
  requireCondition(parts[0] === 'migrations' && parts.length === 3 && ['api', 'identity'].includes(parts[1]) && parts[2].endsWith('.sql'));
  return value;
}
function rawModule(bytes) {
  requireCondition(!multipart.test(bytes.subarray(0, 128).toString('latin1')));
}
function assetOrder(left, right) { return left.path < right.path ? -1 : left.path > right.path ? 1 : 0; }

// Diagnostic data only: this recheck cannot establish inventory/receipt authority.
export async function prepareOperatorCandidate({ verifiedBundle, expectedKey, readBytes }) {
  exact(verifiedBundle, ['key', 'buildSha', 'run', 'files']);
  const bundle = structuredClone(verifiedBundle);
  const key = checkedKey(expectedKey);
  sameKey(bundle.key, key);
  requireCondition(bundle.buildSha === key.head_sha);
  exact(bundle.run, ['run_id', 'attempt']);
  requireCondition(bundle.run.run_id === key.run_id && bundle.run.attempt === key.attempt);
  requireCondition(typeof readBytes === 'function' && Array.isArray(bundle.files) && bundle.files.length > 0);
  for (const file of bundle.files) exact(file, ['path', 'size', 'sha256']);
  const operator = bundle.files.find(file => typeof file.path === 'string' && file.path.endsWith('/workers/operator.mjs'));
  requireCondition(operator);
  const root = operator.path.slice(0, -'/workers/operator.mjs'.length);
  requireCondition(path.isAbsolute(root) && root !== '/' && path.normalize(root) === root);
  const listed = new Set();
  let total = 0;
  const files = bundle.files.map(file => {
    requireCondition(typeof file.path === 'string' && path.isAbsolute(file.path) && file.path.startsWith(`${root}/`) && path.normalize(file.path) === file.path);
    const relative = relativePath(file.path.slice(root.length + 1));
    requireCondition(!listed.has(relative)); listed.add(relative);
    sizeHash(file, relative.startsWith('migrations/'));
    total += file.size; requireCondition(total <= artifactLimits.totalBytes);
    return { ...file, relative };
  });
  requireCondition(workerPaths.every(worker => listed.has(worker)) && listed.has('assets/index.html'));
  const assets = [];
  let module;
  for (const file of files) {
    const received = await readBytes(file.path);
    requireCondition(Buffer.isBuffer(received));
    const bytes = Buffer.from(received);
    requireCondition(bytes.length === file.size && hash(bytes) === file.sha256);
    if (workerPaths.includes(file.relative)) rawModule(bytes);
    if (file.relative === 'workers/operator.mjs') module = { name: 'operator.mjs', contentType: 'application/javascript+module', contentBase64: bytes.toString('base64'), size: file.size, sha256: file.sha256 };
    if (file.relative.startsWith('assets/')) assets.push({ path: file.relative.slice('assets'.length), size: file.size, sha256: file.sha256, contentBase64: bytes.toString('base64') });
  }
  return { key, module, assets: assets.sort(assetOrder), assetProfile: structuredClone(assetProfile) };
}

function snapshot(value) {
  sizeHash(value);
  requireCondition(typeof value.contentBase64 === 'string');
  const bytes = Buffer.from(value.contentBase64, 'base64');
  requireCondition(bytes.toString('base64') === value.contentBase64 && bytes.length === value.size && hash(bytes) === value.sha256);
  return bytes;
}
function candidateAssets(candidate) {
  exact(candidate, ['key', 'module', 'assets', 'assetProfile']);
  checkedKey(candidate.key);
  exact(candidate.module, ['name', 'contentType', 'contentBase64', 'size', 'sha256']);
  requireCondition(candidate.module.name === 'operator.mjs' && candidate.module.contentType === 'application/javascript+module');
  rawModule(snapshot(candidate.module));
  requireCondition(isDeepStrictEqual(candidate.assetProfile, assetProfile) && Array.isArray(candidate.assets) && candidate.assets.length > 0);
  const paths = new Set();
  let total = candidate.module.size;
  for (const asset of candidate.assets) {
    exact(asset, ['path', 'size', 'sha256', 'contentBase64']);
    requireCondition(typeof asset.path === 'string' && asset.path.startsWith('/'));
    relativePath(`assets${asset.path}`);
    requireCondition(!paths.has(asset.path)); paths.add(asset.path);
    snapshot(asset);
    total += asset.size; requireCondition(total <= artifactLimits.totalBytes);
  }
  requireCondition(paths.has('/index.html'));
  return [...candidate.assets].sort(assetOrder);
}
function time(value) {
  requireCondition(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value));
  const ms = Date.parse(value);
  requireCondition(Number.isFinite(ms) && new Date(ms).toISOString() === value);
  return ms;
}
function fresh(value, current) {
  const ms = time(value);
  requireCondition(ms <= current && current - ms <= maxAge);
  return ms;
}
function observedGraph(graph, inventory, versions, current) {
  exact(versions, roles);
  requireCondition(roles.every(role => typeof versions[role] === 'string' && uuid.test(versions[role])));
  exact(graph, ['key', 'accountId', 'observedAt', 'complete', 'workers']);
  sameKey(graph.key, inventory.key);
  requireCondition(graph.accountId === inventory.cloudflare.accountId && graph.complete === true);
  fresh(graph.observedAt, current);
  requireCondition(Array.isArray(graph.workers) && graph.workers.length === 3);
  const core = { name: 'CORE', type: 'service', workerId: inventory.betaWorkerIds.api, service: inventory.names.api, versionId: versions.api, entrypoint: 'CoreOperatorService' };
  const expected = {
    api: [{ name: 'DB', type: 'd1', databaseId: inventory.cloudflare.d1Ids.product }],
    identity: [{ name: 'AUTH_DB', type: 'd1', databaseId: inventory.cloudflare.d1Ids.auth }, core],
    operator: [{ name: 'ASSETS', type: 'assets' }, { name: 'IDENTITY_AUTH', type: 'service', workerId: inventory.betaWorkerIds.identity, service: inventory.names.identity, versionId: versions.identity }, { name: 'IDENTITY', type: 'service', workerId: inventory.betaWorkerIds.identity, service: inventory.names.identity, versionId: versions.identity, entrypoint: 'IdentityOperatorService' }, core],
  };
  const seen = new Set();
  for (const worker of graph.workers) {
    exact(worker, ['role', 'workerId', 'name', 'versionId', 'bindings']);
    requireCondition(roles.includes(worker.role) && !seen.has(worker.role)); seen.add(worker.role);
    requireCondition(worker.workerId === inventory.betaWorkerIds[worker.role] && worker.name === inventory.names[worker.role] && worker.versionId === versions[worker.role]);
    requireCondition(Array.isArray(worker.bindings));
    worker.bindings.forEach(object);
    const byName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    requireCondition(isDeepStrictEqual([...worker.bindings].sort(byName), [...expected[worker.role]].sort(byName)));
  }
}

// Correlation digest of raw-integrity records; never a provider upload hash.
function lifecycleMatches(lifecycle, assets, inventory, current) {
  exact(lifecycle, ['key', 'accountId', 'role', 'workerId', 'workerName', 'manifestDigest', 'sessionId', 'startedAt', 'expiresAt', 'uploadManifest', 'buckets', 'completedBuckets', 'completion']);
  sameKey(lifecycle.key, inventory.key);
  requireCondition(lifecycle.accountId === inventory.cloudflare.accountId && lifecycle.role === 'operator'
    && lifecycle.workerId === inventory.betaWorkerIds.operator && lifecycle.workerName === inventory.names.operator);
  const digest = hash(JSON.stringify(assets.map(asset => [asset.path, asset.size, asset.sha256])));
  requireCondition(lifecycle.manifestDigest === digest);
  string(lifecycle.sessionId);
  const started = fresh(lifecycle.startedAt, current);
  const expiry = time(lifecycle.expiresAt);
  requireCondition(expiry > current && expiry > started);
  exact(lifecycle.uploadManifest, assets.map(asset => asset.path));
  const labels = new Set();
  for (const asset of assets) {
    const record = lifecycle.uploadManifest[asset.path];
    exact(record, ['hash', 'size']); string(record.hash);
    requireCondition(record.size === asset.size && !labels.has(record.hash)); labels.add(record.hash);
  }
  records(lifecycle.buckets); records(lifecycle.completedBuckets);
  requireCondition(lifecycle.completedBuckets.length === lifecycle.buckets.length);
  const completion = (record, keys, after) => {
    exact(record, keys);
    requireCondition(record.sessionId === lifecycle.sessionId && record.manifestDigest === digest);
    string(record.jwt);
    const observed = fresh(record.observedAt, current);
    const end = time(record.expiresAt);
    requireCondition(observed >= after && observed < expiry && end > current && end > observed);
    return observed;
  };
  const completionKeys = ['sessionId', 'manifestDigest', 'observedAt', 'expiresAt', 'jwt'];
  const requestedHashes = new Set();
  let lastRequest = started;
  let lastCompletion = started;
  lifecycle.buckets.forEach((bucket, index) => {
    exact(bucket, ['hashes', 'requestedAt']);
    const requested = fresh(bucket.requestedAt, current);
    requireCondition(requested >= lastRequest && requested < expiry && Array.isArray(bucket.hashes) && bucket.hashes.length > 0);
    lastRequest = requested;
    for (const label of bucket.hashes) {
      requireCondition(labels.has(label) && !requestedHashes.has(label)); requestedHashes.add(label);
    }
    const record = lifecycle.completedBuckets[index];
    requireCondition(record?.bucketIndex === index);
    const observed = completion(record, ['bucketIndex', ...completionKeys], Math.max(requested, lastCompletion));
    requireCondition(index === 0 || observed > lastCompletion);
    lastCompletion = observed;
  });
  completion(lifecycle.completion, completionKeys, lastCompletion);
}

export function assessOperatorMockUpload({ candidate, expectedInventory, expectedVersions, graph, assetsLifecycle, now }) {
  const assets = candidateAssets(candidate);
  let inventory;
  try { inventory = validateInventory(expectedInventory); } catch { fail(); }
  sameKey(candidate.key, inventory.key);
  exact(inventory.betaWorkerIds, roles);
  requireCondition(roles.every(role => betaId.test(inventory.betaWorkerIds[role])) && new Set(Object.values(inventory.betaWorkerIds)).size === 3);
  exact(inventory.cloudflare.d1Ids, ['product', 'auth']);
  requireCondition(inventory.cloudflare.d1Ids.product !== inventory.cloudflare.d1Ids.auth);
  requireCondition(typeof now === 'function');
  const current = time(now());
  observedGraph(graph, inventory, expectedVersions, current);
  lifecycleMatches(assetsLifecycle, assets, inventory, current);
  return { status: 'unsupported', blockers: [...blockers], graphMatches: true, assetPaths: assets.map(asset => asset.path), moduleSha256: candidate.module.sha256 };
}
