import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { resourceNames } from './key.mjs';
import { prepareOperatorCandidate, assessOperatorMockUpload } from './operator-candidate.mjs';

const key = { repository_id: 42, repository: 'acme/incentives', pr: 7, head_sha: 'a'.repeat(40), run_id: 99, attempt: 3 };
const now = () => '2026-10-05T09:01:00.000Z';
const startedAt = '2026-10-05T09:00:00.000Z';
const expiresAt = '2026-10-05T09:05:00.000Z';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const profile = { binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/auth/*', '/internal/*', '/operator/v1/*'] };
const blockers = ['service-binding-remapping-unresolved', 'asset-session-name-target-unproven', 'asset-upload-hash-contract-unproven', 'asset-completion-scope-unproven'];

function fixture(runKey = key, suffix = '') {
  runKey = structuredClone(runKey);
  const names = resourceNames(runKey);
  const bytes = new Map(Object.entries({
    'workers/api.mjs': Buffer.from('export default {};\n'),
    'workers/identity.mjs': Buffer.from('export default {};\n'),
    'workers/operator.mjs': Buffer.from(`export default {fetch(){return new Response("${suffix}")}};\n`),
    'assets/index.html': Buffer.from(`<!doctype html><div>${suffix}</div>\n`),
    'assets/assets/x.js': Buffer.from([0, 1, 254, 255, ...Buffer.from(suffix)]),
    'migrations/api/0001.sql': Buffer.from('create table product(id text);\n'),
    'migrations/identity/0001.sql': Buffer.from('create table auth(id text);\n'),
  }).map(([name, value]) => [`/synthetic/run-${runKey.run_id}/${name}`, value]));
  const verifiedBundle = { key: runKey, buildSha: runKey.head_sha, run: { run_id: runKey.run_id, attempt: runKey.attempt }, files: [...bytes].map(([path, value]) => ({ path, size: value.length, sha256: sha(value) })) };
  const ids = runKey.run_id === 99 ? { api: 'a'.repeat(32), identity: 'b'.repeat(32), operator: 'c'.repeat(32) } : { api: 'd'.repeat(32), identity: 'e'.repeat(32), operator: 'f'.repeat(32) };
  const d1 = runKey.run_id === 99
    ? { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' }
    : { product: '66666666-6666-4666-8666-666666666666', auth: '77777777-7777-4777-8777-777777777777' };
  const expectedInventory = { key: runKey, names, cloudflare: { accountId: 'account-1', workerIds: {}, d1Ids: d1, accessAppIds: {}, tokenId: null }, betaWorkerIds: ids, stage: 'creating', createdAt: startedAt, updatedAt: startedAt };
  const expectedVersions = runKey.run_id === 99
    ? { api: '33333333-3333-4333-8333-333333333333', identity: '44444444-4444-4444-8444-444444444444', operator: '55555555-5555-4555-8555-555555555555' }
    : { api: '88888888-8888-4888-8888-888888888888', identity: '99999999-9999-4999-8999-999999999999', operator: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const core = { name: 'CORE', type: 'service', workerId: ids.api, service: names.api, versionId: expectedVersions.api, entrypoint: 'CoreOperatorService' };
  const bindings = {
    api: [{ name: 'DB', type: 'd1', databaseId: d1.product }],
    identity: [{ name: 'AUTH_DB', type: 'd1', databaseId: d1.auth }, { ...core }],
    operator: [{ name: 'ASSETS', type: 'assets' }, { name: 'IDENTITY_AUTH', type: 'service', workerId: ids.identity, service: names.identity, versionId: expectedVersions.identity }, { name: 'IDENTITY', type: 'service', workerId: ids.identity, service: names.identity, versionId: expectedVersions.identity, entrypoint: 'IdentityOperatorService' }, { ...core }],
  };
  const graph = { key: runKey, accountId: 'account-1', observedAt: '2026-10-05T09:00:30.000Z', complete: true, workers: ['api', 'identity', 'operator'].map(role => ({ role, workerId: ids[role], name: names[role], versionId: expectedVersions[role], bindings: bindings[role] })) };
  const assets = [...bytes].filter(([path]) => path.includes('/assets/')).map(([path, value]) => ({ path: path.slice(`/synthetic/run-${runKey.run_id}/assets`.length), size: value.length, sha256: sha(value) })).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const manifestDigest = sha(JSON.stringify(assets.map(asset => [asset.path, asset.size, asset.sha256])));
  const sessionId = `synthetic-session-${runKey.run_id}`;
  const completion = { sessionId, manifestDigest, observedAt: '2026-10-05T09:00:50.000Z', expiresAt, jwt: 'opaque-synthetic-token' };
  const assetsLifecycle = { key: runKey, accountId: 'account-1', role: 'operator', workerId: ids.operator, workerName: names.operator, manifestDigest, sessionId, startedAt, expiresAt, uploadManifest: { '/assets/x.js': { hash: `fixture-js-${runKey.run_id}`, size: assets[0].size }, '/index.html': { hash: `fixture-html-${runKey.run_id}`, size: assets[1].size } }, buckets: [{ hashes: [`fixture-js-${runKey.run_id}`], requestedAt: '2026-10-05T09:00:10.000Z' }, { hashes: [`fixture-html-${runKey.run_id}`], requestedAt: '2026-10-05T09:00:30.000Z' }], completedBuckets: [{ ...completion, bucketIndex: 0, observedAt: '2026-10-05T09:00:20.000Z' }, { ...completion, bucketIndex: 1, observedAt: '2026-10-05T09:00:40.000Z' }], completion };
  const reads = [];
  const moduleBytes = bytes.get(`/synthetic/run-${runKey.run_id}/workers/operator.mjs`);
  const candidate = { key: structuredClone(runKey), module: { name: 'operator.mjs', contentType: 'application/javascript+module', contentBase64: moduleBytes.toString('base64'), size: moduleBytes.length, sha256: sha(moduleBytes) }, assets: assets.map(asset => ({ ...asset, contentBase64: bytes.get(`/synthetic/run-${runKey.run_id}/assets${asset.path}`).toString('base64') })), assetProfile: structuredClone(profile) };
  return { candidate, verifiedBundle: structuredClone(verifiedBundle), expectedKey: structuredClone(runKey), readBytes: async path => { reads.push(path); if (!bytes.has(path)) throw new Error('missing bytes'); return bytes.get(path); }, bytes, reads, expectedInventory: structuredClone(expectedInventory), expectedVersions, graph: structuredClone(graph), assetsLifecycle: structuredClone(assetsLifecycle), now };
}

async function prepared(input = fixture()) {
  return { ...input, candidate: await prepareOperatorCandidate(input) };
}

test('maps exact SPA bytes and four service edges while retaining all live blockers', async () => {
  const f = await prepared();
  assert.deepEqual(Object.keys(f.candidate).sort(), ['assetProfile', 'assets', 'key', 'module']);
  assert.equal(f.candidate.module.name, 'operator.mjs');
  assert.equal(f.candidate.module.contentType, 'application/javascript+module');
  assert.deepEqual(Buffer.from(f.candidate.module.contentBase64, 'base64'), Buffer.from('export default {fetch(){return new Response("")}};\n'));
  assert.deepEqual(f.candidate.assets.map(asset => [asset.path, Buffer.from(asset.contentBase64, 'base64')]), [['/assets/x.js', Buffer.from([0, 1, 254, 255])], ['/index.html', Buffer.from('<!doctype html><div></div>\n')]]);
  assert.deepEqual(f.candidate.assetProfile, profile);
  assert.deepEqual(f.graph.workers.flatMap(worker => worker.bindings.filter(binding => binding.type === 'service').map(binding => [worker.role, binding.name, binding.service, binding.workerId, binding.versionId, binding.entrypoint])), [
    ['identity', 'CORE', f.expectedInventory.names.api, 'a'.repeat(32), '33333333-3333-4333-8333-333333333333', 'CoreOperatorService'],
    ['operator', 'IDENTITY_AUTH', f.expectedInventory.names.identity, 'b'.repeat(32), '44444444-4444-4444-8444-444444444444', undefined],
    ['operator', 'IDENTITY', f.expectedInventory.names.identity, 'b'.repeat(32), '44444444-4444-4444-8444-444444444444', 'IdentityOperatorService'],
    ['operator', 'CORE', f.expectedInventory.names.api, 'a'.repeat(32), '33333333-3333-4333-8333-333333333333', 'CoreOperatorService'],
  ]);
  assert.deepEqual(assessOperatorMockUpload(f), { status: 'unsupported', blockers, graphMatches: true, assetPaths: ['/assets/x.js', '/index.html'], moduleSha256: sha(Buffer.from('export default {fetch(){return new Response("")}};\n')) });
  assert.deepEqual(f.reads, f.verifiedBundle.files.map(file => file.path));
  const empty = structuredClone(f.assetsLifecycle);
  empty.buckets = []; empty.completedBuckets = [];
  assert.equal(assessOperatorMockUpload({ ...f, assetsLifecycle: empty }).status, 'unsupported');
  const reordered = Object.fromEntries(Object.entries(key).reverse());
  assert.equal(assessOperatorMockUpload({ ...f, graph: { ...f.graph, key: reordered }, assetsLifecycle: { ...f.assetsLifecycle, key: reordered } }).status, 'unsupported');
});

// These mutations catch correlation omissions; none asserts provider JWT cryptography.
const graphMutations = [
  ['run', f => { f.graph.key.run_id++; }], ['account', f => { f.graph.accountId = 'other'; }],
  ['role', f => { f.graph.workers[1].role = 'staging'; }], ['ID retaining name', f => { f.graph.workers[1].workerId = 'd'.repeat(32); }],
  ['name', f => { f.graph.workers[1].name = 'manual-staging'; }], ['sibling name', f => { f.graph.workers[1].name = resourceNames({ ...key, run_id: 100 }).identity; }],
  ['version', f => { f.graph.workers[1].versionId = f.expectedVersions.api; }], ['entrypoint', f => { f.graph.workers[2].bindings[2].entrypoint = 'fetch'; }],
  ['default entrypoint present', f => { f.graph.workers[2].bindings[1].entrypoint = 'fetch'; }], ['Core edge', f => { f.graph.workers[1].bindings[1].workerId = 'd'.repeat(32); }],
  ['service version', f => { f.graph.workers[2].bindings[3].versionId = f.expectedVersions.identity; }], ['D1', f => { f.graph.workers[1].bindings[0].databaseId = f.expectedInventory.cloudflare.d1Ids.product; }],
  ['inert Identity DB', f => { f.graph.workers[1].bindings[0].name = 'DB'; }], ['extra binding', f => { f.graph.workers[0].bindings.push({ name: 'UNKNOWN', type: 'plain_text', text: 'x' }); }],
  ['environment', f => { f.graph.workers[2].bindings[3].environment = 'staging'; }], ['duplicate role', f => { f.graph.workers[2] = f.graph.workers[1]; }],
  ['missing complete', f => { delete f.graph.complete; }], ['incomplete', f => { f.graph.complete = false; }], ['missing version', f => { delete f.graph.workers[0].versionId; }],
  ['missing worker', f => { f.graph.workers.pop(); }], ['unknown pages', f => { f.graph.pages = []; }], ['incoming references', f => { f.graph.workers[0].references = { workers: [] }; }],
  ['stale', f => { f.graph.observedAt = '2026-10-05T08:55:59.000Z'; }], ['future', f => { f.graph.observedAt = '2026-10-05T09:01:01.000Z'; }],
  ['invalid date', f => { f.graph.observedAt = '2026-02-30T09:00:30.000Z'; }], ['invalid clock', f => { f.now = () => NaN; }],
  ['absent Beta IDs', f => { delete f.expectedInventory.betaWorkerIds; f.expectedInventory.cloudflare.workerIds = { api: 'a'.repeat(32), identity: 'b'.repeat(32), operator: 'c'.repeat(32) }; }],
  ['incomplete Beta IDs', f => { delete f.expectedInventory.betaWorkerIds.identity; }], ['duplicate Beta IDs', f => { f.expectedInventory.betaWorkerIds.identity = f.expectedInventory.betaWorkerIds.api; }],
  ['missing expected version', f => { delete f.expectedVersions.identity; }], ['extra expected version', f => { f.expectedVersions.staging = f.expectedVersions.api; }],
  ['invalid expected UUID', f => { f.expectedVersions.operator = 'not-a-uuid'; f.graph.workers[2].versionId = 'not-a-uuid'; }],
  ...[0, 1, 2].flatMap(index => [
    [`Worker ${index} ID`, f => { f.graph.workers[index].workerId = '0'.repeat(32); }],
    [`Worker ${index} name`, f => { f.graph.workers[index].name = 'staging'; }],
    [`Worker ${index} version`, f => { f.graph.workers[index].versionId = '66666666-6666-4666-8666-666666666666'; }],
    [`Worker ${index} environment`, f => { f.graph.workers[index].environment = 'staging'; }],
  ]),
  ...[[1, 1], [2, 1], [2, 2], [2, 3]].flatMap(([worker, binding]) => [
    [`edge ${worker}/${binding} ID`, f => { f.graph.workers[worker].bindings[binding].workerId = '0'.repeat(32); }],
    [`edge ${worker}/${binding} service`, f => { f.graph.workers[worker].bindings[binding].service = 'manual-staging'; }],
    [`edge ${worker}/${binding} version`, f => { f.graph.workers[worker].bindings[binding].versionId = '66666666-6666-4666-8666-666666666666'; }],
  ]),
];
for (const [label, mutate] of graphMutations) test(`rejects wrong or incomplete synthetic graph: ${label}`, async () => {
  const f = fixture(); mutate(f);
  assert.throws(() => assessOperatorMockUpload(f), /Operator diagnostic/);
});

const bundleMutations = [
  ['wrong key', f => { f.expectedKey = { ...key, run_id: 100 }; }], ['wrong build', f => { f.verifiedBundle.buildSha = 'b'.repeat(40); }],
  ['wrong run', f => { f.verifiedBundle.run.attempt++; }], ['boolean authority', f => { f.verifiedBundle.verified = true; }],
  ['missing index', f => { f.verifiedBundle.files = f.verifiedBundle.files.filter(file => !file.path.endsWith('/index.html')); }],
  ['missing Worker', f => { f.verifiedBundle.files.shift(); }], ['extra unlisted kind', f => { f.verifiedBundle.files.push({ path: '/synthetic/run-99/config.json', size: 0, sha256: sha('') }); }],
  ['duplicate asset', f => { f.verifiedBundle.files.push(f.verifiedBundle.files[3]); }], ['different root', f => { f.verifiedBundle.files[3].path = '/other/assets/index.html'; }],
  ['traversal', f => { f.verifiedBundle.files[3].path = '/synthetic/run-99/assets/a/../index.html'; }], ['relative path', f => { f.verifiedBundle.files[3].path = 'assets/index.html'; }],
  ['extra file field', f => { f.verifiedBundle.files[3].relativePath = 'assets/index.html'; }], ['file cap', f => { f.verifiedBundle.files[3].size = 20 * 1024 * 1024 + 1; }],
  ['migration cap', f => { f.verifiedBundle.files[5].size = 1024 * 1024 + 1; }], ['invalid hash', f => { f.verifiedBundle.files[3].sha256 = 'bad'; }],
  ['hash mismatch', f => { f.verifiedBundle.files[3].sha256 = '0'.repeat(64); }], ['length mismatch', f => { f.verifiedBundle.files[3].size++; }],
  ['changed bytes', f => { f.bytes.set(f.verifiedBundle.files[3].path, Buffer.from('tampered')); }], ['missing bytes', f => { f.bytes.delete(f.verifiedBundle.files[3].path); }],
  ['nonbuffer bytes', f => { f.readBytes = async () => 'not a Buffer'; }],
  ...['_headers', '_redirects', '.assetsignore'].map(name => [`special ${name}`, f => { f.verifiedBundle.files.push({ path: `/synthetic/run-99/assets/${name}`, size: 0, sha256: sha('') }); }]),
  ...['api', 'identity', 'operator'].map(role => [`multipart ${role}`, f => { const file = f.verifiedBundle.files.find(file => file.path.endsWith(`workers/${role}.mjs`)); const bytes = Buffer.from('------formdata-undici-123456789012\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}'); f.bytes.set(file.path, bytes); file.size = bytes.length; file.sha256 = sha(bytes); }]),
];
for (const [label, mutate] of bundleMutations) test(`rejects tampered, missing, extra or malformed bundle: ${label}`, async () => {
  const f = fixture(); mutate(f);
  await assert.rejects(() => prepareOperatorCandidate(f));
});

const lifecycleMutations = [
  ['other run', f => { f.assetsLifecycle.key.run_id++; }], ['account', f => { f.assetsLifecycle.accountId = 'other'; }], ['role', f => { f.assetsLifecycle.role = 'api'; }],
  ['Worker ID', f => { f.assetsLifecycle.workerId = 'd'.repeat(32); }], ['Worker name', f => { f.assetsLifecycle.workerName = 'manual-staging'; }],
  ['manifest', f => { f.assetsLifecycle.manifestDigest = '0'.repeat(64); }], ['session', f => { f.assetsLifecycle.completion.sessionId = 'other-session'; }],
  ['completion manifest', f => { f.assetsLifecycle.completion.manifestDigest = '0'.repeat(64); }], ['missing JWT', f => { delete f.assetsLifecycle.completion.jwt; }], ['empty JWT', f => { f.assetsLifecycle.completedBuckets[0].jwt = ''; }],
  ['future completion', f => { f.assetsLifecycle.completion.observedAt = '2026-10-05T09:01:01.000Z'; }], ['expired local context', f => { f.now = () => '2026-10-05T09:05:01.000Z'; }],
  ['expired session', f => { f.assetsLifecycle.expiresAt = '2026-10-05T09:00:59.000Z'; }], ['expired completion', f => { f.assetsLifecycle.completion.expiresAt = '2026-10-05T09:00:59.000Z'; }],
  ['future start', f => { f.assetsLifecycle.startedAt = '2026-10-05T09:01:01.000Z'; }], ['unknown field', f => { f.assetsLifecycle.versionId = f.expectedVersions.operator; }],
  ['unknown hash', f => { f.assetsLifecycle.buckets[0].hashes = ['unknown']; }], ['duplicate requested hash', f => { f.assetsLifecycle.buckets[1].hashes = f.assetsLifecycle.buckets[0].hashes; }],
  ['colliding fixture labels', f => { f.assetsLifecycle.uploadManifest['/index.html'].hash = f.assetsLifecycle.uploadManifest['/assets/x.js'].hash; }],
  ['missing bucket completion', f => { f.assetsLifecycle.completedBuckets.pop(); }], ['duplicate completion', f => { f.assetsLifecycle.completedBuckets[1] = f.assetsLifecycle.completedBuckets[0]; }],
  ['bucket before session', f => { f.assetsLifecycle.buckets[0].requestedAt = '2026-10-05T08:59:59.000Z'; }], ['completion before request', f => { f.assetsLifecycle.completedBuckets[0].observedAt = startedAt; }],
  ['completion before session', f => { f.assetsLifecycle.completion.observedAt = '2026-10-05T08:59:59.000Z'; }], ['final before buckets', f => { f.assetsLifecycle.completion.observedAt = '2026-10-05T09:00:35.000Z'; }],
  ['bucket completion other session', f => { f.assetsLifecycle.completedBuckets[1].sessionId = 'other'; }], ['bucket completion other manifest', f => { f.assetsLifecycle.completedBuckets[1].manifestDigest = '0'.repeat(64); }],
  ['missing asset', f => { delete f.assetsLifecycle.uploadManifest['/index.html']; }], ['extra asset', f => { f.assetsLifecycle.uploadManifest['/extra'] = { hash: 'extra', size: 0 }; }], ['asset length', f => { f.assetsLifecycle.uploadManifest['/index.html'].size++; }],
  ['candidate hash', f => { f.candidate.assets[0].sha256 = '0'.repeat(64); }], ['candidate bytes', f => { f.candidate.module.contentBase64 = Buffer.from('changed').toString('base64'); }],
  ['candidate missing asset', f => { f.candidate.assets.pop(); }], ['candidate extra asset', f => { f.candidate.assets.push({ path: '/extra', size: 0, sha256: sha(''), contentBase64: '' }); }],
  ['candidate PR routing', f => { f.candidate.assetProfile.run_worker_first = ['/*']; }], ['candidate extra request', f => { f.candidate.request = {}; }],
  ['candidate duplicate path', f => { f.candidate.assets.push({ ...f.candidate.assets[0] }); }],
  ['candidate missing index', f => { f.candidate.assets = [f.candidate.assets[0]]; }],
  ['candidate invalid base64', f => { f.candidate.assets[0].contentBase64 += '!'; }],
  ['candidate length', f => { f.candidate.assets[0].size++; }],
  ['candidate special file', f => { f.candidate.assets[0].path = '/_headers'; }],
  ['candidate traversal', f => { f.candidate.assets[0].path = '/a/../x.js'; }],
  ['candidate multipart', f => { const bytes = Buffer.from('------formdata-undici-123456789012\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{}'); Object.assign(f.candidate.module, { size: bytes.length, sha256: sha(bytes), contentBase64: bytes.toString('base64') }); }],
  ['candidate module field', f => { f.candidate.module.headers = {}; }],
  ['bucket completion reverse order', f => { f.assetsLifecycle.completedBuckets.reverse(); }],
  ['bucket completion same time', f => { f.assetsLifecycle.completedBuckets[1].observedAt = f.assetsLifecycle.completedBuckets[0].observedAt; }],
  ['unknown completion field', f => { f.assetsLifecycle.completion.versionId = f.expectedVersions.operator; }],
  ['blank token', f => { f.assetsLifecycle.completion.jwt = ' '; }],
  ['bucket expiry', f => { f.assetsLifecycle.completedBuckets[1].expiresAt = '2026-10-05T09:00:39.000Z'; }],
  ['missing empty-session completion', f => { f.assetsLifecycle.buckets = []; f.assetsLifecycle.completedBuckets = []; f.assetsLifecycle.completion = null; }],
];
for (const [label, mutate] of lifecycleMutations) test(`rejects wrong, expired or unbound synthetic completion: ${label}`, async () => {
  const f = fixture(); mutate(f);
  assert.throws(() => assessOperatorMockUpload(f), /Operator diagnostic/);
});

test('requires concrete bucket requests before matching bucket completions', () => {
  const f = fixture();
  f.assetsLifecycle.buckets = Array(2);
  f.assetsLifecycle.completedBuckets = Array(2);
  assert.throws(() => assessOperatorMockUpload(f), /Operator diagnostic/);
});

test('independent runs retain independent byte/graph/completion records', async () => {
  const a = await prepared(fixture(key, 'first'));
  const b = await prepared(fixture({ ...key, run_id: 100 }, 'second'));
  for (const [f, suffix] of [[a, 'first'], [b, 'second']]) {
    assert.ok(f.candidate.module, 'preparation must return module bytes');
    assert.deepEqual(Buffer.from(f.candidate.module.contentBase64, 'base64'), Buffer.from(`export default {fetch(){return new Response("${suffix}")}};\n`));
    assert.deepEqual(f.candidate.assets.map(asset => [asset.path, Buffer.from(asset.contentBase64, 'base64')]), [['/assets/x.js', Buffer.from([0, 1, 254, 255, ...Buffer.from(suffix)])], ['/index.html', Buffer.from(`<!doctype html><div>${suffix}</div>\n`)]]);
    assert.deepEqual(f.graph.workers.map(worker => [worker.role, worker.name, worker.workerId]), ['api', 'identity', 'operator'].map(role => [role, resourceNames(f.expectedKey)[role], f.expectedInventory.betaWorkerIds[role]]));
    const names = resourceNames(f.expectedKey);
    const [apiId, identityId] = suffix === 'first' ? ['a'.repeat(32), 'b'.repeat(32)] : ['d'.repeat(32), 'e'.repeat(32)];
    const [apiVersion, identityVersion] = suffix === 'first'
      ? ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']
      : ['88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999'];
    assert.deepEqual(f.graph.workers.flatMap(worker => worker.bindings.filter(binding => binding.type === 'service').map(binding => [worker.role, binding.name, binding.service, binding.workerId, binding.versionId, binding.entrypoint])), [
      ['identity', 'CORE', names.api, apiId, apiVersion, 'CoreOperatorService'],
      ['operator', 'IDENTITY_AUTH', names.identity, identityId, identityVersion, undefined],
      ['operator', 'IDENTITY', names.identity, identityId, identityVersion, 'IdentityOperatorService'],
      ['operator', 'CORE', names.api, apiId, apiVersion, 'CoreOperatorService'],
    ]);
    assert.deepEqual(assessOperatorMockUpload(f), { status: 'unsupported', blockers, graphMatches: true, assetPaths: ['/assets/x.js', '/index.html'], moduleSha256: sha(Buffer.from(`export default {fetch(){return new Response("${suffix}")}};\n`)) });
  }
  for (const field of ['candidate', 'expectedInventory', 'graph', 'assetsLifecycle']) {
    assert.throws(() => assessOperatorMockUpload({ ...a, [field]: b[field] }), /Operator diagnostic/);
    assert.throws(() => assessOperatorMockUpload({ ...b, [field]: a[field] }), /Operator diagnostic/);
  }
});

test('independent runs have exact disjoint Worker/D1 identities and version observations', async () => {
  const a = await prepared(fixture(key, 'first'));
  const b = await prepared(fixture({ ...key, run_id: 100 }, 'second'));
  assert.deepEqual(a.expectedInventory.cloudflare.d1Ids, { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' });
  assert.deepEqual(b.expectedInventory.cloudflare.d1Ids, { product: '66666666-6666-4666-8666-666666666666', auth: '77777777-7777-4777-8777-777777777777' });
  assert.deepEqual(a.graph.workers.flatMap(worker => worker.bindings.filter(binding => binding.type === 'd1').map(binding => [worker.role, binding.name, binding.databaseId])), [
    ['api', 'DB', '11111111-1111-4111-8111-111111111111'], ['identity', 'AUTH_DB', '22222222-2222-4222-8222-222222222222'],
  ]);
  assert.deepEqual(b.graph.workers.flatMap(worker => worker.bindings.filter(binding => binding.type === 'd1').map(binding => [worker.role, binding.name, binding.databaseId])), [
    ['api', 'DB', '66666666-6666-4666-8666-666666666666'], ['identity', 'AUTH_DB', '77777777-7777-4777-8777-777777777777'],
  ]);
  assert.deepEqual(a.expectedVersions, { api: '33333333-3333-4333-8333-333333333333', identity: '44444444-4444-4444-8444-444444444444', operator: '55555555-5555-4555-8555-555555555555' });
  assert.deepEqual(b.expectedVersions, { api: '88888888-8888-4888-8888-888888888888', identity: '99999999-9999-4999-8999-999999999999', operator: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.deepEqual(a.graph.workers.map(worker => [worker.role, worker.versionId]), [['api', '33333333-3333-4333-8333-333333333333'], ['identity', '44444444-4444-4444-8444-444444444444'], ['operator', '55555555-5555-4555-8555-555555555555']]);
  assert.deepEqual(b.graph.workers.map(worker => [worker.role, worker.versionId]), [['api', '88888888-8888-4888-8888-888888888888'], ['identity', '99999999-9999-4999-8999-999999999999'], ['operator', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']]);
  for (const [left, right] of [[a.expectedInventory.betaWorkerIds, b.expectedInventory.betaWorkerIds], [a.expectedInventory.cloudflare.d1Ids, b.expectedInventory.cloudflare.d1Ids], [a.expectedVersions, b.expectedVersions]]) {
    assert.deepEqual(Object.values(left).filter(id => Object.values(right).includes(id)), []);
  }
});

for (const recipientRun of [99, 100]) {
  for (const [role, workerIndex] of [['product', 0], ['auth', 1]]) for (const kind of ['inventory ID', 'graph ID', 'graph association']) {
    test(`run ${recipientRun} rejects foreign ${role} ${kind} while retaining its key and graph identity`, () => {
      const recipient = fixture({ ...key, run_id: recipientRun });
      const donor = fixture({ ...key, run_id: recipientRun === 99 ? 100 : 99 });
      const before = structuredClone({ candidate: recipient.candidate, expectedInventory: recipient.expectedInventory, graph: recipient.graph });
      if (kind === 'inventory ID') recipient.expectedInventory.cloudflare.d1Ids[role] = donor.expectedInventory.cloudflare.d1Ids[role];
      else if (kind === 'graph ID') recipient.graph.workers[workerIndex].bindings[0].databaseId = donor.graph.workers[workerIndex].bindings[0].databaseId;
      else recipient.graph.workers[workerIndex].bindings[0] = structuredClone(donor.graph.workers[workerIndex].bindings[0]);
      assert.deepEqual(recipient.candidate.key, before.candidate.key);
      assert.deepEqual(recipient.expectedInventory.key, before.expectedInventory.key);
      assert.deepEqual(recipient.graph.key, before.graph.key);
      assert.deepEqual(recipient.graph.workers.map(({ bindings: _bindings, ...identity }) => identity), before.graph.workers.map(({ bindings: _bindings, ...identity }) => identity));
      assert.throws(() => assessOperatorMockUpload(recipient), /Operator diagnostic/);
    });
  }
  test(`run ${recipientRun} rejects the other run's expected version map while retaining its key and observations`, () => {
    const recipient = fixture({ ...key, run_id: recipientRun });
    const donor = fixture({ ...key, run_id: recipientRun === 99 ? 100 : 99 });
    const before = structuredClone(recipient.graph);
    recipient.expectedVersions = structuredClone(donor.expectedVersions);
    assert.deepEqual(recipient.graph, before);
    assert.throws(() => assessOperatorMockUpload(recipient), /Operator diagnostic/);
  });
}
