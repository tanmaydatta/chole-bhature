import { readdir } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ callback: undefined as (() => Promise<void>) | undefined,
  operatorOpens: 0, skipSignal: new Error('controlled Playwright skip signal') }));

// Only the runner's skip signal and external authentication/transport boundary are controlled.
// Actual spec callback, target parser, scenario wrapper, store and disposal assertions remain real.
vi.mock('@playwright/test', async () => {
  const runnerTest = (_name: string, callback: () => Promise<void>) => { state.callback = callback; };
  runnerTest.skip = (condition: boolean) => { if (condition) throw state.skipSignal; };
  return { test: runnerTest, expect: (await import('vitest')).expect };
});
vi.mock('../../src/operator-client.js', () => ({
  openOperatorClient: async () => {
    state.operatorOpens++;
    return { close: async () => {}, request: async () => { throw Error('No transport permitted'); } };
  },
  verifyFixtureMemberSession: async () => { throw Error('No authentication permitted'); },
}));

afterEach(() => vi.unstubAllEnvs());
async function inventory(): Promise<string[]> {
  try { return (await readdir(new URL('../../.runs/', import.meta.url))).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

// Break caught: a local-only skip inside a scenario becomes an empty-run cleanup failure or opens staging auth.
test('staging simulator skip escapes before operator authentication and run creation', async () => {
  vi.stubEnv('E2E_TARGET', 'staging'); vi.stubEnv('E2E_ENABLE_STAGING', '1');
  vi.stubEnv('E2E_OPERATOR_ORIGIN', 'https://operator.staging.wastd.dev');
  vi.stubEnv('E2E_API_ORIGIN', 'https://api.staging.wastd.dev');
  await import('../playwright/simulator.api.spec.js');
  const before = await inventory();
  expect(state.callback).toBeTypeOf('function');
  await expect(state.callback!()).rejects.toBe(state.skipSignal);
  expect(state.operatorOpens).toBe(0);
  expect(await inventory()).toEqual(before);
});
