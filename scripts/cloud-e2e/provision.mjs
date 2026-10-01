import { readFile } from 'node:fs/promises';

import { verifyBundleV1 } from './artifact.mjs';
import { createCloudflareClient, planBetaAccessCreate, planBetaTokenCreate, planBetaWorkerCreate, planBetaWorkerVersion, prepareBetaWorkerEvidence } from './cloudflare.mjs';
import { betaWorkerReceipt, checkpoint, checkpointBetaAccessCreateIntent, checkpointBetaAccessIdentity, checkpointBetaTokenCreateIntent, checkpointBetaWorkerAccessAttachment, checkpointBetaWorkerCreateIntent, checkpointBetaWorkerDependencies, checkpointBetaWorkerObservation, validateInventory } from './inventory.mjs';
import { parseStackKey, resourceNames } from './key.mjs';
import { cleanupMockSession, registerMockSession } from './teardown.mjs';

const WORKERS = ['api', 'identity', 'operator'];
const ACCESS = ['api', 'operator'];
const HEX_ID = /^[0-9a-f]{32}$/u;

function clock(now) {
  const value = now();
  const ms = Date.parse(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new TypeError('Invalid mock controller clock.');
  return { value, ms };
}

function deadline(now, start, stage) {
  const ms = clock(now).ms;
  if (ms < start || ms - start > 25 * 60_000 || stage !== undefined && ms - stage > 5 * 60_000) {
    const error = new Error('Controller deadline exceeded.');
    error.code = 'CONTROLLER_TIMEOUT';
    throw error;
  }
}

function transient(error) {
  return error?.status === 429 || Number.isInteger(error?.status) && error.status >= 500 && error.status <= 599 || error?.code === 'ETIMEDOUT';
}

async function read(action, now, start, stage, wait) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    deadline(now, start, stage);
    try { return await action(); }
    catch (error) {
      if (!transient(error) || attempt === 2) throw error;
      await wait(100 * 2 ** attempt);
    }
  }
}

function reason(error) {
  if (error?.code === 'CONTROLLER_TIMEOUT') return 'deadline-exceeded';
  if (error?.code === 'QUARANTINED') return 'evidence-quarantined';
  if (error?.name === 'BundleVerificationError') return 'bundle-rejected';
  return 'mock-operation-failed';
}

function d1Client(session) {
  const request = request => request.method === 'GET' ? read(async () => {
    const response = await session.provider.request(request);
    if (response?.status === 429 || response?.status >= 500 && response.status <= 599) throw Object.assign(new Error('Transient mock D1 read.'), { status: response.status });
    return response;
  }, session.now, session.started, session.d1Started, session.wait) : session.provider.request(request);
  return createCloudflareClient({ accountId: session.accountId, inventory: session.inventory, transport: { request }, store: session.store, now: session.now });
}

async function observe(session, kind, role, request, start, stage, wait, safe = true) {
  const action = () => { deadline(session.now, start, stage); return session.provider.observe({ kind, role, key: session.key, request }); };
  return safe ? read(action, session.now, start, stage, wait) : action();
}

function initialInventory(key, accountId, now) {
  if (typeof accountId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(accountId) || /staging|default|demo/iu.test(accountId)) throw new TypeError('Unsafe account identity.');
  const at = clock(now).value;
  return validateInventory({ key, names: resourceNames(key), cloudflare: { accountId, workerIds: {}, d1Ids: {}, accessAppIds: {}, tokenId: null }, stage: 'creating', createdAt: at, updatedAt: at });
}

async function d1Stage(session, verified, start, wait) {
  const stage = clock(session.now).ms;
  session.started = start;
  session.d1Started = stage;
  session.wait = wait;
  for (const role of ['product', 'auth']) {
    deadline(session.now, start, stage);
    session.pending.add(`d1:${role}`);
    const created = await d1Client(session).createD1(role);
    session.inventory = validateInventory({ ...session.inventory, cloudflare: { ...session.inventory.cloudflare, d1Ids: { ...session.inventory.cloudflare.d1Ids, [role]: created.uuid } }, updatedAt: clock(session.now).value });
    session.pending.delete(`d1:${role}`);
    const exact = await d1Client(session).getD1(created.uuid);
    if (exact.missing || exact.result?.uuid !== created.uuid || exact.result?.name !== session.inventory.names[role]) throw new TypeError('D1 readback changed.');
  }
  for (const [role, directory] of [['product', 'api'], ['auth', 'identity']]) {
    const migrations = verified.files.filter(file => file.path.includes(`/migrations/${directory}/`)).sort((a, b) => a.path.localeCompare(b.path));
    if (migrations.length === 0) throw new TypeError('No D1 migration.');
    for (const migration of migrations) {
      deadline(session.now, start, stage);
      const sql = await readFile(migration.path, 'utf8');
      const result = await d1Client(session).queryD1(role, sql);
      if (!Array.isArray(result) || result.length === 0 || result.some(item => item?.success !== true)) throw new TypeError('D1 migration failed.');
    }
  }
}

async function workerStage(session, start, wait) {
  const path = `/accounts/${session.accountId}/workers/workers`;
  for (const role of WORKERS) {
    const discovery = await observe(session, 'beta-worker-precreate-list', role, { method: 'GET', path }, start, undefined, wait);
    const intent = await checkpointBetaWorkerCreateIntent(session.inventory, role, discovery, session.store, session.now);
    const plan = planBetaWorkerCreate(intent, session.now);
    session.pending.add(`beta-worker:${role}`);
    const created = await observe(session, 'beta-worker-create-result', role, plan, start, undefined, wait, false);
    const id = created?.response?.result?.id;
    if (!HEX_ID.test(id)) throw new TypeError('Ambiguous Beta Worker create result.');
    const readback = await observe(session, 'beta-worker-readback', role, { method: 'GET', path: `${path}/${id}` }, start, undefined, wait);
    const receipt = await checkpointBetaWorkerObservation(intent, created, readback, session.store, session.now);
    session.receipts[role] = receipt;
    session.inventory = betaWorkerReceipt(receipt, 'id', session.now).inventory;
    session.pending.delete(`beta-worker:${role}`);
  }
}

async function dependencyStage(session, start, wait) {
  const tokenPath = `/accounts/${session.accountId}/access/service_tokens`;
  const discovery = await observe(session, 'beta-token-precreate-list', 'api', { method: 'GET', path: tokenPath }, start, undefined, wait);
  const intent = await checkpointBetaTokenCreateIntent(session.receipts.api, session.receipts, discovery, session.store, session.now);
  const plan = planBetaTokenCreate(intent, session.now);
  session.pending.add('service-token');
  const created = await observe(session, 'beta-token-create-result', 'api', plan, start, undefined, wait, false);
  const tokenId = created?.response?.result?.id;
  if (typeof tokenId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(tokenId)) throw new TypeError('Ambiguous token create result.');
  const readback = await observe(session, 'beta-token-readback', 'api', { method: 'GET', path: `${tokenPath}/${tokenId}` }, start, undefined, wait);
  session.receipts = await checkpointBetaWorkerDependencies(intent, session.receipts, created, readback, session.store, session.now);
  session.inventory = betaWorkerReceipt(session.receipts.api, 'id', session.now).inventory;
  session.pending.delete('service-token');
  const appPath = `/accounts/${session.accountId}/access/apps`;
  for (const role of ACCESS) {
    const listed = await observe(session, 'beta-access-precreate-list', role, { method: 'GET', path: appPath }, start, undefined, wait);
    const accessIntent = await checkpointBetaAccessCreateIntent(session.receipts.api, role, listed, session.store, session.now);
    const accessPlan = planBetaAccessCreate(accessIntent, session.now);
    session.pending.add(`access-app:${role}`);
    const app = await observe(session, 'beta-access-create-result', role, accessPlan, start, undefined, wait, false);
    const id = app?.response?.result?.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(id)) throw new TypeError('Ambiguous Access create result.');
    const exact = await observe(session, 'beta-access-readback', role, { method: 'GET', path: `${appPath}/${id}` }, start, undefined, wait);
    session.receipts = await checkpointBetaAccessIdentity(session.receipts.api, role, app, exact, session.store, session.now);
    session.inventory = betaWorkerReceipt(session.receipts.api, 'id', session.now).inventory;
    session.pending.delete(`access-app:${role}`);
  }
}

async function accessAndCodePlan(session, verified, start, wait) {
  const parent = session.receipts.api;
  const attachments = {};
  for (const role of ACCESS) {
    const path = `/accounts/${session.accountId}/access/apps/${session.inventory.cloudflare.accessAppIds[role]}`;
    const observation = await observe(session, 'beta-access-attachment', role, { method: 'POST', path }, start, undefined, wait, false);
    attachments[role] = await checkpointBetaWorkerAccessAttachment(parent, role, observation, session.store, session.now);
  }
  const workerPath = `/accounts/${session.accountId}/workers/workers/${session.inventory.betaWorkerIds.api}`;
  const worker = await observe(session, 'beta-worker-readback', 'api', { method: 'GET', path: workerPath }, start, undefined, wait);
  const versions = await observe(session, 'beta-version-list', 'api', { method: 'GET', path: `${workerPath}/versions` }, start, undefined, wait);
  const access = {};
  for (const role of ACCESS) access[role] = await observe(session, 'beta-access-readback', role, { method: 'GET', path: `/accounts/${session.accountId}/access/apps/${session.inventory.cloudflare.accessAppIds[role]}` }, start, undefined, wait);
  const evidence = prepareBetaWorkerEvidence(parent, { worker, versions, access, attachments }, session.now);
  const moduleFile = verified.files.find(file => file.path.endsWith('/workers/api.mjs'));
  if (!moduleFile) throw new TypeError('Verified API module missing.');
  const bytes = await readFile(moduleFile.path);
  const plan = planBetaWorkerVersion(evidence, { module: { name: 'index.js', contentType: 'application/javascript+module', contentBase64: bytes.toString('base64') }, bindings: [{ name: 'DB', type: 'd1', database_id: session.inventory.cloudflare.d1Ids.product }] }, 'api', session.now);
  if (plan.status === 'unsupported') return plan;
  session.apiVersionPlanned = true;
  // Planning never sends Worker source to the mock boundary. Operator remains unsupported.
  return prepareBetaWorkerEvidence(session.receipts.operator, {}, session.now);
}

export async function provisionMockStack({ key: rawKey, accountId, archive, destination, provider, store, now = () => new Date().toISOString(), wait = async () => {} }) {
  let key;
  try { key = parseStackKey(rawKey); } catch { return { status: 'quarantined', reason: 'invalid-run-key', cleanup: { status: 'not-started', remaining: [] } }; }
  if (!provider || typeof provider.request !== 'function' || typeof provider.observe !== 'function' || !store || typeof store.put !== 'function' || typeof wait !== 'function') return { status: 'quarantined', reason: 'invalid-mock-boundary', cleanup: { status: 'not-started', remaining: [] } };
  let session;
  try {
    const start = clock(now).ms;
    const inventory = initialInventory(key, accountId, now);
    const verified = await verifyBundleV1({ archive, expectedKey: key, expectedRun: { run_id: key.run_id, attempt: key.attempt }, destination });
    deadline(now, start);
    session = registerMockSession({ key, accountId, inventory, provider, store, now });
    await checkpoint(inventory, store);
    await d1Stage(session, verified, start, wait);
    await workerStage(session, start, wait);
    await dependencyStage(session, start, wait);
    const outcome = await accessAndCodePlan(session, verified, start, wait);
    return { status: 'unsupported', reason: outcome.reason, apiVersionPlanned: session.apiVersionPlanned === true, cleanup: await cleanupMockSession(session) };
  } catch (error) {
    return { status: 'quarantined', reason: reason(error), cleanup: session ? await cleanupMockSession(session) : { status: 'not-started', remaining: [] } };
  }
}
