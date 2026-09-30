import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloudflareClient, MutationQuarantinedError } from './cloudflare.mjs';
import { resourceNames } from './key.mjs';

const key = { repository_id: 987654321, repository: 'trusted-owner/incentives-platform', pr: 42, head_sha: 'a'.repeat(40), run_id: 123456789, attempt: 2 };
const names = resourceNames(key);
const inventory = {
  key,
  names,
  cloudflare: { accountId: 'account-1', workerIds: { api: 'worker-tag-1' }, d1Ids: { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' }, accessAppIds: { api: 'access-app-1' }, tokenId: 'token-1' },
  stage: 'active', createdAt: '2026-09-30T10:00:00.000Z', updatedAt: '2026-09-30T10:00:00.000Z',
};

function mockTransport(responses) {
  const calls = [];
  return { calls, async request(request) { calls.push(request); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) return next; return { status: 200, success: true, ...(Array.isArray(next.result) ? { result_info: { total_count: next.result.length } } : {}), ...next }; } };
}

test('checkpoints durable intent before create and returned D1 UUID immediately after response', async () => {
  const transport = mockTransport([{ result: [] }, { result: { uuid: '33333333-3333-4333-8333-333333333333', name: inventory.names.product } }]);
  const checkpoints = [];
  const creating = { ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: { auth: inventory.cloudflare.d1Ids.auth } } };
  const client = createCloudflareClient({ accountId: 'account-1', inventory: creating, transport, store: { async put(value, options) { checkpoints.push({ value, options }); } }, now: () => '2026-09-30T10:02:00.000Z' });
  await client.createD1('product');
  assert.deepEqual(transport.calls.map(call => `${call.method} ${call.path}`), [
    'GET /accounts/account-1/d1/database', 'POST /accounts/account-1/d1/database',
  ]);
  assert.deepEqual(checkpoints.map(entry => entry.value.kind ?? entry.value.cloudflare.d1Ids.product), ['d1:product', '33333333-3333-4333-8333-333333333333']);
  assert.equal(checkpoints.every(entry => entry.options.retentionDays === 7), true);
});

test('reports Worker creation unavailable until an immutable-ID write mechanism is proven', async () => {
  const withoutApiWorker = { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: {} } };
  const transport = mockTransport([]);
  const checkpoints = [];
  const client = createCloudflareClient({
    accountId: 'account-1', inventory: withoutApiWorker, transport,
    store: { async put(value) { checkpoints.push(value); } },
    workerUpload: ({ name }) => ({ protected: true, name }), now: () => '2026-09-30T10:03:00.000Z',
  });
  assert.deepEqual(await client.createWorker('api'), { status: 'unsupported', reason: 'immutable-worker-mutation-unproven' });
  assert.equal(transport.calls.length, 0);
});

test('never deletes a target whose exact ID or current binding graph changed after an earlier read', async () => {
  const transport = mockTransport([
    { result: [{ id: inventory.names.api, tag: 'worker-tag-changed' }] },
    { result: { bindings: [{ type: 'd1', name: 'DB', id: inventory.cloudflare.d1Ids.product }] } },
  ]);
  const alerts = [];
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
  assert.deepEqual(await client.deleteWorker('api'), { status: 'unsupported', reason: 'immutable-worker-mutation-unproven' });
  assert.deepEqual(transport.calls.map(call => call.method), []);
  assert.equal(alerts.length, 1);
});

test('missing targets are idempotent but forbidden/errors are not swallowed', async () => {
  const missing = mockTransport([{ status: 404, result: null }]);
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport: missing });
  assert.deepEqual(await client.deleteD1('product'), { status: 'missing' });
  assert.deepEqual(missing.calls.map(call => call.method), ['GET']);
  const forbidden = mockTransport([new Error('403 forbidden')]);
  const forbiddenClient = createCloudflareClient({ accountId: 'account-1', inventory, transport: forbidden });
  await assert.rejects(forbiddenClient.deleteD1('product'), /403 forbidden/u);
});

test('uses fixed ledger paths and rejects untrusted account, kind, or arbitrary request bodies', async () => {
  assert.throws(() => createCloudflareClient({ accountId: 'other', inventory, transport: mockTransport([]) }), MutationQuarantinedError);
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport: mockTransport([]) });
  await assert.rejects(client.deleteWorker('demo'), MutationQuarantinedError);
  assert.throws(() => client.request({ method: 'DELETE', path: '/accounts/account-1/anything' }), /not a function/u);
});

test('refuses every name-addressed Worker mutation with an alert and zero transport calls', async () => {
  const transport = mockTransport([]); const alerts = [];
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
  for (const operation of [() => client.createWorker('api'), () => client.updateWorker('api'), () => client.deleteWorker('api'), () => client.setWorkerSubdomain('api', true)]) {
    assert.deepEqual(await operation(), { status: 'unsupported', reason: 'immutable-worker-mutation-unproven' });
  }
  assert.equal(transport.calls.length, 0); assert.equal(alerts.length, 4);
});

test('quarantines malformed success envelopes, repeated recorded creates, and failed durable checkpoints', async () => {
  const alerts = [];
  const malformed = createCloudflareClient({ accountId: 'account-1', inventory: { ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: {} } }, transport: mockTransport([{ status: 200, success: false, result: [] }]), store: { async put() {} }, alert: value => alerts.push(value) });
  await assert.rejects(malformed.createD1('product'));
  assert.equal(alerts.length, 1);
  const repeatedTransport = mockTransport([]);
  const repeated = createCloudflareClient({ accountId: 'account-1', inventory, transport: repeatedTransport, store: { async put() {} } });
  await assert.rejects(repeated.createD1('product'));
  assert.equal(repeatedTransport.calls.length, 0);
  const failedStoreTransport = mockTransport([{ status: 200, success: true, result: [], result_info: { total_count: 0 } }, { status: 200, success: true, result: { uuid: '33333333-3333-4333-8333-333333333333', name: names.product } }]);
  const failedStore = createCloudflareClient({ accountId: 'account-1', inventory: { ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: {} } }, transport: failedStoreTransport, store: { async put() { throw new Error('store down'); } }, alert: value => alerts.push(value) });
  await assert.rejects(failedStore.createD1('product'));
  await assert.rejects(failedStore.deleteD1('product'));
});

test('rejects an Access app with a wrong Worker destination or policy graph before delete', async () => {
  const transport = mockTransport([{ result: [{ id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: 'replaced-worker-tag', overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] }] }]);
  const alerts = [];
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
  await assert.rejects(client.deleteAccessApp('api'), MutationQuarantinedError);
  assert.deepEqual(transport.calls.map(call => call.method), ['GET']);
  assert.equal(alerts.length, 1);
});

test('rejects Access require, exclude, and unrecognized policy fields before delete', async () => {
  for (const policy of [
    { decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }], require: [{ email: { email: 'x@example.test' } }] },
    { decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }], exclude: [{ everyone: {} }] },
    { decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }], approval_required: false },
  ]) {
    const transport = mockTransport([{ result: [{ id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: 'worker-tag-1', overrides: [] }], policies: [policy] }] }]);
    const alerts = [];
    const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
    await assert.rejects(client.deleteAccessApp('api'), MutationQuarantinedError);
    assert.deepEqual(transport.calls.map(call => call.method), ['GET']);
    assert.equal(alerts.length, 1);
  }
});

test('rejects empty and duplicate Worker list IDs/tags plus unsupported settings with alerts', async () => {
  for (const list of [
    [{ id: '', tag: 'worker-tag-1' }],
    [{ id: names.api, tag: '' }],
    [{ id: names.api, tag: 'worker-tag-1' }, { id: names.identity, tag: 'identity-a' }, { id: names.identity, tag: 'identity-b' }],
  ]) {
    const transport = mockTransport([{ result: list }]); const alerts = [];
    const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
    await assert.rejects(client.getWorker('api'), MutationQuarantinedError); assert.equal(alerts.length, 1);
  }
  const transport = mockTransport([{ result: [{ id: names.api, tag: 'worker-tag-1' }] }, { result: { bindings: [{ type: 'plain_text', name: 'UNPROVEN' }] } }]);
  const alerts = []; const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
  await assert.rejects(client.getWorker('api'), MutationQuarantinedError); assert.equal(alerts.length, 1);
});

test('rejects undefined operation results and poisons after Access inventory checkpoint failure', async () => {
  const deleteTransport = mockTransport([{ result: { uuid: inventory.cloudflare.d1Ids.product, name: names.product } }, { result: undefined }]); const deleteAlerts = [];
  const deleteClient = createCloudflareClient({ accountId: 'account-1', inventory, transport: deleteTransport, alert: value => deleteAlerts.push(value) });
  await assert.rejects(deleteClient.deleteD1('product'), MutationQuarantinedError); assert.equal(deleteAlerts.length, 1);
  const writes = []; const transport = mockTransport([{ result: [] }, { result: { id: 'access-created', name: names.accessApi } }]);
  const client = createCloudflareClient({ accountId: 'account-1', inventory: { ...inventory, cloudflare: { ...inventory.cloudflare, accessAppIds: {} } }, transport, store: { async put(value) { writes.push(value); if (writes.length === 2) throw new Error('inventory checkpoint failed'); } }, alert() {}, accessAppCreate: () => ({ name: names.accessApi, destinations: [{ type: 'worker', worker_id: 'worker-tag-1', overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] }) });
  await assert.rejects(client.createAccessApp('api'));
  await assert.rejects(client.deleteAccessApp('api'));
  assert.equal(transport.calls.length, 2);
});
