import { test as base, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { OperatorSessionViewSchema } from '@incentives/contracts';

import { loadTarget } from '../../src/config.js';
import { createLocalStackOwner, startManagedLocalStack, withLocalStackFixture,
  withLocalStackPair } from '../../src/local-stack.js';
import { openOperatorClient } from '../../src/operator-client.js';

const test = base.extend<{ localStackOwner: ReturnType<typeof createLocalStackOwner> }>({
  // Playwright requires a destructured fixture parameter to resolve dependencies.
  // eslint-disable-next-line no-empty-pattern
  localStackOwner: async ({}, use) => withLocalStackFixture(use),
});

test('two local bootstrap instances have isolated health, root sessions and Auth D1', async ({ browser, localStackOwner }) => {
  test.skip(loadTarget(process.env).kind !== 'local', 'Local stack isolation is local-only');
  await withLocalStackPair(() => startManagedLocalStack({ skipBuild: true, owner: localStackOwner }), async ([first, second]) => {
    expect(first.operatorOrigin).not.toBe(second.operatorOrigin);
    expect(first.apiOrigin).not.toBe(second.apiOrigin);
    expect(first.directory).not.toBe(second.directory);
    expect(first.rootUserId).not.toBe(second.rootUserId);
    for (const stack of [first, second]) {
      const response = await fetch(stack.operatorOrigin);
      expect(response.status).toBe(200);
      const client = await openOperatorClient({ kind: 'local',
        operatorOrigin: stack.operatorOrigin, apiOrigin: stack.apiOrigin },
      { E2E_OPERATOR_STORAGE_STATE: stack.storageState });
      await client.close();
      expect((await stat(stack.storageState)).mode & 0o777).toBe(0o600);
      const restored = await browser.newContext({ storageState: stack.storageState });
      try {
        const sessionResponse = await restored.request.get(`${stack.operatorOrigin}/operator/v1/session`,
          { maxRedirects: 0 });
        expect(sessionResponse.status()).toBe(200);
        const session = OperatorSessionViewSchema.parse(await sessionResponse.json());
        expect(session.userId).toBe(stack.rootUserId);
        expect(session.platformRole).toBe('root');
        expect(session.authenticationMethods).toEqual(['passkey']);
        const page = await restored.newPage();
        await page.goto(stack.operatorOrigin);
        await expect(page.getByRole('heading', { name: 'Sign in to Incentives' })).toBeHidden();
      } finally { await restored.close(); }
    }
    await expect(openOperatorClient({ kind: 'local',
      operatorOrigin: second.operatorOrigin, apiOrigin: second.apiOrigin },
    { E2E_OPERATOR_STORAGE_STATE: first.storageState })).rejects.toThrow();
    await expect(openOperatorClient({ kind: 'local',
      operatorOrigin: first.operatorOrigin, apiOrigin: first.apiOrigin },
    { E2E_OPERATOR_STORAGE_STATE: second.storageState })).rejects.toThrow();
  });
});
