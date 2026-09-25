import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createManifest } from '../../src/manifest.js';
import { createRunStore } from '../../src/run-store.js';

const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'incentives-e2e-run-'));
  directories.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('private run store', () => {
  test('persists the manifest, proof and token privately without mixing the secret into the manifest', async () => {
    const path = await directory();
    const runId = 'e2e_0123456789abcdef01234567';
    const store = createRunStore(path, runId);
    await store.save(createManifest(runId, 'staging'));
    const proof = await store.getOrCreateProof();
    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(await store.getOrCreateProof()).toBe(proof);
    await store.saveToken('checkout', 'credential-secret');
    await store.saveMemberCookie('viewer', 'signed=first');
    await store.saveMemberCookie('viewer', 'signed=renewed');
    expect((await stat(store.proofPath)).mode & 0o077).toBe(0);
    expect((await stat(store.tokenPath('checkout'))).mode & 0o077).toBe(0);
    expect((await stat(store.memberCookiePath('viewer'))).mode & 0o077).toBe(0);
    expect(await store.readMemberCookie('viewer')).toBe('signed=renewed');
    expect(await readFile(store.manifestPath, 'utf8')).not.toContain(proof);
    expect(await readFile(store.manifestPath, 'utf8')).not.toContain('credential-secret');
    expect(await readFile(store.manifestPath, 'utf8')).not.toContain('signed=renewed');
  });

  test('serializes same-run work but allows independent runs', async () => {
    const path = await directory();
    const first = createRunStore(path, 'e2e_0123456789abcdef01234567');
    const second = createRunStore(path, 'e2e_89abcdef0123456701234567');
    const acquired = await first.lock();
    await expect(first.lock()).rejects.toThrow(/already active/u);
    const other = await second.lock();
    await other.release();
    await acquired.release();
    const resumed = await first.lock();
    await resumed.release();
  });
});
