import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { request, test as base } from '@playwright/test';
import { ControlClient, createControlRecord, privateDirectory, readControlRecord } from '../../src/control-client.js';
import { publishMemberState } from '../../src/member-state.js';
import { startManagedLocalStack, type FixtureLocalStack } from '../../src/local-stack.js';
import { OperatorClient, requireOperatorStorageState } from '../../src/operator-client.js';
import { withScenarioRun, assertRunDisposed } from '../../src/scenario-run.js';
import { executeRecipe, type RecipeContext } from '../../src/execution.js';
import { createManifest, recordResource } from '../../src/manifest.js';
import { createRunStore } from '../../src/run-store.js';
import type { RunId } from '../../src/config.js';
interface PromoScenario {
  run<T>(callback: (context: RecipeContext) => Promise<T>): Promise<T>;
  merchant(context: RecipeContext): Promise<{
    merchantId: string;
  }>;
  storageState(context: RecipeContext): string;
  selectMerchant: boolean;
  assertDisposed(runId: RunId): Promise<void>;
}
const enabled = () => process.env.E2E_PREAUTH_LOCAL_FLOW === '1';
export const test = base.extend<{
  promoScenario: PromoScenario;
}, {
  fixtureStack: FixtureLocalStack | undefined;
}>({
  fixtureStack: [async ({}, use) => {
      if (!enabled()) {
        await use(undefined);
        return;
      }
      if (process.env.E2E_TARGET !== 'local' || process.env.E2E_OPERATOR_ORIGIN || process.env.E2E_API_ORIGIN || process.env.E2E_OPERATOR_STORAGE_STATE)
        throw new Error('Preauth flow requires a fresh managed local target');
      const began = Date.now();
      const stack = await startManagedLocalStack({ authMode: 'fixture' });
      console.log(`preauth-local phase=startup; elapsed_ms=${Date.now() - began}`);
      try {
        await use(stack);
      }
      finally {
        await stack.stop();
      }
    }, { scope: 'worker' }],
  promoScenario: async ({ fixtureStack }, use) => {
    if (!fixtureStack) {
      await use({ run: withScenarioRun, merchant: async (ctx) => executeRecipe(ctx, 'add-merchant', { name: 'Browser authoring shop' }) as Promise<{
          merchantId: string;
        }>,
        storageState: () => requireOperatorStorageState(process.env), selectMerchant: true, assertDisposed: assertRunDisposed });
      return;
    }
    const stack = fixtureStack, target = { kind: 'local' as const, operatorOrigin: stack.operatorOrigin, apiOrigin: stack.apiOrigin };
    const control = new ControlClient({ ...target, ...stack.control });
    const published = new WeakMap<RecipeContext, string>();
    const disposed = new Set<string>();
    await use({
      selectMerchant: false,
      storageState: ctx => { const state = published.get(ctx); if (!state)
        throw new Error('Verified member state unavailable'); return state; },
      merchant: async (ctx) => { const merchant = ctx.manifest.resources.find(resource => resource.kind === 'merchant'); if (!merchant)
        throw new Error('Owned merchant unavailable'); return { merchantId: merchant.id }; },
      assertDisposed: async (runId) => { assert.ok(disposed.has(runId), 'Fresh control inventory did not prove disposal'); },
      async run<T>(callback: (ctx: RecipeContext) => Promise<T>): Promise<T> {
        const directory = fileURLToPath(new URL('../../.runs/', import.meta.url));
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await privateDirectory(directory);
        const runDirectory = await mkdtemp(join(directory, 'preauth-promo-'));
        const recordPath = await createControlRecord(join(runDirectory, 'control.json'), control.target);
        const record = await readControlRecord(recordPath), store = createRunStore(runDirectory, record.runId), lock = await store.lock();
        const manifest = createManifest(record.runId, 'local');
        let member: OperatorClient | undefined, result: T | undefined, failure: unknown, cleanupFailure: unknown;
        const timings = { bootstrapMs: 0, scenarioMs: 0, disposalMs: 0 };
        try {
          await store.save(manifest);
          const began = Date.now();
          await control.capabilities();
          const bootstrap = await control.bootstrap(recordPath);
          recordResource(manifest, { kind: 'merchant', id: bootstrap.lease.merchantId, ownerRunId: record.runId, provisioningId: bootstrap.lease.provisioningId,
            organizationId: bootstrap.lease.organizationId, label: record.runId + '_merchant' });
          recordResource(manifest, { kind: 'membership', id: bootstrap.admin.membershipId, ownerRunId: record.runId, merchantId: bootstrap.lease.merchantId,
            organizationId: bootstrap.admin.organizationId, userId: bootstrap.admin.userId, sessionId: bootstrap.admin.sessionId, label: record.runId + '_admin' });
          await store.save(manifest);
          const state = await publishMemberState(target, bootstrap.admin, join(runDirectory, 'member.json'));
          member = new OperatorClient(await request.newContext({ baseURL: target.operatorOrigin, storageState: state, extraHTTPHeaders: { origin: target.operatorOrigin } }), target.operatorOrigin);
          const ctx: RecipeContext = { manifest, target, operator: member, selectedMerchantId: bootstrap.lease.merchantId,
            save: () => store.save(manifest), saveToken: (slug, token) => store.saveToken(slug, token) };
          published.set(ctx, state);
          timings.bootstrapMs = Date.now() - began;
          console.log(`preauth-local phase=bootstrap; elapsed_ms=${timings.bootstrapMs}`);
          const scenarioBegan = Date.now();
          result = await callback(ctx);
          timings.scenarioMs = Date.now() - scenarioBegan;
        }
        catch (error) {
          failure = error;
        }
        finally {
          const began = Date.now();
          try {
            try {
              await member?.close();
            }
            catch (error) {
              cleanupFailure = error;
            }
            const removed = await control.action(recordPath, 'dispose'), fresh = await control.action(recordPath, 'status');
            for (const inventory of [removed, fresh]) {
              assert.equal(inventory.lease.phase, 'disposed');
              assert.equal(inventory.lease.runId, record.runId);
              assert.ok(Object.values(inventory.product).every(count => count === 0), 'Product rows remain');
              assert.ok(Object.values(inventory.auth).every(count => count === 0), 'Auth rows remain');
            }
            for (const resource of manifest.resources)
              resource.status = 'cleaned';
            await store.save(manifest);
            disposed.add(record.runId);
            if (!cleanupFailure) {
              await unlink(join(runDirectory, 'member.json')).catch(error => {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
              });
              await unlink(recordPath);
            }
          }
          catch (error) {
            cleanupFailure = cleanupFailure
              ? new AggregateError([cleanupFailure, error], 'Member close and control disposal failed') : error;
          }
          timings.disposalMs = Date.now() - began;
          try {
            await writeFile(join(runDirectory, 'outcome.json'), JSON.stringify({ version: 1, preauth: true, rootBootstrap: false, passkeyBootstrap: false,
              scenarioPassed: !failure, cleanupPassed: !cleanupFailure, resources: manifest.resources.length, cleaned: manifest.resources.filter(r => r.status === 'cleaned').length,
              zeroProductAuth: disposed.has(record.runId), timings }) + '\n', { flag: 'wx', mode: 0o600 });
            console.log(`preauth-local phase=disposal; elapsed_ms=${timings.disposalMs}; resources=${manifest.resources.length}; zero_rows=${disposed.has(record.runId)}`);
          }
          finally {
            await lock.release();
          }
        }
        if (failure && cleanupFailure)
          throw new AggregateError([failure, cleanupFailure], 'Promo flow and owned disposal failed');
        if (failure)
          throw failure;
        if (cleanupFailure)
          throw cleanupFailure;
        return result as T;
      },
    });
  },
});
export { expect } from '@playwright/test';
