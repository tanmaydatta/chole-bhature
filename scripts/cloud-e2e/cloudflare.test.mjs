import assert from 'node:assert/strict';
import test from 'node:test';

import * as cloudflareProtocol from './cloudflare.mjs';
import { createCloudflareClient, MutationQuarantinedError, planBetaWorkerCreate, planBetaWorkerDelete, planBetaWorkerRead, planBetaWorkerVersion, prepareBetaWorkerEvidence } from './cloudflare.mjs';
import { checkpointBetaAccessCreateIntent, checkpointBetaAccessIdentity, checkpointBetaTokenCreateIntent, checkpointBetaWorkerAccessAttachment, checkpointBetaWorkerCreateIntent, checkpointBetaWorkerDependencies, checkpointBetaWorkerObservation, InventoryQuarantineError } from './inventory.mjs';
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
const IDENTITY_ID = 'd8f70fdbc8b1fb0b8ddb1af166186758';

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

async function workerReceipts(store, runKey = key, runIds = { api: API_ID, identity: IDENTITY_ID, operator: OPERATOR_ID }, overrides = {}, times = {}, priorByRole = {}) {
  const runNames = resourceNames(runKey);
  const state = { ...inventory, key: runKey, names: runNames, cloudflare: { ...inventory.cloudflare, workerIds: {}, accessAppIds: {}, tokenId: null }, betaWorkerIds: {} };
  const ids = {};
  let intent; let create;
  for (const [role, databaseId] of [['api', inventory.cloudflare.d1Ids.product], ['identity', inventory.cloudflare.d1Ids.auth], ['operator', null]]) {
    const at = times[role] ?? NOW;
    const roleState = { ...state, betaWorkerIds: priorByRole[role] ?? {} };
    const betaId = runIds[role];
    const result = { id: betaId, name: runNames[role], routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null, bindings: databaseId ? [{ name: 'DB', type: 'd1', database_id: databaseId }] : [], ...overrides[role] };
    const roleIntent = await checkpointBetaWorkerCreateIntent(roleState, role, { ...envelope('beta-worker-precreate-list', role, '/accounts/account-1/workers/workers', [], at), run: runKey }, store, () => at);
    const roleCreate = planBetaWorkerCreate(roleIntent, () => at);
    ids[role] = await checkpointBetaWorkerObservation(roleIntent, { ...envelope('beta-worker-create-result', role, '/accounts/account-1/workers/workers', result, at, 'POST'), run: runKey }, { ...envelope('beta-worker-readback', role, `/accounts/account-1/workers/workers/${betaId}`, result, at), run: runKey }, store, () => at);
    if (role === 'api') { intent = roleIntent; create = roleCreate; }
  }
  return { ids, intent, create, runNames };
}

function tokenCreate(result = { id: 'token-1', name: names.token }) {
  return envelope('beta-token-create-result', 'api', '/accounts/account-1/access/service_tokens', result, NOW, 'POST');
}

function tokenRead(result = { id: 'token-1', name: names.token }) {
  return envelope('beta-token-readback', 'api', '/accounts/account-1/access/service_tokens/token-1', result);
}

async function plannedToken(ids, store) {
  const receipt = await checkpointBetaTokenCreateIntent(ids.api, ids, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), store, () => NOW);
  assert.deepEqual(cloudflareProtocol.planBetaTokenCreate(receipt, () => NOW), { method: 'POST', path: '/accounts/account-1/access/service_tokens', body: { name: names.token } });
  return receipt;
}

async function plannedAccess(id, role, store) {
  const receipt = await checkpointBetaAccessCreateIntent(id, role, envelope('beta-access-precreate-list', role, '/accounts/account-1/access/apps', []), store, () => NOW);
  return { receipt, plan: cloudflareProtocol.planBetaAccessCreate(receipt, () => NOW) };
}

async function beforeAccess(store) {
  const { ids } = await workerReceipts(store);
  const receipts = await checkpointBetaWorkerDependencies(await plannedToken(ids, store), ids, tokenCreate(), tokenRead(), store, () => NOW);
  return { ids, receipts };
}

async function established(withAttachments = true) {
  const writes = [];
  const store = { async put(value) { writes.push(value); } };
  const { ids, intent, create } = await workerReceipts(store);
  const token = { id: 'token-1', name: names.token };
  let receipts = await checkpointBetaWorkerDependencies(await plannedToken(ids, store), ids, envelope('beta-token-create-result', 'api', '/accounts/account-1/access/service_tokens', token, NOW, 'POST'), envelope('beta-token-readback', 'api', '/accounts/account-1/access/service_tokens/token-1', token), store, () => NOW);
  for (const role of ['api', 'operator']) {
    const appId = role === 'api' ? 'access-app-1' : 'access-app-2';
    const workerId = role === 'api' ? API_ID : OPERATOR_ID;
    const app = { id: appId, name: role === 'api' ? names.accessApi : names.accessOperator, destinations: [{ type: 'worker', worker_id: workerId, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] };
    await plannedAccess(receipts.api, role, store);
    receipts = await checkpointBetaAccessIdentity(receipts.api, role, envelope('beta-access-create-result', role, '/accounts/account-1/access/apps', app, NOW, 'POST'), envelope('beta-access-readback', role, `/accounts/account-1/access/apps/${appId}`, app), store, () => NOW);
  }
  const id = receipts.api;
  if (!withAttachments) return { writes, store, intent, create, id, attachments: {} };
  const apiAttachment = await checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), store, () => NOW);
  const operatorAttachment = await checkpointBetaWorkerAccessAttachment(id, 'operator', attachment('operator'), store, () => NOW);
  return { writes, store, intent, create, id, attachments: { api: apiAttachment, operator: operatorAttachment } };
}

test('requires opaque durable intent and immutable-ID receipts for create and reads', async () => {
  const { create, id, writes } = await established();
  assert.deepEqual(create, { method: 'POST', path: '/accounts/account-1/workers/workers', body: { name: names.api, subdomain: { enabled: false, previews_enabled: false } } });
  assert.deepEqual(planBetaWorkerRead(id, () => NOW), { method: 'GET', path: `/accounts/account-1/workers/workers/${API_ID}` });
  assert.equal(writes.length, 14);
  assert.throws(() => planBetaWorkerCreate(pending(), 'api'), /receipt/u);
  assert.throws(() => planBetaWorkerRead({}), /receipt/u);
});

test('plans Beta-ID Access creation after empty-inventory Worker identity checkpoints', async () => {
  const empty = { ...inventory, cloudflare: { ...inventory.cloudflare, workerIds: {}, accessAppIds: {}, tokenId: null }, betaWorkerIds: {} };
  const writes = [];
  const store = { async put(value) { writes.push(value); } };
  const ids = {};
  for (const [role, id, d1] of [['api', API_ID, inventory.cloudflare.d1Ids.product], ['identity', IDENTITY_ID, inventory.cloudflare.d1Ids.auth], ['operator', OPERATOR_ID, null]]) {
    const result = { id, name: names[role], routes: [], subdomain: { enabled: false, previews_enabled: false }, deployed_on: null, bindings: d1 ? [{ name: 'DB', type: 'd1', database_id: d1 }] : [] };
    const intent = await checkpointBetaWorkerCreateIntent(empty, role, envelope('beta-worker-precreate-list', role, '/accounts/account-1/workers/workers', []), store, () => NOW);
    assert.equal(planBetaWorkerCreate(intent, () => NOW).body.name, names[role]);
    ids[role] = await checkpointBetaWorkerObservation(intent, envelope('beta-worker-create-result', role, '/accounts/account-1/workers/workers', result, NOW, 'POST'), envelope('beta-worker-readback', role, `/accounts/account-1/workers/workers/${id}`, result), store, () => NOW);
  }
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(ids.api, () => NOW), /intent/u);
  const token = { id: 'token-1', name: names.token };
  const certified = await checkpointBetaWorkerDependencies(await plannedToken(ids, store), ids,
    envelope('beta-token-create-result', 'api', '/accounts/account-1/access/service_tokens', token, NOW, 'POST'),
    envelope('beta-token-readback', 'api', '/accounts/account-1/access/service_tokens/token-1', token), store, () => NOW);
  assert.equal(writes.at(-1).betaWorkerIds.identity, IDENTITY_ID);
  assert.equal(writes.at(-1).cloudflare.tokenId, 'token-1');
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(ids.api, () => NOW), /intent/u);
  assert.deepEqual((await plannedAccess(certified.api, 'api', store)).plan, {
    method: 'POST', path: '/accounts/account-1/access/apps',
    body: { name: names.accessApi, destinations: [{ type: 'worker', worker_id: API_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] },
  });
  const apiApp = { id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: API_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] };
  const api = await checkpointBetaAccessIdentity(certified.api, 'api', envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', apiApp, NOW, 'POST'), access('api'), store, () => NOW);
  assert.equal(writes.at(-1).cloudflare.accessAppIds.api, 'access-app-1');
  assert.throws(() => planBetaWorkerRead(certified.api, () => NOW), /receipt/u);
  assert.deepEqual((await plannedAccess(api.api, 'operator', store)).plan, {
    method: 'POST', path: '/accounts/account-1/access/apps',
    body: { name: names.accessOperator, destinations: [{ type: 'worker', worker_id: OPERATOR_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] },
  });
  const operatorApp = { id: 'access-app-2', name: names.accessOperator, destinations: [{ type: 'worker', worker_id: OPERATOR_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] };
  const ready = await checkpointBetaAccessIdentity(api.api, 'operator', envelope('beta-access-create-result', 'operator', '/accounts/account-1/access/apps', operatorApp, NOW, 'POST'), access('operator'), store, () => NOW);
  assert.equal(writes.at(-1).cloudflare.accessAppIds.operator, 'access-app-2');
  assert.deepEqual(planBetaWorkerRead(ready.api, () => NOW), { method: 'GET', path: `/accounts/account-1/workers/workers/${API_ID}` });
  assert.deepEqual(planBetaWorkerRead(ready.identity, () => NOW), { method: 'GET', path: `/accounts/account-1/workers/workers/${IDENTITY_ID}` });
});

test('raw future IDs cannot authorize a Beta Access create plan after a real Worker checkpoint', async () => {
  const seeded = { ...pending(), cloudflare: { ...pending().cloudflare, accessAppIds: {}, tokenId: 'token-1' }, betaWorkerIds: { identity: IDENTITY_ID, operator: OPERATOR_ID } };
  const store = { async put() {} };
  const intent = await checkpointBetaWorkerCreateIntent(seeded, 'api', envelope('beta-worker-precreate-list', 'api', '/accounts/account-1/workers/workers', []), store, () => NOW);
  planBetaWorkerCreate(intent, () => NOW);
  const id = await checkpointBetaWorkerObservation(intent, createResult(), worker(), store, () => NOW);
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(id, () => NOW), /intent/u);
});

test('dependency checkpoint is durable before every sibling ID becomes usable and poisons failed or overlapping transitions', async () => {
  const barrier = deferred(); let entered = 0; let fail = false;
  const store = { async put() { entered += 1; if (entered === 8) { await barrier.promise; if (fail) throw new Error('dependency checkpoint lost'); } } };
  const { ids } = await workerReceipts(store);
  const tokenIntent = await plannedToken(ids, store);
  const first = checkpointBetaWorkerDependencies(tokenIntent, ids, tokenCreate(), tokenRead(), store, () => NOW);
  while (entered < 8) await Promise.resolve();
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(ids.api, () => NOW), /intent/u);
  await assert.rejects(checkpointBetaWorkerDependencies(tokenIntent, ids, tokenCreate(), tokenRead(), store, () => NOW), /required/u);
  fail = true; barrier.release();
  await assert.rejects(first, /dependency checkpoint lost/u);
  await assert.rejects(checkpointBetaWorkerDependencies(tokenIntent, ids, tokenCreate(), tokenRead(), store, () => NOW), /required/u);
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(ids.api, () => NOW), /intent/u);
});

test('resource names and a Worker ID receipt alone cannot authorize an Access POST plan', async () => {
  const store = { async put() {} };
  const { ids } = await workerReceipts(store);
  assert.throws(() => cloudflareProtocol.planBetaTokenCreate(ids.api, () => NOW), /intent/u);
  await assert.rejects(checkpointBetaWorkerDependencies(ids.api, ids, tokenCreate(), tokenRead(), store, () => NOW), /intent/u);
  const certified = await checkpointBetaWorkerDependencies(await plannedToken(ids, store), ids, tokenCreate(), tokenRead(), store, () => NOW);
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(certified.api, () => NOW), /intent/u);
});

test('token and Access intents reserve before persistence and failed writes remain poisoned', async () => {
  const tokenBarrier = deferred(); let tokenWrites = 0;
  const store = { async put() { tokenWrites += 1; if (tokenWrites === 7) { await tokenBarrier.promise; throw new Error('token intent lost'); } } };
  const { ids } = await workerReceipts(store);
  const discovery = envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []);
  const first = checkpointBetaTokenCreateIntent(ids.api, ids, discovery, store, () => NOW);
  while (tokenWrites < 7) await Promise.resolve();
  await assert.rejects(checkpointBetaTokenCreateIntent(ids.api, ids, discovery, store, () => NOW), /reserved|ambiguous/u);
  tokenBarrier.release();
  await assert.rejects(first, /token intent lost/u);
  await assert.rejects(checkpointBetaTokenCreateIntent(ids.api, ids, discovery, store, () => NOW), /reserved|ambiguous/u);

  const accessStore = { async put() {} };
  const { receipts } = await beforeAccess(accessStore);
  const accessBarrier = deferred(); let accessWrites = 0;
  accessStore.put = async () => { accessWrites += 1; await accessBarrier.promise; throw new Error('Access intent lost'); };
  const accessDiscovery = envelope('beta-access-precreate-list', 'api', '/accounts/account-1/access/apps', []);
  const accessFirst = checkpointBetaAccessCreateIntent(receipts.api, 'api', accessDiscovery, accessStore, () => NOW);
  while (accessWrites === 0) await Promise.resolve();
  await assert.rejects(checkpointBetaAccessCreateIntent(receipts.api, 'api', accessDiscovery, accessStore, () => NOW), /phase|incomplete|planned/u);
  accessBarrier.release();
  await assert.rejects(accessFirst, /Access intent lost/u);
  await assert.rejects(checkpointBetaAccessCreateIntent(receipts.api, 'api', accessDiscovery, accessStore, () => NOW), /phase|incomplete|planned/u);
});

test('different trusted runs can checkpoint token identities concurrently in one local store', async () => {
  const otherKey = { ...key, run_id: key.run_id + 1 };
  const otherIds = { api: 'b8f70fdbc8b1fb0b8ddb1af166186758', identity: 'c8f70fdbc8b1fb0b8ddb1af166186758', operator: 'a8f70fdbc8b1fb0b8ddb1af166186758' };
  const barrier = deferred(); let firstEntered = false;
  const store = { async put(value) { if (value.type === 'beta-token-create-intent' && value.key.run_id === key.run_id) { firstEntered = true; await barrier.promise; } } };
  const first = await workerReceipts(store);
  const second = await workerReceipts(store, otherKey, otherIds);
  const firstIntentPromise = checkpointBetaTokenCreateIntent(first.ids.api, first.ids, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), store, () => NOW);
  while (!firstEntered) await Promise.resolve();
  const secondDiscovery = { ...envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), run: otherKey };
  const secondIntent = await checkpointBetaTokenCreateIntent(second.ids.api, second.ids, secondDiscovery, store, () => NOW);
  assert.equal(cloudflareProtocol.planBetaTokenCreate(secondIntent, () => NOW).body.name, second.runNames.token);
  const secondToken = { id: 'token-other', name: second.runNames.token };
  const secondReceipts = await checkpointBetaWorkerDependencies(secondIntent, second.ids,
    { ...envelope('beta-token-create-result', 'api', '/accounts/account-1/access/service_tokens', secondToken, NOW, 'POST'), run: otherKey },
    { ...envelope('beta-token-readback', 'api', '/accounts/account-1/access/service_tokens/token-other', secondToken), run: otherKey }, store, () => NOW);
  assert.deepEqual(planBetaWorkerRead(secondReceipts.api, () => NOW), { method: 'GET', path: `/accounts/account-1/workers/workers/${otherIds.api}` });
  barrier.release();
  const firstIntent = await firstIntentPromise;
  cloudflareProtocol.planBetaTokenCreate(firstIntent, () => NOW);
  const firstReceipts = await checkpointBetaWorkerDependencies(firstIntent, first.ids, tokenCreate(), tokenRead(), store, () => NOW);
  assert.deepEqual(planBetaWorkerRead(firstReceipts.api, () => NOW), { method: 'GET', path: `/accounts/account-1/workers/workers/${API_ID}` });
});

test('new identity transitions use one canonical injected clock snapshot each', async () => {
  const store = { async put() {} };
  const { ids } = await workerReceipts(store);
  let calls = 0;
  const changingNow = () => { calls += 1; return calls === 1 ? NOW : '2026-13-01T09:00:00.000Z'; };
  const intent = await checkpointBetaTokenCreateIntent(ids.api, ids, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), store, changingNow);
  assert.equal(calls, 1);
  cloudflareProtocol.planBetaTokenCreate(intent, () => NOW);
  const receipts = await checkpointBetaWorkerDependencies(intent, ids, tokenCreate(), tokenRead(), store, () => NOW);
  calls = 0;
  const accessIntent = await checkpointBetaAccessCreateIntent(receipts.api, 'api', envelope('beta-access-precreate-list', 'api', '/accounts/account-1/access/apps', []), store, changingNow);
  assert.equal(calls, 1);
  assert.equal(cloudflareProtocol.planBetaAccessCreate(accessIntent, () => NOW).body.name, names.accessApi);
});

test('Access create checkpoint rejects mismatched account, role, ID, destination, token, policy, and time', async () => {
  const app = { id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: API_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] };
  const cases = [
    { create: { ...envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', app, NOW, 'POST'), run: { ...key, attempt: 3 } } },
    { create: envelope('beta-access-create-result', 'operator', '/accounts/account-1/access/apps', app, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/other/access/apps', app, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', { ...app, id: 'foreign/id' }, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', { ...app, destinations: [{ type: 'worker', worker_id: OPERATOR_ID, overrides: [] }] }, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', { ...app, policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'foreign' } }] }] }, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', { ...app, policies: [{ decision: 'allow', include: [{ service_token: { token_id: 'token-1' } }] }] }, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', { ...app, policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }], require: [] }] }, NOW, 'POST') },
    { create: envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', app, '2026-13-01T09:00:00.000Z', 'POST') },
    { read: envelope('beta-access-readback', 'api', '/accounts/account-1/access/apps/foreign', app) },
    { read: envelope('beta-access-readback', 'api', '/accounts/account-1/access/apps/access-app-1', { ...app, id: 'foreign' }) },
  ];
  for (const sample of cases) {
    const writes = []; const store = { async put(value) { writes.push(value); } };
    const { receipts } = await beforeAccess(store);
    await plannedAccess(receipts.api, 'api', store);
    await assert.rejects(checkpointBetaAccessIdentity(receipts.api, 'api', sample.create ?? envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', app, NOW, 'POST'), sample.read ?? envelope('beta-access-readback', 'api', '/accounts/account-1/access/apps/access-app-1', app), store, () => NOW), InventoryQuarantineError);
    assert.equal(writes.length, 9);
    assert.throws(() => cloudflareProtocol.planBetaAccessCreate(receipts.api, () => NOW), /intent/u);
  }
});

test('Access ID remains unusable through an overlapping or failed durable checkpoint', async () => {
  const store = { async put() {} };
  const { receipts } = await beforeAccess(store);
  await plannedAccess(receipts.api, 'api', store);
  const app = { id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: API_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] };
  const created = envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', app, NOW, 'POST');
  const readback = envelope('beta-access-readback', 'api', '/accounts/account-1/access/apps/access-app-1', app);
  await assert.rejects(checkpointBetaAccessIdentity(receipts.identity, 'api', created, readback, store, () => NOW), /lifecycle/u);
  const barrier = deferred(); let entered = false;
  store.put = async () => { entered = true; await barrier.promise; throw new Error('Access ID checkpoint lost'); };
  const first = checkpointBetaAccessIdentity(receipts.api, 'api', created, readback, store, () => NOW);
  while (!entered) await Promise.resolve();
  await assert.rejects(checkpointBetaAccessIdentity(receipts.api, 'api', created, readback, store, () => NOW), /lifecycle/u);
  assert.throws(() => planBetaWorkerRead(receipts.api, () => NOW), /receipt|phase|expired/u, 'old ID read may remain only while its exact Worker ID is valid');
  barrier.release();
  await assert.rejects(first, /Access ID checkpoint lost/u);
  await assert.rejects(checkpointBetaAccessIdentity(receipts.api, 'api', created, readback, store, () => NOW), /lifecycle/u);
  await assert.rejects(checkpointBetaWorkerAccessAttachment(receipts.api, 'api', attachment('api'), store, () => NOW), /phase/u);
});

test('dependency transition refuses foreign, malformed, stale, and uncorrelated token or sibling evidence', async () => {
  const cases = [
    ({ ids }) => ({ ids, create: { ...tokenCreate(), run: { ...key, attempt: 3 } }, read: tokenRead() }),
    ({ ids }) => ({ ids, create: { ...tokenCreate(), request: { method: 'POST', path: '/accounts/other/access/service_tokens' } }, read: tokenRead() }),
    ({ ids }) => ({ ids, create: tokenCreate({ id: 'token-1', name: 'foreign' }), read: tokenRead() }),
    ({ ids }) => ({ ids, create: tokenCreate(), read: tokenRead({ id: 'token-2', name: names.token }) }),
    ({ ids }) => ({ ids, create: { ...tokenCreate(), observedAt: '2026-13-01T09:00:00.000Z' }, read: tokenRead() }),
    ({ ids }) => ({ ids, create: { ...tokenCreate(), observedAt: '2026-10-01T08:54:59.999Z' }, read: tokenRead() }),
  ];
  for (const makeCase of cases) {
    const writes = []; const store = { async put(value) { writes.push(value); } };
    const ids = (await workerReceipts(store)).ids;
    const input = makeCase({ ids });
    const tokenIntent = await plannedToken(ids, store);
    await assert.rejects(checkpointBetaWorkerDependencies(tokenIntent, input.ids, input.create, input.read, store, () => NOW), InventoryQuarantineError);
    assert.equal(writes.length, 7);
    assert.throws(() => cloudflareProtocol.planBetaAccessCreate(ids.api, () => NOW), /intent/u);
  }
  const store = { async put() {} };
  const ids = (await workerReceipts(store)).ids;
  await assert.rejects(checkpointBetaTokenCreateIntent(ids.api, { ...ids, operator: {} }, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), store, () => NOW), InventoryQuarantineError);
});

test('a sibling ID with an unresolved Worker graph cannot authorize the token intent', async () => {
  const store = { async put() {} };
  const { ids } = await workerReceipts(store, key, { api: API_ID, identity: IDENTITY_ID, operator: OPERATOR_ID }, { operator: { deployed_on: 'production' } });
  await assert.rejects(checkpointBetaTokenCreateIntent(ids.api, ids, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), store, () => NOW), /graph|inert/u);
});

test('a conflicting prior Beta ID in a non-anchor sibling refuses durable token intent', async () => {
  const writes = []; const store = { async put(value) { writes.push(value); } };
  const { ids } = await workerReceipts(store, key, { api: API_ID, identity: IDENTITY_ID, operator: OPERATOR_ID }, {}, {}, { operator: { api: 'a8f70fdbc8b1fb0b8ddb1af166186758' } });
  assert.equal(writes.length, 6);
  await assert.rejects(checkpointBetaTokenCreateIntent(ids.api, ids, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', []), store, () => NOW), /immutable ID/u);
  assert.equal(writes.length, 6, 'conflicting sibling evidence cannot produce durable token intent');
});

const STAGGERED = { api: '2026-10-01T09:03:00.000Z', identity: NOW, operator: '2026-10-01T09:04:00.000Z' };
const GRAPH_AT = '2026-10-01T09:04:00.000Z';
const GRAPH_EXPIRED_AT = '2026-10-01T09:05:00.001Z';

async function staggeredDependencies(store) {
  const { ids } = await workerReceipts(store, key, { api: API_ID, identity: IDENTITY_ID, operator: OPERATOR_ID }, {}, STAGGERED);
  const token = { id: 'token-1', name: names.token };
  const intent = await checkpointBetaTokenCreateIntent(ids.api, ids, envelope('beta-token-precreate-list', 'api', '/accounts/account-1/access/service_tokens', [], GRAPH_AT), store, () => GRAPH_AT);
  cloudflareProtocol.planBetaTokenCreate(intent, () => GRAPH_AT);
  return checkpointBetaWorkerDependencies(intent, ids,
    envelope('beta-token-create-result', 'api', '/accounts/account-1/access/service_tokens', token, GRAPH_AT, 'POST'),
    envelope('beta-token-readback', 'api', '/accounts/account-1/access/service_tokens/token-1', token, GRAPH_AT), store, () => GRAPH_AT);
}

async function staggeredAccess(receipts, role, store) {
  const intent = await checkpointBetaAccessCreateIntent(receipts.api, role, envelope('beta-access-precreate-list', role, '/accounts/account-1/access/apps', [], GRAPH_AT), store, () => GRAPH_AT);
  cloudflareProtocol.planBetaAccessCreate(intent, () => GRAPH_AT);
  const app = access(role).response.result;
  return checkpointBetaAccessIdentity(receipts.api, role,
    envelope('beta-access-create-result', role, '/accounts/account-1/access/apps', app, GRAPH_AT, 'POST'),
    envelope('beta-access-readback', role, `/accounts/account-1/access/apps/${app.id}`, app, GRAPH_AT), store, () => GRAPH_AT);
}

test('expired non-anchor Identity receipt cannot authorize Access intent, plan, or checkpoint', async () => {
  const store = { async put() {} };
  const forIntent = await staggeredDependencies(store);
  await assert.rejects(checkpointBetaAccessCreateIntent(forIntent.api, 'api', envelope('beta-access-precreate-list', 'api', '/accounts/account-1/access/apps', [], GRAPH_EXPIRED_AT), store, () => GRAPH_EXPIRED_AT), /expired/u);

  const planStore = { async put() {} };
  const forPlan = await staggeredDependencies(planStore);
  const planIntent = await checkpointBetaAccessCreateIntent(forPlan.api, 'api', envelope('beta-access-precreate-list', 'api', '/accounts/account-1/access/apps', [], GRAPH_AT), planStore, () => GRAPH_AT);
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(planIntent, () => GRAPH_EXPIRED_AT), /expired/u);

  const checkpointStore = { async put() {} };
  const forCheckpoint = await staggeredDependencies(checkpointStore);
  const checkpointIntent = await checkpointBetaAccessCreateIntent(forCheckpoint.api, 'api', envelope('beta-access-precreate-list', 'api', '/accounts/account-1/access/apps', [], GRAPH_AT), checkpointStore, () => GRAPH_AT);
  cloudflareProtocol.planBetaAccessCreate(checkpointIntent, () => GRAPH_AT);
  const app = access('api').response.result;
  await assert.rejects(checkpointBetaAccessIdentity(forCheckpoint.api, 'api', envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', app, GRAPH_EXPIRED_AT, 'POST'), envelope('beta-access-readback', 'api', '/accounts/account-1/access/apps/access-app-1', app, GRAPH_EXPIRED_AT), checkpointStore, () => GRAPH_EXPIRED_AT), /expired/u);
});

test('expired non-anchor Identity receipt cannot authorize Access attachment or code preparation', async () => {
  const store = { async put() {} };
  let receipts = await staggeredDependencies(store);
  receipts = await staggeredAccess(receipts, 'api', store);
  receipts = await staggeredAccess(receipts, 'operator', store);
  await assert.rejects(checkpointBetaWorkerAccessAttachment(receipts.api, 'api', envelope('beta-access-attachment', 'api', '/accounts/account-1/access/apps/access-app-1', { id: 'access-app-1', worker_id: API_ID, token_id: 'token-1' }, GRAPH_EXPIRED_AT, 'POST'), store, () => GRAPH_EXPIRED_AT), /expired/u);
  const attachments = {};
  for (const role of ['api', 'operator']) attachments[role] = await checkpointBetaWorkerAccessAttachment(receipts.api, role,
    envelope('beta-access-attachment', role, `/accounts/account-1/access/apps/${access(role).response.result.id}`, { id: access(role).response.result.id, worker_id: role === 'api' ? API_ID : OPERATOR_ID, token_id: 'token-1' }, GRAPH_AT, 'POST'), store, () => GRAPH_AT);
  const observations = { worker: envelope('beta-worker-readback', 'api', `/accounts/account-1/workers/workers/${API_ID}`, worker().response.result, GRAPH_EXPIRED_AT), versions: envelope('beta-version-list', 'api', `/accounts/account-1/workers/workers/${API_ID}/versions`, [], GRAPH_EXPIRED_AT), access: { api: access('api', {}, GRAPH_EXPIRED_AT), operator: access('operator', {}, GRAPH_EXPIRED_AT) }, attachments };
  assert.throws(() => prepareBetaWorkerEvidence(receipts.api, observations, () => GRAPH_EXPIRED_AT), /expired/u);
});

test('dependency and Access checkpoints revoke every prior role receipt without extending its lifetime', async () => {
  const store = { async put() {} };
  const { ids } = await workerReceipts(store);
  const certified = await checkpointBetaWorkerDependencies(await plannedToken(ids, store), ids, tokenCreate(), tokenRead(), store, () => NOW);
  for (const role of ['api', 'identity', 'operator']) assert.throws(() => planBetaWorkerRead(ids[role], () => NOW), /receipt/u);
  const accessIntent = await checkpointBetaAccessCreateIntent(certified.api, 'api', envelope('beta-access-precreate-list', 'api', '/accounts/account-1/access/apps', []), store, () => NOW);
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(accessIntent, () => '2026-10-01T09:05:00.001Z'), /expired/u);
  cloudflareProtocol.planBetaAccessCreate(accessIntent, () => NOW);
  const app = { id: 'access-app-1', name: names.accessApi, destinations: [{ type: 'worker', worker_id: API_ID, overrides: [] }], policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: 'token-1' } }] }] };
  const next = await checkpointBetaAccessIdentity(certified.api, 'api', envelope('beta-access-create-result', 'api', '/accounts/account-1/access/apps', app, NOW, 'POST'), access('api'), store, () => NOW);
  for (const role of ['api', 'identity', 'operator']) assert.throws(() => planBetaWorkerRead(certified[role], () => NOW), /receipt/u);
  const operatorIntent = await checkpointBetaAccessCreateIntent(next.api, 'operator', envelope('beta-access-precreate-list', 'operator', '/accounts/account-1/access/apps', []), store, () => NOW);
  assert.throws(() => cloudflareProtocol.planBetaAccessCreate(operatorIntent, () => '2026-10-01T09:05:00.001Z'), /expired/u);
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
  await checkpoint;
  const { id, store: attachmentStore } = await established(false);
  const attachmentWrite = deferred(); let attachmentEntered = 0;
  attachmentStore.put = async () => { attachmentEntered += 1; await attachmentWrite.promise; };
  const attached = checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), attachmentStore, () => NOW);
  while (attachmentEntered === 0) await Promise.resolve();
  await assert.rejects(checkpointBetaWorkerAccessAttachment(id, 'api', attachment('api'), attachmentStore, () => NOW), /phase/u);
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
  assert.deepEqual(prepareBetaWorkerEvidence(operator, {}, () => NOW), { status: 'unsupported', reason: 'service-binding-remapping-unresolved' });
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

test('a create response cannot substitute a preexisting staging D1 UUID', async () => {
  const reused = '33333333-3333-4333-8333-333333333333';
  const transport = mockTransport([
    { result: [{ name: 'manual-staging-auth', uuid: reused }] },
    { result: { name: inventory.names.product, uuid: reused } },
  ]);
  const writes = [];
  const creating = { ...inventory, cloudflare: { ...inventory.cloudflare, d1Ids: { auth: inventory.cloudflare.d1Ids.auth } } };
  const client = createCloudflareClient({ accountId: 'account-1', inventory: creating, transport, store: { async put(value) { writes.push(value); } }, now: () => NOW });
  await assert.rejects(client.createD1('product'), /D1|ambiguous|reused/u);
  assert.deepEqual(writes.map(value => value.type), ['create-intent']);
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
