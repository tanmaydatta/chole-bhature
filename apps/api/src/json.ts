function invalidJson(path: string, reason: string): never {
  throw new TypeError(`Invalid JSON value at ${path}: ${reason}`);
}

function canonicalPrimitive(value: unknown, path: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidJson(path, 'numbers must be finite');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  return invalidJson(path, `${typeof value} is not JSON`);
}

function canonicalArray(
  value: unknown[],
  path: string,
  ancestors: Set<object>,
): string {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key === 'symbol')) {
    invalidJson(path, 'symbol properties are not JSON');
  }
  const allowedKeys = new Set(['length', ...value.map((_entry, index) => String(index))]);
  if (ownKeys.some(key => typeof key === 'string' && !allowedKeys.has(key))) {
    invalidJson(path, 'arrays cannot have custom properties');
  }

  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalidJson(`${path}[${index}]`, 'array holes are not JSON');
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !('value' in descriptor)) {
      invalidJson(`${path}[${index}]`, 'accessor properties are not JSON');
    }
    items.push(canonicalJsonValue(descriptor.value, `${path}[${index}]`, ancestors));
  }
  return `[${items.join(',')}]`;
}

function canonicalObject(
  value: object,
  path: string,
  ancestors: Set<object>,
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalidJson(path, 'objects must be plain records');
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key === 'symbol')) {
    invalidJson(path, 'symbol properties are not JSON');
  }
  const keys = (ownKeys as string[]).sort();
  const properties = keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalidJson(`${path}.${key}`, 'properties must be enumerable data values');
    }
    return `${JSON.stringify(key)}:${canonicalJsonValue(
      descriptor.value,
      `${path}.${key}`,
      ancestors,
    )}`;
  });
  return `{${properties.join(',')}}`;
}

function canonicalJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null || typeof value !== 'object') return canonicalPrimitive(value, path);
  if (ancestors.has(value)) invalidJson(path, 'cyclic references are not JSON');

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? canonicalArray(value, path, ancestors)
      : canonicalObject(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, '$', new Set());
}
