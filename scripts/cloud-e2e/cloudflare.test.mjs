import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloudflareClient, MutationQuarantinedError, planBetaWorkerCreate, planBetaWorkerDelete, planBetaWorkerDisable, planBetaWorkerRead, planBetaWorkerVersion } from './cloudflare.mjs';
import { checkpointBetaWorkerCreateIntent, checkpointBetaWorkerObservation } from './inventory.mjs';
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

test('plans only the deterministic disabled Beta Worker create request', () => {
  assert.deepEqual(planBetaWorkerCreate(inventory, 'api'), {
    method: 'POST',
    path: '/accounts/account-1/workers/workers',
    body: {
      name: names.api,
      subdomain: { enabled: false, previews_enabled: false },
    },
  });
});

test('plans Beta reads, disabled patches, and deletes by certified immutable ID only', () => {
  const beta = { ...inventory, betaWorkerIds: { api: 'e8f70fdbc8b1fb0b8ddb1af166186758' } };
  const inert = { worker: { id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null }, version: null };
  assert.deepEqual(planBetaWorkerRead(beta, 'api'), { method: 'GET', path: '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758' });
  assert.deepEqual(planBetaWorkerDisable(beta, 'api', inert), { method: 'PATCH', path: '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758', body: { subdomain: { enabled: false, previews_enabled: false } } });
  assert.deepEqual(planBetaWorkerDelete(beta, 'api', inert), { method: 'DELETE', path: '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758' });
  assert.throws(() => planBetaWorkerDelete(beta, 'api', { worker: { ...inert.worker, routes: ['public-route'] }, version: null }), /observation/u);
  assert.throws(() => planBetaWorkerDisable(beta, 'api', { worker: inert.worker, version: { id: '182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e', bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }] } }), /inert/u);
  assert.throws(() => planBetaWorkerRead(inventory, 'api'), /certified immutable ID/u);
});

test('plans an inert non-deploying Beta version only after disabled ID and exact Access readback', () => {
  const beta = {
    ...inventory,
    cloudflare: { ...inventory.cloudflare, accessAppIds: { api: 'access-app-1', operator: 'access-app-2' } },
    betaWorkerIds: { api: 'e8f70fdbc8b1fb0b8ddb1af166186758', operator: 'f8f70fdbc8b1fb0b8ddb1af166186758' },
  };
  const accessApps = {
    api: { id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: 'e8f70fdbc8b1fb0b8ddb1af166186758', overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] },
    operator: { id: 'access-app-2', name: names.accessOperator, destinations: [{ type: 'worker', worker_id: 'f8f70fdbc8b1fb0b8ddb1af166186758', overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] },
  };
  const plan = planBetaWorkerVersion(beta, 'api', {
    observation: { id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false } },
    accessApps, module: { name: 'index.js', contentType: 'application/javascript+module', contentBase64: 'ZXhwb3J0IGRlZmF1bHQge307' },
    bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }],
  });
  assert.deepEqual(plan, {
    method: 'POST', path: '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758/versions', query: { deploy: false },
    body: { main_module: 'index.js', modules: [{ name: 'index.js', content_type: 'application/javascript+module', content_base64: 'ZXhwb3J0IGRlZmF1bHQge307' }], bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }] },
  });
  assert.throws(() => planBetaWorkerVersion(beta, 'api', {
    observation: { id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false } },
    accessApps: { ...accessApps, api: { ...accessApps.api, policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' }, everyone: {} }] }] } },
    module: { name: 'index.js', contentType: 'application/javascript+module', contentBase64: 'ZXhwb3J0IGRlZmF1bHQge307' }, bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }],
  }), /Access readback/u);
  assert.deepEqual(planBetaWorkerVersion({ ...beta, betaWorkerIds: { ...beta.betaWorkerIds, operator: 'f8f70fdbc8b1fb0b8ddb1af166186758' } }, 'operator', {
    observation: { id: 'f8f70fdbc8b1fb0b8ddb1af166186758', name: names.operator, routes: [], subdomain: { enabled: false, previews_enabled: false } }, accessApps,
    module: { name: 'index.js', contentType: 'application/javascript+module', contentBase64: 'ZXhwb3J0IGRlZmF1bHQge307' }, bindings: [{ name: 'API', type: 'service', service: names.api }],
  }), { status: 'unsupported', reason: 'service-binding-remapping-unresolved' });
});

test('connects disabled create intent, durable Beta readback, both Access gates, and inert version planning locally', async () => {
  const pending = {
    ...inventory,
    cloudflare: { ...inventory.cloudflare, accessAppIds: { api: 'access-app-1', operator: 'access-app-2' } },
    betaWorkerIds: { operator: 'f8f70fdbc8b1fb0b8ddb1af166186758' },
  };
  const accessApps = {
    api: { id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: 'e8f70fdbc8b1fb0b8ddb1af166186758', overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] },
    operator: { id: 'access-app-2', name: names.accessOperator, destinations: [{ type: 'worker', worker_id: 'f8f70fdbc8b1fb0b8ddb1af166186758', overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] },
  };
  const writes = [];
  await checkpointBetaWorkerCreateIntent(pending, 'api', { async put(value) { writes.push(value); } }, () => '2026-10-01T09:00:00.000Z');
  const create = planBetaWorkerCreate(pending, 'api');
  assert.deepEqual(create, { method: 'POST', path: '/accounts/account-1/workers/workers', body: { name: names.api, subdomain: { enabled: false, previews_enabled: false } } });
  const checkpointed = await checkpointBetaWorkerObservation(pending, 'api', {
    id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false },
  }, { async put(value) { writes.push(value); } });
  const version = planBetaWorkerVersion(checkpointed, 'api', {
    observation: { id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false } },
    accessApps, module: { name: 'index.js', contentType: 'application/javascript+module', contentBase64: 'ZXhwb3J0IGRlZmF1bHQge307' },
    bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }],
  });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], {
    type: 'beta-worker-create-intent', key, role: 'api', exactName: names.api,
    startedAt: '2026-10-01T09:00:00.000Z', noPreexistingMatch: true,
  });
  assert.equal(version.path, '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758/versions');
  assert.deepEqual(version.query, { deploy: false });
});

test('does not plan a dependent Beta version after its immutable-ID checkpoint fails', async () => {
  let versionPlans = 0;
  const pending = { ...inventory, betaWorkerIds: { operator: 'f8f70fdbc8b1fb0b8ddb1af166186758' } };
  await assert.rejects(async () => {
    const checkpointed = await checkpointBetaWorkerObservation(pending, 'api', {
      id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false },
    }, { async put() { throw new Error('checkpoint unavailable'); } });
    versionPlans += 1;
    planBetaWorkerVersion(checkpointed, 'api', {});
  }, /checkpoint unavailable/u);
  assert.equal(versionPlans, 0);
});

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
    { decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' }, everyone: {} }] },
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

test('rejects duplicate immutable Worker tags and D1 UUIDs before graph or create certification', async () => {
  const workerTransport = mockTransport([{ result: [{ id: names.api, tag: 'tag-api' }, { id: names.operator, tag: 'tag-operator' }, { id: 'foreign-script', tag: 'tag-api' }] }]);
  const workerAlerts = []; const workerClient = createCloudflareClient({ accountId: 'account-1', inventory: { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: { api: 'tag-api', operator: 'tag-operator' } } }, transport: workerTransport, alert: value => workerAlerts.push(value) });
  await assert.rejects(workerClient.getWorker('operator'), MutationQuarantinedError); assert.equal(workerAlerts.length, 1);
  const d1Transport = mockTransport([{ result: [{ name: 'foreign-product-a', uuid: '33333333-3333-4333-8333-333333333333' }, { name: 'foreign-product-b', uuid: '33333333-3333-4333-8333-333333333333' }] }]);
  const d1Alerts = []; const d1Client = createCloudflareClient({ accountId: 'account-1', inventory: { ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: {} } }, transport: d1Transport, store: { async put() {} }, alert: value => d1Alerts.push(value) });
  await assert.rejects(d1Client.createD1('product'), MutationQuarantinedError); assert.equal(d1Alerts.length, 1); assert.deepEqual(d1Transport.calls.map(call => call.method), ['GET']);
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
