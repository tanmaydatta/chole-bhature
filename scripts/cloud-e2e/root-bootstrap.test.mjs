import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapCiRoot } from './root-bootstrap.mjs';
import { createCloudflareClient } from './cloudflare.mjs';
import { resourceNames } from './key.mjs';

const key = { repository_id: 42, repository: 'acme/incentives', pr: 7, head_sha: 'a'.repeat(40), run_id: 99, attempt: 3 };
const ids = { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' };
const protectedD1Ids = { product: '55555555-5555-4555-8555-555555555555', auth: '66666666-6666-4666-8666-666666666666' };
const secret = 'synthetic-root-bootstrap-secret-32-characters';

function fixture({ config = protectedD1Ids, recorded = false } = {}) {
  const names = resourceNames(key);
  const inventory = { key, names, cloudflare: { accountId: 'account-1', workerIds: {}, d1Ids: recorded ? ids : { product: ids.product }, accessAppIds: {}, tokenId: null }, stage: 'creating', createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:00.000Z' };
  let ms = Date.parse(inventory.createdAt);
  const databases = new Map([[ids.product, { uuid: ids.product, name: names.product }]]);
  if (recorded) databases.set(ids.auth, { uuid: ids.auth, name: names.auth });
  const calls = [];
  const writes = [];
  const transport = { async request(request) {
    calls.push(request);
    let value;
    const root = '/accounts/account-1/d1/database';
    if (request.path === root && request.method === 'GET') value = [...databases.values()];
    else if (request.path === root && request.method === 'POST') {
      assert.deepEqual(request.body, { name: names.auth });
      value = { uuid: ids.auth, name: names.auth }; databases.set(ids.auth, value);
    } else if (request.method === 'GET') {
      value = databases.get(request.path.slice(root.length + 1));
      if (!value) return { status: 404 };
    } else if (request.method === 'DELETE') value = { uuid: ids.product };
    else if (request.path.endsWith('/query')) value = [{ success: true, results: [] }];
    else throw new Error('Unexpected local protocol request');
    return { status: 200, success: true, result: value, ...(Array.isArray(value) ? { result_info: { total_count: value.length } } : {}) };
  } };
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, protectedD1Ids: config, store: { async put(value) { writes.push(value); } }, now: () => new Date(ms).toISOString() });
  return { client, calls, writes, databases, setTime(value) { ms = value; } };
}

async function rejectWithoutSql(d1Client, input = {}) {
  const result = await bootstrapCiRoot({ authDatabaseId: ids.auth, key, authSecret: secret, email: 'root@example.test', d1Client, ...input }).then(() => 'accepted', () => 'rejected');
  assert.equal(result, 'rejected');
}

test('raw, copied and boolean-marked clients cannot create bootstrap authority', async () => {
  for (const d1Client of [{}, { verified: true, queryD1() { throw new Error('called'); } }, { async queryD1() { return [{ success: true, results: [] }]; } }]) await rejectWithoutSql(d1Client);
  const f = fixture({ recorded: true });
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.length, 0);
});

test('protected config is required independently of actual Auth creation', async () => {
  for (const config of [undefined, {}, { ...protectedD1Ids, auth: protectedD1Ids.product }, { ...protectedD1Ids, auth: 'ABCDEFAB-1234-4234-8234-123456789ABC' }]) {
    // An omitted argument is intentionally distinguished from fixture's default.
    const f = fixture({ config: config ?? null });
    await f.client.createD1('auth');
    f.calls.length = 0;
    await rejectWithoutSql(f.client);
    assert.equal(f.calls.length, 0);
  }
});

test('exact recipient run and Auth UUID are required before SQL', async () => {
  const f = fixture(); await f.client.createD1('auth');
  for (const authDatabaseId of ['', undefined, 'not-a-uuid', ids.product, protectedD1Ids.auth, '77777777-7777-4777-8777-777777777777']) await rejectWithoutSql(f.client, { authDatabaseId });
  await rejectWithoutSql(f.client, { key: { ...key, run_id: 100 } });
  await rejectWithoutSql({ ...f.client });
  assert.equal(f.calls.some(c => c.path.endsWith('/query')), false);
});

test('creation freshness cannot be renewed by successful readback', async () => {
  const f = fixture(); await f.client.createD1('auth');
  f.setTime(Date.parse('2026-10-06T12:05:00.001Z'));
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.some(c => c.path.endsWith('/query')), false);
});

test('changed or missing exact readback permanently revokes bootstrap', async () => {
  for (const change of ['missing', 'name', 'uuid', 'account_id']) {
    const f = fixture(); await f.client.createD1('auth');
    const original = f.databases.get(ids.auth);
    if (change === 'missing') f.databases.delete(ids.auth);
    else f.databases.set(ids.auth, { ...original, [change]: change === 'uuid' ? ids.product : 'manual-staging-auth' });
    await rejectWithoutSql(f.client);
    f.databases.set(ids.auth, original);
    await rejectWithoutSql(f.client);
    assert.equal(f.calls.some(c => c.path.endsWith('/query')), false);
  }
});

test('invalid bootstrap inputs reject before guard transport and errors reveal no secret', async () => {
  const f = fixture(); await f.client.createD1('auth'); f.calls.length = 0;
  for (const input of [{ email: '' }, { email: 'x\u0000@example.test' }, { authSecret: ' '.repeat(40) }]) await rejectWithoutSql(f.client, input);
  assert.equal(f.calls.length, 0);
});

test('deleting a dependency revokes Auth bootstrap even if later exact Auth readback is unchanged', async () => {
  const f = fixture(); await f.client.createD1('auth'); await f.client.deleteD1('product');
  f.calls.length = 0;
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.length, 0);
});

test('an ordinary changed Auth read revokes creation evidence before a later restored bootstrap readback', async () => {
  const f = fixture(); await f.client.createD1('auth'); const original = f.databases.get(ids.auth);
  f.databases.set(ids.auth, { uuid: ids.auth, name: 'foreign-auth' });
  await f.client.getD1(ids.auth);
  f.databases.set(ids.auth, original); f.calls.length = 0;
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.length, 0);
});
