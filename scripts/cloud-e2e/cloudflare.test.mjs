import assert from 'node:assert/strict';
import test from 'node:test';

import { createCloudflareClient, MutationQuarantinedError, planBetaWorkerCreate, planBetaWorkerDelete, planBetaWorkerRead, planBetaWorkerVersion, prepareBetaWorkerEvidence } from './cloudflare.mjs';
import { checkpointBetaWorkerAccessAttachment, checkpointBetaWorkerCreateIntent, checkpointBetaWorkerObservation, InventoryQuarantineError } from './inventory.mjs';
import { resourceNames } from './key.mjs';

const key = { repository_id: 987654321, repository: 'trusted-owner/incentives-platform', pr: 42, head_sha: 'a'.repeat(40), run_id: 123456789, attempt: 2 };
const names = resourceNames(key);
const inventory = {
  key,
  names,
  cloudflare: { accountId: 'account-1', workerIds: { api: 'worker-tag-1' }, d1Ids: { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' }, accessAppIds: { api: 'access-app-1' }, tokenId: 'token-1' },
  stage: 'creating', createdAt: '2026-09-30T10:00:00.000Z', updatedAt: '2026-09-30T10:00:00.000Z',
};
const NOW = '2026-10-01T09:00:00.000Z';
const ACCESS_AT = '2026-10-01T09:00:01.000Z';
const PREP_AT = '2026-10-01T09:00:02.000Z';
const API_ID = 'e8f70fdbc8b1fb0b8ddb1af166186758';
const OPERATOR_ID = 'f8f70fdbc8b1fb0b8ddb1af166186758';

function mockTransport(responses) {
  const calls = [];
  return { calls, async request(request) { calls.push(request); const next = responses.shift(); if (next instanceof Error) throw next; if (!next) return next; return { status: 200, success: true, ...(Array.isArray(next.result) ? { result_info: { total_count: next.result.length } } : {}), ...next }; } };
}

function envelope(kind, role, path, result, observedAt = NOW, method = 'GET') {
  return { kind, run: key, role, observedAt, request: { method, path }, response: { success: true, result } };
}

function pending() {
  return { ...inventory, cloudflare: { ...inventory.cloudflare, accessAppIds: { api: 'access-app-1', operator: 'access-app-2' } }, betaWorkerIds: { operator: OPERATOR_ID } };
}

function worker(result = {}) {
  return envelope('beta-worker-readback', 'api', `/accounts/account-1/workers/workers/${API_ID}`, {
    id: API_ID, name: names.api, routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null,
    bindings: [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }], ...result,
  });
}

function access(role, result = {}, observedAt = NOW) {
  const id = role === 'api' ? API_ID : OPERATOR_ID;
  const appId = role === 'api' ? 'access-app-1' : 'access-app-2';
  const appName = role === 'api' ? names.accessApi : names.accessOperator;
  return envelope('beta-access-readback', role, `/accounts/account-1/access/apps/${appId}`, {
    id: appId, name: appName, destinations: [{ type: 'worker', worker_id: id, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }], ...result,
  }, observedAt);
}

function createResult() {
  return envelope('beta-worker-create-result', 'api', '/accounts/account-1/workers/workers', worker().response.result, NOW, 'POST');
}

function attachment(role) {
  const appId = role === 'api' ? 'access-app-1' : 'access-app-2';
  const workerId = role === 'api' ? API_ID : OPERATOR_ID;
  return envelope('beta-access-attachment', role, `/accounts/account-1/access/apps/${appId}`, { id: appId, worker_id: workerId, token_id: 'token-1' }, NOW, 'POST');
}

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function established(withAttachments = true) {
  const writes = [];
  const store = { async put(value) { writes.push(value); } };
  const state = pending();
  const intent = await checkpointBetaWorkerCreateIntent(state, 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW);
  const create = planBetaWorkerCreate(intent, () => NOW);
  const id = await checkpointBetaWorkerObservation(intent, createResult(), worker(), store, () => NOW);
  if (!withAttachments) return { writes, store, intent, create, id, attachments: {} };
  const apiAttachment = await checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), store, () => NOW);
  const operatorAttachment = await checkpointBetaWorkerAccessAttachment(id, 'operator', attachment('operator'), store, () => NOW);
  return { writes, store, intent, create, id, attachments: { api: apiAttachment, operator: operatorAttachment } };
}

test('requires opaque durable intent and immutable-ID receipts for create and reads', async () => {
  const { create, id, writes } = await established();
  assert.deepEqual(create, { method: 'POST', path: '/accounts/account-1/workers/workers', body: { name: names.api, subdomain: { enabled: false, previews_enabled: false } } });
  assert.deepEqual(planBetaWorkerRead(id), { method: 'GET', path: `/accounts/account-1/workers/workers/${API_ID}` });
  assert.equal(writes.length, 4);
  assert.throws(() => planBetaWorkerCreate(pending(), 'api'), /receipt/u);
  assert.throws(() => planBetaWorkerRead({}), /receipt/u);
});

test('enforces single create-plan before correlated create-result and immutable-ID checkpoint', async () => {
  const writes = [];
  const store = { async put(value) { writes.push(value); } };
  const intent = await checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW);
  await assert.rejects(checkpointBetaWorkerObservation(intent, createResult(), worker(), store, () => NOW), /receipt/u);
  planBetaWorkerCreate(intent, () => NOW);
  assert.throws(() => planBetaWorkerCreate(intent, () => NOW), /receipt/u);
  await assert.rejects(checkpointBetaWorkerObservation(intent, envelope('beta-worker-create-result', 'api', '/accounts/account-1/workers/workers', { ...worker().response.result, id: OPERATOR_ID }, NOW, 'POST'), worker(), store, () => NOW), /match/u);
});

test('reserves each local run-role transition before an awaited durable write', async () => {
  const firstWrite = deferred(); let entered = 0;
  const store = { async put() { entered += 1; await firstWrite.promise; } };
  const first = checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW);
  while (entered === 0) await Promise.resolve();
  await assert.rejects(checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW), /reserved|ambiguous/u);
  firstWrite.release();
  const intent = await first;
  planBetaWorkerCreate(intent, () => NOW);
  const idWrite = deferred(); let idEntered = 0;
  store.put = async () => { idEntered += 1; await idWrite.promise; };
  const checkpoint = checkpointBetaWorkerObservation(intent, createResult(), worker(), store, () => NOW);
  while (idEntered === 0) await Promise.resolve();
  await assert.rejects(checkpointBetaWorkerObservation(intent, createResult(), worker(), store, () => NOW), /lifecycle|receipt/u);
  idWrite.release();
  const id = await checkpoint;
  const attachmentWrite = deferred(); let attachmentEntered = 0;
  store.put = async () => { attachmentEntered += 1; await attachmentWrite.promise; };
  const attached = checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), store, () => NOW);
  while (attachmentEntered === 0) await Promise.resolve();
  await assert.rejects(checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), store, () => NOW), /phase/u);
  attachmentWrite.release();
  await attached;
  const failedStore = { async put() { throw new Error('intent persistence lost'); } };
  await assert.rejects(checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), failedStore, () => NOW), /intent persistence lost/u);
  await assert.rejects(checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), failedStore, () => NOW), /reserved|ambiguous/u);
});

test('treats reordered fields of one trusted run as one local create lifecycle', async () => {
  const reorderedKey = { attempt: key.attempt, run_id: key.run_id, head_sha: key.head_sha, pr: key.pr, repository: key.repository, repository_id: key.repository_id };
  const reordered = { ...pending(), key: reorderedKey };
  const discovery = { ...envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), run: reorderedKey };
  const firstWrite = deferred();
  const writes = [];
  const store = { async put(value) { writes.push(value); if (writes.length === 1) await firstWrite.promise; } };
  const first = checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW);
  while (writes.length === 0) await Promise.resolve();
  try {
    await assert.rejects(checkpointBetaWorkerCreateIntent(reordered, 'api', discovery, store, () => NOW), /reserved|ambiguous/u);
  } finally {
    firstWrite.release();
  }
  const intent = await first;
  await assert.rejects(checkpointBetaWorkerCreateIntent(reordered, 'api', discovery, store, () => NOW), /reserved|ambiguous/u);
  assert.deepEqual(planBetaWorkerCreate(intent, () => NOW), { method: 'POST', path: '/accounts/account-1/workers/workers', body: { name: names.api, subdomain: { enabled: false, previews_enabled: false } } });
  assert.equal(writes.length, 1);
});

test('keeps two distinct trusted runs independent within one local evidence store', async () => {
  const otherKey = { ...key, run_id: key.run_id + 1 };
  const other = { ...pending(), key: otherKey, names: resourceNames(otherKey) };
  const store = { async put() {} };
  const first = await checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW);
  const second = await checkpointBetaWorkerCreateIntent(other, 'api', { kind: 'beta-worker-precreate-list', run: otherKey, role: 'api', observedAt: NOW, request: { method: 'GET', path: '/accounts/account-1/workers/workers' }, response: { success: true, result: [] } }, store, () => NOW);
  assert.notEqual(planBetaWorkerCreate(first, () => NOW).body.name, planBetaWorkerCreate(second, () => NOW).body.name);
});

test('uses one canonical preparation-clock snapshot rather than a changing callback', async () => {
  const { id, attachments } = await established();
  const observations = { worker: worker(), versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, []), access: { api: access('api', {}, ACCESS_AT), operator: access('operator', {}, ACCESS_AT) }, attachments };
  let calls = 0;
  assert.doesNotThrow(() => prepareBetaWorkerEvidence(id, observations, () => {
    calls += 1;
    return calls === 1 ? PREP_AT : '2026-13-01T09:00:00.000Z';
  }));
  assert.equal(calls, 1);
});

test('rejects invalid dates and evidence capability expiry or attachment-phase revocation', async () => {
  await assert.rejects(checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', [], '2026-13-01T09:00:00.000Z'), { async put() {} }, () => NOW), /time/u);
  const { id, attachments } = await established();
  const observations = { worker: worker(), versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, []), access: { api: access('api', {}, ACCESS_AT), operator: access('operator', {}, ACCESS_AT) }, attachments };
  const evidence = prepareBetaWorkerEvidence(id, observations, () => PREP_AT);
  assert.throws(() => planBetaWorkerDelete(evidence, () => '2026-10-01T09:05:00.001Z'), /expired/u);
  assert.throws(() => planBetaWorkerDelete(evidence, () => '2026-13-01T09:00:00.000Z'), /clock/u);
});

test('requires durable Access attachments before later same-run Access readbacks', async () => {
  const { id, attachments } = await established();
  const observations = { worker: worker(), versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, []), access: { api: access('api', {}, ACCESS_AT), operator: access('operator', {}, ACCESS_AT) }, attachments: {} };
  assert.throws(() => prepareBetaWorkerEvidence(id, observations, () => PREP_AT), /incomplete/u);
  assert.throws(() => prepareBetaWorkerEvidence(id, { ...observations, access: { api: access('api'), operator: access('operator') }, attachments }, () => PREP_AT), /follow attachment/u);
});

test('does not issue an Access attachment receipt when its durable checkpoint fails', async () => {
  const { id, store } = await established(false);
  store.put = async () => { throw new Error('attachment lost'); };
  await assert.rejects(checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), store, () => NOW), /attachment lost/u);
  assert.throws(() => prepareBetaWorkerEvidence(id, { worker: worker(), versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, []), access: { api: access('api', {}, ACCESS_AT), operator: access('operator', {}, ACCESS_AT) }, attachments: {} }, () => PREP_AT), /incomplete/u);
});

test('plans version, patch, and delete only from fresh complete local evidence', async () => {
  const { id, attachments } = await established();
  const observations = { worker: worker(), versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, []), access: { api: access('api', {}, ACCESS_AT), operator: access('operator', {}, ACCESS_AT) }, attachments };
  const evidence = prepareBetaWorkerEvidence(id, observations, () => PREP_AT);
  const bindings = [{ name: 'DB', type: 'd1', database_id: inventory.cloudflare.d1Ids.product }];
  assert.equal(planBetaWorkerVersion(evidence, { module: { name: 'index.js', contentType: 'application/javascript+module', contentBase64: 'ZXhwb3J0IGRlZmF1bHQge307' }, bindings }, undefined, () => PREP_AT).path, `/accounts/account-1/workers/workers/${API_ID}/versions`);
  assert.throws(() => planBetaWorkerDelete(evidence, () => PREP_AT), /consumed/u);
  assert.throws(() => prepareBetaWorkerEvidence(id, observations, () => PREP_AT), /lifecycle/u);
});

test('quarantines skipped checkpoints, bad provenance, stale or duplicate envelopes, and non-inert graph state', async () => {
  assert.throws(() => prepareBetaWorkerEvidence({}, {}), /receipt/u);
  await assert.rejects(checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', [{}]), { async put() {} }, () => NOW), /ambiguous/u);
  const { intent } = await established();
  await assert.rejects(checkpointBetaWorkerObservation(intent, envelope('beta-worker-readback', 'api', `/accounts/account-1/workers/workers/${API_ID}`, [worker().response.result]), { async put() {} }, () => NOW), /invalid/u);
  const { id, attachments } = await established();
  const versions = envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, []);
  const base = { worker: worker(), versions, access: { api: access('api', {}, ACCESS_AT), operator: access('operator', {}, ACCESS_AT) }, attachments };
  for (const bad of [
    { ...base, worker: worker({ deployed_on: 'production' }) },
    { ...base, worker: worker({ bindings: [] }) },
    { ...base, worker: { ...worker(), run: { ...key, attempt: 3 } } },
    { ...base, access: { api: access('api', { public_override: true }), operator: access('operator') } },
    { ...base, access: { api: access('api', {}, '2026-10-01T08:00:00.000Z'), operator: access('operator') } },
    { ...base, versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, [{ id: 'v1' }]) },
  ]) assert.throws(() => prepareBetaWorkerEvidence(id, bad, () => PREP_AT), InventoryQuarantineError);
});

test('refuses deleted phase, lost checkpoint, and unresolved Operator service graph', async () => {
  const deleted = { ...pending(), stage: 'deleted' };
  await assert.rejects(checkpointBetaWorkerCreateIntent(deleted, 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), { async put() {} }, () => NOW), /phase/u);
  await assert.rejects(checkpointBetaWorkerCreateIntent(pending(), 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), { async put() { throw new Error('lost'); } }, () => NOW), /lost/u);
  const writes = [];
  const store = { async put(value) { writes.push(value); } };
  const intent = await checkpointBetaWorkerCreateIntent(inventory, 'operator', envelope('beta-worker-precreate-list', 'operator', '/accounts/account-1/workers/workers', []), store, () => NOW);
  planBetaWorkerCreate(intent, () => NOW);
  const operatorResult = {
    id: OPERATOR_ID, name: names.operator, routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null, bindings: [],
  };
  const operator = await checkpointBetaWorkerObservation(intent, envelope('beta-worker-create-result', 'operator', '/accounts/account-1/workers/workers', operatorResult, NOW, 'POST'), envelope('beta-worker-readback', 'operator', `/accounts/account-1/workers/workers/${OPERATOR_ID}`, operatorResult), store, () => NOW);
  assert.deepEqual(prepareBetaWorkerEvidence(operator, {}), { status: 'unsupported', reason: 'service-binding-remapping-unresolved' });
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
