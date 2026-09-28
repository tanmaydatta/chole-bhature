import { test, expect } from '@playwright/test';

import { loadTarget } from '../../src/config.js';
import { startManagedLocalStack } from '../../src/local-stack.js';
import { openOperatorClient } from '../../src/operator-client.js';

test('two local bootstrap instances have isolated health, root sessions and Auth D1', async () => {
  test.skip(loadTarget(process.env).kind !== 'local', 'Local stack isolation is local-only');
  const [first, second] = await Promise.all([
    startManagedLocalStack({ skipBuild: true }),
    startManagedLocalStack({ skipBuild: true }),
  ]);
  try {
    expect(first.operatorOrigin).not.toBe(second.operatorOrigin);
    expect(first.apiOrigin).not.toBe(second.apiOrigin);
    expect(first.directory).not.toBe(second.directory);
    for (const stack of [first, second]) {
      const response = await fetch(stack.operatorOrigin);
      expect(response.status).toBe(200);
      const client = await openOperatorClient({ kind: 'local',
        operatorOrigin: stack.operatorOrigin, apiOrigin: stack.apiOrigin },
      { E2E_OPERATOR_STORAGE_STATE: stack.storageState });
      await client.close();
    }
    await expect(openOperatorClient({ kind: 'local',
      operatorOrigin: second.operatorOrigin, apiOrigin: second.apiOrigin },
    { E2E_OPERATOR_STORAGE_STATE: first.storageState })).rejects.toThrow();
    await expect(openOperatorClient({ kind: 'local',
      operatorOrigin: first.operatorOrigin, apiOrigin: first.apiOrigin },
    { E2E_OPERATOR_STORAGE_STATE: second.storageState })).rejects.toThrow();
  } finally {
    await Promise.all([first.stop(), second.stop()]);
  }
});
