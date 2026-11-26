import { describe, expect, it } from 'vitest';
import { runSeed, type SeedRequester } from '../seed/seed.mjs';

interface FakeState {
  definitions: string[];
  draft: boolean;
  published: boolean;
  programs: Map<string, string>;
}

interface Call {
  method: string;
  path: string;
}

function fakeOperator(initial: Partial<FakeState> = {}) {
  const state: FakeState = {
    definitions: initial.definitions ?? [],
    draft: initial.draft ?? false,
    published: initial.published ?? false,
    programs: initial.programs ?? new Map<string, string>(),
  };
  const calls: Call[] = [];

  const request: SeedRequester = async (method, path, body) => {
    calls.push({ method, path });

    if (method === 'GET' && path === '/operator/v1/schema/definitions') {
      return {
        status: 200,
        body: {
          definitions: state.definitions.map(key => ({
            id: key,
            definition: { key },
            readOnly: false,
            referenced: false,
          })),
          ...(state.draft ? { draftVersion: 1 } : {}),
          ...(state.published ? { publishedVersion: 1 } : {}),
        },
      };
    }

    if (method === 'POST' && path === '/operator/v1/schema/definitions') {
      const variable = body as { key: string };
      state.definitions.push(variable.key);
      state.draft = true;
      return {
        status: 201,
        body: { id: variable.key, definition: variable, readOnly: false, referenced: false },
      };
    }

    if (method === 'POST' && path === '/operator/v1/schema/publish') {
      state.draft = false;
      state.published = true;
      return { status: 200, body: {} };
    }

    if (method === 'PATCH' && path.startsWith('/operator/v1/customers/')) {
      return { status: 200, body: {} };
    }

    if (method === 'GET' && path.startsWith('/operator/v1/programs/')) {
      const id = decodeURIComponent(path.split('/').at(-1) ?? '');
      const status = state.programs.get(id);
      if (status === undefined) return { status: 404, body: null };
      return { status: 200, body: { lifecycle: { status } } };
    }

    if (method === 'POST' && path === '/operator/v1/programs') {
      const program = body as { id: string };
      state.programs.set(program.id, 'draft');
      return { status: 201, body: { configuration: program, lifecycle: { status: 'draft' } } };
    }

    if (method === 'POST' && path.endsWith('/publish')) {
      const id = decodeURIComponent(path.split('/')[4] ?? '');
      state.programs.set(id, 'active');
      return { status: 200, body: {} };
    }

    throw new Error(`Unexpected operator call: ${method} ${path}`);
  };

  return { request, calls, state };
}

function count(calls: Call[], predicate: (call: Call) => boolean): number {
  return calls.filter(predicate).length;
}

function schemaPublishes(calls: Call[]): number {
  return count(calls, call => call.path === '/operator/v1/schema/publish');
}

function programPublishes(calls: Call[]): number {
  return count(calls, call => call.path.startsWith('/operator/v1/programs/')
    && call.path.endsWith('/publish'));
}

describe('demo seed script', () => {
  it('creates and publishes everything on a fresh tenant', async () => {
    const operator = fakeOperator();
    await runSeed({ request: operator.request, log: () => undefined });

    expect(schemaPublishes(operator.calls)).toBe(1);
    expect(count(operator.calls, call => call.method === 'POST'
      && call.path === '/operator/v1/programs')).toBe(7);
    expect(programPublishes(operator.calls)).toBe(7);
    expect(count(operator.calls, call => call.method === 'PATCH')).toBe(3);
  });

  it('is idempotent on a second run', async () => {
    const operator = fakeOperator();
    await runSeed({ request: operator.request, log: () => undefined });
    operator.calls.length = 0;

    await runSeed({ request: operator.request, log: () => undefined });

    expect(schemaPublishes(operator.calls)).toBe(0);
    expect(programPublishes(operator.calls)).toBe(0);
    expect(count(operator.calls, call => call.method === 'POST'
      && call.path === '/operator/v1/programs')).toBe(0);
    // Customers are upserts, so they are refreshed on every run.
    expect(count(operator.calls, call => call.method === 'PATCH')).toBe(3);
  });

  it('publishes an unpublished draft left by a failed run', async () => {
    const operator = fakeOperator({
      definitions: ['customer.is_vip', 'customer.orders_count'],
      draft: true,
      published: false,
    });
    await runSeed({ request: operator.request, log: () => undefined });

    expect(schemaPublishes(operator.calls)).toBe(1);
    expect(count(operator.calls, call => call.method === 'POST'
      && call.path === '/operator/v1/schema/definitions')).toBe(0);
  });
});
