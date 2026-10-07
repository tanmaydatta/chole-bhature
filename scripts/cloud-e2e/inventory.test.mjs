import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOwnedResource, checkpoint, checkpointBetaWorkerCreateIntent, checkpointBetaWorkerObservation, discoverRun, InventoryQuarantineError, validateInventory } from './inventory.mjs';
import { resourceNames } from './key.mjs';
import { createCloudflareClient, planBetaWorkerCreate } from './cloudflare.mjs';

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

function recordedReadbacks(current) {
  return {
    async listWorkers() { return Object.entries(current.cloudflare.workerIds).map(([role, tag]) => ({ id: current.names[role], tag })); },
    async getWorker(role) { return { name: current.names[role], tag: current.cloudflare.workerIds[role], bindings: role === 'api' ? { d1: { DB: current.cloudflare.d1Ids.product }, services: {} } : role === 'identity' ? { d1: { DB: current.cloudflare.d1Ids.auth }, services: {} } : { d1: {}, services: { API: current.cloudflare.workerIds.api, IDENTITY: current.cloudflare.workerIds.identity } } }; },
    async listD1() { return Object.entries(current.cloudflare.d1Ids).map(([role, uuid]) => ({ name: current.names[role], uuid })); },
    async listAccessApps() { return Object.entries(current.cloudflare.accessAppIds).map(([role, id]) => ({ id, name: role === 'api' ? current.names.accessApi : current.names.accessOperator, destinations: [{ type: 'worker', worker_id: current.cloudflare.workerIds[role], overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: current.cloudflare.tokenId } }] }] })); },
    async listServiceTokens() { return current.cloudflare.tokenId ? [{ id: current.cloudflare.tokenId, name: current.names.token }] : []; },
  };
}

function completeInventory(stage) {
  return { ...inventory, stage, cloudflare: { ...inventory.cloudflare, workerIds: { api: 'worker-tag-1', identity: 'worker-tag-2', operator: 'worker-tag-3' }, accessAppIds: { api: 'access-app-1', operator: 'access-app-2' } } };
}

test('I1 complete terminal discovery preserves stage IDs and timestamps without provider reads or persistence', async () => {
  for (const stage of ['quarantined', 'deleted']) {
    const original = completeInventory(stage); let reads = 0; let saves = 0;
    const api = { async loadCheckpoint() { return { inventory: original, intents: [] }; }, controllerTokenId: 'controller-token', async saveCheckpoint() { saves += 1; } };
    for (const operation of ['listWorkers', 'getWorker', 'listD1', 'listAccessApps', 'listServiceTokens', 'listAudit']) api[operation] = async () => { reads += 1; throw new Error('terminal resource read is forbidden'); };
    const discovered = await discoverRun(key, api);
    assert.equal(discovered.stage, stage);
    assert.equal(discovered.updatedAt, '2026-09-30T10:00:00.000Z');
    assert.deepEqual(discovered, original);
    assert.equal(reads, 0); assert.equal(saves, 0);
  }
});

test('I1 complete creating promotion requires exact current resources and a successful durable stage checkpoint', async () => {
  const original = completeInventory('creating');
  for (const persistence of ['success', 'missing', 'failing']) {
    const reads = []; const saves = [];
    const api = { async loadCheckpoint() { return { inventory: original, intents: [] }; }, controllerTokenId: 'controller-token' };
    for (const [operation, read] of Object.entries(recordedReadbacks(original))) api[operation] = async (...args) => { reads.push(operation); return read(...args); };
    if (persistence !== 'missing') api.saveCheckpoint = async value => { saves.push(structuredClone(value)); if (persistence === 'failing') throw new Error('stage checkpoint lost'); };
    if (persistence === 'success') {
      const found = await discoverRun(key, api);
      assert.equal(found.stage, 'active');
      assert.notEqual(found.updatedAt, original.updatedAt);
      assert.equal(saves.length, 1); assert.deepEqual(saves[0], found);
      assert.deepEqual(found.cloudflare, original.cloudflare);
    } else await assert.rejects(discoverRun(key, api));
    assert.equal(reads.filter(operation => operation === 'getWorker').length, 3);
    assert.ok(reads.includes('listD1')); assert.ok(reads.includes('listAccessApps')); assert.ok(reads.includes('listServiceTokens'));
    assert.equal(original.stage, 'creating');
  }
});

test('I1 recorded missing or substituted resource refuses promotion without checkpoint', async () => {
  const original = completeInventory('creating');
  for (const operation of ['listWorkers', 'getWorker', 'listD1', 'listAccessApps', 'listServiceTokens']) {
    for (const defect of ['missing', 'replaced']) {
      let saves = 0; const good = recordedReadbacks(original);
      const api = { ...good, async loadCheckpoint() { return { inventory: original, intents: [] }; }, controllerTokenId: 'controller-token', async saveCheckpoint() { saves += 1; } };
      api[operation] = async (...args) => {
        const value = await good[operation](...args);
        if (operation === 'getWorker') return defect === 'missing' ? { missing: true } : { ...value, tag: 'foreign-tag' };
        if (defect === 'missing') return [];
        const field = operation === 'listWorkers' ? 'tag' : operation === 'listD1' ? 'uuid' : 'id';
        return value.map(entry => ({ ...entry, [field]: field === 'uuid' ? '33333333-3333-4333-8333-333333333333' : 'foreign-id' }));
      };
      await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
      assert.equal(saves, 0); assert.equal(original.stage, 'creating');
    }
  }
});

test('I1 verified unchanged active discovery preserves timestamps without a gratuitous checkpoint', async () => {
  const original = completeInventory('active'); let saves = 0;
  const found = await discoverRun(key, { ...recordedReadbacks(original), async loadCheckpoint() { return { inventory: original, intents: [] }; }, controllerTokenId: 'controller-token', async saveCheckpoint() { saves += 1; } });
  assert.deepEqual(found, original); assert.equal(saves, 0);
});

test('I1 recovered Access identity cannot promote a run with an unproven destination or policy graph', async () => {
  const complete = completeInventory('creating');
  const partial = { ...complete, cloudflare: { ...complete.cloudflare, accessAppIds: { operator: 'access-app-2' } } };
  const readbacks = recordedReadbacks(complete); let saves = 0;
  const api = { ...readbacks, async loadCheckpoint() { return { inventory: partial, intents: [{ key, kind: 'accessApp:api', exactName: names.accessApi, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listAccessApps() { return (await readbacks.listAccessApps()).map(app => app.id === 'access-app-1' ? { ...app, destinations: [{ type: 'worker', worker_id: 'foreign-worker', overrides: [] }] } : app); },
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: 'access-app-1' }, raw: { method: 'POST', uri: '/accounts/account-1/access/apps' } }]; },
    controllerTokenId: 'controller-token', async saveCheckpoint() { saves += 1; } };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
  assert.equal(saves, 0);
});

test('I1 a recorded Worker tag under a foreign listed name cannot authorize promotion', async () => {
  const original = completeInventory('creating'); const readbacks = recordedReadbacks(original); let saves = 0;
  const api = { ...readbacks, async loadCheckpoint() { return { inventory: original, intents: [] }; }, async listWorkers() { return (await readbacks.listWorkers()).map(worker => worker.tag === 'worker-tag-1' ? { ...worker, id: 'foreign-worker-name' } : worker); }, controllerTokenId: 'controller-token', async saveCheckpoint() { saves += 1; } };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
  assert.equal(saves, 0);
});

test('refuses a single database UUID assigned to both Product and Auth', () => {
  assert.throws(() => validateInventory({ ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: { product: inventory.cloudflare.d1Ids.product, auth: inventory.cloudflare.d1Ids.product } } }), InventoryQuarantineError);
});

test('durably checkpoints only provenance-correlated Beta intent and exact immutable readback', async () => {
  const writes = [];
  const store = { async put(value, options) { writes.push({ value, options }); } };
  const creating = { ...inventory, stage: 'creating' };
  const now = () => '2026-10-01T09:00:00.000Z';
  const intent = await checkpointBetaWorkerCreateIntent(creating, 'api', {
    kind: 'beta-worker-precreate-list', run: key, role: 'api', observedAt: now(), request: { method: 'GET', path: '/accounts/account-1/workers/workers' }, response: { success: true, result: [] },
  }, store, now);
  planBetaWorkerCreate(intent, now);
  const beta = { id: 'e8f70fdbc8b1fb0b8ddb1af166186758', name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null, bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }] };
  await checkpointBetaWorkerObservation(intent, {
    kind: 'beta-worker-create-result', run: key, role: 'api', observedAt: now(), request: { method: 'POST', path: '/accounts/account-1/workers/workers' },
    response: { success: true, result: beta },
  }, {
    kind: 'beta-worker-readback', run: key, role: 'api', observedAt: now(), request: { method: 'GET', path: '/accounts/account-1/workers/workers/e8f70fdbc8b1fb0b8ddb1af166186758' },
    response: { success: true, result: beta },
  }, store, now);
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
    ...recordedReadbacks({ ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: { api: 'worker-tag-2' } } }),
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, workerIds: {} } }, intents: [{ key, kind: 'worker:api', exactName: inventory.names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return [{ id: inventory.names.api, tag: 'worker-tag-2' }]; },
    async getWorker(role) { return { name: names[role], tag: 'worker-tag-2', bindings: { d1: { DB: inventory.cloudflare.d1Ids.product }, services: {} } }; },
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
    ...recordedReadbacks({ ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: { product: '33333333-3333-4333-8333-333333333333' } } }),
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, d1Ids: {} } }, intents: [{ key, kind: 'd1:product', exactName: inventory.names.product, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listD1() { return [{ name: inventory.names.product, uuid: '33333333-3333-4333-8333-333333333333' }]; },
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
    ...recordedReadbacks({ ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: { ...inventory.cloudflare.d1Ids, product: '33333333-3333-4333-8333-333333333333' } } }),
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, d1Ids: { auth: inventory.cloudflare.d1Ids.auth } } }, intents: [{ key, kind: 'd1:product', exactName: inventory.names.product, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: '33333333-3333-4333-8333-333333333333' }, raw: { method: 'POST', uri: '/accounts/account-1/d1/database' } }]; }, controllerTokenId: 'controller-token', alert: value => alerts.push(value),
  };
  await assert.rejects(discoverRun(key, api), /durable checkpoint/u);
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
    { result: [{ id: names.api, tag: 'worker-tag-recovered' }] },
    { result: [{ id: names.api, tag: 'worker-tag-recovered' }] },
    { result: { bindings: [{ type: 'd1', name: 'DB', id: inventory.cloudflare.d1Ids.product }] } },
  ];
  const calls = [];
  const incomplete = { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, workerIds: {} } };
  const client = createCloudflareClient({ accountId: 'account-1', inventory: incomplete, transport: { async request(request) { calls.push(request); const response = responses.shift(); return { status: 200, success: true, result_info: Array.isArray(response.result) ? { total_count: response.result.length } : undefined, ...response }; } } });
  const saved = [];
  const api = {
    ...recordedReadbacks({ ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: { api: 'worker-tag-recovered' } } }),
    async loadCheckpoint() { return { inventory: incomplete, intents: [{ key, kind: 'worker:api', exactName: names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    listWorkers: client.listWorkers, getWorker: client.getWorker,
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: 'worker-tag-recovered' }, raw: { method: 'PUT', uri: `/accounts/account-1/workers/scripts/${names.api}` } }]; },
    controllerTokenId: 'controller-token', async saveCheckpoint(value) { saved.push(value); },
  };
  assert.equal((await discoverRun(key, api)).cloudflare.workerIds.api, 'worker-tag-recovered');
  assert.equal(saved.length, 1); assert.deepEqual(calls.map(call => call.path), ['/accounts/account-1/workers/scripts', '/accounts/account-1/workers/scripts', `/accounts/account-1/workers/scripts/${names.api}/settings`, '/accounts/account-1/workers/scripts', '/accounts/account-1/workers/scripts', '/accounts/account-1/workers/scripts', '/accounts/account-1/workers/scripts', `/accounts/account-1/workers/scripts/${names.api}/settings`]);
});
