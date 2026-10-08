import { describe, expect, test } from 'vitest';
import { validateCloudTargetCandidate } from '../../src/cloud-target.js';

const api = 'https://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev';
const operator = 'https://cb-e2e-1dcb45133da23b01d244-operator.fixture.workers.dev';
function candidate() {
  return { stackKey: { repository_id: 42, repository: 'owner/repo', pr: 17,
    head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', run_id: 900, attempt: 1 },
  apiOrigin: api, operatorOrigin: operator };
}
function expectation() {
  return { currentRun: { repository_id: 42, repository: 'owner/repo', pr: 17,
    head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', run_id: 900, attempt: 1 },
  workersSubdomain: 'fixture' };
}

describe('local cloud target candidate consistency, without deployment authority', () => {
  test('accepts exact independently expected run origins and snapshots nested input', () => {
    const input = candidate();
    const expected = expectation();
    const result = validateCloudTargetCandidate(input, expected);
    input.stackKey.attempt = 2;
    expected.currentRun.pr = 18;
    expect(result.apiOrigin).toBe(api);
    expect(result.operatorOrigin).toBe(operator);
    expect(result.stackKey.attempt).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.stackKey)).toBe(true);
  });

  test.each([
    ['repository_id', 43], ['repository', 'owner/renamed'], ['pr', 18],
    ['head_sha', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], ['run_id', 901], ['attempt', 2],
  ])('refuses independent current-run mismatch in %s', (field, value) => {
    const expected = expectation();
    Reflect.set(expected.currentRun, field, value);
    expect(() => validateCloudTargetCandidate(candidate(), expected)).toThrow(/candidate/u);
  });

  test.each([
    'http://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev',
    'https://api.staging.wastd.dev', 'http://localhost:8787',
    'https://cb-e2e-1dcb45133da23b01d244-identity.fixture.workers.dev',
    'https://cb-e2e-00000000000000000000-api.fixture.workers.dev',
    'https://cb-e2e-1dcb45133da23b01d244-api.other.workers.dev',
    'https://preview.cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev',
    'https://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev.evil.example',
    `${api}/`, `${api}/path`, `${api}?x=1`, `${api}#x`,
    'https://user@cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev',
    `${api}:443`, `${api}:8443`, operator,
    'https://CB-E2E-1dcb45133da23b01d244-api.fixture.workers.dev',
  ])('refuses non-exact API origin %s', apiOrigin => {
    expect(() => validateCloudTargetCandidate({ ...candidate(), apiOrigin }, expectation()))
      .toThrow(/candidate/u);
  });

  test('refuses swapped or duplicate Operator origin independently of API', () => {
    expect(() => validateCloudTargetCandidate({ ...candidate(), operatorOrigin: api }, expectation()))
      .toThrow(/candidate/u);
    expect(() => validateCloudTargetCandidate({ ...candidate(), operatorOrigin: `${operator}/` }, expectation()))
      .toThrow(/candidate/u);
  });

  test.each([null, [], {}, { ...candidate(), authority: true },
    { ...candidate(), stackKey: { ...candidate().stackKey, extra: 'unadopted' } },
    { ...candidate(), stackKey: { ...candidate().stackKey, attempt: 0 } },
    Object.assign(Object.create({ inherited: true }) as object, candidate()),
    { ...candidate(), [Symbol('hidden')]: true },
  ])('refuses malformed, extended or nonplain candidate records', input => {
    expect(() => validateCloudTargetCandidate(input, expectation())).toThrow(/candidate/u);
  });

  test('refuses accessors without evaluating them', () => {
    let reads = 0;
    const input = candidate();
    Object.defineProperty(input, 'apiOrigin', { enumerable: true, get() { reads++; return api; } });
    expect(() => validateCloudTargetCandidate(input, expectation())).toThrow(/candidate/u);
    expect(reads).toBe(0);
  });

  test.each(['', 'fixture.workers.dev', '-fixture', 'fixture-', 'Fixture', 'fixture/path'])
    ('refuses malformed expected workers subdomain %s', workersSubdomain => {
      expect(() => validateCloudTargetCandidate(candidate(), { ...expectation(), workersSubdomain }))
        .toThrow(/candidate/u);
    });
});
