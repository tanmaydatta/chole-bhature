import { describe, expect, test } from 'vitest';

import { createManifest, recordResource } from '../../src/manifest.js';
import { cleanupStagingRun } from '../../src/staging-cleanup.js';

const runId = 'e2e_0123456789abcdef01234567';
const proof = 'A'.repeat(43);
function manifest() {
  const value = createManifest(runId, 'staging');
  recordResource(value, { kind: 'merchant', id: 'merchant-server',
    label: `${runId}_merchant`, ownerRunId: runId,
    provisioningId: 'provision-server' });
  recordResource(value, { kind: 'customer', id: `${runId}_buyer`,
    ownerRunId: runId, merchantId: 'merchant-server' });
  return value;
}
const active = { runId, merchantId: 'merchant-server', status: 'active',
  productStatus: 'active', auth: { organizations: 1 }, product: { merchants: 1 } };
const disposed = { ...active, status: 'disposed', productStatus: 'disposed',
  auth: { organizations: 0 }, product: { merchants: 0 } };

describe('full staging cleanup', () => {
  test('previews without disposal and requires exact server inventory identity', async () => {
    const value = manifest();
    const calls: string[] = [];
    const result = await cleanupStagingRun({ manifest: value, proof,
      operator: { async request(_method, path) {
        calls.push(path);
        return active;
      } }, save: async () => { throw new Error('unexpected write'); },
    }, { dryRun: true });
    expect(result).toEqual(active);
    expect(calls).toEqual([`/operator/v1/platform/e2e-runs/${runId}/preview`]);
    expect(value.resources.every(item => item.status === 'active')).toBe(true);
    await expect(cleanupStagingRun({ manifest: value, proof,
      operator: { async request() { return { ...active, merchantId: 'foreign' }; } },
      save: async () => {},
    }, { dryRun: true })).rejects.toThrow(/boundary/u);
  });

  test('records a failed disposal, then resumes idempotently and requires all D1 counts zero', async () => {
    const value = manifest();
    const saved: string[][] = [];
    let fail = true;
    const context = { manifest: value, proof,
      operator: { async request(_method: string, path: string) {
        if (path.endsWith('/preview')) return active;
        if (fail) throw new Error('Product D1 unavailable');
        return disposed;
      } },
      save: async () => { saved.push(value.resources.map(item => item.status)); },
    };
    await expect(cleanupStagingRun(context, { dryRun: false })).rejects.toThrow(/unavailable/u);
    expect(saved.at(-1)).toEqual(['error', 'active']);
    fail = false;
    expect(await cleanupStagingRun(context, { dryRun: false })).toEqual(disposed);
    expect(value.resources.map(item => item.status)).toEqual(['cleaned', 'cleaned']);
    await cleanupStagingRun(context, { dryRun: false });
    expect(value.resources.map(item => item.status)).toEqual(['cleaned', 'cleaned']);
  });
});
