import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOwnedResource, checkpoint, discoverRun, InventoryQuarantineError } from './inventory.mjs';
import { resourceNames } from './key.mjs';

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
  cloudflare: { accountId: 'account-1', workerIds: { api: 'worker-tag-1' }, d1Ids: { api: '11111111-1111-4111-8111-111111111111' }, accessAppIds: { api: 'access-app-1' }, tokenId: 'token-1' },
  stage: 'active',
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

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
    bindings: { d1: { DB: inventory.cloudflare.d1Ids.api }, services: {} },
  }, 'worker:api'));
  for (const discovered of [
    { accountId: 'other-account', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-1', bindings: { d1: { DB: inventory.cloudflare.d1Ids.api }, services: {} } },
    { accountId: 'account-1', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-changed', bindings: { d1: { DB: inventory.cloudflare.d1Ids.api }, services: {} } },
    { accountId: 'account-1', kind: 'worker', role: 'api', name: inventory.names.api, id: 'worker-tag-1', bindings: { d1: { DB: inventory.cloudflare.d1Ids.api }, services: { OTHER: 'worker-tag-1' } } },
    { accountId: 'account-1', kind: 'd1', role: 'api', name: 'demo', id: '11111111-1111-4111-8111-111111111111' },
    { accountId: 'account-1', kind: 'd1', role: 'api', name: inventory.names.auth, id: '11111111-1111-4111-8111-111111111111' },
  ]) assert.throws(() => assertOwnedResource(inventory, discovered, discovered.kind === 'd1' ? 'd1:api' : 'worker:api'), InventoryQuarantineError);
});

test('discovery rejects matching prefixes, short hashes, untrusted inventory, and crash recovery without independent audit proof', async () => {
  const foreign = { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: {} } };
  const api = {
    async loadCheckpoint() { return { inventory: foreign, intents: [] }; },
    async listWorkers() { return [{ name: inventory.names.api, tag: 'foreign-tag' }]; },
    async listD1() { return []; },
    async listAccessApps() { return []; },
    async listServiceTokens() { return []; },
    async listAudit() { return []; },
  };
  await assert.rejects(discoverRun(key, api), InventoryQuarantineError);
  await assert.rejects(discoverRun({ ...key, pr: 43 }, api), InventoryQuarantineError);
});

test('crash recovery records only an exact read plus independently matching audit evidence', async () => {
  const writes = [];
  const api = {
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, workerIds: {} } }, intents: [{ key, kind: 'worker:api', exactName: inventory.names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return [{ name: inventory.names.api, tag: 'worker-tag-2' }]; },
    async getWorker(name) { return { name, tag: 'worker-tag-2', bindings: { d1: { DB: inventory.cloudflare.d1Ids.api }, services: {} } }; },
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
    async loadCheckpoint() { return { inventory: { ...inventory, stage: 'creating', cloudflare: { ...inventory.cloudflare, d1Ids: {} } }, intents: [{ key, kind: 'd1:api', exactName: inventory.names.api, startedAt: '2026-09-30T10:01:00.000Z', noPreexistingMatch: true }] }; },
    async listWorkers() { return []; },
    async listD1() { return [{ name: inventory.names.api, uuid: '22222222-2222-4222-8222-222222222222' }]; },
    async listAccessApps() { return []; }, async listServiceTokens() { return []; },
    async listAudit() { return [{ actor: { token_id: 'controller-token' }, action: { type: 'create', result: true, time: '2026-09-30T10:01:01.000Z' }, resource: { id: '22222222-2222-4222-8222-222222222222' }, raw: { method: 'POST', uri: '/accounts/account-1/d1/database' } }]; },
    controllerTokenId: 'controller-token', async saveCheckpoint(value) { writes.push(value); },
  };
  const recovered = await discoverRun(key, api);
  assert.equal(recovered.cloudflare.d1Ids.api, '22222222-2222-4222-8222-222222222222');
  assert.equal(writes.length, 1);
});
