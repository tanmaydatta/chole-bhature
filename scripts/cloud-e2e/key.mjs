import { createHash } from 'node:crypto';

const repositoryPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/u;
const shaPattern = /^[a-f0-9]{40}$/u;
const resourceKinds = {
  api: 'api',
  identity: 'identity',
  operator: 'operator',
  product: 'product',
  auth: 'auth',
  accessApi: 'access-api',
  accessOperator: 'access-operator',
  token: 'token',
};

function stackKeyError() {
  return new TypeError('Expected a valid StackKeyV1.');
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function parseStackKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw stackKeyError();
  const fields = ['repository_id', 'repository', 'pr', 'head_sha', 'run_id', 'attempt'];
  if (Object.keys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field))) {
    throw stackKeyError();
  }
  if (!positiveInteger(value.repository_id)
    || typeof value.repository !== 'string' || !repositoryPattern.test(value.repository)
    || !positiveInteger(value.pr)
    || typeof value.head_sha !== 'string' || !shaPattern.test(value.head_sha)
    || !positiveInteger(value.run_id)
    || !positiveInteger(value.attempt)) {
    throw stackKeyError();
  }
  return {
    repository_id: value.repository_id,
    repository: value.repository,
    pr: value.pr,
    head_sha: value.head_sha,
    run_id: value.run_id,
    attempt: value.attempt,
  };
}

export function resourceNames(value) {
  const key = parseStackKey(value);
  const digest = createHash('sha256').update(JSON.stringify([
    key.repository_id, key.pr, key.head_sha, key.run_id, key.attempt,
  ])).digest('hex').slice(0, 20);
  const prefix = `cb-e2e-${digest}`;
  return Object.fromEntries(Object.entries(resourceKinds).map(([name, suffix]) => [name, `${prefix}-${suffix}`]));
}
