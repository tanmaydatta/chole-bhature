import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { parseStackKey, resourceNames } from './key.mjs';

const key = {
  repository_id: 987654321,
  repository: 'trusted-owner/incentives-platform',
  pr: 42,
  head_sha: 'a'.repeat(40),
  run_id: 123456789,
  attempt: 2,
};

function digest(value) {
  return createHash('sha256').update(JSON.stringify([
    value.repository_id, value.pr, value.head_sha, value.run_id, value.attempt,
  ])).digest('hex').slice(0, 20);
}

test('parses only the version-one trusted stack key schema', () => {
  assert.deepEqual(parseStackKey(key), key);
  for (const invalid of [
    { ...key, repository_id: '987654321' },
    { ...key, repository: 'trusted owner/incentives-platform' },
    { ...key, pr: 0 },
    { ...key, head_sha: 'A'.repeat(40) },
    { ...key, run_id: 0 },
    { ...key, attempt: 0 },
    { ...key, unexpected: true },
  ]) {
    assert.throws(() => parseStackKey(invalid), /StackKeyV1/u);
  }
});

test('derives deterministic legal Cloudflare names from the trusted tuple alone', () => {
  const names = resourceNames(key);
  const expectedPrefix = `cb-e2e-${digest(key)}`;
  assert.deepEqual(names, {
    api: `${expectedPrefix}-api`,
    identity: `${expectedPrefix}-identity`,
    operator: `${expectedPrefix}-operator`,
    product: `${expectedPrefix}-product`,
    auth: `${expectedPrefix}-auth`,
    accessApi: `${expectedPrefix}-access-api`,
    accessOperator: `${expectedPrefix}-access-operator`,
    token: `${expectedPrefix}-token`,
  });
  for (const name of Object.values(names)) {
    assert.match(name, /^cb-e2e-[a-f0-9]{20}-[a-z-]+$/u);
    assert.ok(name.length <= 63, `${name} exceeds the Worker name limit`);
  }
});

test('changes every resource name when an identity tuple field changes', () => {
  const baseline = resourceNames(key);
  for (const changedKey of [
    { ...key, repository_id: key.repository_id + 1 },
    { ...key, pr: key.pr + 1 },
    { ...key, head_sha: 'b'.repeat(40) },
    { ...key, run_id: key.run_id + 1 },
    { ...key, attempt: key.attempt + 1 },
  ]) {
    const changed = resourceNames(changedKey);
    for (const name of Object.keys(baseline)) {
      assert.notEqual(changed[name], baseline[name], `${name} must change with the key`);
    }
  }
});
