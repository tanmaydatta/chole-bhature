import { describe, expect, test } from 'vitest';

import { createManifest, recordResource } from '../../src/manifest.js';
import { cleanupRun, validateRecipeInput } from '../../src/recipes.js';

const runId = 'e2e_0123456789abcdef01234567';

describe('recipe validation', () => {
  test('rejects unknown fields and missing required inputs before contacting an operator', () => {
    expect(() => validateRecipeInput('add-merchant', { name: '' })).toThrow();
    expect(() => validateRecipeInput('add-customer', { slug: 'buyer', attributes: {}, token: 'secret' })).toThrow();
  });
});

describe('cleanup orchestration', () => {
  test('dry run previews reverse order without mutating the manifest or calling handlers', async () => {
    const manifest = createManifest(runId, 'staging');
    recordResource(manifest, { kind: 'merchant', id: `${runId}_merchant`, ownerRunId: runId });
    recordResource(manifest, { kind: 'promo', id: `${runId}_promo`, ownerRunId: runId });
    const preview = await cleanupRun(manifest, async () => { throw new Error('must not call'); }, {
      dryRun: true, save: async () => { throw new Error('must not save'); },
    });
    expect(preview.map(item => item.id)).toEqual([`${runId}_promo`, `${runId}_merchant`]);
    expect(manifest.resources.map(item => item.status)).toEqual(['active', 'active']);
  });

  test('persists partial failure and resumes without repeating completed cleanup', async () => {
    const manifest = createManifest(runId, 'staging');
    recordResource(manifest, { kind: 'merchant', id: `${runId}_merchant`, ownerRunId: runId });
    recordResource(manifest, { kind: 'credential', id: 'generated-id', label: `${runId}_credential`, ownerRunId: runId });
    const saved: string[][] = [];
    const save = async () => { saved.push(manifest.resources.map(item => item.status)); };
    let fail = true;
    await expect(cleanupRun(manifest, async resource => {
      if (resource.kind === 'credential' && fail) throw new Error('temporary failure');
      return resource.kind === 'merchant' ? 'retained' : 'cleaned';
    }, { save })).rejects.toThrow(/temporary failure/u);
    expect(saved).toEqual([['active', 'error']]);
    fail = false;
    const cleaned: string[] = [];
    await cleanupRun(manifest, async resource => {
      cleaned.push(resource.kind);
      return resource.kind === 'merchant' ? 'retained' : 'cleaned';
    }, { save });
    expect(cleaned).toEqual(['credential', 'merchant']);
    expect(manifest.resources.map(item => item.status)).toEqual(['retained', 'cleaned']);
  });
});
