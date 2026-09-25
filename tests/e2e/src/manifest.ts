import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import { RunIdSchema, type RunId } from './config.js';

export const ResourceSchema = z.object({
  kind: z.enum([
    'merchant', 'invitation', 'membership', 'schema', 'customer', 'credential',
    'promo', 'evaluation', 'redemption',
  ]),
  id: z.string().min(1),
  ownerRunId: RunIdSchema,
  merchantId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  provisioningId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  email: z.email().optional(),
  schemaKey: z.string().min(1).optional(),
  status: z.enum(['active', 'cleaned', 'retained', 'error']).default('active'),
  cleanupError: z.string().optional(),
}).strict();
export type Resource = z.infer<typeof ResourceSchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  runId: RunIdSchema,
  target: z.enum(['local', 'staging']),
  createdAt: z.iso.datetime({ offset: true }),
  resources: z.array(ResourceSchema),
}).strict();
export type Manifest = z.infer<typeof ManifestSchema>;

export function createManifest(runId: RunId, target: Manifest['target']): Manifest {
  return { version: 1, runId: RunIdSchema.parse(runId), target,
    createdAt: new Date().toISOString(), resources: [] };
}

export function recordResource(
  manifest: Manifest,
  input: Omit<Resource, 'status'> & { status?: Resource['status'] },
): Resource {
  const resource = ResourceSchema.parse(input);
  if (resource.ownerRunId !== manifest.runId) throw new Error('Resource belongs to another run');
  if (
    !resource.id.startsWith(`${manifest.runId}_`)
    && !resource.label?.startsWith(`${manifest.runId}_`)
  ) throw new Error('Resource has no run-scoped identifier or label');
  if (manifest.resources.some(item => item.kind === resource.kind && item.id === resource.id)) {
    throw new Error('Resource already recorded in this run');
  }
  manifest.resources.push(resource);
  return resource;
}

export function nextCleanup(manifest: Manifest): Resource[] {
  return [...manifest.resources].reverse().filter(item => item.status === 'active' || item.status === 'error');
}

export function manifestPath(directory: string, runId: RunId): string {
  return join(directory, `${RunIdSchema.parse(runId)}.json`);
}

export async function saveManifest(path: string, manifest: Manifest): Promise<void> {
  ManifestSchema.parse(manifest);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export async function readManifest(path: string): Promise<Manifest> {
  return ManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown);
}
