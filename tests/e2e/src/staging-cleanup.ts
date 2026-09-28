import { E2eRunInventorySchema, E2eRunProofSchema } from '@incentives/contracts';

import type { Manifest } from './manifest.js';

interface Context {
  manifest: Manifest;
  proof: string;
  operator: { request(method: 'POST', path: string, body: unknown): Promise<unknown> };
  save(): Promise<void>;
}

export async function cleanupStagingRun(ctx: Context, options: { dryRun: boolean }) {
  if (ctx.manifest.target !== 'staging'
    && !(ctx.manifest.target === 'local' && process.env.E2E_MANAGED_LOCAL_STACK === '1')) {
    throw new Error('Full disposal requires staging or an isolated managed local E2E stack');
  }
  E2eRunProofSchema.parse({ runId: ctx.manifest.runId, proof: ctx.proof });
  const merchant = ctx.manifest.resources.find(resource => resource.kind === 'merchant');
  if (!merchant || !merchant.provisioningId
    || !merchant.label?.startsWith(`${ctx.manifest.runId}_merchant`)) {
    throw new Error('Run manifest lacks merchant provenance');
  }
  for (const resource of ctx.manifest.resources) {
    if (resource.ownerRunId !== ctx.manifest.runId
      || (resource.kind !== 'merchant' && resource.merchantId !== merchant.id)) {
      throw new Error('Run manifest contains a foreign resource');
    }
  }
  const request = async (action: 'preview' | 'dispose') => {
    const value = E2eRunInventorySchema.parse(await ctx.operator.request(
      'POST', `/operator/v1/platform/e2e-runs/${ctx.manifest.runId}/${action}`,
      { proof: ctx.proof },
    ));
    if (value.runId !== ctx.manifest.runId || value.merchantId !== merchant.id) {
      throw new Error('E2E lifecycle inventory crossed the run boundary');
    }
    return value;
  };
  const preview = await request('preview');
  if (options.dryRun) return preview;
  try {
    const result = await request('dispose');
    if (result.status !== 'disposed' || result.productStatus !== 'disposed'
      || Object.values(result.auth).some(count => count !== 0)
      || Object.values(result.product).some(count => count !== 0)) {
      throw new Error('E2E lifecycle disposal left tenant rows behind');
    }
    for (const resource of ctx.manifest.resources) {
      resource.status = 'cleaned';
      delete resource.cleanupError;
    }
    await ctx.save();
    return result;
  } catch (error) {
    merchant.status = 'error';
    merchant.cleanupError = error instanceof Error ? error.message : 'Unknown cleanup error';
    await ctx.save();
    throw error;
  }
}
