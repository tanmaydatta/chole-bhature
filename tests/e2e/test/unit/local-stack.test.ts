import { afterEach, describe, expect, test } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { localStackConfiguration, summarizeLocalWorkerFailure,
  withLocalStackPair } from '../../src/local-stack.js';

const ports = { core: 20101, identity: 20102, operator: 20103,
  coreInspector: 20104, identityInspector: 20105, operatorInspector: 20106 };

describe('isolated local Worker stack', () => {
  test('namespaces names, origins, D1 persistence and secrets per suite', () => {
    const first = localStackConfiguration('/repo', '/private/tmp/first',
      'e2e_aaaaaaaaaaaaaaaaaaaaaaaa', ports);
    const second = localStackConfiguration('/repo', '/private/tmp/second',
      'e2e_bbbbbbbbbbbbbbbbbbbbbbbb', { ...ports, core: 20201,
        identity: 20202, operator: 20203 });
    expect(first.operatorOrigin).toBe('http://localhost:20103');
    expect(first.coreConfig.name).not.toBe(second.coreConfig.name);
    expect(first.identityConfig.services[0].service).toBe(first.coreConfig.name);
    expect(first.operatorConfig.services[0].service).toBe(first.identityConfig.name);
    expect(first.operatorConfig.services[2].service).toBe(first.coreConfig.name);
    expect(first.identityConfig.vars.PUBLIC_APP_ORIGIN).toBe(first.operatorOrigin);
    expect(first.persistTo).not.toBe(second.persistTo);
    expect(first.identityConfig.d1_databases[0].migrations_dir).toBe('/repo/apps/identity/migrations');
    expect(first.operatorConfig.assets.directory).toBe('/repo/apps/dashboard/dist');
  });

  test('rejects a non-local or non-loopback target and malformed run ID', () => {
    expect(() => localStackConfiguration('/repo', '/private/tmp/first',
      'e2e_aaaaaaaaaaaaaaaaaaaaaaaa', ports, 'staging')).toThrow(/local/u);
    expect(() => localStackConfiguration('/repo', '/private/tmp/first',
      'foreign', ports)).toThrow();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const ownedDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(ownedDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

async function fileResource(options: { beforeStop?: Promise<void>; cleanupError?: Error } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'local-stack-ownership-test-'));
  ownedDirectories.push(directory);
  const marker = join(directory, 'owned');
  await writeFile(marker, 'controlled resource', { flag: 'wx', mode: 0o600 });
  return { marker, async stop() {
    await options.beforeStop;
    await rm(directory, { recursive: true });
    if (options.cleanupError) throw options.cleanupError;
  } };
}

async function present(path: string) {
  try { await access(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

describe('concurrent local stack ownership', () => {
  // Break caught: rejecting one startup abandons an already acquired peer.
  test('cleans an acquired peer when the other startup fails', async () => {
    const allocated = deferred();
    const startupError = new Error('controlled startup failure');
    let attempts = 0;
    let peer: Awaited<ReturnType<typeof fileResource>> | undefined;
    const result = withLocalStackPair(async () => {
      if (attempts++ === 0) { await allocated.promise; throw startupError; }
      peer = await fileResource();
      allocated.resolve();
      return peer;
    }, async () => { throw new Error('failed pair must not reach assertions'); });
    await expect(result).rejects.toBe(startupError);
    expect(peer).toBeDefined();
    expect(await present(peer!.marker)).toBe(false);
  });

  // Break caught: the owner settles before a pending peer can finish and be stopped.
  test('awaits late successful startup and its cleanup before rejecting', async () => {
    const allocated = deferred();
    const release = deferred();
    const startupError = new Error('controlled early failure');
    let attempts = 0;
    let peer: Awaited<ReturnType<typeof fileResource>> | undefined;
    let settled = false;
    const result = withLocalStackPair(async () => {
      if (attempts++ === 0) { await allocated.promise; throw startupError; }
      peer = await fileResource();
      allocated.resolve();
      await release.promise;
      return peer;
    }, async () => { throw new Error('failed pair must not reach assertions'); });
    const outcome = result.then(() => { settled = true; return undefined; },
      error => { settled = true; return error; });
    try {
      await allocated.promise;
      await setImmediate();
      expect(settled).toBe(false);
      expect(await present(peer!.marker)).toBe(true);
      release.resolve();
      expect(await outcome).toBe(startupError);
      expect(await present(peer!.marker)).toBe(false);
    } finally { release.resolve(); await outcome; }
  });

  test('starts both factories even when the first throws synchronously', async () => {
    const startupError = new Error('controlled synchronous failure');
    let attempts = 0;
    let peer: Awaited<ReturnType<typeof fileResource>> | undefined;
    await expect(withLocalStackPair(() => {
      if (attempts++ === 0) throw startupError;
      return fileResource().then(resource => { peer = resource; return resource; });
    }, async () => undefined)).rejects.toBe(startupError);
    expect(peer).toBeDefined();
    expect(await present(peer!.marker)).toBe(false);
  });

  // Both factories wait for the other to start, so serial execution cannot pass.
  test('retains concurrent startup and removes both resources after success', async () => {
    const bothStarted = deferred();
    const resources: Awaited<ReturnType<typeof fileResource>>[] = [];
    let attempts = 0;
    const value = await withLocalStackPair(async () => {
      if (++attempts === 2) bothStarted.resolve();
      await bothStarted.promise;
      const resource = await fileResource();
      resources.push(resource);
      return resource;
    }, async ([first, second]) => {
      expect(first.marker).not.toBe(second.marker);
      expect(await present(first.marker)).toBe(true);
      expect(await present(second.marker)).toBe(true);
      return 'pair assertions completed';
    });
    expect(value).toBe('pair assertions completed');
    expect(await Promise.all(resources.map(resource => present(resource.marker)))).toEqual([false, false]);
  });

  test('cleans both resources when pair assertions throw', async () => {
    const resources: Awaited<ReturnType<typeof fileResource>>[] = [];
    const assertionError = new Error('controlled assertion failure');
    await expect(withLocalStackPair(async () => {
      const resource = await fileResource();
      resources.push(resource);
      return resource;
    }, async () => { throw assertionError; })).rejects.toBe(assertionError);
    expect(await Promise.all(resources.map(resource => present(resource.marker)))).toEqual([false, false]);
  });

  // Break caught: one rejected stop settles the owner before the other stop finishes.
  test('awaits every cleanup before propagating a cleanup failure', async () => {
    const release = deferred();
    const cleanupError = new Error('controlled cleanup failure');
    const resources = [await fileResource({ cleanupError }),
      await fileResource({ beforeStop: release.promise })];
    let attempts = 0;
    let settled = false;
    const outcome = withLocalStackPair(async () => resources[attempts++]!, async () => 'done')
      .then(() => { settled = true; return undefined; },
        error => { settled = true; return error; });
    try {
      // Observe the first actual removal before checking that its failure cannot escape early.
      while (await present(resources[0]!.marker)) await setImmediate();
      await setImmediate();
      expect(settled).toBe(false);
      expect(await present(resources[1]!.marker)).toBe(true);
      release.resolve();
      expect(await outcome).toBe(cleanupError);
      expect(await present(resources[1]!.marker)).toBe(false);
    } finally { release.resolve(); await outcome; }
  });

  test('retains both assertion and cleanup failures after removing resources', async () => {
    const assertionError = new Error('controlled assertion failure');
    const cleanupError = new Error('controlled cleanup failure');
    const resources = [await fileResource({ cleanupError }), await fileResource()];
    let attempts = 0;
    const error = await withLocalStackPair(async () => resources[attempts++]!,
      async () => { throw assertionError; }).catch(failure => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([assertionError, cleanupError]);
    expect(await Promise.all(resources.map(resource => present(resource.marker)))).toEqual([false, false]);
  });
});

describe('private local Worker startup diagnostics', () => {
  // Break caught: long native stacks hide the leading errno under tail truncation.
  test('keeps the native errno hint from before a long native stack', () => {
    const stderr = 'workerd: pthread_create: Resource temporarily unavailable (EAGAIN)\n'
      + '/private/native/workerd@1234567 '.repeat(200);
    expect(summarizeLocalWorkerFailure(stderr, { exitCode: 1, signalCode: null }))
      .toBe('hints=resource-unavailable; exit=1; signal=none');
  });

  test.each([
    ['Address already in use (EADDRINUSE)', 'address-in-use'],
    ['Too many open files (EMFILE)', 'too-many-open-files'],
    ['Cannot allocate memory (ENOMEM)', 'out-of-memory'],
    ['Fatal error: Check failed: controlledNativeCheck()', 'native-check-failed'],
    ['Segmentation fault', 'segmentation-fault'],
  ])('reports only the known classification for %s', (stderr, hint) => {
    expect(summarizeLocalWorkerFailure(stderr, { exitCode: null, signalCode: 'SIGABRT' }))
      .toBe(`hints=${hint}; exit=none; signal=SIGABRT`);
  });

  // Break caught: redacting only 64-byte hex leaves other credential encodings visible.
  test.each([
    'activationGrant=pending_root_grant_PRIVATE_X9; root session=opaqueCookie_PRIVATE_Y8',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.PRIVATE_SIGNATURE; proof=Q'.repeat(45),
    'AUTH_SECRET=' + 'a'.repeat(64) + '; recovery-code=PRIVATE_RECOVERY_72',
    'https://private.invalid/?grant=PRIVATE_GRANT; /private/root-storage-state.json',
    'Unexpected startup error: secret-with-Resource temporarily unavailable-inside',
  ])('does not reflect credential-shaped or arbitrary native input %#', stderr => {
    const diagnostic = summarizeLocalWorkerFailure(stderr, { exitCode: 1, signalCode: null });
    expect(diagnostic).toMatch(/^hints=(unknown|resource-unavailable); exit=1; signal=none$/u);
    expect(diagnostic).not.toMatch(/PRIVATE|grant|cookie|Bearer|eyJ|AUTH_SECRET|recovery|https:|\/private|aaaa/iu);
  });

  test('does not reflect unknown signal or invalid exit metadata', () => {
    expect(summarizeLocalWorkerFailure('opaque activation/session grant', {
      exitCode: Number.NaN, signalCode: 'PRIVATE_SESSION_GRANT',
    })).toBe('hints=unknown; exit=unknown; signal=unknown');
    expect(summarizeLocalWorkerFailure('')).toBe('hints=unknown; exit=not-started; signal=none');
  });
});
