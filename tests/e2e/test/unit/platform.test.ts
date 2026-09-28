import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { loadTarget, newRunId, runScoped } from '../../src/config.js';
import { createManifest, recordResource, nextCleanup } from '../../src/manifest.js';

describe('E2E target and run identity', () => {
  test('exposes explicit local and staging headed commands with browser-only selection', () => {
    const packageFile = fileURLToPath(new URL('../../../../package.json', import.meta.url));
    const scripts = (JSON.parse(readFileSync(packageFile, 'utf8')) as {
      scripts: Record<string, string>;
    }).scripts;
    expect(scripts['e2e:local:headed']).toContain('E2E_TARGET=local');
    expect(scripts['e2e:local:headed']).toContain('--project=browser --headed');
    expect(scripts['e2e:staging:headed']).toContain('E2E_TARGET=staging');
    expect(scripts['e2e:staging:headed']).toContain('E2E_ENABLE_STAGING=1');
    expect(scripts['e2e:staging:headed']).toContain('--project=browser --headed');
    expect(scripts['e2e:staging:login']).toContain('E2E_TARGET=staging');
    expect(scripts['e2e:staging:login']).toContain('login:staging');
  });
  test('rejects staging unless explicitly enabled and pinned to protected origins', () => {
    expect(() => loadTarget({ E2E_TARGET: 'staging' })).toThrow(/staging/i);
    expect(() => loadTarget({
      E2E_TARGET: 'staging', E2E_ENABLE_STAGING: '1',
      E2E_OPERATOR_ORIGIN: 'https://evil.example',
      E2E_API_ORIGIN: 'https://api.staging.wastd.dev',
    })).toThrow(/origin/i);
  });

  test('gives concurrent runs collision-resistant identities and scoped names', () => {
    const first = newRunId();
    const second = newRunId();
    expect(first).toMatch(/^e2e_[a-f0-9]{24}$/u);
    expect(second).not.toBe(first);
    expect(runScoped(first, 'customer')).toBe(`${first}_customer`);
    expect(runScoped(second, 'customer')).not.toBe(runScoped(first, 'customer'));
  });
});

describe('run manifest', () => {
  test('records server-generated provisioning identifiers without credential secrets', () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const manifest = createManifest(runId, 'local');
    recordResource(manifest, {
      kind: 'merchant', id: 'merchant-from-server', label: `${runId}_merchant`,
      ownerRunId: runId, provisioningId: 'provisioning-from-server',
      organizationId: 'org-from-server',
    });
    expect(manifest.resources[0]).toMatchObject({
      id: 'merchant-from-server', provisioningId: 'provisioning-from-server',
      organizationId: 'org-from-server',
    });
    expect(JSON.stringify(manifest)).not.toContain('token');
  });

  test('rejects resources owned by another run and plans cleanup in reverse dependency order', () => {
    const runId = 'e2e_0123456789abcdef01234567';
    const manifest = createManifest(runId, 'local');
    recordResource(manifest, { kind: 'merchant', id: `${runId}_merchant`, ownerRunId: runId });
    recordResource(manifest, { kind: 'promo', id: `${runId}_promo`, ownerRunId: runId, merchantId: `${runId}_merchant` });
    expect(nextCleanup(manifest).map(item => item.kind)).toEqual(['promo', 'merchant']);
    expect(() => recordResource(manifest, {
      kind: 'customer', id: 'foreign', ownerRunId: runId, merchantId: `${runId}_merchant`,
    })).toThrow(/run/i);
  });
});
