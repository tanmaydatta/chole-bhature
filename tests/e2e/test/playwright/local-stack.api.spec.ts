import { test as base, expect, type BrowserContext } from '@playwright/test';
import { mkdir, mkdtemp, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiErrorSchema, OperatorSessionViewSchema, type E2eControlAccount } from '@incentives/contracts';

import { loadTarget } from '../../src/config.js';
import { createLocalStackOwner, startManagedLocalStack, withLocalStackFixture,
  withLocalStackPair, type FixtureLocalStack } from '../../src/local-stack.js';
import { ControlClient, createControlRecord, privateDirectory, readControlRecord } from '../../src/control-client.js';
import { publishMemberState } from '../../src/member-state.js';

const test = base.extend<{ localStackOwner: ReturnType<typeof createLocalStackOwner> }>({
  // Playwright requires a destructured fixture parameter to resolve dependencies.
  // eslint-disable-next-line no-empty-pattern
  localStackOwner: async ({}, use) => withLocalStackFixture(use),
});

test('two local fixture stacks isolate Admin sessions and Auth D1 with protected disposal', async ({ browser, localStackOwner }) => {
  test.skip(loadTarget(process.env).kind !== 'local', 'Local stack isolation is local-only');
  await withLocalStackPair(() => startManagedLocalStack({ authMode: 'fixture', skipBuild: true, owner: localStackOwner }), async ([first, second]) => {
    expect(first.operatorOrigin).not.toBe(second.operatorOrigin);
    expect(first.apiOrigin).not.toBe(second.apiOrigin);
    expect(first.directory).not.toBe(second.directory);
    const runs = fileURLToPath(new URL('../../.runs/', import.meta.url));
    await mkdir(runs, { recursive: true, mode: 0o700 });
    await privateDirectory(runs);
    const directory = await mkdtemp(join(runs, 'fixture-isolation-'));
    const entries: Array<{
      stack: FixtureLocalStack; control: ControlClient; record: string; runId: string;
      state: string; attempted: boolean; zero: boolean; retired: boolean; admin?: E2eControlAccount;
    }> = [];
    const failures: unknown[] = [];
    let scenarioPassed = false;

    async function withState(state: string, origin: string, check: (context: BrowserContext) => Promise<void>) {
      const context = await browser.newContext({ storageState: state, extraHTTPHeaders: { origin } });
      const errors: unknown[] = [];
      try { await check(context); } catch (error) { errors.push(error); }
      try { await context.close(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Fixture session check or browser cleanup failed');
    }

    try {
      // Record both independent recovery capabilities before any bootstrap mutation.
      for (const [index, stack] of [first, second].entries()) {
        const control = new ControlClient({ ...stack.control, operatorOrigin: stack.operatorOrigin, apiOrigin: stack.apiOrigin });
        const record = await createControlRecord(join(directory, `control-${index}.json`), control.target);
        entries.push({ stack, control, record, runId: (await readControlRecord(record)).runId,
          state: join(directory, `member-${index}.json`), attempted: false, zero: false, retired: false });
      }
      const setup = await Promise.allSettled(entries.map(async entry => {
        const { stack, control } = entry;
        expect((await fetch(stack.operatorOrigin)).status).toBe(200);
        await control.capabilities();
        entry.attempted = true;
        entry.admin = (await control.bootstrap(entry.record)).admin;
        await publishMemberState({ kind: 'local', operatorOrigin: stack.operatorOrigin, apiOrigin: stack.apiOrigin }, entry.admin, entry.state);
        expect((await stat(entry.state)).mode & 0o777).toBe(0o600);
      }));
      const setupFailures = setup.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (setupFailures.length) throw new AggregateError(setupFailures, 'Fixture stack member setup failed');
      for (const entry of entries) {
        const { stack } = entry;
        await withState(entry.state, stack.operatorOrigin, async context => {
          const response = await context.request.get(`${stack.operatorOrigin}/operator/v1/session`, { maxRedirects: 0 });
          expect(response.status()).toBe(200);
          const session = OperatorSessionViewSchema.parse(await response.json());
          expect(session).toMatchObject({ userId: entry.admin!.userId, organizationId: entry.admin!.organizationId,
            merchantId: entry.admin!.merchantId, membershipId: entry.admin!.membershipId,
            authenticationMethods: ['e2e-fixture'], merchantSelectionRequired: false });
          expect(session.platformRole).toBeUndefined();
          expect(session.permissions).toContain('members:manage');
          const page = await context.newPage();
          await page.goto(stack.operatorOrigin);
          await expect(page.getByRole('heading', { name: 'Sign in to Incentives' })).toBeHidden();
          await expect(page.getByRole('link', { name: 'Promo Codes', exact: true })).toBeVisible();
        });
      }
      for (const key of ['userId', 'organizationId', 'merchantId', 'membershipId', 'sessionId'] as const) {
        expect(entries[0]!.admin![key]).not.toBe(entries[1]!.admin![key]);
      }
      for (const [source, destination] of [[entries[0]!, entries[1]!], [entries[1]!, entries[0]!]] as const) {
        await withState(source.state, destination.stack.operatorOrigin, async context => {
          const response = await context.request.get(`${destination.stack.operatorOrigin}/operator/v1/session`, { maxRedirects: 0 });
          expect(response.status()).toBe(401);
          expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('UNAUTHORIZED');
        });
      }
      scenarioPassed = true;
    } catch (error) { failures.push(error); }
    finally {
      // A failed bootstrap response may still have created rows. Attempt both targets,
      // and fresh status even when dispose failed; never fail fast on the other run.
      const cleanup = await Promise.allSettled(entries.filter(entry => entry.attempted).map(async entry => {
        const errors: unknown[] = [];
        let verified = 0;
        for (const operation of ['dispose', 'status'] as const) {
          try {
            const inventory = await entry.control.action(entry.record, operation);
            expect(inventory.lease.runId).toBe(entry.runId);
            expect(inventory.lease.phase).toBe('disposed');
            expect(Object.values(inventory.product).every(count => count === 0)).toBe(true);
            expect(Object.values(inventory.auth).every(count => count === 0)).toBe(true);
            verified++;
          } catch (error) { errors.push(error); }
        }
        entry.zero = verified === 2;
        if (entry.zero) {
          try {
            await unlink(entry.state).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
            await unlink(entry.record);
            entry.retired = true;
          } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Fixture isolation protected cleanup failed');
      }));
      failures.push(...cleanup.flatMap(result => result.status === 'rejected' ? [result.reason] : []));
      try {
        await writeFile(join(directory, 'outcome.json'), JSON.stringify({ version: 1, scenarioPassed,
          cleanupPassed: cleanup.every(result => result.status === 'fulfilled'), stacks: entries.length,
          bootstraps: entries.filter(entry => entry.attempted).length,
          zeroProductAuth: entries.length === 2 && entries.every(entry => entry.zero),
          retired: entries.filter(entry => entry.retired).length, rootBootstrap: false, passkeyBootstrap: false }) + '\n',
        { flag: 'wx', mode: 0o600 });
      } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Fixture stack isolation or cleanup failed');
  });
});
