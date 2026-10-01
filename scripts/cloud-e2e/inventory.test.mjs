import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOwnedResource, checkpoint, checkpointBetaWorkerCreateIntent, checkpointBetaWorkerObservation, discoverRun, InventoryQuarantineError } from './inventory.mjs';
import { resourceNames } from './key.mjs';
import { createCloudflareClient } from './cloudflare.mjs';

const key = {
  repository_id: 987654321,
  repository: 'trusted-owner/incentives-platform',
  pr: 42,
  head_sha: 'a'.repeat(40),
  run_id: 123456789,
  attempt: 2,
};
const names = resourceNames(key);

const inventory = {
  key,
  names,
  cloudflare: { accountId: 'account-1', workerIds: { api: 'worker-tag-1' }, d1Ids: { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' }, accessAppIds: { api: 'access-app-1' }, tokenId: 'token-1' },
  stage: 'active',
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

test('durably checkpoints only provenance-correlated Beta intent and exact immutable readback', async () => {
  const writes = [];
  const creating = { ...inventory, stage: 'creating' };
  const now = () => '2026-10-01T09:00:00.000Z';
  const intent = await checkpointBetaWorkerCreateIntent(creating, 'api', {
    kind: 'beta-worker-precreate-list', run: key, role: 'api', observedAt: now(), request: { method: 'GET', path: '/accounts/account-1/workers/workers' }, response: { success: true, result: [] },
  }, { async put(value, options) { writes.push({ value, options }); } }, now);
  await checkpointBetaWorkerObservation(intent, {
    kind: 'beta-worker-readback', run: key, role: 'api', observedAt: now(), request: { method: 'GET', path: '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758' },
    response: { success: true, result: { id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null, bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }] } },
  }, { async put(value, options) { writes.push({ value, options }); } }, now);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].value.betaWorkerIds.api, 'e8f70fdbc8b1fb0b8ddb1af166186758');
  assert.equal(writes.every(entry => entry.options.retentionDays === 7), true);
  await assert.rejects(checkpointBetaWorkerCreateIntent({ ...creating, stage: 'quarantined' }, 'api', { kind: 'beta-worker-precreate-list', run: key, role: 'api', observedAt: now(), request: { method: 'GET', path: '/accounts/account-1/workers/workers' }, response: { success: true, result: [] } }, { async put() {} }, now), InventoryQuarantineError);
});

test('checkpoints only seven-day restricted controller evidence and never credentials', async () => {
  const writes = [];
  await checkpoint(inventory, { async put(value, options) { writes.push({ value, options }); } });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].options, { classification: 'controller-evidence', retentionDays: 7, restricted: true });
  assert.equal(writes[0].value.cloudflare.tokenId, 'token-1');
  assert.equal(JSON.stringify(writes[0].value).includes('secret'), false);
  await assert.rejects(checkpoint({ ...inventory, unexpected: true }, { async put() {} }), InventoryQuarantineError);
});

test('requires exact account, immutable Worker tag, UUID, and binding graph', () => {
  assert.doesNotThrow(() => assertOwnedResource(inventory, {
    accountId: 'account-1', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-1',
    bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: {} },
  }, 'worker:api'));
  for (const discovered of [
    { accountId: 'other-account', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-1', bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: {} } },
    { accountId: 'account-1', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-changed', bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: {} } },
    { accountId: 'account-1', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-1', bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: { OTHER: 'worker-tag-1' } } },
    { accountId: 'account-1', kind: 'd1', role: 'product', name: 'demo', id: inventory.cloudflare.d1Ids.product },
    { accountId: 'account-1', kind: 'd1', role: 'product', name: inventory.names.auth, id: inventory.cloudflare.d1Ids.product },
  ]) assert.throws(() => assertOwnedResource(inventory, discovered, discovered.kind === 'd1' ? 'd1:product' : 'worker:api'), InventoryQuarantineError);
});

test('discovery rejects matching prefixes, short hashes, untrusted inventory, and crash recovery without independent audit proof', async () => {
  const foreign = { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: {} } };
  const api = {
    async loadCheckpoint() { return { inventory: foreign, intents: [] }; },
    async listWorkers() { return [{ id: inventory.names.api, tag: 'foreign-tag' }]; },
    async listD1() { return []; },
    async listAccessApps() { return []; },
    async listServiceTokens() { return []; },
    async listAudit() { return []; }, controllerTokenId: 'controller-token',
  };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
  await assert.rejects(discoverRun({ ...key, pr: 43 }, api), InventoryQuarantineError);
});

test('crash recovery records only an exact read plus independently matching audit evidence', async () => {
  const writes = [];
  const api = {
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, workerIds: {} } }, intents: [{ key, kind: 'worker:api', exactName: inventory.names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return [{ id: inventory.names.api, tag: 'worker-tag-2' }]; },
    async getWorker(name) { return { name, tag: 'worker-tag-2', bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: {} } }; },
    async listD1() { return []; }, async listAccessApps() { return []; }, async listServiceTokens() { return []; },
    async listAudit() { return []; },
    controllerTokenId: 'controller-token',
    async saveCheckpoint(value) { writes.push(value); },
  };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
  api.listAudit = async () => [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: 'worker-tag-2' }, raw: { method: 'PUT', uri: `/accounts/account-1/workers/scripts/${inventory.names.api}` } }];
  const recovered = await discoverRun(key, api);
  assert.equal(recovered.cloudflare.workerIds.api, 'worker-tag-2');
  assert.equal(writes.length, 1);
});

test('D1 recovery requires the exact UUID and an independently matching POST audit entry', async () => {
  const writes = [];
  const api = {
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, d1Ids: {} } }, intents: [{ key, kind: 'd1:product', exactName: inventory.names.product, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return []; },
    async listD1() { return [{ name: inventory.names.product, uuid: '33333333-3333-4333-8333-333333333333' }]; },
    async listAccessApps() { return []; }, async listServiceTokens() { return []; },
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: '33333333-3333-4333-8333-333333333333' }, raw: { method: 'POST', uri: '/accounts/account-1/d1/database' } }]; },
    controllerTokenId: 'controller-token', async saveCheckpoint(value) { writes.push(value); },
  };
  const recovered = await discoverRun(key, api);
  assert.equal(recovered.cloudflare.d1Ids.product, '33333333-3333-4333-8333-333333333333');
  assert.equal(writes.length, 1);
});

test('uses the required three-Worker/two-D1 topology and preserves incomplete discovery', async () => {
  const correct = {
    ...inventory,
    cloudflare: { ...inventory.cloudflare, workerIds: { api: 'worker-tag-1', identity: 'worker-tag-2', operator: 'worker-tag-3' }, d1Ids: { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' } },
  };
  assert.doesNotThrow(() => assertOwnedResource(correct, { accountId: 'account-1', kind: 'd1', role: 'product', name: names.product, id: correct.cloudflare.d1Ids.product }, 'd1:product'));
  const api = { async loadCheckpoint() { return { inventory: { ...correct, stage: 'creating', cloudflare: { ...correct.cloudflare, workerIds: {}, d1Ids: {}, accessAppIds: {}, tokenId: null } }, intents: [] }; }, async listWorkers() { return []; }, async listD1() { return []; }, async listAccessApps() { return []; }, async listServiceTokens() { return []; }, controllerTokenId: 'controller-token', alert() {} };
  assert.equal((await discoverRun(key, api)).stage, 'creating');
});

test('never accepts an audit recovery without a nonempty trusted actor token', async () => {
  const api = {
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, workerIds: {} } }, intents: [{ key, kind: 'worker:api', exactName: inventory.names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return [{ id: inventory.names.api, tag: 'worker-tag-2' }]; }, async getWorker() { return { tag: 'worker-tag-2', bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: {} } }; }, async listD1() { return []; }, async listAccessApps() { return []; }, async listServiceTokens() { return []; },
    async listAudit() { return [{ actor: {}, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: 'worker-tag-2' }, raw: { method: 'PUT', uri: `/accounts/account-1/workers/scripts/${inventory.names.api}` } }]; }, alert() {},
  };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
});

test('does not return recovered IDs before saveCheckpoint durably succeeds and alerts malformed evidence', async () => {
  const alerts = [];
  const api = {
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, d1Ids: { auth: inventory.cloudflare.d1Ids.auth } } }, intents: [{ key, kind: 'd1:product', exactName: inventory.names.product, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return []; }, async listD1() { return [{ name: inventory.names.product, uuid: '33333333-3333-4333-8333-333333333333' }]; }, async listAccessApps() { return []; }, async listServiceTokens() { return []; },
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: '33333333-3333-4333-8333-333333333333' }, raw: { method: 'POST', uri: '/accounts/account-1/d1/database' } }]; }, controllerTokenId: 'controller-token', alert: value => alerts.push(value),
  };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
  assert.equal(alerts.length, 1);
});

test('downgrades incomplete active inventory and wires discovery to client list/get normalization', async () => {
  const active = { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: {}, d1Ids: {}, accessAppIds: {}, tokenId: null } };
  const saved = []; const incompleteApi = { async loadCheckpoint() { return { inventory: active, intents: [] }; }, async listWorkers() { return []; }, async listD1() { return []; }, async listAccessApps() { return []; }, async listServiceTokens() { return []; }, async saveCheckpoint(value) { saved.push(value); }, controllerTokenId: 'controller-token', alert() {} };
  assert.equal((await discoverRun(key, incompleteApi)).stage, 'creating');
  assert.equal(saved.length, 1);
});

test('wires discoverRun to actual client listWorkers and getWorker(role) normalization', async () => {
  const responses = [
    { result: [{ id: names.api, tag: 'worker-tag-recovered' }] },
    { result: [{ id: names.api, tag: 'worker-tag-recovered' }] },
    { result: { bindings: [{ type: 'd1', name: 'DB', id: inventory.cloudflare.d1Ids.product }] } },
    { result: [] },
    { result: [] },
  ];
  const calls = [];
  const incomplete = { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, workerIds: {} } };
  const client = createCloudflareClient({ accountId: 'account-1', inventory: incomplete, transport: { async request(request) { calls.push(request); const response = responses.shift(); return { status: 200, success: true, result_info: Array.isArray(response.result) ? { total_count: response.result.length } : undefined, ...response }; } } });
  const saved = [];
  const api = {
    async loadCheckpoint() { return { inventory: incomplete, intents: [{ key, kind: 'worker:api', exactName: names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    listWorkers: client.listWorkers, getWorker: client.getWorker,
    async listD1() { return []; }, async listAccessApps() { return []; }, async listServiceTokens() { return []; },
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: 'worker-tag-recovered' }, raw: { method: 'PUT', uri: `/accounts/account-1/workers/scripts/${names.api}` } }]; },
    controllerTokenId: 'controller-token', async saveCheckpoint(value) { saved.push(value); },
  };
  assert.equal((await discoverRun(key, api)).cloudflare.workerIds.api, 'worker-tag-recovered');
  assert.equal(saved.length, 1); assert.deepEqual(calls.map(call => call.path), ['/accounts/account-1/workers/scripts', '/accounts/account-1/workers/scripts', `/accounts/account-1/workers/scripts/${names.api}/settings`, '/accounts/account-1/workers/scripts', '/accounts/account-1/workers/scripts']);
});
