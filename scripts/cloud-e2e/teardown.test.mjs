import assert from 'node:assert/strict';
import test from 'node:test';

import { fixture, key, mockBoundary } from './provision.test.mjs';
import { resourceNames } from './key.mjs';
import * as provision from './provision.mjs';
import * as teardown from './teardown.mjs';

const { teardownMockStack } = teardown;
const { provisionMockStack } = provision;

test('forged or copied raw sessions cannot authorize any provider call', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const names = resourceNames(key);
  const makeForged = () => {
    const mock = mockBoundary();
    mock.databases.set(id, { uuid: id, name: names.product });
    const session = {
      key, accountId: 'account-1', store: mock.store, provider: mock.provider, now: mock.now,
      inventory: {
        key, names, cloudflare: { accountId: 'account-1', workerIds: {}, d1Ids: { product: id }, accessAppIds: {}, tokenId: null },
        stage: 'creating', createdAt: mock.now(), updatedAt: mock.now(),
      },
      pending: new Set(), phase: 'closing',
    };
    return { mock, session };
  };
  {
    const { mock, session } = makeForged();
    assert.deepEqual(await teardownMockStack({ key, accountId: 'account-1', store: mock.store, session: { ...session } }), { status: 'refused', reason: 'unproven-run-or-account' });
    assert.equal(mock.calls.length, 0);
  }
  {
    const { mock, session } = makeForged();
    if (typeof teardown.cleanupMockSession === 'function') await teardown.cleanupMockSession(session);
    assert.equal(mock.calls.length, 0, 'raw cleanup helper must not reach provider or storage');
  }
  {
    const { mock, session } = makeForged();
    if (typeof teardown.registerMockSession === 'function') {
      const registered = teardown.registerMockSession(session);
      registered.phase = 'closing';
      await teardownMockStack({ key, accountId: 'account-1', store: mock.store });
    }
    assert.equal(mock.calls.length, 0, 'raw registration helper must not mint cleanup authority');
  }
  assert.equal(typeof teardown.cleanupMockSession, 'undefined');
  assert.equal(typeof teardown.registerMockSession, 'undefined');
  assert.equal(typeof provision.cleanupMockSession, 'undefined');
  assert.equal(typeof provision.registerMockSession, 'undefined');
});

test('teardown accepts only the exact locally registered run and account', async t => {
  const input = await fixture(t);
  const mock = mockBoundary({ failMigration: true });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.cleanup.status, 'local-cleanup-observed');
  const deletes = mock.calls.filter(call => call[0] === 'DELETE').length;
  for (const target of [
    { key: { ...key, run_id: key.run_id + 1 }, accountId: 'account-1' },
    { key, accountId: 'manual-staging' },
    { key, accountId: 'demo' },
    { key: { ...key, pr: key.pr + 1 }, accountId: 'account-1' },
  ]) {
    assert.deepEqual(await teardownMockStack({ ...target, store: mock.store }), { status: 'refused', reason: 'unproven-run-or-account' });
  }
  assert.equal(mock.calls.filter(call => call[0] === 'DELETE').length, deletes);
  assert.deepEqual(await teardownMockStack({ key, accountId: 'account-1', store: mock.store }), outcome.cleanup);
  assert.equal(mock.calls.filter(call => call[0] === 'DELETE').length, deletes);
});

test('cleanup failure is preserved separately from the migration failure', async t => {
  const input = await fixture(t);
  const mock = mockBoundary({ failMigration: true, failDelete: true });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'quarantined');
  assert.equal(outcome.reason, 'mock-operation-failed');
  assert.equal(outcome.cleanup.status, 'failed');
  assert.equal(outcome.cleanup.reason, 'mock-cleanup-failed');
  assert.deepEqual(outcome.cleanup.failed, ['d1:auth']);
  assert.deepEqual(outcome.cleanup.remaining, ['d1:product', 'd1:auth']);
  assert.equal(JSON.stringify(outcome).includes('sensitive text'), false);
});

test('changed D1 ownership refuses deletion even when the exact UUID was checkpointed', async t => {
  const input = await fixture(t);
  const mock = mockBoundary({ failMigration: true, changeD1OnDelete: true });
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'quarantined');
  assert.equal(outcome.cleanup.status, 'failed');
  assert.equal(mock.calls.some(call => call[0] === 'DELETE'), false);
  assert.deepEqual(outcome.cleanup.remaining, ['d1:product']);
});

test('a run with unresolved Workers retains its dependency graph on explicit teardown', async t => {
  const input = await fixture(t);
  const mock = mockBoundary();
  const outcome = await provisionMockStack({ key, accountId: 'account-1', ...input, ...mock });
  assert.equal(outcome.status, 'unsupported');
  assert.deepEqual(await teardownMockStack({ key, accountId: 'account-1', store: mock.store }), outcome.cleanup);
  assert.equal(mock.calls.some(call => call[0] === 'DELETE'), false);
});
