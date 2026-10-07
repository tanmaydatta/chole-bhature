import { parseStackKey, resourceNames } from './key.mjs';

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BETA_WORKER_ID = /^[0-9a-f]{32}$/u;
const roles = {
  worker: ['api', 'identity', 'operator'],
  d1: ['product', 'auth'],
  accessApp: ['api', 'operator'],
};

export class InventoryQuarantineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InventoryQuarantineError';
    this.code = 'QUARANTINED';
  }
}

function quarantine(message) {
  throw new InventoryQuarantineError(message);
}

function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) quarantine(message);
  return value;
}

function exactKeys(value, keys, message) {
  if (Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) quarantine(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function checkedString(value, message) {
  if (typeof value !== 'string' || value.length === 0) quarantine(message);
  return value;
}

function checkedIdMap(value, validRoles, { uuid = false } = {}) {
  object(value, 'Inventory resource IDs are invalid.');
  for (const [role, id] of Object.entries(value)) {
    if (!validRoles.includes(role) || typeof id !== 'string' || id.length === 0 || (uuid && !UUID.test(id))) {
      quarantine('Inventory resource IDs are invalid.');
    }
  }
  return value;
}

function d1Name(inventory, role) {
  return role === 'product' ? inventory.names.product : inventory.names.auth;
}

function expectedName(inventory, kind, role) {
  if (kind === 'd1') return d1Name(inventory, role);
  if (kind === 'accessApp') return role === 'api' ? inventory.names.accessApi : inventory.names.accessOperator;
  if (kind === 'token') return inventory.names.token;
  return inventory.names[role];
}

function expectedId(inventory, kind, role) {
  if (kind === 'worker') return inventory.cloudflare.workerIds[role];
  if (kind === 'd1') return inventory.cloudflare.d1Ids[role];
  if (kind === 'accessApp') return inventory.cloudflare.accessAppIds[role];
  return inventory.cloudflare.tokenId;
}

function parseKind(value) {
  const [kind, role, extra] = String(value).split(':');
  if (extra || !['worker', 'd1', 'accessApp', 'token'].includes(kind) || (kind === 'token' ? role !== undefined : !roles[kind].includes(role))) {
    quarantine('Resource kind is invalid.');
  }
  return { kind, role };
}

export function validateInventory(value) {
  object(value, 'InventoryV1 is invalid.');
  const inventoryKeys = ['key', 'names', 'cloudflare', 'stage', 'createdAt', 'updatedAt'];
  if (Object.hasOwn(value, 'betaWorkerIds')) inventoryKeys.push('betaWorkerIds');
  exactKeys(value, inventoryKeys, 'InventoryV1 is invalid.');
  let key;
  try { key = parseStackKey(value.key); } catch { quarantine('InventoryV1 key is invalid.'); }
  const names = resourceNames(key);
  if (!sameJson(value.names, names)) quarantine('InventoryV1 names are not controller-derived.');
  object(value.cloudflare, 'InventoryV1 Cloudflare identity is invalid.');
  exactKeys(value.cloudflare, ['accountId', 'workerIds', 'd1Ids', 'accessAppIds', 'tokenId'], 'InventoryV1 Cloudflare identity is invalid.');
  checkedString(value.cloudflare.accountId, 'InventoryV1 Cloudflare account is invalid.');
  checkedIdMap(value.cloudflare.workerIds, roles.worker);
  checkedIdMap(value.cloudflare.d1Ids, roles.d1, { uuid: true });
  const d1Ids = Object.values(value.cloudflare.d1Ids).map(id => id.toLowerCase());
  if (new Set(d1Ids).size !== d1Ids.length) quarantine('InventoryV1 D1 roles share an ambiguous UUID.');
  checkedIdMap(value.cloudflare.accessAppIds, roles.accessApp);
  if (value.cloudflare.tokenId !== null) checkedString(value.cloudflare.tokenId, 'InventoryV1 token ID is invalid.');
  if (!['creating', 'active', 'quarantined', 'deleted'].includes(value.stage) || !ISO_TIME.test(value.createdAt) || !ISO_TIME.test(value.updatedAt)) {
    quarantine('InventoryV1 lifecycle state is invalid.');
  }
  if (value.betaWorkerIds !== undefined) checkedIdMap(value.betaWorkerIds, roles.worker);
  if (value.betaWorkerIds !== undefined && Object.values(value.betaWorkerIds).some(id => !BETA_WORKER_ID.test(id))) {
    quarantine('InventoryV1 Beta Worker IDs are invalid.');
  }
  if (value.betaWorkerIds !== undefined && new Set(Object.values(value.betaWorkerIds)).size !== Object.keys(value.betaWorkerIds).length) {
    quarantine('InventoryV1 Beta Worker IDs are ambiguous.');
  }
  return structuredClone(value);
}

const betaReceipts = new WeakMap();
const betaTokenIntents = new WeakMap();
const betaAccessIntents = new WeakMap();
const betaLifecyclesByStore = new WeakMap();
const betaGraphsByStore = new WeakMap();
const BETA_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;

function lifecycleFor(store, inventory, role) {
  let entries = betaLifecyclesByStore.get(store);
  if (!entries) { entries = new Map(); betaLifecyclesByStore.set(store, entries); }
  const key = `${JSON.stringify(parseStackKey(inventory.key))}:${role}`;
  let lifecycle = entries.get(key);
  if (!lifecycle) { lifecycle = { phase: 'new', attachments: {} }; entries.set(key, lifecycle); }
  return lifecycle;
}

function graphSlot(store, key) {
  let entries = betaGraphsByStore.get(store);
  if (!entries) { entries = new Map(); betaGraphsByStore.set(store, entries); }
  const run = JSON.stringify(parseStackKey(key));
  let slot = entries.get(run);
  if (!slot) { slot = { phase: 'new' }; entries.set(run, slot); }
  return slot;
}

function betaRole(role) {
  if (!roles.worker.includes(role)) quarantine('Beta Worker role is invalid.');
}

function betaTime(value, message) {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) quarantine(message);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) quarantine(message);
  return parsed;
}

function betaClock(now) {
  const value = now();
  betaTime(value, 'Beta Worker evidence clock is invalid.');
  return () => value;
}

function betaEnvelope(inventory, envelope, { kind, role, path, now, after, method = 'GET' }) {
  object(envelope, 'Beta Worker observation envelope is invalid.');
  exactKeys(envelope, ['kind', 'run', 'role', 'observedAt', 'request', 'response'], 'Beta Worker observation envelope is invalid.');
  let envelopeRun;
  try { envelopeRun = parseStackKey(envelope.run); } catch { quarantine('Beta Worker observation provenance does not match this run.'); }
  if (envelope.kind !== kind || envelope.role !== role || !sameJson(envelopeRun, parseStackKey(inventory.key))) quarantine('Beta Worker observation provenance does not match this run.');
  const observedAt = betaTime(envelope.observedAt, 'Beta Worker observation time is invalid.');
  const current = betaTime(now(), 'Beta Worker evidence clock is invalid.');
  if (observedAt > current || current - observedAt > BETA_EVIDENCE_MAX_AGE_MS || after !== undefined && observedAt < after) quarantine('Beta Worker observation is stale or out of order.');
  object(envelope.request, 'Beta Worker observation request is invalid.');
  exactKeys(envelope.request, ['method', 'path'], 'Beta Worker observation request is invalid.');
  if (envelope.request.method !== method || envelope.request.path !== path) quarantine('Beta Worker observation request does not match the fixed protocol.');
  object(envelope.response, 'Beta Worker observation response is invalid.');
  exactKeys(envelope.response, ['success', 'result'], 'Beta Worker observation response is invalid.');
  if (envelope.response.success !== true) quarantine('Beta Worker observation response is unsuccessful.');
  return { result: envelope.response.result, observedAt };
}

function recordBetaWorkerObservation(rawInventory, role, observation) {
  const inventory = validateInventory(rawInventory);
  betaRole(role);
  object(observation, 'Beta Worker observation is invalid.');
  exactKeys(observation, ['id', 'name', 'routes', 'subdomain', 'deployed_on', 'bindings'], 'Beta Worker observation is incomplete.');
  if (!BETA_WORKER_ID.test(observation.id) || observation.name !== inventory.names[role]
    || !Array.isArray(observation.routes) || observation.routes.length !== 0
    || !observation.subdomain || Object.keys(observation.subdomain).length !== 2 || observation.subdomain.enabled !== false || observation.subdomain.previews_enabled !== false) {
    quarantine('Beta Worker observation is not a disabled exact immutable identity.');
  }
  const prior = inventory.betaWorkerIds?.[role];
  if (prior && prior !== observation.id) quarantine('Beta Worker immutable ID changed after checkpoint.');
  return validateInventory({ ...inventory, betaWorkerIds: { ...inventory.betaWorkerIds, [role]: observation.id } });
}

export async function checkpointBetaWorkerCreateIntent(rawInventory, role, discovery, store, now = () => new Date().toISOString()) {
  const inventory = validateInventory(rawInventory);
  betaRole(role);
  if (inventory.stage !== 'creating') quarantine('Beta Worker creation phase is not permitted.');
  if (inventory.betaWorkerIds?.[role]) quarantine('Beta Worker already has a certified immutable ID.');
  if (!store || typeof store.put !== 'function') throw new TypeError('Expected a restricted evidence store with put().');
  const lifecycle = lifecycleFor(store, inventory, role);
  if (lifecycle.phase !== 'new') quarantine('Beta Worker lifecycle intent is already reserved or ambiguous.');
  lifecycle.phase = 'intent-reserving';
  const path = `/accounts/${inventory.cloudflare.accountId}/workers/workers`;
  const { result, observedAt } = betaEnvelope(inventory, discovery, { kind: 'beta-worker-precreate-list', role, path, now });
  if (!Array.isArray(result) || result.length !== 0) quarantine('Beta Worker pre-create discovery is ambiguous.');
  const startedAt = new Date(observedAt).toISOString();
  try {
    await store.put({
      type: 'beta-worker-create-intent', key: inventory.key, role, exactName: inventory.names[role], startedAt, noPreexistingMatch: true,
    }, { classification: 'controller-evidence', retentionDays: 7, restricted: true });
  } catch (error) { lifecycle.phase = 'failed'; throw error; }
  lifecycle.phase = 'intent';
  const receipt = {};
  betaReceipts.set(receipt, { kind: 'intent', inventory, role, observedAt, expiresAt: observedAt + BETA_EVIDENCE_MAX_AGE_MS, generation: 0, lifecycle, store });
  return receipt;
}

function currentReceipt(receipt, kind, now, { allowGraphPhase = false } = {}) {
  const state = betaReceipts.get(receipt);
  if (!state || state.kind !== kind) quarantine('Beta Worker evidence receipt is invalid or incomplete.');
  if (kind === 'id' && state.lifecycle.currentId !== receipt) quarantine('Beta Worker ID receipt was superseded.');
  if (kind === 'id' && state.graph && state.graph.phase !== 'ready' && !allowGraphPhase) quarantine('Beta Worker ID receipt phase is ambiguous or revoked.');
  const current = betaTime(now(), 'Beta Worker evidence clock is invalid.');
  if (!Number.isFinite(state.expiresAt) || current > state.expiresAt || current < state.observedAt
    || kind === 'id' && state.graph && current > state.graph.expiresAt) quarantine('Beta Worker evidence receipt expired or out of order.');
  return state;
}

export function consumeBetaWorkerCreatePlan(intentReceipt, now = () => new Date().toISOString()) {
  const intent = currentReceipt(intentReceipt, 'intent', now);
  if (intent.lifecycle.phase !== 'intent') quarantine('Beta Worker create plan lifecycle is invalid or ambiguous.');
  intent.lifecycle.phase = 'create-planned';
  intent.kind = 'create-planned';
  intent.generation += 1;
  intent.plannedAt = betaTime(now(), 'Beta Worker evidence clock is invalid.');
  intent.expiresAt = intent.plannedAt + BETA_EVIDENCE_MAX_AGE_MS;
  return { inventory: structuredClone(intent.inventory), role: intent.role, generation: intent.generation };
}

export async function checkpointBetaWorkerObservation(createReceipt, createEnvelope, readbackEnvelope, store, now = () => new Date().toISOString()) {
  const intent = currentReceipt(createReceipt, 'create-planned', now);
  if (intent.store !== store || intent.lifecycle.phase !== 'create-planned') quarantine('Beta Worker ID checkpoint lifecycle is invalid or ambiguous.');
  intent.lifecycle.phase = 'id-checkpointing';
  const createPath = `/accounts/${intent.inventory.cloudflare.accountId}/workers/workers`;
  const created = betaEnvelope(intent.inventory, createEnvelope, { kind: 'beta-worker-create-result', role: intent.role, path: createPath, now, after: intent.plannedAt, method: 'POST' });
  const id = created.result?.id;
  if (!BETA_WORKER_ID.test(id)) quarantine('Beta Worker readback immutable ID is invalid.');
  const path = `/accounts/${intent.inventory.cloudflare.accountId}/workers/workers/${id}`;
  const { result, observedAt } = betaEnvelope(intent.inventory, readbackEnvelope, { kind: 'beta-worker-readback', role: intent.role, path, now, after: created.observedAt });
  if (!sameJson(created.result, result)) quarantine('Beta Worker create result and readback do not match.');
  const inventory = recordBetaWorkerObservation(intent.inventory, intent.role, result);
  try { await checkpoint(inventory, store); } catch (error) { intent.lifecycle.phase = 'failed'; throw error; }
  intent.kind = 'revoked';
  intent.lifecycle.phase = 'id';
  const receipt = {};
  betaReceipts.set(receipt, { kind: 'id', inventory, role: intent.role, observedAt, observation: structuredClone(result), expiresAt: observedAt + BETA_EVIDENCE_MAX_AGE_MS, generation: intent.generation + 1, attachments: {}, lifecycle: intent.lifecycle, store });
  intent.lifecycle.currentId = receipt;
  return receipt;
}

function successorId(state, inventory, observedAt) {
  const next = {};
  betaReceipts.set(next, { ...state, inventory, observedAt, expiresAt: Math.min(state.expiresAt, observedAt + BETA_EVIDENCE_MAX_AGE_MS), generation: state.generation + 1, attachments: {}, accessPlans: {}, kind: 'id' });
  state.lifecycle.currentId = next;
  state.lifecycle.attachments = {};
  state.lifecycle.phase = 'id';
  state.kind = 'revoked';
  return next;
}

function rotateGraph(receipts, inventory, observedAt, certifiedAccessIds) {
  const next = {};
  for (const role of roles.worker) {
    const receipt = receipts[role];
    next[role] = successorId(betaReceipts.get(receipt), inventory, observedAt);
  }
  const graph = { phase: 'ready', receipts: next, accessPlans: {}, expiresAt: Math.min(...roles.worker.map(role => betaReceipts.get(next[role]).expiresAt)) };
  for (const role of roles.worker) {
    const state = betaReceipts.get(next[role]);
    state.graph = graph;
    state.certifiedDependencies = true;
    state.certifiedAccessIds = { ...certifiedAccessIds };
  }
  return next;
}

export async function checkpointBetaTokenCreateIntent(idReceipt, workerReceipts, discovery, store, now = () => new Date().toISOString()) {
  const clock = betaClock(now);
  const state = currentReceipt(idReceipt, 'id', clock);
  if (state.store !== store || state.lifecycle.phase !== 'id') quarantine('Beta token intent lifecycle is invalid.');
  const slot = graphSlot(store, state.inventory.key);
  if (slot.phase !== 'new') quarantine('Beta token intent is already reserved or ambiguous.');
  slot.phase = 'intent-checkpointing';
  if (state.inventory.cloudflare.tokenId !== null || Object.keys(state.inventory.cloudflare.accessAppIds).length !== 0) quarantine('Beta Worker future identities were not certified by this transition.');
  object(workerReceipts, 'Beta Worker sibling receipts are incomplete.');
  exactKeys(workerReceipts, roles.worker, 'Beta Worker sibling receipts are incomplete.');
  if (!state.inventory.cloudflare.d1Ids.product || !state.inventory.cloudflare.d1Ids.auth) quarantine('Beta Worker D1 graph is incomplete.');
  const ids = {};
  for (const role of roles.worker) {
    const sibling = currentReceipt(workerReceipts[role], 'id', clock);
    if (sibling.store !== store || sibling.role !== role || !sameJson(parseStackKey(sibling.inventory.key), parseStackKey(state.inventory.key))
      || sibling.inventory.cloudflare.accountId !== state.inventory.cloudflare.accountId || sibling.inventory.names[role] !== state.inventory.names[role]
      || !sameJson(sibling.inventory.cloudflare.d1Ids, state.inventory.cloudflare.d1Ids)
      || sibling.observation?.name !== state.inventory.names[role] || sibling.observation?.id !== sibling.inventory.betaWorkerIds?.[role]) quarantine('Beta Worker sibling identity is not certified for this run.');
    const expectedBindings = role === 'operator' ? [] : [{ name: 'DB', type: 'd1', database_id: state.inventory.cloudflare.d1Ids[role === 'api' ? 'product' : 'auth'] }];
    if (sibling.observation.deployed_on !== null || !sameJson(sibling.observation.bindings, expectedBindings)) quarantine('Beta Worker sibling inert graph is unresolved.');
    ids[role] = betaWorkerIdFor(sibling.inventory, role);
  }
  if (workerReceipts[state.role] !== idReceipt || new Set(Object.values(ids)).size !== roles.worker.length) quarantine('Beta Worker sibling identity graph is ambiguous.');
  for (const role of roles.worker) {
    const sibling = betaReceipts.get(workerReceipts[role]);
    for (const [priorRole, id] of Object.entries(sibling.inventory.betaWorkerIds ?? {})) {
      if (ids[priorRole] !== id) quarantine('Beta Worker immutable ID changed after checkpoint.');
    }
  }
  const path = `/accounts/${state.inventory.cloudflare.accountId}/access/service_tokens`;
  const discovered = betaEnvelope(state.inventory, discovery, { kind: 'beta-token-precreate-list', role: state.role, path, now: clock, after: state.observedAt });
  if (!Array.isArray(discovered.result) || discovered.result.length !== 0) quarantine('Beta token pre-create discovery is ambiguous.');
  const startedAt = new Date(discovered.observedAt).toISOString();
  try { await store.put({ type: 'beta-token-create-intent', key: state.inventory.key, accountId: state.inventory.cloudflare.accountId, exactName: state.inventory.names.token, workerIds: ids, startedAt, noPreexistingMatch: true }, { classification: 'controller-evidence', retentionDays: 7, restricted: true }); }
  catch (error) { slot.phase = 'failed'; throw error; }
  slot.phase = 'intent';
  const receipt = {};
  betaTokenIntents.set(receipt, { idReceipt, workerReceipts: { ...workerReceipts }, ids, store, slot, role: state.role, plannedAt: null, expiresAt: Math.min(state.expiresAt, discovered.observedAt + BETA_EVIDENCE_MAX_AGE_MS), phase: 'intent' });
  return receipt;
}

export function consumeBetaTokenCreatePlan(tokenIntentReceipt, now = () => new Date().toISOString()) {
  const clock = betaClock(now);
  const intent = betaTokenIntents.get(tokenIntentReceipt);
  if (!intent || intent.phase !== 'intent' || intent.slot.phase !== 'intent') quarantine('Beta token create intent receipt is invalid or consumed.');
  const state = currentReceipt(intent.idReceipt, 'id', clock);
  const current = betaTime(clock(), 'Beta Worker evidence clock is invalid.');
  if (current > intent.expiresAt || state.store !== intent.store) quarantine('Beta token create intent receipt expired.');
  intent.phase = 'planned'; intent.slot.phase = 'planned'; intent.plannedAt = current;
  return { inventory: structuredClone(state.inventory), role: state.role };
}

export async function checkpointBetaWorkerDependencies(tokenIntentReceipt, workerReceipts, tokenCreate, tokenReadback, store, now = () => new Date().toISOString()) {
  const clock = betaClock(now);
  const intent = betaTokenIntents.get(tokenIntentReceipt);
  if (!intent || intent.phase !== 'planned' || intent.slot.phase !== 'planned' || intent.store !== store) quarantine('Beta token create intent receipt is required.');
  const state = currentReceipt(intent.idReceipt, 'id', clock);
  intent.phase = 'checkpointing'; intent.slot.phase = 'checkpointing';
  object(workerReceipts, 'Beta Worker sibling receipts are incomplete.');
  exactKeys(workerReceipts, roles.worker, 'Beta Worker sibling receipts are incomplete.');
  if (state.lifecycle.phase !== 'id' || roles.worker.some(role => workerReceipts?.[role] !== intent.workerReceipts[role])) quarantine('Beta Worker dependency transition is ambiguous.');
  for (const role of roles.worker) currentReceipt(workerReceipts[role], 'id', clock);
  const path = `/accounts/${state.inventory.cloudflare.accountId}/access/service_tokens`;
  const created = betaEnvelope(state.inventory, tokenCreate, { kind: 'beta-token-create-result', role: state.role, path, now: clock, after: intent.plannedAt, method: 'POST' });
  const token = created.result;
  if (!token || typeof token !== 'object' || Object.keys(token).length !== 2 || typeof token.id !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(token.id) || token.name !== state.inventory.names.token) quarantine('Beta Worker token identity is invalid.');
  const read = betaEnvelope(state.inventory, tokenReadback, { kind: 'beta-token-readback', role: state.role, path: `${path}/${token.id}`, now: clock, after: created.observedAt });
  if (!sameJson(read.result, token) || state.inventory.cloudflare.tokenId && state.inventory.cloudflare.tokenId !== token.id) quarantine('Beta Worker token create/readback identity changed.');
  const inventory = validateInventory({ ...state.inventory, betaWorkerIds: intent.ids, cloudflare: { ...state.inventory.cloudflare, tokenId: token.id }, updatedAt: tokenReadback.observedAt });
  try { await checkpoint(inventory, store); } catch (error) { intent.slot.phase = 'failed'; throw error; }
  const next = rotateGraph(workerReceipts, inventory, read.observedAt, {});
  intent.slot.phase = 'ready';
  return next;
}

export async function checkpointBetaAccessCreateIntent(idReceipt, role, discovery, store, now = () => new Date().toISOString()) {
  const clock = betaClock(now);
  const state = currentReceipt(idReceipt, 'id', clock);
  if (!['api', 'operator'].includes(role) || state.store !== store || state.lifecycle.phase !== 'id' || !state.certifiedDependencies || state.graph?.phase !== 'ready' || state.inventory.cloudflare.accessAppIds[role]
    || !state.inventory.cloudflare.tokenId || !roles.worker.every(workerRole => BETA_WORKER_ID.test(state.inventory.betaWorkerIds?.[workerRole]))
    || Object.keys(state.graph.accessPlans).length !== 0) quarantine('Beta Access create intent identity graph is incomplete or already planned.');
  const graph = state.graph;
  graph.phase = 'intent-checkpointing';
  const path = `/accounts/${state.inventory.cloudflare.accountId}/access/apps`;
  const discovered = betaEnvelope(state.inventory, discovery, { kind: 'beta-access-precreate-list', role, path, now: clock, after: state.observedAt });
  if (!Array.isArray(discovered.result) || discovered.result.length !== 0) quarantine('Beta Access pre-create discovery is ambiguous.');
  const exactName = expectedName(state.inventory, 'accessApp', role);
  const startedAt = new Date(discovered.observedAt).toISOString();
  try { await store.put({ type: 'beta-access-create-intent', key: state.inventory.key, accountId: state.inventory.cloudflare.accountId, role, exactName, workerId: betaWorkerIdFor(state.inventory, role), tokenId: state.inventory.cloudflare.tokenId, startedAt, noPreexistingMatch: true }, { classification: 'controller-evidence', retentionDays: 7, restricted: true }); }
  catch (error) { graph.phase = 'failed'; throw error; }
  const receipt = {};
  betaAccessIntents.set(receipt, { idReceipt, role, graph, store, phase: 'intent', expiresAt: Math.min(state.expiresAt, discovered.observedAt + BETA_EVIDENCE_MAX_AGE_MS) });
  graph.accessPlans[role] = { phase: 'intent' };
  graph.phase = 'intent';
  return receipt;
}

export function consumeBetaAccessCreatePlan(accessIntentReceipt, now = () => new Date().toISOString()) {
  const clock = betaClock(now);
  const intent = betaAccessIntents.get(accessIntentReceipt);
  if (!intent || intent.phase !== 'intent' || intent.graph.phase !== 'intent') quarantine('Beta Access create intent receipt is invalid or consumed.');
  const state = currentReceipt(intent.idReceipt, 'id', clock, { allowGraphPhase: true });
  const current = betaTime(clock(), 'Beta Worker evidence clock is invalid.');
  if (current > intent.expiresAt || state.store !== intent.store) quarantine('Beta Access create intent receipt expired.');
  intent.phase = 'planned'; intent.graph.phase = 'planned';
  const role = intent.role;
  state.graph.accessPlans[role] = { idReceipt: intent.idReceipt, plannedAt: current, phase: 'planned' };
  return { inventory: structuredClone(state.inventory), role };
}

function exactBetaAccessApp(inventory, role, app, expectedId) {
  object(app, 'Beta Access application is invalid.');
  exactKeys(app, ['id', 'name', 'destinations', 'policies'], 'Beta Access application is not exact.');
  if (typeof app.id !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(app.id) || expectedId && app.id !== expectedId
    || app.name !== expectedName(inventory, 'accessApp', role) || !Array.isArray(app.destinations) || app.destinations.length !== 1
    || !Array.isArray(app.policies) || app.policies.length !== 1) quarantine('Beta Access application identity or graph is invalid.');
  const destination = app.destinations[0];
  object(destination, 'Beta Access destination is invalid.');
  exactKeys(destination, ['type', 'worker_id', 'overrides'], 'Beta Access destination is invalid.');
  if (destination.type !== 'worker' || destination.worker_id !== betaWorkerIdFor(inventory, role) || !Array.isArray(destination.overrides) || destination.overrides.length !== 0) quarantine('Beta Access Worker destination is invalid.');
  const policy = app.policies[0];
  object(policy, 'Beta Access policy is invalid.');
  exactKeys(policy, ['decision', 'include'], 'Beta Access policy is invalid.');
  if (policy.decision !== 'non_identity' || !Array.isArray(policy.include) || policy.include.length !== 1) quarantine('Beta Access policy is invalid.');
  const include = policy.include[0];
  object(include, 'Beta Access policy is invalid.');
  exactKeys(include, ['service_token'], 'Beta Access policy is invalid.');
  object(include.service_token, 'Beta Access token is invalid.');
  exactKeys(include.service_token, ['token_id'], 'Beta Access token is invalid.');
  if (include.service_token.token_id !== inventory.cloudflare.tokenId) quarantine('Beta Access token is not certified for this run.');
}

export async function checkpointBetaAccessIdentity(idReceipt, role, createEnvelope, readbackEnvelope, store, now = () => new Date().toISOString()) {
  const clock = betaClock(now);
  const state = currentReceipt(idReceipt, 'id', clock, { allowGraphPhase: true });
  const graph = state.graph;
  const plan = graph?.accessPlans?.[role];
  if (state.store !== store || state.lifecycle.phase !== 'id' || graph?.phase !== 'planned' || graph.receipts[state.role] !== idReceipt || !plan || plan.idReceipt !== idReceipt || plan.phase !== 'planned' || state.inventory.cloudflare.accessAppIds[role]) quarantine('Beta Access identity checkpoint lifecycle is invalid.');
  plan.phase = 'checkpointing';
  graph.phase = 'checkpointing';
  const path = `/accounts/${state.inventory.cloudflare.accountId}/access/apps`;
  const created = betaEnvelope(state.inventory, createEnvelope, { kind: 'beta-access-create-result', role, path, now: clock, after: plan.plannedAt, method: 'POST' });
  exactBetaAccessApp(state.inventory, role, created.result);
  const appId = created.result.id;
  if (Object.values(state.inventory.cloudflare.accessAppIds).includes(appId)) quarantine('Beta Access app ID is duplicated in this run.');
  const read = betaEnvelope(state.inventory, readbackEnvelope, { kind: 'beta-access-readback', role, path: `${path}/${appId}`, now: clock, after: created.observedAt });
  exactBetaAccessApp(state.inventory, role, read.result, appId);
  if (!sameJson(created.result, read.result)) quarantine('Beta Access create/readback graph changed.');
  const inventory = validateInventory({ ...state.inventory, cloudflare: { ...state.inventory.cloudflare, accessAppIds: { ...state.inventory.cloudflare.accessAppIds, [role]: appId } }, updatedAt: readbackEnvelope.observedAt });
  try { await checkpoint(inventory, store); } catch (error) { graph.phase = 'failed'; throw error; }
  graph.phase = 'revoked';
  return rotateGraph(graph.receipts, inventory, read.observedAt, { ...state.certifiedAccessIds, [role]: appId });
}

export async function checkpointBetaWorkerAccessAttachment(idReceipt, role, envelope, store, now = () => new Date().toISOString()) {
  const state = currentReceipt(idReceipt, 'id', now);
  if (state.store !== store || state.lifecycle.phase !== 'id' && state.lifecycle.phase !== 'access-ready' || state.graph?.phase !== 'ready' || !['api', 'operator'].includes(role) || state.attachments[role] || state.lifecycle.attachments[role] || !state.certifiedDependencies || state.certifiedAccessIds?.[role] !== state.inventory.cloudflare.accessAppIds[role]) quarantine('Beta Worker Access attachment phase is invalid.');
  if (!store || typeof store.put !== 'function') throw new TypeError('Expected a restricted evidence store with put().');
  state.lifecycle.attachments[role] = 'reserving';
  const appId = state.inventory.cloudflare.accessAppIds[role];
  const result = betaEnvelope(state.inventory, envelope, { kind: 'beta-access-attachment', role, path: `/accounts/${state.inventory.cloudflare.accountId}/access/apps/${appId}`, now, after: state.observedAt, method: 'POST' }).result;
  const workerId = betaWorkerIdFor(state.inventory, role);
  if (!result || typeof result !== 'object' || Object.keys(result).length !== 3 || result.id !== appId || result.worker_id !== workerId || result.token_id !== state.inventory.cloudflare.tokenId) quarantine('Beta Worker Access attachment is not exact.');
  try { await store.put({ type: 'beta-access-attachment', key: state.inventory.key, role, appId, workerId, tokenId: state.inventory.cloudflare.tokenId, attachedAt: envelope.observedAt }, { classification: 'controller-evidence', retentionDays: 7, restricted: true }); } catch (error) { state.lifecycle.attachments[role] = 'failed'; state.lifecycle.phase = 'failed'; throw error; }
  state.generation += 1;
  state.attachments[role] = { observedAt: betaTime(envelope.observedAt, 'Beta Worker observation time is invalid.'), generation: state.generation };
  state.lifecycle.attachments[role] = 'attached';
  if (state.lifecycle.attachments.api === 'attached' && state.lifecycle.attachments.operator === 'attached') state.lifecycle.phase = 'access-ready';
  const receipt = {};
  betaReceipts.set(receipt, { kind: 'attachment', parent: idReceipt, role, inventory: state.inventory, observedAt: state.attachments[role].observedAt, expiresAt: state.attachments[role].observedAt + BETA_EVIDENCE_MAX_AGE_MS, generation: state.generation, lifecycle: state.lifecycle });
  return receipt;
}

function betaWorkerIdFor(inventory, role) {
  const id = inventory.betaWorkerIds?.[role];
  if (typeof id !== 'string' || !BETA_WORKER_ID.test(id)) quarantine('Beta Worker immutable ID is missing for Access attachment.');
  return id;
}

export function betaWorkerReceipt(receipt, kind, now = () => new Date().toISOString()) {
  const state = currentReceipt(receipt, kind, now);
  return { inventory: structuredClone(state.inventory), role: state.role, observedAt: state.observedAt, observation: state.observation && structuredClone(state.observation), expiresAt: state.expiresAt, generation: state.generation, attachments: structuredClone(state.attachments ?? {}) };
}

export function betaWorkerAttachmentReceipt(receipt, role, idReceipt, now = () => new Date().toISOString()) {
  const state = currentReceipt(receipt, 'attachment', now);
  const parent = currentReceipt(idReceipt, 'id', now);
  if (state.role !== role || state.parent !== idReceipt || !parent || parent.attachments[role]?.generation !== state.generation || state.lifecycle.attachments[role] !== 'attached') quarantine('Beta Worker Access attachment receipt is invalid.');
  return { observedAt: state.observedAt, generation: state.generation };
}

export function betaWorkerEvidencePhase(idReceipt, now = () => new Date().toISOString()) {
  const state = currentReceipt(idReceipt, 'id', now);
  if (!state.certifiedDependencies || state.certifiedAccessIds?.api !== state.inventory.cloudflare.accessAppIds.api || state.certifiedAccessIds?.operator !== state.inventory.cloudflare.accessAppIds.operator || state.lifecycle.phase !== 'access-ready' || state.lifecycle.attachments.api !== 'attached' || state.lifecycle.attachments.operator !== 'attached') quarantine('Beta Worker evidence lifecycle is incomplete or revoked.');
  return { generation: state.generation };
}

export function consumeBetaWorkerAction(idReceipt, generation, now = () => new Date().toISOString()) {
  const state = currentReceipt(idReceipt, 'id', now);
  if (state.lifecycle.phase !== 'access-ready' || state.generation !== generation) quarantine('Beta Worker action lifecycle is stale or revoked.');
  state.generation += 1;
  state.lifecycle.phase = 'action-planned';
}

function validBindings(inventory, role, bindings) {
  object(bindings, 'Worker binding graph is missing.');
  exactKeys(bindings, ['d1', 'services'], 'Worker binding graph is invalid.');
  object(bindings.d1, 'Worker D1 bindings are invalid.');
  object(bindings.services, 'Worker service bindings are invalid.');
  const expected = {
    api: { d1: inventory.cloudflare.d1Ids.product ? { DB: inventory.cloudflare.d1Ids.product } : {}, services: {} },
    identity: { d1: inventory.cloudflare.d1Ids.auth ? { DB: inventory.cloudflare.d1Ids.auth } : {}, services: {} },
    operator: { d1: {}, services: Object.fromEntries(Object.entries({ API: inventory.cloudflare.workerIds.api, IDENTITY: inventory.cloudflare.workerIds.identity }).filter(([, tag]) => tag)) },
  }[role];
  if (!sameJson(bindings, expected)) quarantine('Worker binding graph does not match the exact inventory.');
}

export function assertOwnedResource(rawInventory, discovered, kindValue) {
  const inventory = validateInventory(rawInventory);
  const { kind, role } = parseKind(kindValue);
  object(discovered, 'Discovered resource is invalid.');
  if (discovered.accountId !== inventory.cloudflare.accountId || discovered.kind !== kind || discovered.role !== role
    || discovered.name !== expectedName(inventory, kind, role) || discovered.id !== expectedId(inventory, kind, role)) {
    quarantine('Discovered resource does not match the exact inventory identity.');
  }
  if (kind === 'worker') validBindings(inventory, role, discovered.bindings);
  if (kind === 'accessApp') {
    object(discovered.graph, 'Access application binding graph is missing.');
    exactKeys(discovered.graph, ['workerId', 'tokenId', 'decision', 'exclusive', 'publicOverrides'], 'Access application binding graph is invalid.');
    if (discovered.graph.workerId !== inventory.cloudflare.workerIds[role] || discovered.graph.tokenId !== inventory.cloudflare.tokenId
      || discovered.graph.decision !== 'non_identity' || discovered.graph.exclusive !== true || discovered.graph.publicOverrides !== false) {
      quarantine('Access application binding graph does not match the exact inventory.');
    }
  }
  return undefined;
}

export async function checkpoint(rawInventory, store) {
  const inventory = validateInventory(rawInventory);
  if (!store || typeof store.put !== 'function') throw new TypeError('Expected a restricted evidence store with put().');
  await store.put(inventory, { classification: 'controller-evidence', retentionDays: 7, restricted: true });
}

function parseCheckpointRecord(raw) {
  object(raw, 'Checkpoint evidence is malformed.');
  exactKeys(raw, ['inventory', 'intents'], 'Checkpoint evidence is malformed.');
  if (!Array.isArray(raw.intents)) quarantine('Checkpoint intents are malformed.');
  return { inventory: validateInventory(raw.inventory), intents: raw.intents };
}

function matchingIntent(key, intents, kind, name) {
  const named = intents.filter(intent => intent && typeof intent === 'object' && intent.kind === kind && intent.exactName === name);
  if (named.length === 0) return null;
  const matches = named.filter(intent => intent && typeof intent === 'object'
    && sameJson(intent.key, key) && intent.kind === kind && intent.exactName === name
    && intent.noPreexistingMatch === true && ISO_TIME.test(intent.startedAt));
  if (matches.length !== 1) quarantine('A missing ID has no unique durable creation intent.');
  return matches[0];
}

function auditProvesCreation(entry, { controllerTokenId, id, startedAt, method, uri }) {
  return typeof controllerTokenId === 'string' && controllerTokenId.length > 0
    && typeof entry?.actor?.token_id === 'string' && entry.actor.token_id.length > 0 && entry.actor.token_id === controllerTokenId && entry.action?.type === 'create'
    && entry.action?.result === true && typeof entry.action?.time === 'string' && entry.action.time >= startedAt
    && entry.resource?.id === id && entry.raw?.method === method && entry.raw?.uri === uri;
}

function discoveryAccessGraph(app) {
  const destination = Array.isArray(app?.destinations) && app.destinations.length === 1 ? app.destinations[0] : null;
  const policy = Array.isArray(app?.policies) && app.policies.length === 1 ? app.policies[0] : null;
  const token = Array.isArray(policy?.include) && policy.include.length === 1 ? policy.include[0]?.service_token : null;
  if (!destination || !policy || !token) quarantine('Discovery Access graph is incomplete.');
  exactKeys(destination, ['type', 'worker_id', 'overrides'], 'Discovery Access destination is unsupported.');
  exactKeys(policy, ['decision', 'include'], 'Discovery Access policy is unsupported.');
  exactKeys(policy.include[0], ['service_token'], 'Discovery Access policy is unsupported.');
  exactKeys(token, ['token_id'], 'Discovery Access token reference is unsupported.');
  if (destination.type !== 'worker' || !Array.isArray(destination.overrides) || destination.overrides.length !== 0) quarantine('Discovery Access destination is unsupported.');
  return { workerId: destination.worker_id, tokenId: token.token_id, decision: policy.decision, exclusive: true, publicOverrides: false };
}

async function verifyRecordedResources(inventory, api) {
  for (const role of roles.worker) {
    if (!inventory.cloudflare.workerIds[role]) continue;
    if (typeof api.listWorkers !== 'function' || typeof api.getWorker !== 'function') quarantine('Discovery evidence source is incomplete.');
    const listed = await api.listWorkers();
    const matches = Array.isArray(listed) ? listed.filter(resource => resource?.id === inventory.names[role] || resource?.tag === inventory.cloudflare.workerIds[role]) : [];
    if (matches.length !== 1 || matches[0].id !== inventory.names[role] || matches[0].tag !== inventory.cloudflare.workerIds[role]) quarantine('Recorded Worker is missing or changed.');
    const current = await api.getWorker(role);
    assertOwnedResource(inventory, { accountId: inventory.cloudflare.accountId, kind: 'worker', role, name: current?.name, id: current?.tag, bindings: current?.bindings }, `worker:${role}`);
  }
  for (const [kind, section, validRoles, list, idField] of [
    ['d1', 'd1Ids', roles.d1, 'listD1', 'uuid'],
    ['accessApp', 'accessAppIds', roles.accessApp, 'listAccessApps', 'id'],
    ['token', 'tokenId', [undefined], 'listServiceTokens', 'id'],
  ]) {
    const recordedRoles = validRoles.filter(role => section === 'tokenId' ? inventory.cloudflare.tokenId : inventory.cloudflare[section][role]);
    if (!recordedRoles.length) continue;
    if (typeof api[list] !== 'function') quarantine('Discovery evidence source is incomplete.');
    const listed = await api[list]();
    if (!Array.isArray(listed)) quarantine('Recorded resource discovery is malformed.');
    for (const role of recordedRoles) {
      const id = expectedId(inventory, kind, role); const name = expectedName(inventory, kind, role);
      const matches = listed.filter(resource => resource?.[idField] === id || resource?.name === name);
      if (matches.length !== 1) quarantine('Recorded resource is missing or ambiguous.');
      const current = matches[0];
      assertOwnedResource(inventory, { accountId: inventory.cloudflare.accountId, kind, role, name: current.name, id: current[idField], ...(kind === 'accessApp' ? { graph: discoveryAccessGraph(current) } : {}) }, kind === 'token' ? 'token' : `${kind}:${role}`);
    }
  }
}

async function discoverRunInner(rawKey, api) {
  let key;
  try { key = parseStackKey(rawKey); } catch { quarantine('Discovery key is invalid.'); }
  if (!api || typeof api.loadCheckpoint !== 'function') throw new TypeError('Expected a discovery API with loadCheckpoint().');
  if (typeof api.controllerTokenId !== 'string' || api.controllerTokenId.length === 0) quarantine('Discovery requires a trusted nonempty controller token ID.');
  const { inventory, intents } = parseCheckpointRecord(await api.loadCheckpoint(key));
  if (!sameJson(inventory.key, key)) quarantine('Checkpoint key does not match the trusted run.');
  // Terminal discovery is inspection of durable evidence, never recovery or
  // authority renewal. No timestamp or provider state is changed here.
  if (inventory.stage === 'quarantined' || inventory.stage === 'deleted') return inventory;
  const next = structuredClone(inventory);
  let recovered = false;
  for (const role of roles.worker) {
    if (next.cloudflare.workerIds[role]) continue;
    const name = expectedName(next, 'worker', role);
    const intent = matchingIntent(key, intents, `worker:${role}`, name);
    if (typeof api.listWorkers !== 'function') quarantine('Discovery evidence source is incomplete.');
    const listed = await api.listWorkers();
    const matches = Array.isArray(listed) ? listed.filter(resource => resource?.id === name) : [];
    if (!intent) {
      if (matches.length > 0) quarantine('An uncheckpointed deterministic name is foreign or ambiguous.');
      continue;
    }
    if (typeof api.getWorker !== 'function' || typeof api.listAudit !== 'function') quarantine('Discovery evidence source is incomplete.');
    if (matches.length !== 1 || typeof matches[0].tag !== 'string' || matches[0].tag.length === 0) quarantine('Worker discovery is ambiguous.');
    const current = await api.getWorker(role);
    const candidate = { ...next, cloudflare: { ...next.cloudflare, workerIds: { ...next.cloudflare.workerIds, [role]: matches[0].tag } } };
    const discovered = { accountId: next.cloudflare.accountId, kind: 'worker', role, name, id: current?.tag, bindings: current?.bindings };
    assertOwnedResource(candidate, discovered, `worker:${role}`);
    const audit = await api.listAudit();
    if (!Array.isArray(audit) || !audit.some(entry => auditProvesCreation(entry, { controllerTokenId: api.controllerTokenId, id: matches[0].tag, startedAt: intent.startedAt, method: 'PUT', uri: `/accounts/${next.cloudflare.accountId}/workers/scripts/${name}` }))) {
      quarantine('Audit evidence cannot independently prove the Worker creation.');
    }
    next.cloudflare.workerIds[role] = matches[0].tag;
    recovered = true;
  }
  const recoverListed = async ({ kind, section, validRoles, list, idField, method, uri }) => {
    for (const role of validRoles) {
      if (section === 'tokenId' ? next.cloudflare.tokenId : next.cloudflare[section][role]) continue;
      const name = expectedName(next, kind, role);
      const intent = matchingIntent(key, intents, kind === 'token' ? 'token' : `${kind}:${role}`, name);
      if (typeof api[list] !== 'function') quarantine('Discovery evidence source is incomplete.');
      const listed = await api[list]();
      const matches = Array.isArray(listed) ? listed.filter(resource => resource?.name === name) : [];
      if (!intent) {
        if (matches.length > 0) quarantine('An uncheckpointed deterministic name is foreign or ambiguous.');
        continue;
      }
      if (matches.length !== 1 || typeof matches[0][idField] !== 'string' || matches[0][idField].length === 0 || typeof api.listAudit !== 'function') {
        quarantine('Resource discovery is ambiguous.');
      }
      const id = matches[0][idField];
      const audit = await api.listAudit();
      if (!Array.isArray(audit) || !audit.some(entry => auditProvesCreation(entry, { controllerTokenId: api.controllerTokenId, id, startedAt: intent.startedAt, method, uri: uri(name) }))) {
        quarantine('Audit evidence cannot independently prove the resource creation.');
      }
      if (section === 'tokenId') next.cloudflare.tokenId = id;
      else next.cloudflare[section][role] = id;
      recovered = true;
    }
  };
  await recoverListed({ kind: 'd1', section: 'd1Ids', validRoles: roles.d1, list: 'listD1', idField: 'uuid', method: 'POST', uri: () => `/accounts/${next.cloudflare.accountId}/d1/database` });
  await recoverListed({ kind: 'accessApp', section: 'accessAppIds', validRoles: roles.accessApp, list: 'listAccessApps', idField: 'id', method: 'POST', uri: () => `/accounts/${next.cloudflare.accountId}/access/apps` });
  await recoverListed({ kind: 'token', section: 'tokenId', validRoles: [undefined], list: 'listServiceTokens', idField: 'id', method: 'POST', uri: () => `/accounts/${next.cloudflare.accountId}/access/service_tokens` });
  // Audit-correlated recovery establishes a candidate ID, not its graph.
  // Every returned identity, including recovered slots, needs current readback.
  await verifyRecordedResources(next, api);
  const complete = roles.worker.every(role => next.cloudflare.workerIds[role])
    && roles.d1.every(role => next.cloudflare.d1Ids[role])
    && roles.accessApp.every(role => next.cloudflare.accessAppIds[role]) && next.cloudflare.tokenId;
  if (complete) next.stage = 'active';
  else if (next.stage === 'active') next.stage = 'creating';
  const lifecycleChanged = next.stage !== inventory.stage;
  if (recovered || lifecycleChanged) next.updatedAt = new Date().toISOString();
  if ((recovered || lifecycleChanged) && typeof api.saveCheckpoint !== 'function') quarantine('Changed inventory cannot be returned before a durable checkpoint.');
  if (recovered || lifecycleChanged) await api.saveCheckpoint(validateInventory(next));
  return validateInventory(next);
}

export async function discoverRun(rawKey, api) {
  try {
    return await discoverRunInner(rawKey, api);
  } catch (error) {
    if (typeof api?.alert === 'function') api.alert({ status: 'quarantined', message: error.message });
    throw error;
  }
}
