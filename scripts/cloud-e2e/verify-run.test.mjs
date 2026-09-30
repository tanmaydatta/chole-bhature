import assert from 'node:assert/strict';
import test from 'node:test';

import { StaleRunStop, verifyCurrentPr } from './verify-run.mjs';

const eventSha = 'a'.repeat(40);
const liveSha = 'b'.repeat(40);
const defaultBranchRunSha = 'c'.repeat(40);
const repository = {
  id: 987654321,
  full_name: 'trusted-owner/incentives-platform',
  owner: { login: 'trusted-owner' },
  name: 'incentives-platform',
};

function event(action = 'synchronize', overrides = {}) {
  return {
    action,
    repository: { owner: { login: 'event-owner' }, name: 'event-repository' },
    pull_request: {
      number: 42,
      head: { sha: eventSha, repo: { id: repository.id, full_name: repository.full_name } },
    },
    run_id: 123456789,
    attempt: 2,
    ...overrides,
  };
}

function githubClient({ pull = {}, run = {}, repo = repository } = {}) {
  const calls = [];
  const client = {
    async request({ method, path }) {
      calls.push({ method, path });
      assert.equal(method, 'GET');
      if (path === '/repos/event-owner/event-repository') return repo;
      if (path === '/repos/trusted-owner/incentives-platform/pulls/42') {
        return {
          number: 42,
          state: 'open',
          head: { sha: eventSha, repo: { id: repository.id, full_name: repository.full_name } },
          ...pull,
        };
      }
      if (path === '/repos/trusted-owner/incentives-platform/actions/runs/123456789') {
        return {
          id: 123456789,
          run_attempt: 2,
          head_sha: defaultBranchRunSha,
          event: 'pull_request_target',
          status: 'queued',
          ...run,
        };
      }
      throw new Error(`Unexpected GitHub request: ${path}`);
    },
  };
  return { client, calls };
}

test('accepts each eligible same-repository PR action using canonical GitHub records', async () => {
  for (const action of ['opened', 'reopened', 'synchronize']) {
    const mock = githubClient();
    const key = await verifyCurrentPr({ event: event(action), githubClient: mock.client, phase: 'predeploy' });
    assert.deepEqual(key, {
      repository_id: repository.id,
      repository: repository.full_name,
      pr: 42,
      head_sha: eventSha,
      run_id: 123456789,
      attempt: 2,
    });
    assert.deepEqual(mock.calls, [
      { method: 'GET', path: '/repos/event-owner/event-repository' },
      { method: 'GET', path: '/repos/trusted-owner/incentives-platform/pulls/42' },
      { method: 'GET', path: '/repos/trusted-owner/incentives-platform/actions/runs/123456789' },
    ]);
  }
});

test('rejects a fork after checking the live pull repository identity', async () => {
  const mock = githubClient({
    pull: { head: { sha: eventSha, repo: { id: 444, full_name: 'attacker/incentives-platform' } } },
  });
  assert.equal(await verifyCurrentPr({ event: event(), githubClient: mock.client, phase: 'predeploy' }), null);
});

test('stops a queued older run whose event SHA is no longer the live PR head at either boundary', async () => {
  for (const phase of ['predeploy', 'pretest']) {
    const mock = githubClient({ pull: { head: { sha: liveSha, repo: { id: repository.id, full_name: repository.full_name } } } });
    await assert.rejects(
      verifyCurrentPr({ event: event(), githubClient: mock.client, phase }),
      error => error instanceof StaleRunStop && error.code === 'STALE_PR_HEAD' && error.phase === phase,
    );
    assert.deepEqual(mock.calls, [
      { method: 'GET', path: '/repos/event-owner/event-repository' },
      { method: 'GET', path: '/repos/trusted-owner/incentives-platform/pulls/42' },
    ]);
  }
});

test('rejects mismatched GitHub run metadata instead of using event-controlled run identity', async () => {
  const mock = githubClient({ run: { run_attempt: 1 } });
  await assert.rejects(
    verifyCurrentPr({ event: event(), githubClient: mock.client, phase: 'predeploy' }),
    /GitHub run metadata/u,
  );
});

test('rejects a GitHub run that was not triggered by pull_request_target', async () => {
  const mock = githubClient({ run: { event: 'push' } });
  await assert.rejects(
    verifyCurrentPr({ event: event(), githubClient: mock.client, phase: 'predeploy' }),
    /GitHub run event/u,
  );
});

test('treats closed events as cleanup-only without looking up GitHub records', async () => {
  const mock = githubClient();
  assert.equal(await verifyCurrentPr({ event: event('closed'), githubClient: mock.client, phase: 'predeploy' }), null);
  assert.deepEqual(mock.calls, []);
});
