import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloudflareClient, MutationQuarantinedError } from './cloudflare.mjs';
import { resourceNames } from './key.mjs';

const key = { repository_id: 987654321, repository: 'trusted-owner/incentives-platform', pr: 42, head_sha: 'a'.repeat(40), run_id: 123456789, attempt: 2 };
const names = resourceNames(key);
const inventory = {
  key,
  names,
  cloudflare: { accountId: 'account-1', workerIds: { api: 'worker-tag-1' }, d1Ids: { api: '11111111-1111-4111-8111-111111111111' }, accessAppIds: { api: 'access-app-1' }, tokenId: 'token-1' },
  stage: 'active', createdAt: '2026-09-30T10:00:00.000Z', updatedAt: '2026-09-30T10:00:00.000Z',
};

function mockTransport(responses) {
  const calls = [];
  return { calls, async request(request) { calls.push(request); const next = responses.shift(); if (next instanceof Error) throw next; return next; } };
}

test('checkpoints durable intent before create and returned D1 UUID immediately after response', async () => {
  const transport = mockTransport([{ result: [] }, { result: { uuid: '22222222-2222-4222-8222-222222222222', name: inventory.names.auth } }]);
  const checkpoints = [];
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, store: { async put(value, options) { checkpoints.push({ value, options }); } }, now: () => '2026-09-30T10:02:00.000Z' });
  await client.createD1('identity');
  assert.deepEqual(transport.calls.map(call => `${call.method} ${call.path}`), [
    'GET /accounts/account-1/d1/database', 'POST /accounts/account-1/d1/database',
  ]);
  assert.deepEqual(checkpoints.map(entry => entry.value.kind ?? entry.value.cloudflare.d1Ids.identity), ['d1:identity', '22222222-2222-4222-8222-222222222222']);
  assert.equal(checkpoints.every(entry => entry.options.retentionDays === 7), true);
});

test('uses only a protected upload builder and checkpoints the returned immutable Worker tag', async () => {
  const withoutApiWorker = { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: {} } };
  const transport = mockTransport([{ result: [] }, { result: { tag: 'worker-tag-created' } }]);
  const checkpoints = [];
  const client = createCloudflareClient({
    accountId: 'account-1', inventory: withoutApiWorker, transport,
    store: { async put(value) { checkpoints.push(value); } },
    workerUpload: ({ name }) => ({ protected: true, name }), now: () => '2026-09-30T10:03:00.000Z',
  });
  await client.createWorker('api');
  assert.deepEqual(transport.calls.map(call => `${call.method} ${call.path}`), [
    'GET /accounts/account-1/workers/scripts', `PUT /accounts/account-1/workers/scripts/${inventory.names.api}`,
  ]);
  assert.equal(transport.calls[1].body.protected, true);
  assert.equal(checkpoints.at(-1).cloudflare.workerIds.api, 'worker-tag-created');
  await assert.rejects(createCloudflareClient({ accountId: 'account-1', inventory: withoutApiWorker, transport: mockTransport([]) }).createWorker('api'), /workerUpload/u);
});

test('never deletes a target whose exact ID or current binding graph changed after an earlier read', async () => {
  const transport = mockTransport([
    { result: [{ id: inventory.names.api, tag: 'worker-tag-changed' }] },
    { result: { bindings: [{ type: 'd1', name: 'DB', id: inventory.cloudflare.d1Ids.api }] } },
  ]);
  const alerts = [];
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, alert: value => alerts.push(value) });
  await assert.rejects(client.deleteWorker('api'), MutationQuarantinedError);
  assert.deepEqual(transport.calls.map(call => call.method), ['GET', 'GET']);
  assert.equal(alerts.length, 1);
});

test('missing targets are idempotent but forbidden/errors are not swallowed', async () => {
  const missing = mockTransport([{ status: 404, result: null }]);
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport: missing });
  assert.deepEqual(await client.deleteD1('api'), { status: 'missing' });
  assert.deepEqual(missing.calls.map(call => call.method), ['GET']);
  const forbidden = mockTransport([new Error('403 forbidden')]);
  const forbiddenClient = createCloudflareClient({ accountId: 'account-1', inventory, transport: forbidden });
  await assert.rejects(forbiddenClient.deleteD1('api'), /403 forbidden/u);
});

test('uses fixed ledger paths and rejects untrusted account, kind, or arbitrary request bodies', async () => {
  assert.throws(() => createCloudflareClient({ accountId: 'other', inventory, transport: mockTransport([]) }), MutationQuarantinedError);
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport: mockTransport([]) });
  await assert.rejects(client.deleteWorker('demo'), MutationQuarantinedError);
  assert.throws(() => client.request({ method: 'DELETE', path: '/accounts/account-1/anything' }), /not a function/u);
});
