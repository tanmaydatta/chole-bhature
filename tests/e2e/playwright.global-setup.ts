import type { FullConfig } from '@playwright/test';

import { loadTarget } from './src/config.js';
import { startManagedLocalStack } from './src/local-stack.js';
import { openOperatorClient, requireE2eCapabilities,
  requireOperatorStorageState } from './src/operator-client.js';

export default async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  const target = loadTarget(process.env);
  if (target.kind === 'staging') {
    requireOperatorStorageState(process.env);
    const operator = await openOperatorClient(target, process.env);
    try { await requireE2eCapabilities(operator); }
    finally { await operator.close(); }
    return async () => {};
  }
  if (process.env.E2E_OPERATOR_ORIGIN || process.env.E2E_API_ORIGIN
    || process.env.E2E_OPERATOR_STORAGE_STATE) {
    throw new Error('Managed local Playwright setup allocates its own origins and root state; unset local E2E overrides');
  }
  const stack = await startManagedLocalStack();
  process.env.E2E_OPERATOR_ORIGIN = stack.operatorOrigin;
  process.env.E2E_API_ORIGIN = stack.apiOrigin;
  process.env.E2E_OPERATOR_STORAGE_STATE = stack.storageState;
  process.env.E2E_MANAGED_LOCAL_STACK = '1';
  try {
    const operator = await openOperatorClient(loadTarget(process.env), process.env);
    try { await requireE2eCapabilities(operator); }
    finally { await operator.close(); }
  } catch (error) {
    await stack.stop();
    throw error;
  }
  return async () => {
    await stack.stop();
    delete process.env.E2E_OPERATOR_ORIGIN;
    delete process.env.E2E_API_ORIGIN;
    delete process.env.E2E_OPERATOR_STORAGE_STATE;
    delete process.env.E2E_MANAGED_LOCAL_STACK;
  };
}
