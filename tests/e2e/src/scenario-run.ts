import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { loadTarget, newRunId, type RunId } from './config.js';
import type { RecipeContext } from './execution.js';
import { createManifest } from './manifest.js';
import { openOperatorClient, verifyFixtureMemberSession } from './operator-client.js';
import { createRunStore } from './run-store.js';
import { cleanupStagingRun } from './staging-cleanup.js';

export async function withScenarioRun<T>(scenario: (context: RecipeContext) => Promise<T>): Promise<T> {
  const target = loadTarget(process.env);
  const runId = newRunId();
  const directory = fileURLToPath(new URL('../.runs/', import.meta.url));
  const store = createRunStore(directory, runId);
  const lock = await store.lock();
  const manifest = createManifest(runId, target.kind);
  try {
    await store.save(manifest);
    const operator = await openOperatorClient(target, process.env);
    const context: RecipeContext = { manifest, target, operator,
      save: () => store.save(manifest),
      saveToken: (slug, token) => store.saveToken(slug, token),
      saveMemberCookie: (slug, cookie) => store.saveMemberCookie(slug, cookie),
      verifyMemberSession: input => verifyFixtureMemberSession(target, input),
      getOrCreateProof: () => store.getOrCreateProof(),
    };
    let scenarioFailure: unknown;
    let scenarioResult: T | undefined;
    try {
      scenarioResult = await scenario(context);
    } catch (error) {
      scenarioFailure = error;
    }
    let cleanupFailure: unknown;
    try {
      const merchant = manifest.resources.find(resource => resource.kind === 'merchant');
      if (merchant && (target.kind === 'staging'
        || process.env.E2E_MANAGED_LOCAL_STACK === '1')) {
        await cleanupStagingRun({ manifest, proof: await store.readProof(), operator,
          save: () => store.save(manifest) }, { dryRun: false });
      }
    } catch (error) {
      cleanupFailure = error;
    } finally {
      await operator.close();
    }
    if (scenarioFailure && cleanupFailure) {
      throw new AggregateError([scenarioFailure, cleanupFailure],
        'Scenario and cleanup both failed');
    }
    if (scenarioFailure) throw scenarioFailure;
    if (cleanupFailure) throw cleanupFailure;
    return scenarioResult as T;
  } finally {
    await lock.release();
  }
}

export async function assertRunDisposed(runId: RunId): Promise<void> {
  const target = loadTarget(process.env);
  const directory = fileURLToPath(new URL('../.runs/', import.meta.url));
  const store = createRunStore(directory, runId);
  const manifest = await store.read();
  assert.equal(manifest.runId, runId);
  assert.ok(manifest.resources.length > 0, 'Disposed run must have recorded resources');
  assert.ok(manifest.resources.every(resource => resource.status === 'cleaned'),
    'Run manifest still has live or failed resources');
  const operator = await openOperatorClient(target, process.env);
  try {
    const inventory = await cleanupStagingRun({ manifest, proof: await store.readProof(), operator,
      save: () => store.save(manifest) }, { dryRun: true });
    assert.equal(inventory.status, 'disposed');
    assert.equal(inventory.productStatus, 'disposed');
    assert.ok(Object.values(inventory.auth).every(count => count === 0),
      'Auth D1 contains run-owned rows after disposal');
    assert.ok(Object.values(inventory.product).every(count => count === 0),
      'Product D1 contains run-owned rows after disposal');
  } finally {
    await operator.close();
  }
}
