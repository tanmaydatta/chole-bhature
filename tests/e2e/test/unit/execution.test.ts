import { describe, expect, test } from 'vitest';

import { createManifest } from '../../src/manifest.js';
import { executeRecipe } from '../../src/execution.js';

describe('recipe execution', () => {
  test('creates a namespaced merchant and records ownership before selection', async () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const manifest = createManifest(runId, 'local');
    const calls: string[] = [];
    const result = await executeRecipe({
      manifest,
      target: { kind: 'local', operatorOrigin: 'http://localhost:5173', apiOrigin: 'http://localhost:8787' },
      operator: { async request(method, path, body) {
        calls.push(`${method} ${path}`);
        if (path === '/operator/v1/platform/clients') {
          expect(body).toEqual({ name: `${runId}_merchant Test shop`, idempotencyKey: `${runId}_merchant` });
          return { provisioningId: 'provisioning-1', merchantId: 'merchant-1', organizationId: 'org-1',
            name: `${runId}_merchant Test shop`, status: 'active', failedStep: null, retryable: false };
        }
        return null;
      } },
      save: async () => { expect(manifest.resources).toHaveLength(1); },
      saveToken: async () => { throw new Error('No token expected'); },
    }, 'add-merchant', { name: 'Test shop' });
    expect(result).toMatchObject({ merchantId: 'merchant-1' });
    expect(manifest.resources).toMatchObject([{ kind: 'merchant', id: 'merchant-1', ownerRunId: runId }]);
    expect(calls).toEqual([
      'POST /operator/v1/platform/clients',
      'POST /operator/v1/platform/merchant-selection',
    ]);
  });

  test('two concurrent runs never share merchant, customer, or idempotency identities', async () => {
    const seen = new Set<string>();
    const runIds = ['e2e_0123456789abcdef01234567', 'e2e_89abcdef0123456701234567'] as const;
    const manifests = await Promise.all(runIds.map(async runId => {
      const manifest = createManifest(runId, 'local');
      const context = {
        manifest,
        target: { kind: 'local' as const, operatorOrigin: 'http://localhost:5173', apiOrigin: 'http://localhost:8787' },
        operator: { async request(_method: string, path: string, body?: unknown) {
          if (path.endsWith('/clients')) {
            const input = body as { name: string; idempotencyKey: string };
            seen.add(input.idempotencyKey);
            return { provisioningId: `prov-${runId}`, merchantId: `merchant-${runId}`,
              organizationId: `org-${runId}`, name: input.name,
              status: 'active', failedStep: null, retryable: false };
          }
          if (path.includes('/customers/')) return {
            externalRef: path.split('/').at(-1), attributes: {}, version: 1,
            updatedAt: '2026-09-25T00:00:00.000Z',
          };
          return null;
        } },
        save: async () => {},
        saveToken: async () => {},
      };
      await executeRecipe(context, 'add-merchant', { name: 'Shop' });
      await executeRecipe(context, 'add-customer', { slug: 'buyer', attributes: {} });
      return manifest;
    }));
    expect(seen.size).toBe(2);
    expect(manifests[0]?.resources.map(item => item.id)).toEqual([
      `merchant-${runIds[0]}`, `${runIds[0]}_buyer`,
    ]);
    expect(manifests[1]?.resources.map(item => item.id)).toEqual([
      `merchant-${runIds[1]}`, `${runIds[1]}_buyer`,
    ]);
  });

  test('staging provisioning sends its durable run proof only after persisting it', async () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const manifest = createManifest(runId, 'staging');
    const proof = 'A'.repeat(43);
    let persisted = false;
    await executeRecipe({
      manifest,
      target: { kind: 'staging', operatorOrigin: 'https://operator.staging.wastd.dev',
        apiOrigin: 'https://api.staging.wastd.dev' },
      getOrCreateProof: async () => { persisted = true; return proof; },
      operator: { async request(_method, path, body) {
        if (path.endsWith('/clients')) {
          expect(persisted).toBe(true);
          expect(body).toMatchObject({ e2eRun: { runId, proof } });
          return { provisioningId: 'provision-1', merchantId: 'merchant-1',
            organizationId: 'org-1', name: `${runId}_merchant Shop`,
            status: 'active', failedStep: null, retryable: false };
        }
        return null;
      } },
      save: async () => {}, saveToken: async () => {},
    }, 'add-merchant', { name: 'Shop' });
    expect(JSON.stringify(manifest)).not.toContain(proof);
  });

  test('resumes a failed staged provisioning with the same proof and server identifiers', async () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const proof = 'A'.repeat(43);
    const manifest = createManifest(runId, 'staging');
    const paths: string[] = [];
    const context = {
      manifest,
      target: { kind: 'staging' as const, operatorOrigin: 'https://operator.staging.wastd.dev',
        apiOrigin: 'https://api.staging.wastd.dev' },
      getOrCreateProof: async () => proof,
      operator: { async request(_method: string, path: string, body?: unknown) {
        paths.push(path);
        if (path.endsWith('/clients')) return { provisioningId: 'provision-1',
          merchantId: 'merchant-1', organizationId: null,
          name: `${runId}_merchant Shop`, status: 'failed',
          failedStep: 'core_provision', retryable: true };
        if (path.endsWith('/retry')) {
          expect(body).toEqual({ e2eRun: { runId, proof } });
          return { provisioningId: 'provision-1', merchantId: 'merchant-1',
            organizationId: 'org-1', name: `${runId}_merchant Shop`,
            status: 'active', failedStep: null, retryable: false };
        }
        return null;
      } },
      save: async () => {}, saveToken: async () => {},
    };
    await expect(executeRecipe(context, 'add-merchant', { name: 'Shop' }))
      .rejects.toThrow(/failed/u);
    expect(manifest.resources[0]?.status).toBe('error');
    expect(await executeRecipe(context, 'add-merchant', { name: 'Shop' }))
      .toMatchObject({ status: 'active' });
    expect(manifest.resources[0]).toMatchObject({ status: 'active',
      provisioningId: 'provision-1', organizationId: 'org-1' });
    expect(paths).toContain('/operator/v1/platform/provisionings/provision-1/retry');
  });

  test('staging add-admin records a fully active fixture account and verifies its signed session', async () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const manifest = createManifest(runId, 'staging');
    manifest.resources.push({ kind: 'merchant', id: 'merchant-1', label: `${runId}_merchant`,
      ownerRunId: runId, organizationId: 'org-1', status: 'active' });
    const email = `e2e+${runId}_admin@e2e.invalid`;
    const proof = 'A'.repeat(43);
    const steps: string[] = [];
    const context = { manifest,
      target: { kind: 'staging' as const, operatorOrigin: 'https://operator.staging.wastd.dev',
        apiOrigin: 'https://api.staging.wastd.dev' },
      getOrCreateProof: async () => proof,
      operator: { async request(_method: string, path: string, body?: unknown) {
        if (path === '/operator/v1/platform/merchant-selection') return null;
        expect(path).toBe(`/operator/v1/platform/e2e-runs/${runId}/accounts`);
        expect(body).toEqual({ proof, slug: 'admin', role: 'admin' });
        steps.push('create');
        return { runId, merchantId: 'merchant-1', organizationId: 'org-1',
          userId: 'user-1', membershipId: 'member-1', email, role: 'admin',
          sessionId: 'session-1', cookieHeader: 'signed=cookie' };
      } },
      save: async () => { steps.push('manifest'); },
      saveToken: async () => {},
      saveMemberCookie: async (_slug: string, cookie: string) => {
        expect(cookie).toBe('signed=cookie'); steps.push('cookie');
      },
      verifyMemberSession: async (input: { membershipId: string; role: string }) => {
        expect(input).toMatchObject({ membershipId: 'member-1', role: 'admin' });
        steps.push('verify');
      },
    };
    expect(await executeRecipe(context, 'add-admin', { slug: 'admin' }))
      .toMatchObject({ membershipId: 'member-1', userId: 'user-1' });
    expect(steps).toEqual(['create', 'manifest', 'cookie', 'verify']);
    expect(manifest.resources.map(item => item.kind)).toEqual(['merchant', 'membership']);
  });

  test('local add-user fails clearly because fixture sessions are staging-only', async () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const manifest = createManifest(runId, 'local');
    manifest.resources.push({ kind: 'merchant', id: 'merchant-1', label: `${runId}_merchant`,
      ownerRunId: runId, organizationId: 'org-1', status: 'active' });
    await expect(executeRecipe({ manifest,
      target: { kind: 'local', operatorOrigin: 'http://localhost:5173',
        apiOrigin: 'http://localhost:8787' },
      operator: { async request() { throw new Error('must not contact operator'); } },
      save: async () => {}, saveToken: async () => {},
    }, 'add-user', { slug: 'viewer', role: 'viewer' }))
      .rejects.toThrow(/staging-only/u);
  });
});
