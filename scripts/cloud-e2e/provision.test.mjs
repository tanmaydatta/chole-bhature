import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resourceNames } from './key.mjs';
import { provisionMockStack } from './provision.mjs';
import { teardownMockStack } from './teardown.mjs';

const ownTests = process.argv[1]?.endsWith('/provision.test.mjs') ? test : () => {};

export const key = { repository_id: 42, repository: 'acme/incentives', pr: 7, head_sha: 'a'.repeat(40), run_id: 99, attempt: 3 };
export const names = resourceNames(key);
const files = {
  'workers/api.mjs': 'export default {};\n',
  'workers/identity.mjs': 'export default {};\n',
  'workers/operator.mjs': 'export default {};\n',
  'assets/index.html': '<!doctype html>\n',
  'migrations/api/0001.sql': 'create table product (id text);\n',
  'migrations/identity/0001.sql': 'create table auth (id text);\n',
};

function header(name, size) {
  const bytes = Buffer.alloc(512);
  Buffer.from(name).copy(bytes, 0);
  Buffer.from('0000644\0').copy(bytes, 100);
  Buffer.from('0000000\0').copy(bytes, 108);
  Buffer.from('0000000\0').copy(bytes, 116);
  Buffer.from(size.toString(8).padStart(11, '0') + '\0').copy(bytes, 124);
  Buffer.from('00000000000\0').copy(bytes, 136);
  bytes.fill(0x20, 148, 156);
  bytes[156] = 48;
  Buffer.from('ustar\0').copy(bytes, 257);
  Buffer.from('00').copy(bytes, 263);
  const sum = bytes.reduce((total, byte) => total + byte, 0);
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ').copy(bytes, 148);
  return bytes;
}

export async function fixture(t, runKey = key) {
  const root = await mkdtemp(path.join(tmpdir(), 'cloud-e2e-controller-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'bundle.tar');
  const manifest = { schema: 1, key: runKey, build_sha: runKey.head_sha, run: { run_id: runKey.run_id, attempt: runKey.attempt }, files: Object.entries(files).map(([filePath, value]) => ({ path: filePath, size: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') })) };
  const entries = [['manifest.json', JSON.stringify(manifest)], ...Object.entries(files)];
  const blocks = [];
  for (const [name, value] of entries) {
    const bytes = Buffer.from(value);
    blocks.push(header(name, bytes.length), bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  await writeFile(archive, Buffer.concat(blocks));
  return { archive, destination: path.join(root, 'verified') };
}

ownTests('verified bundle precedes durable D1 create intent and ambiguous create is not retried', async t => {
  const input = await fixture(t);
  const calls = [];
  const store = { async put(value) { calls.push(['put', value.type ?? value.stage]); } };
  const provider = { async request(request) { calls.push([request.method, request.path]); if (request.method === 'GET' && request.path.endsWith('/d1/database')) return { status: 200, success: true, result: [], result_info: { total_count: 0 } }; throw new Error('unexpected provider call'); }, async observe() { throw new Error('unexpected mock observation'); } };
  const result = await provisionMockStack({ key, accountId: 'account-1', ...input, store, provider, now: () => '2026-10-01T09:00:00.000Z' });
  assert.equal(result.status, 'quarantined');
  assert.deepEqual(calls[0], ['put', 'creating'], JSON.stringify(result));
  assert.deepEqual(calls[1], ['GET', '/accounts/account-1/d1/database']);
  assert.deepEqual(calls[2], ['put', 'create-intent']);
  assert.equal(calls.filter(call => call[0] === 'POST').length, 1);
});

const d1Ids = { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' };
const workerIds = { api: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', identity: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', operator: 'cccccccccccccccccccccccccccccccc' };

export function mockBoundary({ runKey = key, failMigration = false, failDelete = false, changeReadback = false, badAccessReadback = false, waitOn = null, transientRead = null, transientD1Read = null, staleKind = null, failCheckpoint = null, changeD1OnDelete = false } = {}) {
  const runNames = resourceNames(runKey);
  const runD1Ids = runKey === key ? d1Ids : { product: '33333333-3333-4333-8333-333333333333', auth: '44444444-4444-4444-8444-444444444444' };
  const runWorkerIds = runKey === key ? workerIds : { api: 'dddddddddddddddddddddddddddddddd', identity: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', operator: 'ffffffffffffffffffffffffffffffff' };
  const calls = [];
  const values = new Map();
  const databases = new Map();
  const workers = new Map();
  const apps = new Map();
  let token;
  let ms = Date.parse('2026-10-01T09:00:00.000Z');
  const now = () => new Date(ms).toISOString();
  const result = value => ({ status: 200, success: true, result: value, ...(Array.isArray(value) ? { result_info: { total_count: value.length } } : {}) });
  const store = { async put(value) { calls.push(['put', value.type ?? value.stage]); if (waitOn && value.type === waitOn.type) await waitOn.promise; if (failCheckpoint && value.betaWorkerIds?.[failCheckpoint]) throw new Error('checkpoint failed with secret'); values.set(JSON.stringify(value.key ?? runKey), value); } };
  const provider = {
    async request(request) {
      calls.push([request.method, request.path]);
      const root = '/accounts/account-1/d1/database';
      if (request.method === 'GET' && transientD1Read && transientD1Read.remaining-- > 0) return { status: transientD1Read.status ?? 503 };
      if (request.path === root && request.method === 'GET') return result([...databases.values()]);
      if (request.path === root && request.method === 'POST') {
        const role = request.body.name === runNames.product ? 'product' : request.body.name === runNames.auth ? 'auth' : null;
        if (!role) throw new Error('unexpected D1 name');
        const value = { name: request.body.name, uuid: runD1Ids[role] };
        databases.set(value.uuid, value);
        return result(value);
      }
      const id = request.path.startsWith(`${root}/`) ? request.path.slice(root.length + 1).split('/')[0] : null;
      if (!id) throw new Error('unexpected D1 request');
      if (request.method === 'GET') return databases.has(id) ? result({ ...databases.get(id), ...(changeD1OnDelete && failMigration ? { name: 'manual-staging-auth' } : {}) }) : { status: 404 };
      if (request.method === 'DELETE') { if (failDelete) throw new Error('delete failed with sensitive text'); databases.delete(id); return result({ id }); }
      if (request.method === 'POST' && request.path.endsWith('/query')) return result([{ success: !failMigration }]);
      throw new Error('unexpected D1 method');
    },
    async observe({ kind, role, key: run, request }) {
      calls.push([kind, role, request.method, request.path, request.body]);
      if (waitOn && kind === waitOn.kind) await waitOn.promise;
      if (transientRead && kind === transientRead.kind && transientRead.remaining-- > 0) throw { status: transientRead.status ?? 503 };
      ms += 1000;
      const pathRoot = '/accounts/account-1';
      let value;
      if (kind.endsWith('precreate-list') || kind === 'beta-version-list') value = [];
      else if (kind === 'beta-worker-create-result') {
        value = { id: runWorkerIds[role], name: runNames[role], routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null, bindings: role === 'operator' ? [] : [{ name: 'DB', type: 'd1', database_id: runD1Ids[role === 'api' ? 'product' : 'auth'] }] };
        workers.set(role, value);
      } else if (kind === 'beta-worker-readback') value = { ...workers.get(role), ...(changeReadback && role === 'api' && request.path.endsWith(runWorkerIds.api) ? { name: 'manual-staging' } : {}) };
      else if (kind === 'beta-token-create-result') { token = { id: `token-${runKey.run_id}`, name: runNames.token }; value = token; }
      else if (kind === 'beta-token-readback') value = token;
      else if (kind === 'beta-access-create-result') { value = { id: `app-${role}-${runKey.run_id}`, ...request.body }; apps.set(role, value); }
      else if (kind === 'beta-access-readback') value = badAccessReadback && role === 'api' ? { ...apps.get(role), policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'other-run-token' } }] }] } : apps.get(role);
      else if (kind === 'beta-access-attachment') value = { id: `app-${role}-${runKey.run_id}`, worker_id: runWorkerIds[role], token_id: token.id };
      else throw new Error(`unexpected ${kind}`);
      if (!request.path.startsWith(pathRoot)) throw new Error('unexpected account path');
      return { kind, run, role, observedAt: kind === staleKind ? '2026-10-01T08:00:00.000Z' : now(), request: { method: request.method, path: request.path }, response: { success: true, result: value } };
    },
  };
  return { calls, store, provider, now, databases, values };
}

ownTests('failed D1 migration cleans only its exact observed databases in reverse order', async t => {
  const input = await fixture(t);
  const mock = mockBoundary({ failMigration: true });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'quarantined');
  assert.equal(outcome.cleanup.status, 'local-cleanup-observed');
  assert.deepEqual(outcome.cleanup.removed, ['d1:auth', 'd1:product']);
  assert.deepEqual(outcome.cleanup.remaining, []);
  assert.deepEqual(mock.calls.filter(call => call[0] === 'DELETE').map(call => call[1]), [
    '/accounts/account-1/d1/database/22222222-2222-4222-8222-222222222222',
    '/accounts/account-1/d1/database/11111111-1111-4111-8111-111111111111',
  ]);
  assert.equal(mock.calls.some(call => call[0] === 'beta-worker-precreate-list'), false);
});

ownTests('failed Auth pre-create discovery or intent leaves Product independently cleanable', async t => {
  for (const failure of ['discovery', 'intent']) {
    const input = await fixture(t);
    const mock = mockBoundary();
    let authReads = 0;
    const request = mock.provider.request;
    mock.provider.request = async operation => {
      if (failure === 'discovery' && operation.method === 'GET' && operation.path === '/accounts/account-1/d1/database' && mock.databases.has('11111111-1111-4111-8111-111111111111')) {
        authReads += 1;
        mock.calls.push(['GET', operation.path]);
        return { status: 503 };
      }
      return request(operation);
    };
    if (failure === 'intent') {
      const put = mock.store.put;
      mock.store.put = async value => {
        if (value.type === 'create-intent' && value.kind === 'd1:auth') throw new Error('Auth intent store unavailable');
        return put(value);
      };
    }
    const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
    assert.equal(outcome.status, 'quarantined');
    assert.equal(outcome.cleanup.status, 'local-cleanup-observed');
    assert.deepEqual(outcome.cleanup.removed, ['d1:product']);
    assert.deepEqual(outcome.cleanup.remaining, []);
    assert.equal(authReads, failure === 'discovery' ? 3 : 0);
    assert.deepEqual(mock.calls.filter(call => call[0] === 'POST' && call[1] === '/accounts/account-1/d1/database').map(call => call[1]), ['/accounts/account-1/d1/database']);
    const productPath = '/accounts/account-1/d1/database/11111111-1111-4111-8111-111111111111';
    const deletion = mock.calls.findIndex(call => call[0] === 'DELETE');
    assert.deepEqual(mock.calls.slice(deletion - 1, deletion + 2), [['GET', productPath], ['DELETE', productPath], ['GET', productPath]]);
    assert.equal(mock.databases.has('11111111-1111-4111-8111-111111111111'), false);
    assert.equal(mock.calls.some(call => call[0] === 'beta-worker-precreate-list'), false);
  }
});

ownTests('ambiguous Auth create retains only that unknown target while cleaning proven Product', async t => {
  const input = await fixture(t);
  const mock = mockBoundary();
  const request = mock.provider.request;
  mock.provider.request = async operation => {
    if (operation.method === 'POST' && operation.path === '/accounts/account-1/d1/database' && operation.body?.name === names.auth) {
      mock.calls.push(['POST', operation.path]);
      throw new Error('Auth create response lost');
    }
    return request(operation);
  };
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'quarantined');
  assert.equal(outcome.cleanup.status, 'unsupported');
  assert.equal(outcome.cleanup.reason, 'ambiguous-d1-create');
  assert.deepEqual(outcome.cleanup.removed, ['d1:product']);
  assert.deepEqual(outcome.cleanup.remaining, ['ambiguous:d1:auth']);
  assert.equal(mock.calls.filter(call => call[0] === 'POST' && call[1] === '/accounts/account-1/d1/database').length, 2);
  assert.deepEqual(mock.calls.filter(call => call[0] === 'DELETE'), [['DELETE', '/accounts/account-1/d1/database/11111111-1111-4111-8111-111111111111']]);
  assert.equal(mock.databases.has('11111111-1111-4111-8111-111111111111'), false);
  assert.equal(mock.calls.some(call => call[0] === 'beta-worker-precreate-list'), false);
});

ownTests('real protocol progresses through exact Worker and Access gates, then stops at Operator unsupported', async t => {
  const input = await fixture(t);
  const mock = mockBoundary();
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.deepEqual([outcome.status, outcome.reason, outcome.apiVersionPlanned], ['unsupported', 'service-binding-remapping-unresolved', true]);
  assert.equal(outcome.cleanup.status, 'unsupported');
  assert.deepEqual(outcome.cleanup.remaining, ['beta-worker:api', 'beta-worker:identity', 'beta-worker:operator', 'access-app:api', 'access-app:operator', 'service-token', 'd1:product', 'd1:auth']);
  const order = mock.calls.map(call => call[0]);
  assert.ok(order.indexOf('beta-worker-precreate-list') > order.lastIndexOf('POST'));
  assert.deepEqual(mock.calls.filter(call => call[0] === 'beta-worker-create-result').map(call => call[4]), [
    { name: names.api, subdomain: { enabled: false, previews_enabled: false } },
    { name: names.identity, subdomain: { enabled: false, previews_enabled: false } },
    { name: names.operator, subdomain: { enabled: false, previews_enabled: false } },
  ]);
  assert.ok(order.indexOf('beta-token-precreate-list') > mock.calls.findLastIndex(call => call[0] === 'beta-worker-readback' && call[1] === 'operator'));
  assert.ok(order.indexOf('beta-access-attachment') > order.lastIndexOf('beta-access-create-result'));
  assert.deepEqual(mock.calls.filter(call => call[0] === 'beta-access-create-result').map(call => call[4]), [
    { name: names.accessApi, destinations: [{ type: 'worker', worker_id: workerIds.api, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-99' } }] }] },
    { name: names.accessOperator, destinations: [{ type: 'worker', worker_id: workerIds.operator, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-99' } }] }] },
  ]);
  assert.equal(mock.calls.some(call => call[0] === 'beta-version-create-result'), false);
  assert.deepEqual(mock.calls.filter(call => call[0] === 'beta-access-attachment').map(call => call[1]), ['api', 'operator']);
  assert.deepEqual(mock.calls.filter(call => call[0] === 'beta-access-readback').map(call => call[1]), ['api', 'operator', 'api', 'operator']);
  assertNoCodeOrAssetsTransport(mock.calls);
  assert.equal(mock.calls.some(call => call[0] === 'DELETE'), false);
});

function assertNoCodeOrAssetsTransport(calls) {
  const forbidden = calls.filter(call => {
    const method = ['GET', 'POST', 'DELETE'].includes(call[0]) ? call[0] : call[2];
    const target = ['GET', 'POST', 'DELETE'].includes(call[0]) ? call[1] : call[3];
    return /(?:version.*(?:create|upload)|asset.*(?:session|upload))/u.test(call[0])
      || typeof target === 'string' && (/assets(?:-upload-session|\/upload)/u.test(target) || method === 'POST' && target.includes('/versions'));
  });
  assert.deepEqual(forbidden, []);
}

ownTests('either failed Access identity or final policy gate stops before Worker code or asset transport', async t => {
  for (const role of ['api', 'operator']) for (const occurrence of [1, 2]) {
    const input = await fixture(t);
    const mock = mockBoundary();
    const observe = mock.provider.observe;
    let seen = 0;
    mock.provider.observe = async operation => {
      const envelope = await observe(operation);
      if (operation.kind === 'beta-access-readback' && operation.role === role && ++seen === occurrence) {
        envelope.response.result.policies = [{ decision: 'non_identity', include: [{ service_token: { token_id: 'other-run-token' } }] }];
      }
      return envelope;
    };
    const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
    assert.equal(outcome.status, 'quarantined');
    assert.equal(outcome.apiVersionPlanned, undefined);
    assert.equal(mock.calls.filter(call => call[0] === 'beta-access-attachment').length, occurrence === 1 ? 0 : 2);
    assert.equal(mock.calls.filter(call => call[0] === 'beta-version-list').length, occurrence === 1 ? 0 : 1);
    assertNoCodeOrAssetsTransport(mock.calls);
  }
});

ownTests('changed immutable Worker readback quarantines and leaves unresolved resource in inventory', async t => {
  const input = await fixture(t);
  const mock = mockBoundary({ changeReadback: true });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'quarantined');
  assert.equal(outcome.cleanup.status, 'unsupported');
  assert.ok(outcome.cleanup.remaining.includes('ambiguous:beta-worker:api'));
  assert.deepEqual(mock.calls.filter(call => call[0] === 'DELETE'), []);
  assert.equal(mock.calls.filter(call => call[0] === 'beta-worker-create-result').length, 1);
});

ownTests('wrong inert D1 or service associations stop before credentials, code or bootstrap progression', async t => {
  for (const [role, bindings] of [
    ['api', [{ name: 'DB', type: 'd1', database_id: d1Ids.auth }]],
    ['identity', [{ name: 'DB', type: 'd1', database_id: d1Ids.product }]],
    ['identity', [{ name: 'DB', type: 'd1', database_id: '77777777-7777-4777-8777-777777777777' }]],
    ['identity', [{ name: 'DB', type: 'd1', database_id: d1Ids.auth }, { name: 'CORE', type: 'service', service: 'incentives-api-staging' }]],
    ['operator', [{ name: 'IDENTITY', type: 'service', service: 'foreign-identity' }]],
  ]) {
    const input = await fixture(t); const mock = mockBoundary(); const observe = mock.provider.observe;
    mock.provider.observe = async request => {
      const response = await observe(request);
      if (request.role === role && ['beta-worker-create-result', 'beta-worker-readback'].includes(request.kind)) response.response.result.bindings = bindings;
      return response;
    };
    const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
    assert.equal(outcome.status, 'quarantined');
    assert.equal(mock.calls.some(call => call[0] === 'beta-token-create-result'), false);
    assert.equal(mock.calls.some(call => call[0] === 'beta-access-attachment'), false);
    assertNoCodeOrAssetsTransport(mock.calls);
    assert.equal(mock.calls.some(call => call[0] === 'DELETE'), false);
    assert.equal(outcome.cleanup.status, 'unsupported');
    assert.equal(JSON.stringify([...mock.values.values()]).includes('activationGrant'), false);
  }
});

ownTests('changed Access token policy blocks attachment and code plan without deleting the Worker graph', async t => {
  const input = await fixture(t);
  const mock = mockBoundary({ badAccessReadback: true });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'quarantined');
  assert.equal(outcome.cleanup.status, 'unsupported');
  assert.equal(mock.calls.some(call => call[0] === 'beta-access-attachment'), false);
  assertNoCodeOrAssetsTransport(mock.calls);
  assert.equal(mock.calls.some(call => call[0] === 'DELETE'), false);
});

ownTests('failed Worker ID checkpoint and stale discovery stop without retry or dependent deletion', async t => {
  for (const options of [{ failCheckpoint: 'api' }, { staleKind: 'beta-worker-precreate-list' }]) {
    const input = await fixture(t);
    const mock = mockBoundary(options);
    const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
    assert.equal(outcome.status, 'quarantined');
    assert.equal(mock.calls.filter(call => call[0] === 'beta-worker-create-result').length, options.failCheckpoint ? 1 : 0);
    assert.equal(mock.calls.some(call => call[0] === 'DELETE'), !options.failCheckpoint);
    if (options.failCheckpoint) assert.ok(outcome.cleanup.remaining.includes('ambiguous:beta-worker:api'));
  }
});

ownTests('same-run overlap and replay cannot duplicate creates while another run progresses on the same store', async t => {
  const input = await fixture(t);
  let release;
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const first = mockBoundary();
  const originalPut = first.store.put;
  first.store.put = async value => { if (value.type === 'create-intent' && value.kind === 'd1:product' && value.key.run_id === key.run_id) { entered(); await barrier; } await originalPut(value); };
  const pending = provisionMockStack({ key, accountId: 'account-1', ...input, ...first });
  await enteredPromise;
  assert.deepEqual(await teardownMockStack({ key, accountId: 'account-1', store: first.store }), { status: 'refused', reason: 'run-in-progress' });
  const replayInput = await fixture(t);
  const overlap = await provisionMockStack({ key: { attempt: key.attempt, run_id: key.run_id, head_sha: key.head_sha, pr: key.pr, repository: key.repository, repository_id: key.repository_id }, accountId: 'account-1', ...replayInput, ...first });
  assert.equal(overlap.status, 'quarantined');
  const secondKey = { ...key, run_id: key.run_id + 1 };
  const secondInput = await fixture(t, secondKey);
  const other = mockBoundary({ runKey: secondKey });
  other.store = first.store;
  const distinct = await provisionMockStack({ key: secondKey, accountId: 'account-1', ...secondInput, ...other });
  assert.equal(distinct.status, 'unsupported');
  assert.equal(other.calls.filter(call => call[0] === 'beta-worker-create-result').length, 3);
  assert.deepEqual(other.calls.filter(call => call[0] === 'beta-worker-create-result').map(call => call[4].name), [resourceNames(secondKey).api, resourceNames(secondKey).identity, resourceNames(secondKey).operator]);
  release();
  const initial = await pending;
  assert.equal(initial.status, 'unsupported');
  assert.equal(first.calls.filter(call => call[0] === 'beta-worker-create-result').length, 3);
  assert.equal((await provisionMockStack({ key, accountId: 'account-1', ...replayInput, ...first })).status, 'quarantined');
});

ownTests('safe transient reads retry twice, while a third failure stops before create', async t => {
  const input = await fixture(t);
  const waits = [];
  const mock = mockBoundary({ transientRead: { kind: 'beta-worker-precreate-list', remaining: 2 } });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock, wait: async ms => { waits.push(ms); } });
  assert.equal(outcome.status, 'unsupported');
  assert.deepEqual(waits, [100, 200]);
  const failedInput = await fixture(t);
  const failedMock = mockBoundary({ transientRead: { kind: 'beta-worker-precreate-list', remaining: 3 } });
  const stopped = await provisionMockStack({ key, accountId: 'account-1', ...failedInput, ...failedMock });
  assert.equal(stopped.status, 'quarantined');
  assert.equal(failedMock.calls.filter(call => call[0] === 'beta-worker-precreate-list').length, 3);
  assert.equal(failedMock.calls.some(call => call[0] === 'beta-worker-create-result'), false);
  const badInput = await fixture(t);
  const bad = mockBoundary({ transientRead: { kind: 'beta-worker-precreate-list', remaining: 3, status: 400 } });
  assert.equal((await provisionMockStack({ key, accountId: 'account-1', ...badInput, ...bad })).status, 'quarantined');
  assert.equal(bad.calls.filter(call => call[0] === 'beta-worker-precreate-list').length, 1);
  const d1Input = await fixture(t);
  const d1Waits = [];
  const d1 = mockBoundary({ transientD1Read: { remaining: 2 } });
  assert.equal((await provisionMockStack({ key, accountId: 'account-1', ...d1Input, ...d1, wait: async ms => { d1Waits.push(ms); } })).status, 'unsupported');
  assert.deepEqual(d1Waits, [100, 200]);
});

ownTests('invalid bundle, staging account, and stage deadline refuse before Worker planning', async t => {
  const forged = mockBoundary();
  const bare = await provisionMockStack({ key, accountId: 'account-1', verified: { key, files: [] }, destination: '/tmp/forged-cloud-e2e', ...forged });
  assert.equal(bare.status, 'quarantined');
  assert.deepEqual(forged.calls, []);
  const otherInput = await fixture(t, { ...key, head_sha: 'b'.repeat(40) });
  const wrong = mockBoundary();
  const rejected = await provisionMockStack({ key, accountId: 'account-1', ...otherInput, ...wrong });
  assert.deepEqual(wrong.calls, []);
  assert.equal(rejected.reason, 'bundle-rejected');
  const stagingInput = await fixture(t);
  const staging = mockBoundary();
  const denied = await provisionMockStack({ key, accountId: 'manual-staging', ...stagingInput, ...staging });
  assert.equal(denied.status, 'quarantined');
  assert.deepEqual(staging.calls, []);
  const timeoutInput = await fixture(t);
  const timed = mockBoundary();
  const start = timed.now();
  const late = await provisionMockStack({ key, accountId: 'account-1', ...timeoutInput, ...timed, now: (() => { let count = 0; return () => count++ < 2 ? start : '2026-10-01T09:25:00.001Z'; })() });
  assert.equal(late.reason, 'deadline-exceeded');
  assert.equal(timed.calls.some(call => call[0] === 'beta-worker-create-result'), false);
});
