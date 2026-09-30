import { assertOwnedResource, checkpoint, InventoryQuarantineError, validateInventory } from './inventory.mjs';

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
  if (!['api', 'identity'].includes(role)) return null;
  return role === 'identity' ? inventory.names.auth : inventory.names.api;
}

function workerName(inventory, role) {
  return ['api', 'identity', 'operator', 'product'].includes(role) ? inventory.names[role] : null;
}

function result(response) {
  if (!response || typeof response !== 'object') throw new TypeError('Cloudflare transport returned an invalid response.');
  if (response.status === 404) return { missing: true };
  if (response.status && response.status >= 400) throw new Error(`Cloudflare API request failed with status ${response.status}.`);
  return { result: response.result };
}

function cloneWith(inventory, section, role, id, now) {
  return {
    ...inventory,
    cloudflare: { ...inventory.cloudflare, [section]: { ...inventory.cloudflare[section], [role]: id } },
    updatedAt: now(),
  };
}

function normalizeWorkerBindings(rawBindings) {
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
    if (binding.type === 'service' && typeof binding.service === 'string' && !Object.hasOwn(services, binding.name)) {
      services[binding.name] = binding.service;
      continue;
    }
    throw new TypeError('Cloudflare Worker settings contain an unsupported binding.');
  }
  return { d1, services };
}

export function createCloudflareClient({ accountId, inventory: rawInventory, transport, store, alert, now = () => new Date().toISOString(), workerUpload, accessAppCreate, serviceTokenCreate }) {
  let inventory = validateInventory(rawInventory);
  if (accountId !== inventory.cloudflare.accountId) quarantine('Cloudflare account is not certified by inventory.', alert);
  if (!transport || typeof transport.request !== 'function') throw new TypeError('Expected an injected Cloudflare transport with request().');
  const root = `/accounts/${accountId}`;
  const call = async (method, path, body) => result(await transport.request(body === undefined ? { method, path } : { method, path, body }));
  const evidence = async value => {
    if (!store || typeof store.put !== 'function') throw new TypeError('Expected a restricted evidence store with put().');
    await store.put(value, { classification: 'controller-evidence', retentionDays: 7, restricted: true });
  };
  const intent = async (kind, exactName) => evidence({ type: 'create-intent', key: inventory.key, kind, exactName, startedAt: now(), noPreexistingMatch: true });
  const check = async next => { inventory = validateInventory(next); await checkpoint(inventory, store); };

  async function listD1() { return (await call('GET', `${root}/d1/database`)).result; }
  async function getD1(uuid) {
    if (typeof uuid !== 'string' || uuid !== inventory.cloudflare.d1Ids.api && uuid !== inventory.cloudflare.d1Ids.identity) quarantine('D1 target is not certified by inventory.', alert);
    return call('GET', `${root}/d1/database/${uuid}`);
  }
  async function createD1(role) {
    const name = d1Name(inventory, role);
    if (!name) quarantine('D1 role is not certified by inventory.', alert);
    const listed = await listD1();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare D1 list response is invalid.');
    if (listed.some(database => database?.name === name)) quarantine('D1 already exists; create is ambiguous.', alert);
    await intent(`d1:${role}`, name);
    const created = (await call('POST', `${root}/d1/database`, { name })).result;
    if (!created || created.name !== name || typeof created.uuid !== 'string') quarantine('D1 create response is not an exact identity.', alert);
    await check(cloneWith(inventory, 'd1Ids', role, created.uuid, now));
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
  async function listWorkers() { return (await call('GET', `${root}/workers/scripts`)).result; }
  async function getWorker(role) {
    const name = workerName(inventory, role);
    const id = inventory.cloudflare.workerIds[role];
    if (!name || !id) quarantine('Worker target is not certified by inventory.', alert);
    const listed = await listWorkers();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare Worker list response is invalid.');
    const matches = listed.filter(script => script?.id === name);
    if (matches.length === 0) return { missing: true };
    if (matches.length !== 1) quarantine('Worker lookup is ambiguous.', alert);
    const settings = await call('GET', `${root}/workers/scripts/${name}/settings`);
    if (settings.missing) return { missing: true };
    return { name, tag: matches[0].tag, bindings: normalizeWorkerBindings(settings.result?.bindings) };
  }
  async function deleteWorker(role) {
    const name = workerName(inventory, role);
    if (!name) quarantine('Worker role is not certified by inventory.', alert);
    const current = await getWorker(role);
    if (current.missing) return { status: 'missing' };
    try { assertOwnedResource(inventory, { accountId, kind: 'worker', role, name: current.name, id: current.tag, bindings: current.bindings }, `worker:${role}`); } catch (error) { quarantine(error.message, alert); }
    await call('DELETE', `${root}/workers/scripts/${name}`);
    return { status: 'deleted' };
  }
  async function createWorker(role) {
    const name = workerName(inventory, role);
    if (!name) quarantine('Worker role is not certified by inventory.', alert);
    if (typeof workerUpload !== 'function') throw new TypeError('Expected a protected workerUpload builder.');
    const listed = await listWorkers();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare Worker list response is invalid.');
    if (listed.some(script => script?.id === name)) quarantine('Worker already exists; create is ambiguous.', alert);
    await intent(`worker:${role}`, name);
    const body = await workerUpload({ role, name, inventory: structuredClone(inventory) });
    if (!body || typeof body !== 'object') throw new TypeError('Protected workerUpload builder returned an invalid body.');
    const created = (await call('PUT', `${root}/workers/scripts/${name}`, body)).result;
    if (!created || typeof created.tag !== 'string' || created.tag.length === 0) quarantine('Worker create response is missing its immutable tag.', alert);
    await check(cloneWith(inventory, 'workerIds', role, created.tag, now));
    return created;
  }
  async function updateWorker(role) {
    const name = workerName(inventory, role);
    if (!name) quarantine('Worker role is not certified by inventory.', alert);
    if (typeof workerUpload !== 'function') throw new TypeError('Expected a protected workerUpload builder.');
    const current = await getWorker(role);
    if (current.missing) return { status: 'missing' };
    try { assertOwnedResource(inventory, { accountId, kind: 'worker', role, name: current.name, id: current.tag, bindings: current.bindings }, `worker:${role}`); } catch (error) { quarantine(error.message, alert); }
    const body = await workerUpload({ role, name, inventory: structuredClone(inventory), operation: 'update' });
    if (!body || typeof body !== 'object') throw new TypeError('Protected workerUpload builder returned an invalid body.');
    return (await call('PUT', `${root}/workers/scripts/${name}`, body)).result;
  }
  async function setWorkerSubdomain(role, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Expected subdomain enabled to be boolean.');
    const current = await getWorker(role);
    if (current.missing) return { status: 'missing' };
    try { assertOwnedResource(inventory, { accountId, kind: 'worker', role, name: current.name, id: current.tag, bindings: current.bindings }, `worker:${role}`); } catch (error) { quarantine(error.message, alert); }
    return (await call('POST', `${root}/workers/scripts/${current.name}/subdomain`, { enabled, previews_enabled: false })).result;
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
  async function listAccessApps() { return (await call('GET', `${root}/access/apps`)).result; }
  async function createAccessApp(role) {
    const name = accessAppName(role);
    if (!name) quarantine('Access application role is not certified by inventory.', alert);
    if (typeof accessAppCreate !== 'function') throw new TypeError('Expected a protected accessAppCreate builder.');
    const listed = await listAccessApps();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare Access app list response is invalid.');
    if (listed.some(app => app?.name === name)) quarantine('Access application already exists; create is ambiguous.', alert);
    await intent(`accessApp:${role}`, name);
    const body = await accessAppCreate({ role, name, inventory: structuredClone(inventory) });
    if (!body || typeof body !== 'object') throw new TypeError('Protected accessAppCreate builder returned an invalid body.');
    const created = (await call('POST', `${root}/access/apps`, body)).result;
    if (!created || created.name !== name || typeof created.id !== 'string' || created.id.length === 0) quarantine('Access application create response is not an exact identity.', alert);
    await check(cloneWith(inventory, 'accessAppIds', role, created.id, now));
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
    try { assertOwnedResource(inventory, { accountId, kind: 'accessApp', role, name: matches[0].name, id: matches[0].id }, `accessApp:${role}`); } catch (error) { quarantine(error.message, alert); }
    await call('DELETE', `${root}/access/apps/${id}`);
    return { status: 'deleted' };
  }
  async function listServiceTokens() { return (await call('GET', `${root}/access/service_tokens`)).result; }
  async function createServiceToken() {
    const name = inventory.names.token;
    if (typeof serviceTokenCreate !== 'function') throw new TypeError('Expected a protected serviceTokenCreate builder.');
    const listed = await listServiceTokens();
    if (!Array.isArray(listed)) throw new TypeError('Cloudflare service token list response is invalid.');
    if (listed.some(token => token?.name === name)) quarantine('Service token already exists; create is ambiguous.', alert);
    await intent('token', name);
    const body = await serviceTokenCreate({ name, inventory: structuredClone(inventory) });
    if (!body || typeof body !== 'object') throw new TypeError('Protected serviceTokenCreate builder returned an invalid body.');
    const created = (await call('POST', `${root}/access/service_tokens`, body)).result;
    if (!created || created.name !== name || typeof created.id !== 'string' || created.id.length === 0) quarantine('Service token create response is not an exact identity.', alert);
    inventory = validateInventory({ ...inventory, cloudflare: { ...inventory.cloudflare, tokenId: created.id }, updatedAt: now() });
    await checkpoint(inventory, store);
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
