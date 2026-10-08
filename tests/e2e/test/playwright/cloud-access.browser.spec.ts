import { test, expect, type Browser } from '@playwright/test';
import { loadTarget } from '../../src/config.js';
import { openCloudAccessBrowserContext } from '../../src/cloud-access.js';
import { localTransport } from '../support/cloud-access-transport.js';

const api = 'https://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev';
const operator = 'https://cb-e2e-1dcb45133da23b01d244-operator.fixture.workers.dev';
const key = { repository_id: 42, repository: 'owner/repo', pr: 17,
  head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', run_id: 900, attempt: 1 };
function inputs(): [
  { stackKey: typeof key; apiOrigin: string; operatorOrigin: string },
  { currentRun: typeof key; workersSubdomain: string },
  { clientId: string; clientSecret: string },
] {
  return [{ stackKey: { ...key }, apiOrigin: api, operatorOrigin: operator },
    { currentRun: { ...key }, workersSubdomain: 'fixture' },
    { clientId: 'fixture-client', clientSecret: 'fixture-secret' }];
}

test('real browser routes navigation, asset and subrequests without foreign credentials or redirect dispatch',
    async ({ browser }) => {
      test.skip(loadTarget(process.env).kind !== 'local', 'Controlled local transport fixture only');
      const fixture = await localTransport();
      const [candidate, expectation, credential] = inputs();
      const localBrowser = new Proxy(browser, { get(target, property) {
        if (property === 'newContext') return (options: Parameters<Browser['newContext']>[0]) => {
          credential.clientSecret = 'mutation-during-context-creation';
          candidate.operatorOrigin = 'https://foreign.example';
          return target.newContext({ ...options, ...fixture.transport });
        };
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      try {
        const context = await openCloudAccessBrowserContext(localBrowser, candidate, expectation, credential);
        try {
          const page = await context.newPage();
          await page.goto(`${operator}/page`);
          await page.waitForFunction(() => document.body.dataset.done === 'yes');
          for (const path of ['/page', '/asset.js', '/subrequest']) {
            const observed = fixture.receipts.find(item => item.path === path && item.host !== 'foreign.example');
            expect(observed?.id).toBe('fixture-client');
            expect(observed?.secret).toBe('fixture-secret');
          }
          expect(fixture.receipts.filter(item => item.host === 'foreign.example')).toEqual([]);
          for (const path of ['/redirect-foreign', '/redirect-same']) {
            await expect(page.goto(`${operator}${path}`)).rejects.toThrow();
          }
          expect(fixture.receipts.filter(item => item.path === '/destination')).toEqual([]);
          const count = fixture.receipts.length;
          await context.setExtraHTTPHeaders({ 'cF-aCcEsS-cLiEnT-sEcReT': 'caller-injected-secret' });
          await expect(page.goto(`${operator}/collision`)).rejects.toThrow();
          expect(fixture.receipts).toHaveLength(count);
          await context.setExtraHTTPHeaders({});
          await context.close();
          await expect(context.newPage()).rejects.toThrow();
        } finally { await context.close(); }
      } finally { await fixture.close(); }
    });
