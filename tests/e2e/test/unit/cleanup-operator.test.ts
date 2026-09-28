import { describe, expect, test } from 'vitest';

import { createManifest, recordResource } from '../../src/manifest.js';
import { cleanupOperatorResource } from '../../src/cleanup-operator.js';

const runId = 'e2e_0123456789abcdef01234567';

describe('scoped operator cleanup', () => {
  test('refuses a credential tied to a different merchant before any write', async () => {
    const manifest = createManifest(runId, 'staging');
    recordResource(manifest, {
      kind: 'merchant', id: 'owned-merchant', label: `${runId}_merchant`, ownerRunId: runId,
    });
    const foreign = {
      kind: 'credential' as const, id: 'foreign-credential', label: `${runId}_credential`,
      ownerRunId: runId, merchantId: 'different-merchant', status: 'active' as const,
    };
    const calls: string[] = [];
    await expect(cleanupOperatorResource({
      manifest,
      operator: { async request(method, path) { calls.push(`${method} ${path}`); return []; } },
    }, foreign)).rejects.toThrow(/merchant/u);
    expect(calls).toEqual([]);
  });

  test('marks customer data retained because no supported delete route exists', async () => {
    const manifest = createManifest(runId, 'staging');
    recordResource(manifest, {
      kind: 'merchant', id: 'owned-merchant', label: `${runId}_merchant`, ownerRunId: runId,
    });
    const customer = recordResource(manifest, {
      kind: 'customer', id: `${runId}_buyer`, ownerRunId: runId, merchantId: 'owned-merchant',
    });
    const result = await cleanupOperatorResource({
      manifest, operator: { async request() { throw new Error('No customer deletion route'); } },
    }, customer);
    expect(result).toBe('retained');
  });
});
