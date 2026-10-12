import { afterEach, describe, expect, test, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';

import { localStackConfiguration, summarizeLocalWorkerFailure,
  createLocalStackOwner, withLocalStackFixture, withLocalStackPair } from '../../src/local-stack.js';

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

function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

async function eventuallyAbsent(pid: number) {
  for (let attempt = 0; attempt < 100 && alive(pid); attempt++) await delay(20);
  return !alive(pid);
}

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200 && !await present(path); attempt++) await delay(10);
  return readFile(path, 'utf8');
}

function killControlled(pids: number[]) {
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
}

describe('timeout-safe local stack ownership', () => {
  test('never signals a logically reused group after its owned launcher exits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-owner-reuse-'));
    ownedDirectories.push(directory);
    const marker = join(directory, 'exited-command');
    const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
      { detached: true, stdio: 'ignore' });
    await new Promise<void>(resolve => foreign.once('spawn', resolve));
    const owner = createLocalStackOwner();
    const child = owner.spawn(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.argv[1],"completed");', marker], { stdio: 'ignore' });
    const originalKill = process.kill.bind(process);
    // OS PID churn is nondeterministic: redirect a stale post-exit group signal
    // to a real foreign group at the exact production signalling boundary.
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -child.pid! && child.exitCode !== null) return originalKill(-foreign.pid!, signal);
      return originalKill(pid, signal);
    });
    try {
      await waitForFile(marker);
      await delay(100);
      await owner.stop().catch(() => {});
      expect(alive(foreign.pid!)).toBe(true);
    } finally { kill.mockRestore(); foreign.kill('SIGKILL'); await owner.stop().catch(() => {}); }
  });

  test('reaps the owned launcher before probing its terminated group', async () => {
    const owner = createLocalStackOwner();
    const child = owner.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    await new Promise<void>(resolve => child.once('spawn', resolve));
    let reaped = false;
    child.once('exit', () => { reaped = true; });
    const earlyProbes: number[] = [];
    const originalKill = process.kill.bind(process);
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -child.pid! && signal === 0 && !reaped) earlyProbes.push(pid);
      return originalKill(pid, signal);
    });
    try {
      await owner.stop();
      expect(reaped).toBe(true);
      expect(earlyProbes).toEqual([]);
      expect(await eventuallyAbsent(child.pid!)).toBe(true);
    } finally { kill.mockRestore(); killControlled([child.pid!]); await owner.stop(); }
  });

  test('rejects acquisitions after cancellation before creating any real resource', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-owner-refusal-'));
    ownedDirectories.push(directory);
    const marker = join(directory, 'forbidden');
    const owner = createLocalStackOwner();
    await owner.stop();
    await expect(owner.acquire(async () => { await writeFile(marker, 'PRIVATE_GRANT'); return marker; },
      path => rm(path))).rejects.not.toThrow('PRIVATE_GRANT');
    expect(await present(marker)).toBe(false);
  });

  test('attempts all owned cleanup idempotently and preserves fixture failure without private errors', async () => {
    const first = await fileResource();
    const second = await fileResource({ cleanupError: new Error('PRIVATE_COOKIE') });
    const bodyError = new Error('controlled body failure');
    const outcome = await withLocalStackFixture(async owner => {
      owner.own(() => first.stop()); owner.own(() => second.stop());
      throw bodyError;
    }).catch(error => error);
    expect(outcome).toBeInstanceOf(AggregateError);
    expect(outcome.errors[0]).toBe(bodyError);
    expect(String(outcome.errors[1])).toMatch(/cleanup incomplete/iu);
    expect(String(outcome.errors[1])).not.toContain('PRIVATE_COOKIE');
    expect(await present(first.marker)).toBe(false);
    expect(await present(second.marker)).toBe(false);
  });

  test('bounds blocked cleanup without waiting for its late release', async () => {
    const release = deferred();
    const resource = await fileResource({ beforeStop: release.promise });
    const owner = createLocalStackOwner();
    owner.own(() => resource.stop());
    let settled = false;
    const outcome = owner.stop().catch(error => { settled = true; return error; });
    try {
      vi.useFakeTimers();
      // Let the registered cleanup enter its controlled gate before advancing only the deadline clock.
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_001);
      expect(settled).toBe(true);
      expect(String(await outcome)).toMatch(/cleanup incomplete/iu);
      expect(await present(resource.marker)).toBe(true);
    } finally {
      vi.useRealTimers(); release.resolve(); await outcome;
      for (let attempt = 0; attempt < 100 && await present(resource.marker); attempt++) await delay(10);
    }
    expect(await present(resource.marker)).toBe(false);
  });

  test('emits only bounded phase labels before failure without reflecting private input', async () => {
    const messages: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(value => { messages.push(String(value)); });
    const owner = createLocalStackOwner();
    try {
      owner.phase('root-bootstrap');
      owner.phase('PRIVATE_GRANT:/private/root.json');
      expect(messages.some(message => /^local-stack phase=root-bootstrap; elapsed_ms=\d+$/u.test(message))).toBe(true);
      expect(messages.some(message => /^local-stack phase=unknown; elapsed_ms=\d+$/u.test(message))).toBe(true);
      expect(messages.join('\n')).not.toMatch(/PRIVATE|\/private|root.json/iu);
      await owner.stop();
    } finally { log.mockRestore(); }
  });
  // Break caught: killing only the launcher leaves its real descendant alive.
  test('stops an owned launcher and descendant without killing a foreign process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-owner-descendant-'));
    ownedDirectories.push(directory);
    const marker = join(directory, 'pids');
    const owner = createLocalStackOwner();
    const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    const script = 'const {spawn}=require("node:child_process"); const {writeFileSync}=require("node:fs");'
      + 'const peer=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});'
      + 'writeFileSync(process.argv[1],JSON.stringify([process.pid,peer.pid]));setInterval(()=>{},1000);';
    let pids: number[] = [];
    try {
      owner.spawn(process.execPath, ['-e', script, marker], { stdio: 'ignore' });
      pids = JSON.parse(await waitForFile(marker));
      await owner.stop();
      expect(await eventuallyAbsent(pids[0]!)).toBe(true);
      expect(await eventuallyAbsent(pids[1]!)).toBe(true);
      expect(alive(foreign.pid!)).toBe(true);
    } finally { killControlled(pids); foreign.kill('SIGKILL'); await owner.stop(); }
  });

  test('cancels an in-flight setup command and preserves its private cancellation reason', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-owner-command-'));
    ownedDirectories.push(directory);
    const marker = join(directory, 'pid');
    const owner = createLocalStackOwner();
    const script = 'require("node:fs").writeFileSync(process.argv[1],String(process.pid));'
      + 'setTimeout(()=>process.exit(0),2000);';
    const outcome = owner.run(process.execPath, ['-e', script, marker], directory).catch(error => error);
    const pid = Number(await waitForFile(marker));
    try {
      await owner.stop();
      expect(alive(pid)).toBe(false);
      expect(await outcome).toBeInstanceOf(Error);
    } finally { killControlled([pid]); await outcome; }
  });

  test('disposes late acquisition after cancellation and refuses subsequent acquisitions', async () => {
    const resource = await fileResource();
    const release = deferred();
    const entered = deferred();
    const owner = createLocalStackOwner();
    const outcome = owner.acquire(async () => { entered.resolve(); await release.promise; return resource; },
      acquired => acquired.stop()).catch(error => error);
    await entered.promise;
    await owner.stop();
    release.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    expect(await present(resource.marker)).toBe(false);
    const forbidden = join(tmpdir(), 'not-created-by-cancelled-owner');
    await expect(owner.acquire(async () => { throw new Error(`PRIVATE_GRANT:${forbidden}`); },
      async () => {})).rejects.not.toThrow('PRIVATE_GRANT');
  });

  // Exercises this project's fixture boundary under a real pinned Playwright body timeout.
  test('real runner timeout tears down both pending starts and their descendants', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-owner-runner-'));
    ownedDirectories.push(directory);
    const ownerModule = fileURLToPath(new URL('../../src/local-stack.ts', import.meta.url));
    const testModule = fileURLToPath(new URL('../../node_modules/@playwright/test/index.mjs', import.meta.url));
    const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
    const command = 'const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");'
      + 'const peer=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});'
      + 'writeFileSync(process.argv[1],JSON.stringify([process.pid,peer.pid]));setInterval(()=>{},1000);';
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'config.ts'), 'export default {testDir:".",timeout:500,workers:1,retries:0,reporter:"json"};');
    await writeFile(join(directory, 'timeout.spec.ts'), `import { test as base } from ${JSON.stringify(testModule)};
import { withLocalStackFixture } from ${JSON.stringify(ownerModule)};
const test=base.extend({ owned: async ({},use)=>withLocalStackFixture(use) });
test('controlled owned startup timeout',async({owned})=>{
 await Promise.all([0,1].map(i=>owned.run(process.execPath,['-e',${JSON.stringify(command)},${JSON.stringify(directory)}+'/'+i+'.pids'],${JSON.stringify(directory)})));
});`);
    let pids: number[] = [];
    try {
      const result = await promisify(execFile)(process.execPath, [cli, 'test', '--config', join(directory, 'config.ts')],
        { cwd: directory, timeout: 20_000, maxBuffer: 1_000_000 }).catch(error => error);
      const report = JSON.parse(result.stdout);
      expect(report.errors).toEqual([]);
      pids = [...JSON.parse(await waitForFile(join(directory, '0.pids'))),
        ...JSON.parse(await waitForFile(join(directory, '1.pids')))];
      expect(report.stats.unexpected).toBe(1);
      expect(report.suites[0].specs[0].tests[0].results[0].status).toBe('timedOut');
      expect(await Promise.all(pids.map(eventuallyAbsent))).toEqual([true, true, true, true]);
    } finally { killControlled(pids); }
  }, 25_000);
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
