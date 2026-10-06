import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapCiRoot } from './root-bootstrap.mjs';
import { createCloudflareClient, withBootstrapAuthDatabase } from './cloudflare.mjs';
import { resourceNames } from './key.mjs';

const key = { repository_id: 42, repository: 'acme/incentives', pr: 7, head_sha: 'a'.repeat(40), run_id: 99, attempt: 3 };
const ids = { product: '11111111-1111-4111-8111-111111111111', auth: '22222222-2222-4222-8222-222222222222' };
const protectedD1Ids = { product: '55555555-5555-4555-8555-555555555555', auth: '66666666-6666-4666-8666-666666666666' };
const secret = 'synthetic-root-bootstrap-secret-32-characters';

function fixture({ config = protectedD1Ids, recorded = false, beforeRequest = async () => {}, beforeCheckpoint = async () => {} } = {}) {
  const names = resourceNames(key);
  const inventory = { key, names, cloudflare: { accountId: 'account-1', workerIds: {}, d1Ids: recorded ? ids : { product: ids.product }, accessAppIds: {}, tokenId: null }, stage: 'creating', createdAt: '2026-10-06T12:00:00.000Z', updatedAt: '2026-10-06T12:00:00.000Z' };
  let ms = Date.parse(inventory.createdAt);
  const databases = new Map([[ids.product, { uuid: ids.product, name: names.product }]]);
  if (recorded) databases.set(ids.auth, { uuid: ids.auth, name: names.auth });
  const calls = [];
  const writes = [];
  const transport = { async request(request) {
    calls.push(request);
    await beforeRequest(request);
    let value;
    const root = '/accounts/account-1/d1/database';
    if (request.path === root && request.method === 'GET') value = [...databases.values()];
    else if (request.path === root && request.method === 'POST') {
      assert.deepEqual(request.body, { name: names.auth });
      const uuid = databases.has(ids.auth) ? '77777777-7777-4777-8777-777777777777' : ids.auth;
      value = { uuid, name: names.auth }; databases.set(uuid, value);
    } else if (request.method === 'GET') {
      value = databases.get(request.path.slice(root.length + 1));
      if (!value) return { status: 404 };
    } else if (request.method === 'DELETE') value = { uuid: ids.product };
    else if (request.path.endsWith('/query')) value = [{ success: true, results: [] }];
    else throw new Error('Unexpected local protocol request');
    return { status: 200, success: true, result: value, ...(Array.isArray(value) ? { result_info: { total_count: value.length } } : {}) };
  } };
  const client = createCloudflareClient({ accountId: 'account-1', inventory, transport, protectedD1Ids: config, store: { async put(value) { writes.push(value); await beforeCheckpoint(value); } }, now: () => new Date(ms).toISOString() });
  return { client, calls, writes, databases, setTime(value) { ms = value; } };
}

function deferred() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

const outcome = promise => promise.then(() => 'accepted', () => 'rejected');

test('overlapping Auth creation cannot redirect an admitted bootstrap from its requested UUID', async () => {
  const firstList = deferred(); const firstEntered = deferred(); const secondPost = deferred(); const secondEntered = deferred();
  let lists = 0; let firstWaiting = true; let second;
  const f = fixture({ beforeRequest: async request => {
    if (request.method === 'GET' && request.path.endsWith('/database') && ++lists === 1) { firstEntered.release(); await firstList.promise; }
    if (request.method === 'POST' && request.path.endsWith('/database') && firstWaiting) { secondEntered.release(); await secondPost.promise; }
    if (request.path.endsWith('/query')) { secondPost.release(); await second; }
  } });
  const first = f.client.createD1('auth'); await firstEntered.promise;
  second = outcome(f.client.createD1('auth'));
  // Either refusal or entry at the second POST is an explicit synchronization boundary.
  await Promise.race([secondEntered.promise, second]);
  firstWaiting = false; firstList.release();
  const requested = await first;
  const accepted = await outcome(bootstrapCiRoot({ authDatabaseId: requested.uuid, key, authSecret: secret, email: 'root@example.test', d1Client: f.client }));
  secondPost.release();
  assert.deepEqual({ second: await second, bootstrap: accepted,
    queries: f.calls.filter(call => call.path.endsWith('/query')).map(call => call.path),
    creates: f.calls.filter(call => call.method === 'POST' && call.path.endsWith('/database')).length,
  }, { second: 'rejected', bootstrap: 'accepted', queries: Array(2).fill(`/accounts/account-1/d1/database/${ids.auth}/query`), creates: 1 });
});

for (const [age, wanted] of [[299999, 'accepted'], [300000, 'rejected'], [300001, 'rejected']]) {
  test(`creation freshness is half-open at literal POST age ${age}ms`, async () => {
    const f = fixture(); await f.client.createD1('auth');
    f.setTime(Date.parse('2026-10-06T12:00:00.000Z') + age);
    assert.equal(await outcome(bootstrapCiRoot({ authDatabaseId: ids.auth, key, authSecret: secret, email: 'root@example.test', d1Client: f.client })), wanted);
    assert.equal(f.calls.filter(call => call.path.endsWith('/query')).length, wanted === 'accepted' ? 2 : 0);
  });
}

test('a delayed durable Auth checkpoint cannot restart the POST-boundary deadline', async () => {
  let f;
  f = fixture({ beforeCheckpoint: async value => { if (value.type !== 'create-intent') f.setTime(Date.parse('2026-10-06T12:05:00.001Z')); } });
  await f.client.createD1('auth'); await rejectWithoutSql(f.client);
  assert.equal(f.calls.filter(call => call.path.endsWith('/query')).length, 0);
});

test('a delayed Auth POST response cannot restart the deadline after create transport awaits', async () => {
  let f;
  f = fixture({ beforeRequest: async request => {
    if (request.method === 'POST' && request.path.endsWith('/database')) f.setTime(Date.parse('2026-10-06T12:05:00.001Z'));
  } });
  await f.client.createD1('auth'); await rejectWithoutSql(f.client);
  assert.equal(f.calls.filter(call => call.path.endsWith('/query')).length, 0);
});

test('clock observed at durable checkpoint completion cannot move backwards into earlier authority', async () => {
  let f;
  f = fixture({ beforeCheckpoint: async value => { if (value.type !== 'create-intent') f.setTime(Date.parse('2026-10-06T12:00:00.200Z')); } });
  await f.client.createD1('auth'); f.setTime(Date.parse('2026-10-06T12:00:00.100Z'));
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.some(call => call.path.endsWith('/query')), false);
});

test('dependency deletion during Auth checkpoint cannot mint new creation authority after revocation', async () => {
  let f;
  f = fixture({ beforeCheckpoint: async value => { if (value.type !== 'create-intent') await f.client.deleteD1('product'); } });
  assert.equal(await outcome(f.client.createD1('auth')), 'rejected');
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.some(call => call.path.endsWith('/query')), false);
});

test('a backwards clock within the original interval revokes bootstrap after awaited readback', async () => {
  let reads = 0; let f;
  f = fixture({ beforeRequest: async request => {
    if (request.method === 'GET' && request.path.endsWith(`/${ids.auth}`) && ++reads === 3) f.setTime(Date.parse('2026-10-06T12:00:00.050Z'));
  } });
  await f.client.createD1('auth'); f.setTime(Date.parse('2026-10-06T12:00:00.100Z'));
  await rejectWithoutSql(f.client);
  assert.equal(f.calls.filter(call => call.path.endsWith('/query') && call.body.sql.includes('INSERT INTO user')).length, 0);
  f.setTime(Date.parse('2026-10-06T12:00:00.200Z'));
  await rejectWithoutSql(f.client);
});

for (const [age, wanted] of [[299999, 'accepted'], [300000, 'rejected'], [300001, 'rejected'], [-1, 'rejected']]) {
  test(`awaited final readback rechecks deadline before INSERT at POST age ${age}ms`, async () => {
    let reads = 0; let f;
    f = fixture({ beforeRequest: async request => {
      if (request.method === 'GET' && request.path.endsWith(`/${ids.auth}`) && ++reads === 3) f.setTime(Date.parse('2026-10-06T12:00:00.000Z') + age);
    } });
    await f.client.createD1('auth');
    assert.equal(await outcome(bootstrapCiRoot({ authDatabaseId: ids.auth, key, authSecret: secret, email: 'root@example.test', d1Client: f.client })), wanted);
    assert.equal(f.calls.filter(call => call.path.endsWith('/query') && call.body.sql.includes('INSERT INTO user')).length, wanted === 'accepted' ? 1 : 0);
  });
}

test('queued bootstrap rechecks revoked original creation context after dependency deletion', async () => {
  const f = fixture(); await f.client.createD1('auth'); const entered = deferred(); const release = deferred();
  const first = withBootstrapAuthDatabase(f.client, { authDatabaseId: ids.auth, key }, async () => { entered.release(); await release.promise; });
  await entered.promise;
  const queued = outcome(bootstrapCiRoot({ authDatabaseId: ids.auth, key, authSecret: secret, email: 'root@example.test', d1Client: f.client }));
  await f.client.deleteD1('product'); release.release(); await first;
  assert.equal(await queued, 'rejected');
  assert.equal(f.calls.some(call => call.path.endsWith('/query')), false);
});

test('queued bootstrap cannot use creation evidence that expires while waiting', async () => {
  const f = fixture(); await f.client.createD1('auth'); const entered = deferred(); const release = deferred();
  const first = withBootstrapAuthDatabase(f.client, { authDatabaseId: ids.auth, key }, async () => { entered.release(); await release.promise; });
  await entered.promise;
  const queued = outcome(bootstrapCiRoot({ authDatabaseId: ids.auth, key, authSecret: secret, email: 'root@example.test', d1Client: f.client }));
  f.setTime(Date.parse('2026-10-06T12:05:00.000Z')); release.release(); await first;
  assert.equal(await queued, 'rejected');
  assert.equal(f.calls.some(call => call.path.endsWith('/query')), false);
});

test('ordinary changed read during awaited bootstrap readback cannot restore revoked authority', async () => {
  const entered = deferred(); const release = deferred(); let first = true;
  const f = fixture({ beforeRequest: async request => {
    if (request.method === 'GET' && request.path.endsWith(`/${ids.auth}`) && first) { first = false; entered.release(); await release.promise; }
  } });
  await f.client.createD1('auth');
  const pending = outcome(bootstrapCiRoot({ authDatabaseId: ids.auth, key, authSecret: secret, email: 'root@example.test', d1Client: f.client }));
  await entered.promise; const original = f.databases.get(ids.auth);
  f.databases.set(ids.auth, { ...original, name: 'foreign-auth' }); await f.client.getD1(ids.auth);
  f.databases.set(ids.auth, original); release.release();
  assert.equal(await pending, 'rejected');
  assert.equal(f.calls.some(call => call.path.endsWith('/query')), false);
});

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
