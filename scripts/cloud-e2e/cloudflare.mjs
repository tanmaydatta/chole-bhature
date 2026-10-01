import { assertOwnedResource, betaWorkerAttachmentReceipt, betaWorkerEvidencePhase, betaWorkerReceipt, checkpoint, consumeBetaAccessCreatePlan, consumeBetaTokenCreatePlan, consumeBetaWorkerAction, consumeBetaWorkerCreatePlan, InventoryQuarantineError, validateInventory } from './inventory.mjs';

export class MutationQuarantinedError extends InventoryQuarantineError {
  constructor(message) {
    super(message);
    this.name = 'MutationQuarantinedError';
  }
}

function quarantine(message, alert) {
  const error = new MutationQuarantinedError(message);
  if (typeof alert === 'function') alert({ status: 'quarantined', message });
  throw error;
}

function d1Name(inventory, role) {
  if (!['product', 'auth'].includes(role)) return null;
  return role === 'product' ? inventory.names.product : inventory.names.auth;
}

function workerName(inventory, role) {
  return ['api', 'identity', 'operator'].includes(role) ? inventory.names[role] : null;
}

function result(response) {
  if (!response || typeof response !== 'object') throw new TypeError('Cloudflare transport returned an invalid response.');
  if (response.status === 404) return { missing: true };
  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300 || response.success !== true || !Object.hasOwn(response, 'result') || response.result === undefined) {
    throw new TypeError('Cloudflare API envelope is malformed or unsuccessful.');
  }
  return { result: response.result, resultInfo: response.result_info };
}

function cloneWith(inventory, section, role, id, now) {
  return {
    ...inventory,
    cloudflare: { ...inventory.cloudflare, [section]: { ...inventory.cloudflare[section], [role]: id } },
    updatedAt: now(),
  };
}

function normalizeAccessGraph(app) {
  const destination = Array.isArray(app?.destinations) && app.destinations.length === 1 ? app.destinations[0] : null;
  const policy = Array.isArray(app?.policies) && app.policies.length === 1 ? app.policies[0] : null;
  const include = Array.isArray(policy?.include) && policy.include.length === 1 ? policy.include[0]?.service_token : null;
  if (!destination || Object.keys(destination).length !== 3 || destination.type !== 'worker' || typeof destination.worker_id !== 'string' || destination.worker_id.length === 0
    || !Array.isArray(destination.overrides) || destination.overrides.length !== 0 || !policy || policy.decision !== 'non_identity'
    || Object.keys(policy).length !== 2 || !include || Object.keys(policy.include[0]).length !== 1 || !Object.hasOwn(policy.include[0], 'service_token') || Object.keys(include).length !== 1 || typeof include.token_id !== 'string' || include.token_id.length === 0) throw new TypeError('Cloudflare Access application graph is unsupported or malformed.');
  return { workerId: destination.worker_id, tokenId: include.token_id, decision: policy.decision, exclusive: true, publicOverrides: false };
}

function normalizeWorkerBindings(rawBindings, workerTags) {
  if (!Array.isArray(rawBindings)) throw new TypeError('Cloudflare Worker settings bindings are invalid.');
  const d1 = {};
  const services = {};
  for (const binding of rawBindings) {
    if (!binding || typeof binding !== 'object' || typeof binding.name !== 'string' || binding.name.length === 0) {
      throw new TypeError('Cloudflare Worker settings bindings are invalid.');
    }
    if (binding.type === 'd1' && typeof binding.id === 'string' && !Object.hasOwn(d1, binding.name)) {
      d1[binding.name] = binding.id;
      continue;
    }
    if (binding.type === 'service' && typeof binding.service === 'string' && typeof workerTags[binding.service] === 'string' && !Object.hasOwn(services, binding.name)) {
      services[binding.name] = workerTags[binding.service];
      continue;
    }
    throw new TypeError('Cloudflare Worker settings contain an unsupported binding.');
  }
  return { d1, services };
}

const betaEvidence = new WeakMap();

function protocolClock(now) {
  const value = now(); const parsed = Date.parse(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new InventoryQuarantineError('Beta Worker evidence clock is invalid.');
  return { value, parsed, now: () => value };
}

function betaWorkerId(inventory, role) {
  const id = inventory.betaWorkerIds?.[role];
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/u.test(id)) throw new InventoryQuarantineError('Beta Worker has no certified immutable ID.');
  return id;
}

function betaWorkerPath(inventory, role) {
  return `/accounts/${inventory.cloudflare.accountId}/workers/workers/${betaWorkerId(inventory, role)}`;
}

function receipt(receipt, kind, now) {
  return betaWorkerReceipt(receipt, kind, now);
}

export function planBetaWorkerCreate(intentReceipt, now = () => new Date().toISOString()) {
  const { inventory, role } = consumeBetaWorkerCreatePlan(intentReceipt, now);
  if (!workerName(inventory, role) || inventory.betaWorkerIds?.[role]) throw new InventoryQuarantineError('Beta Worker create receipt is not a new certified role.');
  return {
    method: 'POST',
    path: `/accounts/${inventory.cloudflare.accountId}/workers/workers`,
    body: { name: inventory.names[role], subdomain: { enabled: false, previews_enabled: false } },
  };
}

export function planBetaWorkerRead(idReceipt, now = () => new Date().toISOString()) {
  const { inventory, role } = receipt(idReceipt, 'id', now);
  return { method: 'GET', path: betaWorkerPath(inventory, role) };
}

export function planBetaTokenCreate(tokenIntentReceipt, now = () => new Date().toISOString()) {
  const { inventory } = consumeBetaTokenCreatePlan(tokenIntentReceipt, now);
  return { method: 'POST', path: `/accounts/${inventory.cloudflare.accountId}/access/service_tokens`, body: { name: inventory.names.token } };
}

export function planBetaAccessCreate(accessIntentReceipt, now = () => new Date().toISOString()) {
  const { inventory, role } = consumeBetaAccessCreatePlan(accessIntentReceipt, now);
  return {
    method: 'POST', path: `/accounts/${inventory.cloudflare.accountId}/access/apps`,
    body: {
      name: role === 'api' ? inventory.names.accessApi : inventory.names.accessOperator,
      destinations: [{ type: 'worker', worker_id: betaWorkerId(inventory, role), overrides: [] }],
      policies: [{ decision: 'non_identity', include: [{ service_token: { token_id: inventory.cloudflare.tokenId } }] }],
    },
  };
}

function exactD1Bindings(inventory, role, bindings) {
  const expected = role === 'api' ? inventory.cloudflare.d1Ids.product : role === 'identity' ? inventory.cloudflare.d1Ids.auth : null;
  if (!expected) return false;
  return Array.isArray(bindings) && bindings.length === 1 && bindings[0]?.name === 'DB' && bindings[0]?.type === 'd1'
    && bindings[0]?.database_id === expected && Object.keys(bindings[0]).length === 3;
}

function observationEnvelope(inventory, role, envelope, kind, path, now, after) {
  if (!envelope || typeof envelope !== 'object' || Object.keys(envelope).length !== 6
    || envelope.kind !== kind || envelope.role !== role || JSON.stringify(envelope.run) !== JSON.stringify(inventory.key)
    || typeof envelope.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(envelope.observedAt)
    || !envelope.request || Object.keys(envelope.request).length !== 2 || envelope.request.method !== 'GET' || envelope.request.path !== path
    || !envelope.response || Object.keys(envelope.response).length !== 2 || envelope.response.success !== true) {
    throw new InventoryQuarantineError('Beta Worker observation provenance is invalid.');
  }
  const observed = Date.parse(envelope.observedAt); const clock = now(); const current = Date.parse(clock);
  if (!Number.isFinite(observed) || new Date(observed).toISOString() !== envelope.observedAt || typeof clock !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(clock) || !Number.isFinite(current) || new Date(current).toISOString() !== clock || observed > current || current - observed > 5 * 60 * 1000 || observed < after) throw new InventoryQuarantineError('Beta Worker observation is stale or out of order.');
  return envelope.response.result;
}

function exactAccessGate(inventory, role, envelope, now, after) {
  const expectedName = role === 'api' ? inventory.names.accessApi : inventory.names.accessOperator;
  const expectedId = inventory.cloudflare.accessAppIds[role];
  const expectedWorkerId = betaWorkerId(inventory, role);
  const app = observationEnvelope(inventory, role, envelope, 'beta-access-readback', `/accounts/${inventory.cloudflare.accountId}/access/apps/${expectedId}`, now, after);
  if (Date.parse(envelope.observedAt) <= after) throw new InventoryQuarantineError('Beta Worker Access readback did not follow attachment.');
  if (!app || typeof app !== 'object' || Object.keys(app).length !== 4) throw new InventoryQuarantineError('Beta Worker Access readback is not exact.');
  const destinations = Array.isArray(app.destinations) && app.destinations.length === 1 ? app.destinations[0] : null;
  const policy = Array.isArray(app.policies) && app.policies.length === 1 ? app.policies[0] : null;
  const include = Array.isArray(policy?.include) && policy.include.length === 1 ? policy.include[0] : null;
  if (!expectedId || app.id !== expectedId || app.name !== expectedName || !destinations
    || Object.keys(destinations).length !== 3 || destinations.type !== 'worker' || destinations.worker_id !== expectedWorkerId
    || !Array.isArray(destinations.overrides) || destinations.overrides.length !== 0 || !policy
    || Object.keys(policy).length !== 2 || policy.decision !== 'non_identity' || !include
    || Object.keys(include).length !== 1 || !include.service_token || Object.keys(include.service_token).length !== 1
    || include.service_token.token_id !== inventory.cloudflare.tokenId) throw new InventoryQuarantineError('Beta Worker Access readback is not the exact token-exclusive policy.');
}

export function prepareBetaWorkerEvidence(idReceipt, observations, now = () => new Date().toISOString()) {
  const clock = protocolClock(now);
  const { inventory, role, observedAt, observation, generation, expiresAt } = receipt(idReceipt, 'id', clock.now);
  if (role === 'operator') return { status: 'unsupported', reason: 'service-binding-remapping-unresolved' };
  betaWorkerEvidencePhase(idReceipt, clock.now);
  if (!observations || typeof observations !== 'object' || Object.keys(observations).length !== 4 || !observations.access || Object.keys(observations.access).length !== 2 || !observations.attachments || Object.keys(observations.attachments).length !== 2) throw new InventoryQuarantineError('Beta Worker evidence is incomplete.');
  const apiAttachment = betaWorkerAttachmentReceipt(observations.attachments.api, 'api', idReceipt, clock.now);
  const operatorAttachment = betaWorkerAttachmentReceipt(observations.attachments.operator, 'operator', idReceipt, clock.now);
  const path = betaWorkerPath(inventory, role);
  const worker = observationEnvelope(inventory, role, observations.worker, 'beta-worker-readback', path, clock.now, observedAt);
  if (JSON.stringify(worker) !== JSON.stringify(observation) || worker.deployed_on !== null || !exactD1Bindings(inventory, role, worker.bindings)) throw new InventoryQuarantineError('Beta Worker inert graph is unsupported or changed.');
  const versions = observationEnvelope(inventory, role, observations.versions, 'beta-version-list', `${path}/versions`, clock.now, observedAt);
  if (!Array.isArray(versions) || versions.length !== 0) throw new InventoryQuarantineError('Beta Worker version state is unknown or non-inert.');
  exactAccessGate(inventory, 'api', observations.access.api, clock.now, apiAttachment.observedAt);
  exactAccessGate(inventory, 'operator', observations.access.operator, clock.now, operatorAttachment.observedAt);
  const evidence = {}; betaEvidence.set(evidence, { inventory, role, idReceipt, generation, preparedAt: clock.parsed, expiresAt: Math.min(expiresAt, apiAttachment.observedAt + 5 * 60 * 1000, operatorAttachment.observedAt + 5 * 60 * 1000) });
  return evidence;
}

function evidence(receipt, now) {
  const state = betaEvidence.get(receipt);
  if (!state || state.used) throw new InventoryQuarantineError('Beta Worker evidence receipt is invalid, incomplete, or already consumed.');
  const clock = protocolClock(now);
  if (clock.parsed < state.preparedAt || clock.parsed > state.expiresAt) throw new InventoryQuarantineError('Beta Worker evidence receipt expired.');
  const id = betaWorkerReceipt(state.idReceipt, 'id', clock.now);
  if (id.generation !== state.generation) throw new InventoryQuarantineError('Beta Worker evidence receipt was revoked by a phase transition.');
  consumeBetaWorkerAction(state.idReceipt, state.generation, clock.now);
  state.used = true;
  return state;
}

export function planBetaWorkerDisable(evidenceReceipt, now = () => new Date().toISOString()) {
  const { inventory, role } = evidence(evidenceReceipt, now);
  return { method: 'PATCH', path: betaWorkerPath(inventory, role), body: { subdomain: { enabled: false, previews_enabled: false } } };
}

export function planBetaWorkerDelete(evidenceReceipt, now = () => new Date().toISOString()) {
  const { inventory, role } = evidence(evidenceReceipt, now);
  return { method: 'DELETE', path: betaWorkerPath(inventory, role) };
}

function safeModule(module) {
  if (!module || typeof module !== 'object' || Object.keys(module).length !== 3 || module.contentType !== 'application/javascript+module'
    || typeof module.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(module.name) || module.name.includes('..') || module.name.includes('//')
    || typeof module.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(module.contentBase64)) {
    throw new InventoryQuarantineError('Beta Worker module is unsupported or unsafe.');
  }
}

function safeBindings(inventory, role, bindings) {
  if (!Array.isArray(bindings)) throw new InventoryQuarantineError('Beta Worker bindings are invalid.');
  const expected = role === 'api' ? inventory.cloudflare.d1Ids.product : role === 'identity' ? inventory.cloudflare.d1Ids.auth : null;
  if (role === 'operator') return { status: 'unsupported', reason: 'service-binding-remapping-unresolved' };
  if (!expected) throw new InventoryQuarantineError('Beta Worker required D1 binding ID is missing.');
  if (expected && bindings.length === 1 && bindings[0]?.type === 'd1' && bindings[0]?.name === 'DB' && bindings[0]?.database_id === expected && Object.keys(bindings[0]).length === 3) return null;
  if (!expected && bindings.length === 0) return null;
  throw new InventoryQuarantineError('Beta Worker bindings are not the allowlisted exact graph.');
}

export function planBetaWorkerVersion(evidenceReceipt, { module, bindings = [] }, requestedRole, now = () => new Date().toISOString()) {
  const { inventory, role } = evidence(evidenceReceipt, now);
  if (requestedRole && requestedRole !== role) throw new InventoryQuarantineError('Beta Worker role cannot change after evidence validation.');
  const unsupported = safeBindings(inventory, role, bindings);
  if (unsupported) return unsupported;
  safeModule(module);
  return {
    method: 'POST',
    path: `${betaWorkerPath(inventory, role)}/versions`,
    query: { deploy: false },
    body: { main_module: module.name, modules: [{ name: module.name, content_type: module.contentType, content_base64: module.contentBase64 }], bindings },
  };
}

export function createCloudflareClient({ accountId, inventory: rawInventory, transport, store, alert, now = () => new Date().toISOString(), accessAppCreate, serviceTokenCreate }) {
  let inventory = validateInventory(rawInventory);
  let poisoned = false;
  if (accountId !== inventory.cloudflare.accountId) quarantine('Cloudflare account is not certified by inventory.', alert);
  if (!transport || typeof transport.request !== 'function') throw new TypeError('Expected an injected Cloudflare transport with request().');
  const root = `/accounts/${accountId}`;
  const call = async (method, path, body) => {
    if (poisoned) quarantine('Cloudflare client is quarantined after ambiguous persistence.', alert);
    try { return result(await transport.request(body === undefined ? { method, path } : { method, path, body })); }
    catch (error) { poisoned = true; quarantine(error.message, alert); }
  };
  const completeList = (response, validEntry, uniqueField) => {
    if (!Array.isArray(response.result) || !response.resultInfo || !Number.isSafeInteger(response.resultInfo.total_count) || response.resultInfo.total_count !== response.result.length) {
      poisoned = true; quarantine('Cloudflare list response is incomplete or malformed.', alert);
    }
    const values = response.result.map(entry => entry?.[uniqueField]);
    if (response.result.some(entry => !validEntry(entry)) || values.some(value => typeof value !== 'string' || value.length === 0) || new Set(values).size !== values.length) {
      poisoned = true; quarantine('Cloudflare list contains a malformed resource entry.', alert);
    }
    return response.result;
  };
  const evidence = async value => {
    if (!store || typeof store.put !== 'function') throw new TypeError('Expected a restricted evidence store with put().');
    await store.put(value, { classification: 'controller-evidence', retentionDays: 7, restricted: true });
  };
  const intent = async (kind, exactName) => evidence({ type: 'create-intent', key: inventory.key, kind, exactName, startedAt: now(), noPreexistingMatch: true });
  const check = async next => { const candidate = validateInventory(next); await checkpoint(candidate, store); inventory = candidate; };

  async function listD1() { return completeList(await call('GET', `${root}/d1/database`), entry => typeof entry?.name === 'string' && entry.name.length > 0 && typeof entry?.uuid === 'string' && entry.uuid.length > 0, 'uuid'); }
  async function getD1(uuid) {
    if (typeof uuid !== 'string' || uuid !== inventory.cloudflare.d1Ids.product && uuid !== inventory.cloudflare.d1Ids.auth) quarantine('D1 target is not certified by inventory.', alert);
    return call('GET', `${root}/d1/database/${uuid}`);
  }
  async function createD1(role) {
    const name = d1Name(inventory, role);
    if (!name) quarantine('D1 role is not certified by inventory.', alert);
    if (inventory.cloudflare.d1Ids[role]) quarantine('D1 role already has a recorded exact ID.', alert);
    const listed = await listD1();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare D1 list response is invalid.');
    if (listed.some(database => database?.name === name)) quarantine('D1 already exists; create is ambiguous.', alert);
    await intent(`d1:${role}`, name);
    const created = (await call('POST', `${root}/d1/database`, { name })).result;
    if (!created || created.name !== name || typeof created.uuid !== 'string' || listed.some(database => database.uuid === created.uuid)) quarantine('D1 create response is reused or ambiguous.', alert);
    try { await check(cloneWith(inventory, 'd1Ids', role, created.uuid, now)); } catch (error) { poisoned = true; quarantine(error.message, alert); }
    return created;
  }
  async function deleteD1(role) {
    const id = inventory.cloudflare.d1Ids[role];
    const name = d1Name(inventory, role);
    if (!id || !name) quarantine('D1 target is not certified by inventory.', alert);
    const current = await getD1(id);
    if (current.missing) return { status: 'missing' };
    const resource = current.result;
    try { assertOwnedResource(inventory, { accountId, kind: 'd1', role, name: resource?.name, id: resource?.uuid }, `d1:${role}`); } catch (error) { quarantine(error.message, alert); }
    await call('DELETE', `${root}/d1/database/${id}`);
    return { status: 'deleted' };
  }
  async function listWorkers() {
    const response = await call('GET', `${root}/workers/scripts`);
    const listed = completeList(response, entry => typeof entry?.id === 'string' && entry.id.length > 0 && typeof entry?.tag === 'string' && entry.tag.length > 0, 'id');
    const tags = listed.map(entry => entry.tag);
    if (new Set(tags).size !== tags.length) { poisoned = true; quarantine('Cloudflare Worker list has duplicate immutable tags.', alert); }
    return listed;
  }
  async function getWorker(role) {
    const name = workerName(inventory, role);
    if (!name) quarantine('Worker role is invalid.', alert);
    const listed = await listWorkers();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare Worker list response is invalid.');
    const matches = listed.filter(script => script?.id === name);
    if (matches.length === 0) return { missing: true };
    if (matches.length !== 1) quarantine('Worker lookup is ambiguous.', alert);
    const settings = await call('GET', `${root}/workers/scripts/${name}/settings`);
    if (settings.missing) return { missing: true };
    try {
      const tags = Object.fromEntries(listed.map(script => [script.id, script.tag]));
      return { name, tag: matches[0].tag, bindings: normalizeWorkerBindings(settings.result?.bindings, tags) };
    } catch (error) { poisoned = true; quarantine(error.message, alert); }
  }
  async function deleteWorker(role) {
    return createWorker(role);
  }
  async function createWorker(role) {
    if (!workerName(inventory, role)) quarantine('Worker role is not certified by inventory.', alert);
    if (typeof alert === 'function') alert({ status: 'unsupported', reason: 'immutable-worker-mutation-unproven' });
    return { status: 'unsupported', reason: 'immutable-worker-mutation-unproven' };
  }
  async function updateWorker(role) {
    return createWorker(role);
  }
  async function setWorkerSubdomain(role, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Expected subdomain enabled to be boolean.');
    return createWorker(role);
  }
  async function queryD1(role, sql, params = []) {
    const id = inventory.cloudflare.d1Ids[role];
    if (!d1Name(inventory, role) || !id || typeof sql !== 'string' || !Array.isArray(params)) quarantine('D1 query is not certified by inventory.', alert);
    const current = await getD1(id);
    if (current.missing) return { status: 'missing' };
    try { assertOwnedResource(inventory, { accountId, kind: 'd1', role, name: current.result?.name, id: current.result?.uuid }, `d1:${role}`); } catch (error) { quarantine(error.message, alert); }
    return (await call('POST', `${root}/d1/database/${id}/query`, { sql, params })).result;
  }
  function accessAppName(role) {
    return role === 'api' ? inventory.names.accessApi : role === 'operator' ? inventory.names.accessOperator : null;
  }
  async function listAccessApps() { return completeList(await call('GET', `${root}/access/apps`), entry => typeof entry?.id === 'string' && entry.id.length > 0 && typeof entry?.name === 'string' && entry.name.length > 0, 'id'); }
  async function createAccessApp(role) {
    const name = accessAppName(role);
    if (!name) quarantine('Access application role is not certified by inventory.', alert);
    if (inventory.cloudflare.accessAppIds[role]) quarantine('Access application role already has a recorded exact ID.', alert);
    if (typeof accessAppCreate !== 'function') throw new TypeError('Expected a protected accessAppCreate builder.');
    const listed = await listAccessApps();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare Access app list response is invalid.');
    if (listed.some(app => app?.name === name)) quarantine('Access application already exists; create is ambiguous.', alert);
    await intent(`accessApp:${role}`, name);
    const body = await accessAppCreate({ role, name, inventory: structuredClone(inventory) });
    if (!body || typeof body !== 'object') throw new TypeError('Protected accessAppCreate builder returned an invalid body.');
    try {
      if (body.name !== name) throw new TypeError('Protected Access application name is not controller-derived.');
      assertOwnedResource({ ...inventory, cloudflare: { ...inventory.cloudflare, accessAppIds: { ...inventory.cloudflare.accessAppIds, [role]: '__pending__' } } }, { accountId, kind: 'accessApp', role, name, id: '__pending__', graph: normalizeAccessGraph(body) }, `accessApp:${role}`);
    } catch (error) { poisoned = true; quarantine(error.message, alert); }
    const created = (await call('POST', `${root}/access/apps`, body)).result;
    if (!created || created.name !== name || typeof created.id !== 'string' || created.id.length === 0) quarantine('Access application create response is not an exact identity.', alert);
    try { await check(cloneWith(inventory, 'accessAppIds', role, created.id, now)); } catch (error) { poisoned = true; quarantine(error.message, alert); }
    return created;
  }
  async function deleteAccessApp(role) {
    const id = inventory.cloudflare.accessAppIds[role];
    const name = accessAppName(role);
    if (!id || !name) quarantine('Access application target is not certified by inventory.', alert);
    const listed = await listAccessApps();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare Access app list response is invalid.');
    const matches = listed.filter(app => app?.id === id);
    if (matches.length === 0) return { status: 'missing' };
    if (matches.length !== 1) quarantine('Access application lookup is ambiguous.', alert);
    try { assertOwnedResource(inventory, { accountId, kind: 'accessApp', role, name: matches[0].name, id: matches[0].id, graph: normalizeAccessGraph(matches[0]) }, `accessApp:${role}`); } catch (error) { poisoned = true; quarantine(error.message, alert); }
    await call('DELETE', `${root}/access/apps/${id}`);
    return { status: 'deleted' };
  }
  async function listServiceTokens() { return completeList(await call('GET', `${root}/access/service_tokens`), entry => typeof entry?.id === 'string' && entry.id.length > 0 && typeof entry?.name === 'string' && entry.name.length > 0, 'id'); }
  async function createServiceToken() {
    const name = inventory.names.token;
    if (inventory.cloudflare.tokenId) quarantine('Service token already has a recorded exact ID.', alert);
    if (typeof serviceTokenCreate !== 'function') throw new TypeError('Expected a protected serviceTokenCreate builder.');
    const listed = await listServiceTokens();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare service token list response is invalid.');
    if (listed.some(token => token?.name === name)) quarantine('Service token already exists; create is ambiguous.', alert);
    await intent('token', name);
    const body = await serviceTokenCreate({ name, inventory: structuredClone(inventory) });
    if (!body || typeof body !== 'object') throw new TypeError('Protected serviceTokenCreate builder returned an invalid body.');
    const created = (await call('POST', `${root}/access/service_tokens`, body)).result;
    if (!created || created.name !== name || typeof created.id !== 'string' || created.id.length === 0) quarantine('Service token create response is not an exact identity.', alert);
    const candidate = validateInventory({ ...inventory, cloudflare: { ...inventory.cloudflare, tokenId: created.id }, updatedAt: now() });
    try { await checkpoint(candidate, store); } catch (error) { poisoned = true; quarantine(error.message, alert); }
    inventory = candidate;
    return created;
  }
  async function deleteServiceToken() {
    const id = inventory.cloudflare.tokenId;
    if (!id) quarantine('Service token target is not certified by inventory.', alert);
    const listed = await listServiceTokens();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare service token list response is invalid.');
    const matches = listed.filter(token => token?.id === id);
    if (matches.length === 0) return { status: 'missing' };
    if (matches.length !== 1) quarantine('Service token lookup is ambiguous.', alert);
    try { assertOwnedResource(inventory, { accountId, kind: 'token', role: undefined, name: matches[0].name, id: matches[0].id }, 'token'); } catch (error) { quarantine(error.message, alert); }
    await call('DELETE', `${root}/access/service_tokens/${id}`);
    return { status: 'deleted' };
  }

  return Object.freeze({
    listD1, getD1, createD1, deleteD1, queryD1,
    listWorkers, getWorker, createWorker, updateWorker, deleteWorker, setWorkerSubdomain,
    listAccessApps, createAccessApp, deleteAccessApp,
    listServiceTokens, createServiceToken, deleteServiceToken,
  });
}
