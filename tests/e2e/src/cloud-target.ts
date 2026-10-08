import { parseStackKey, resourceNames, type StackKeyV1 } from '../../../scripts/cloud-e2e/key.mjs';

export interface CloudTargetCandidate {
  readonly stackKey: StackKeyV1;
  readonly apiOrigin: string;
  readonly operatorOrigin: string;
}

export interface CloudTargetExpectation {
  readonly currentRun: unknown;
  readonly workersSubdomain: string;
}

function invalidCandidate(): never {
  throw new TypeError('Invalid cloud target candidate or independent expectation.');
}

// Reject getters, symbols, inherited fields and class instances before reading data.
function ownData(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalidCandidate();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length
    || !fields.every(field => Object.hasOwn(descriptors, field)
      && Object.hasOwn(descriptors[field], 'value') && descriptors[field]?.enumerable)) invalidCandidate();
  return Object.fromEntries(fields.map(field => [field, descriptors[field]?.value]));
}

const keyFields = ['repository_id', 'repository', 'pr', 'head_sha', 'run_id', 'attempt'] as const;

/** Local consistency only: this does not establish live GitHub or provider authority. */
export function validateCloudTargetCandidate(
  candidate: unknown, expectation: CloudTargetExpectation,
): CloudTargetCandidate {
  try {
    const input = ownData(candidate, ['stackKey', 'apiOrigin', 'operatorOrigin']);
    const expected = ownData(expectation, ['currentRun', 'workersSubdomain']);
    const key = parseStackKey(ownData(input.stackKey, keyFields));
    const current = parseStackKey(ownData(expected.currentRun, keyFields));
    if (!keyFields.every(field => key[field] === current[field])) invalidCandidate();
    if (typeof expected.workersSubdomain !== 'string'
      || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(expected.workersSubdomain)) invalidCandidate();
    const names = resourceNames(current);
    const apiOrigin = `https://${names.api}.${expected.workersSubdomain}.workers.dev`;
    const operatorOrigin = `https://${names.operator}.${expected.workersSubdomain}.workers.dev`;
    if (input.apiOrigin !== apiOrigin || input.operatorOrigin !== operatorOrigin
      || apiOrigin === operatorOrigin) invalidCandidate();
    return Object.freeze({ stackKey: Object.freeze(key), apiOrigin, operatorOrigin });
  } catch {
    return invalidCandidate();
  }
}
