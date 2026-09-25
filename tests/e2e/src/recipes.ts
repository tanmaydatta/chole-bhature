import {
  ApiCredentialScopeSchema,
  FixedOperatorRoleSchema,
  PromoProgramSchema,
  VariableDefinitionSchema,
} from '@incentives/contracts';
import { z } from 'zod';

import { nextCleanup, type Manifest, type Resource } from './manifest.js';

const slug = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u);
const attributes = z.record(z.string(), z.unknown());

export const recipeInputs = {
  'add-merchant': z.object({ name: z.string().trim().min(1).max(120) }).strict(),
  'add-user': z.object({ slug, role: z.enum(['operator', 'viewer']) }).strict(),
  'add-admin': z.object({ slug }).strict(),
  'set-role': z.object({ membershipId: z.string().min(1), role: FixedOperatorRoleSchema }).strict(),
  'add-schema': z.object({ slug, definition: VariableDefinitionSchema }).strict(),
  'add-customer': z.object({ slug, attributes }).strict(),
  'create-api-credential': z.object({
    slug,
    kind: z.enum(['publishable', 'secret']),
    scopes: z.array(ApiCredentialScopeSchema).min(1),
    allowedOrigins: z.array(z.url()).optional(),
  }).strict(),
  'add-promo': z.object({ slug, program: PromoProgramSchema }).strict(),
  'publish-promo': z.object({ slug }).strict(),
  'cleanup-run': z.object({ dryRun: z.boolean().default(true) }).strict(),
} as const;

export type RecipeName = keyof typeof recipeInputs;

export function validateRecipeInput(name: RecipeName, input: unknown): unknown {
  return recipeInputs[name].parse(input);
}

export type CleanupHandler = (resource: Resource) => Promise<'cleaned' | 'retained'>;

export async function cleanupRun(
  manifest: Manifest,
  handler: CleanupHandler,
  options: { dryRun: boolean; save: () => Promise<void> } | { save: () => Promise<void> },
): Promise<Resource[]> {
  const pending = nextCleanup(manifest);
  if ('dryRun' in options && options.dryRun) return pending;
  for (const resource of pending) {
    if (resource.ownerRunId !== manifest.runId) {
      throw new Error(`Refusing foreign resource ${resource.kind}`);
    }
    try {
      resource.status = await handler(resource);
      delete resource.cleanupError;
    } catch (error) {
      resource.status = 'error';
      resource.cleanupError = error instanceof Error ? error.message : 'Unknown cleanup error';
      await options.save();
      throw error;
    }
    await options.save();
  }
  return pending;
}
