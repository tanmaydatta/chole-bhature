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

export function recordBetaWorkerObservation(rawInventory, role, observation) {
  const inventory = validateInventory(rawInventory);
  if (!roles.worker.includes(role)) quarantine('Beta Worker role is invalid.');
  object(observation, 'Beta Worker observation is invalid.');
  if (!BETA_WORKER_ID.test(observation.id) || observation.name !== inventory.names[role]
    || !Array.isArray(observation.routes) || observation.routes.length !== 0
    || !observation.subdomain || observation.subdomain.enabled !== false || observation.subdomain.previews_enabled !== false) {
    quarantine('Beta Worker observation is not a disabled exact immutable identity.');
  }
  const prior = inventory.betaWorkerIds?.[role];
  if (prior && prior !== observation.id) quarantine('Beta Worker immutable ID changed after checkpoint.');
  return validateInventory({ ...inventory, betaWorkerIds: { ...inventory.betaWorkerIds, [role]: observation.id } });
}

export async function checkpointBetaWorkerCreateIntent(rawInventory, role, store, now = () => new Date().toISOString()) {
  const inventory = validateInventory(rawInventory);
  if (!roles.worker.includes(role)) quarantine('Beta Worker role is invalid.');
  if (inventory.betaWorkerIds?.[role]) quarantine('Beta Worker already has a certified immutable ID.');
  if (!store || typeof store.put !== 'function') throw new TypeError('Expected a restricted evidence store with put().');
  const startedAt = now();
  if (!ISO_TIME.test(startedAt)) quarantine('Beta Worker creation intent time is invalid.');
  await store.put({
    type: 'beta-worker-create-intent', key: inventory.key, role, exactName: inventory.names[role], startedAt, noPreexistingMatch: true,
  }, { classification: 'controller-evidence', retentionDays: 7, restricted: true });
}

export async function checkpointBetaWorkerObservation(rawInventory, role, observation, store) {
  const inventory = recordBetaWorkerObservation(rawInventory, role, observation);
  await checkpoint(inventory, store);
  return inventory;
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

async function discoverRunInner(rawKey, api) {
  let key;
  try { key = parseStackKey(rawKey); } catch { quarantine('Discovery key is invalid.'); }
  if (!api || typeof api.loadCheckpoint !== 'function') throw new TypeError('Expected a discovery API with loadCheckpoint().');
  if (typeof api.controllerTokenId !== 'string' || api.controllerTokenId.length === 0) quarantine('Discovery requires a trusted nonempty controller token ID.');
  const { inventory, intents } = parseCheckpointRecord(await api.loadCheckpoint(key));
  if (!sameJson(inventory.key, key)) quarantine('Checkpoint key does not match the trusted run.');
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
  const complete = roles.worker.every(role => next.cloudflare.workerIds[role])
    && roles.d1.every(role => next.cloudflare.d1Ids[role])
    && roles.accessApp.every(role => next.cloudflare.accessAppIds[role]) && next.cloudflare.tokenId;
  let lifecycleChanged = false;
  if (complete) next.stage = 'active';
  else if (next.stage === 'active') { next.stage = 'creating'; lifecycleChanged = true; }
  next.updatedAt = new Date().toISOString();
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
