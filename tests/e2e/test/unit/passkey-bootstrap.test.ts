import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as eventLoopTurn, setTimeout as delay } from 'node:timers/promises';
import { chromium, request, type APIRequestContext } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { bootstrapLocalRootPasskey, parseLocalRootBootstrapResult, saveLocalPasskeyRootState,
  withLocalPasskeyBrowser, withLocalPasskeyContext } from '../../src/passkey-bootstrap.js';
import { createLocalStackOwner } from '../../src/local-stack.js';

const rootSession = {
  userId: 'independently-issued-root', platformRole: 'root',
  authenticationMethods: ['passkey'], authenticatedAt: '2026-10-08T12:00:00Z',
  permissions: [], merchantSelectionRequired: true,
};
const snapshot = { cookies: [{ name: 'local-session', value: 'private-cookie-value',
  domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false,
  sameSite: 'Lax' as const }], origins: [] };

describe('local passkey root state publication', () => {
  let directory: string;
  let output: string;
  let server: Server;
  let api: APIRequestContext;
  let origin: string;
  let body: unknown;
  let status: number;
  let invalidJson: boolean;
  let disconnect: boolean;
  let storageFailure: boolean;
  let redirectedRequests: string[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'passkey-bootstrap-unit-'));
    output = join(directory, 'root.json');
    body = { ...rootSession }; status = 200; invalidJson = false;
    disconnect = false; storageFailure = false; redirectedRequests = [];
    server = createServer((incoming, response) => {
      if (incoming.url !== '/operator/v1/session') {
        redirectedRequests.push(incoming.url ?? '');
        response.writeHead(200).end(JSON.stringify(rootSession));
        return;
      }
      if (disconnect) { incoming.socket.destroy(); return; }
      response.writeHead(status, { 'content-type': 'application/json',
        ...(status >= 300 && status < 400 ? { location: '/redirected-session' } : {}) });
      response.end(invalidJson ? 'invalid-json-with-private-cookie-value' : JSON.stringify(body));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    origin = `http://127.0.0.1:${address.port}`;
    api = await request.newContext({ baseURL: origin });
  });

  afterEach(async () => {
    await api?.dispose();
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  function publish(overrides: Partial<Parameters<typeof saveLocalPasskeyRootState>[1]> = {}) {
    // Only the browser snapshot is substituted: session HTTP and filesystem are real.
    return saveLocalPasskeyRootState({ request: api, storageState: async () => {
      if (storageFailure) throw new Error('serialization included private-cookie-value');
      return snapshot;
    } }, { operatorOrigin: origin, expectedRootUserId: 'independently-issued-root',
      storageStatePath: output, ...overrides });
  }

  async function expectRejectedWithoutState(overrides = {}) {
    const outcome = await publish(overrides).then(value => ({ value }), error => ({ error }));
    expect(await readdir(directory)).toEqual([]);
    expect(outcome).toHaveProperty('error');
  }

  // Removing the server identity/method guard must fail these tests with real state on disk.
  test.each([
    ['a different root identity', { ...rootSession, userId: 'another-root' }],
    ['a member identity', { ...rootSession, platformRole: undefined }],
    ['a fixture login', { ...rootSession, authenticationMethods: ['e2e-fixture'] }],
    ['a recovery login', { ...rootSession, authenticationMethods: ['recovery'] }],
    ['a magic-link login', { ...rootSession, authenticationMethods: ['magic-link'] }],
    ['a passkey mixed with a fixture method', { ...rootSession, authenticationMethods: ['passkey', 'e2e-fixture'] }],
    ['an unknown method', { ...rootSession, authenticationMethods: ['other'] }],
    ['empty authentication methods', { ...rootSession, authenticationMethods: [] }],
    ['a missing required session field', { ...rootSession, authenticatedAt: undefined }],
    ['an invalid authentication timestamp', { ...rootSession, authenticatedAt: 'yesterday' }],
    ['unknown schema fields', { ...rootSession, privateSession: 'private-cookie-value' }],
    ['a non-object session', null],
  ])('leaves no browser state for %s', async (_label, session) => {
    body = session;
    await expectRejectedWithoutState();
  });

  test.each([401, 403, 500, 204])('leaves no state after HTTP %i', async code => {
    status = code;
    await expectRejectedWithoutState();
  });

  test.each([301, 302, 307, 308])('refuses HTTP %i without following the redirect', async code => {
    status = code;
    await expectRejectedWithoutState();
    expect(redirectedRequests).toEqual([]);
  });

  test('does not expose malformed response contents in errors or write state', async () => {
    invalidJson = true;
    await expect(publish()).rejects.not.toThrow('private-cookie-value');
    expect(await readdir(directory)).toEqual([]);
  });

  test('leaves no state after transport disconnect', async () => {
    disconnect = true;
    await expectRejectedWithoutState();
  });

  test('leaves no state after browser serialization fails and redacts its error', async () => {
    storageFailure = true;
    await expect(publish()).rejects.not.toThrow('private-cookie-value');
    expect(await readdir(directory)).toEqual([]);
  });

  // Real browser, navigation, CDP and owned cleanup; abort before a missing root UI.
  // Without pre-operation progress the old helper exposes no stage before cancellation.
  test('reports closed passkey substeps before a blocked real UI without reflecting private inputs', async () => {
    const controller = new AbortController();
    const owner = createLocalStackOwner();
    const labels: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const diagnosticOwner = { own: owner.own, phase(value: string) {
      labels.push(value); owner.phase(value);
      if (value === 'passkey-root-activation') controller.abort(new Error('PRIVATE_ABORT_COOKIE'));
    } };
    // Bound the absent-progress RED after actual navigation, not browser launch speed.
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const afterNavigation = () => { fallback = setTimeout(() => controller.abort(), 1_000); };
    server.once('request', afterNavigation);
    try {
      const outcome = await bootstrapLocalRootPasskey({ operatorOrigin: origin,
        expectedRootUserId: 'PRIVATE_ROOT_ID', storageStatePath: output,
        activationGrant: 'PRIVATE_ACTIVATION_GRANT', signal: controller.signal,
        owner: diagnosticOwner }).catch(error => error);
      expect(labels).toEqual(['passkey-browser-launch', 'passkey-context-init', 'passkey-page-init',
        'passkey-webauthn', 'passkey-page-navigation', 'passkey-root-activation',
        'passkey-context-close', 'passkey-browser-close']);
      expect(String(outcome)).toContain('Local root passkey bootstrap failed');
      expect(await readdir(directory)).toEqual([]);
      const diagnostics = log.mock.calls.flat().join('\n');
      expect(diagnostics).toContain('phase=passkey-root-activation');
      expect(diagnostics).not.toMatch(/PRIVATE|127\.0\.0\.1|root\.json|private-cookie-value/iu);
      expect(String(outcome)).not.toMatch(/PRIVATE|127\.0\.0\.1|root\.json/iu);
    } finally {
      clearTimeout(fallback); server.off('request', afterNavigation);
      await owner.stop(); log.mockRestore();
    }
  });

  // Substitute only close/launch boundaries around real Browser and Context objects.
  // Nested failure must not prevent the enclosing browser from being disposed.
  test.each(['failure', 'deadline'] as const)('closes the real enclosing browser after nested context cleanup %s', async mode => {
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    const owner = createLocalStackOwner();
    const controller = new AbortController();
    let release!: () => void;
    const blockedClose = new Promise<void>(done => { release = done; });
    let entered!: () => void;
    const rootUi = new Promise<void>(done => { entered = done; });
    let browserCloseAttempted = false;
    const wrapped = new Proxy(browser, { get(target, name) {
      if (name === 'close') return async () => { browserCloseAttempted = true; await target.close(); };
      if (name === 'newContext') return async (options: Parameters<typeof browser.newContext>[0]) => {
        const context = await target.newContext(options);
        return new Proxy(context, { get(inner, key) {
          if (key !== 'close') return Reflect.get(inner, key);
          return async () => {
            if (mode === 'deadline') await blockedClose;
            await inner.close();
            if (mode === 'failure') throw new Error('PRIVATE_CONTEXT_COOKIE');
          };
        } });
      };
      return Reflect.get(target, name);
    } });
    const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(wrapped);
    const diagnosticOwner = { own: owner.own, phase(value: string) {
      owner.phase(value);
      if (value === 'passkey-root-activation') {
        if (mode === 'deadline') vi.useFakeTimers();
        controller.abort(new Error('PRIVATE_ABORT_GRANT')); entered();
      }
    } };
    const outcome = bootstrapLocalRootPasskey({ operatorOrigin: origin,
      expectedRootUserId: rootSession.userId, storageStatePath: output,
      activationGrant: 'PRIVATE_ACTIVATION_GRANT', signal: controller.signal,
      owner: diagnosticOwner }).catch(error => error);
    try {
      await rootUi;
      if (mode === 'deadline') {
        await eventLoopTurn();
        await vi.advanceTimersByTimeAsync(10_001);
      }
      const error = await outcome;
      vi.useRealTimers();
      expect(String(error)).toContain('Local root passkey bootstrap failed');
      expect(String(error)).not.toContain('PRIVATE');
      expect(browserCloseAttempted).toBe(true);
      await browser.close();
      expect(browser.isConnected()).toBe(false);
      expect(await readdir(directory)).toEqual([]);
      const cleanup = await owner.stop().catch(error => error);
      expect(String(cleanup)).toContain('cleanup incomplete');
      expect(String(cleanup)).not.toContain('PRIVATE');
    } finally {
      vi.useRealTimers(); release(); launch.mockRestore(); await browser.close();
      await outcome; await owner.stop().catch(() => {});
    }
  });

  // Accepting a foreign or noncanonical origin would allow this helper to become a cloud login seam.
  test.each([
    'https://operator.staging.wastd.dev', 'https://localhost:4000',
    'http://foreign.example:4000', 'http://localhost', 'http://localhost:0',
    'http://localhost:80', 'http://localhost:65536', 'http://127.1:4000',
    'http://user:password@localhost:4000', 'http://localhost:4000/',
    'http://localhost:4000?query=secret', 'http://localhost:4000#fragment',
  ])('refuses non-local/noncanonical origin %s before state publication', async operatorOrigin => {
    await expectRejectedWithoutState({ operatorOrigin });
  });

  test('refuses an absent independently expected user ID', async () => {
    await expectRejectedWithoutState({ expectedRootUserId: '' });
  });

  test('publishes the actual browser snapshot as a complete private file', async () => {
    const result = await publish();
    expect(result).toBe(output);
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual(snapshot);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['root.json']);
  });

  // Break caught: ignoring abort publishes a privileged session after its owner has cancelled.
  test('refuses an already cancelled publication without any artifact or private error', async () => {
    const controller = new AbortController();
    controller.abort(new Error('PRIVATE_ACTIVATION_GRANT'));
    const outcome = await publish({ signal: controller.signal }).catch(error => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(String(outcome)).not.toContain('PRIVATE_ACTIVATION_GRANT');
    expect(await readdir(directory)).toEqual([]);
  });

  test('does not publish when cancellation occurs during snapshot acquisition', async () => {
    const controller = new AbortController();
    const outcome = await saveLocalPasskeyRootState({ request: api, storageState: async () => {
      controller.abort();
      return snapshot;
    } }, { operatorOrigin: origin, expectedRootUserId: rootSession.userId,
      storageStatePath: output, signal: controller.signal }).catch(error => error);
    expect(outcome).toBeInstanceOf(Error);
    expect(await readdir(directory)).toEqual([]);
  });

  // Overwriting or unlinking existing destinations must fail these preservation assertions.
  test('preserves an unrelated existing output and removes only its unpublished temporary file', async () => {
    await writeFile(output, 'unrelated owner content', { mode: 0o600 });
    await expect(publish()).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('unrelated owner content');
    expect(await readdir(directory)).toEqual(['root.json']);
  });

  test('preserves a symlink destination and its unrelated target', async () => {
    const target = join(directory, 'owner.json');
    await writeFile(target, 'unrelated owner content', { mode: 0o600 });
    await symlink(target, output);
    await expect(publish()).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('unrelated owner content');
    expect((await readdir(directory)).sort()).toEqual(['owner.json', 'root.json']);
  });

  test('preserves a directory destination', async () => {
    await mkdir(output);
    await writeFile(join(output, 'owner.txt'), 'unrelated owner content');
    await expect(publish()).rejects.toThrow();
    expect(await readFile(join(output, 'owner.txt'), 'utf8')).toBe('unrelated owner content');
    expect(await readdir(directory)).toEqual(['root.json']);
  });

  test('leaves no partial artifact when the destination parent is absent', async () => {
    await expect(publish({ storageStatePath: join(directory, 'absent', 'root.json') })).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});

describe('owned passkey browser cancellation', () => {
  test('still attempts real browser close when a nested cleanup hook never settles', async () => {
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    const owner = createLocalStackOwner();
    const controller = new AbortController();
    let entered!: () => void;
    const using = new Promise<void>(done => { entered = done; });
    let browserCloseAttempted = false;
    const wrapped = new Proxy(browser, { get(target, name) {
      return name === 'close' ? async () => { browserCloseAttempted = true; await target.close(); }
        : Reflect.get(target, name);
    } });
    const outcome = withLocalPasskeyBrowser(async () => wrapped, async () => {
      entered(); await new Promise(() => {});
    }, controller.signal, owner, () => new Promise(() => {})).catch(error => error);
    try {
      await using; vi.useFakeTimers(); controller.abort(new Error('PRIVATE_ABORT_COOKIE'));
      await eventLoopTurn(); await vi.advanceTimersByTimeAsync(10_001);
      const error = await outcome;
      expect(String(error)).toMatch(/cancelled.*cleanup incomplete/iu);
      expect(String(error)).not.toContain('PRIVATE');
      expect(browserCloseAttempted).toBe(true);
      vi.useRealTimers(); await browser.close();
      expect(browser.isConnected()).toBe(false);
      const cleanup = await owner.stop().catch(error => error);
      expect(String(cleanup)).toMatch(/cleanup incomplete/iu);
    } finally { vi.useRealTimers(); await browser.close(); await outcome; await owner.stop().catch(() => {}); }
  });

  test('bounds pending browser acquisition and reports incompleteness to caller and owner', async () => {
    const realNow = Date.now.bind(Date);
    const began = realNow();
    const step = (value: 'browser-launch' | 'launch-gated' | 'disposal-registered' | 'caller-settled'
      | 'owner-stop' | 'owner-stopped' | 'browser-close' | 'browser-closed') =>
      console.log(`local-passkey-unit step=${value}; elapsed_ms=${
        Math.max(0, Math.min(3_600_000, realNow() - began))}`);
    step('browser-launch');
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    const owner = createLocalStackOwner();
    const controller = new AbortController();
    let release!: () => void;
    const late = new Promise<void>(done => { release = done; });
    let started!: () => void;
    const launching = new Promise<void>(done => { started = done; });
    const outcome = withLocalPasskeyBrowser(async () => { started(); await late; return browser; },
      async () => { throw new Error('must not enter bootstrap'); }, controller.signal, owner).catch(error => error);
    try {
      await launching;
      step('launch-gated');
      vi.useFakeTimers(); controller.abort(new Error('PRIVATE_GRANT'));
      // Abort resumes the async helper before its cleanup deadline is installed.
      // Flush that continuation using a real turn before advancing the fake clock.
      await eventLoopTurn();
      expect(vi.getTimerCount()).toBe(1);
      step('disposal-registered');
      await vi.advanceTimersByTimeAsync(10_001);
      const error = await outcome;
      step('caller-settled');
      expect(String(error)).toMatch(/cancelled.*cleanup incomplete/iu);
      expect(String(error)).not.toContain('PRIVATE_GRANT');
      step('owner-stop');
      const cleanup = await owner.stop().catch(error => error);
      step('owner-stopped');
      expect(String(cleanup)).toMatch(/cleanup incomplete/iu);
    } finally {
      vi.useRealTimers(); release(); step('browser-close'); await browser.close();
      step('browser-closed'); await outcome;
      await owner.stop().catch(() => {});
    }
  });

  test('reports failed cleanup of a real browser acquired after cancellation', async () => {
    const owner = createLocalStackOwner();
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    let release!: () => void;
    const late = new Promise<void>(done => { release = done; });
    let started!: () => void;
    const launching = new Promise<void>(done => { started = done; });
    const wrapped = new Proxy(browser, { get(target, name) {
      return name === 'close' ? async () => { await target.close(); throw new Error('PRIVATE_COOKIE'); }
        : Reflect.get(target, name);
    } });
    const controller = new AbortController();
    let entered = false;
    const outcome = withLocalPasskeyBrowser(async () => { started(); await late; return wrapped; },
      async () => { entered = true; }, controller.signal, owner).catch(error => error);
    try {
      await launching;
      controller.abort();
      await delay(20); release();
      const error = await outcome;
      expect(String(error)).toMatch(/cancelled.*cleanup/iu);
      expect(String(error)).not.toContain('PRIVATE_COOKIE');
      expect(entered).toBe(false);
      const cleanup = await owner.stop().catch(error => error);
      expect(String(cleanup)).toMatch(/cleanup incomplete/iu);
      expect(String(cleanup)).not.toContain('PRIVATE_COOKIE');
      for (let attempt = 0; attempt < 100 && browser.isConnected(); attempt++) await delay(10);
      expect(browser.isConnected()).toBe(false);
    } finally { release(); await browser.close(); await outcome; await owner.stop().catch(() => {}); }
  });

  test('bounds a blocked real-browser close and reports cancellation plus cleanup failure privately', async () => {
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    let release!: () => void;
    const blocked = new Promise<void>(done => { release = done; });
    const wrapped = new Proxy(browser, { get(target, name) {
      return name === 'close' ? async () => { await blocked; await target.close(); }
        : Reflect.get(target, name);
    } });
    const controller = new AbortController();
    let entered!: () => void;
    const using = new Promise<void>(done => { entered = done; });
    let settled = false;
    const outcome = withLocalPasskeyBrowser(async () => wrapped, async () => {
      entered(); await new Promise(() => {});
    }, controller.signal).catch(error => { settled = true; return error; });
    try {
      await using;
      vi.useFakeTimers();
      controller.abort(new Error('PRIVATE_COOKIE'));
      await vi.advanceTimersByTimeAsync(10_001);
      expect(settled).toBe(true);
      const error = await outcome;
      expect(String(error)).toMatch(/cancelled.*cleanup/iu);
      expect(String(error)).not.toContain('PRIVATE_COOKIE');
    } finally {
      vi.useRealTimers(); release(); await browser.close(); await outcome;
    }
  });
  test('closes late context initialization without entering bootstrap or closing a foreign browser', async () => {
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    const context = await browser.newContext();
    const page = await context.newPage();
    const controller = new AbortController();
    let release!: () => void;
    const late = new Promise<void>(done => { release = done; });
    let started!: () => void;
    const initializing = new Promise<void>(done => { started = done; });
    let entered = false;
    const outcome = withLocalPasskeyContext(async () => { started(); await late; return context; },
      async () => { entered = true; }, controller.signal).catch(error => error);
    try {
      await initializing;
      controller.abort(new Error('PRIVATE_SESSION'));
      release();
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('PRIVATE_SESSION');
      for (let attempt = 0; attempt < 100 && !page.isClosed(); attempt++) await delay(10);
      expect(page.isClosed()).toBe(true);
      expect(entered).toBe(false);
      expect(browser.isConnected()).toBe(true);
    } finally { release(); await browser.close(); }
  });
  // Real Chromium is the resource; only a delayed dependency boundary is controlled.
  test('closes a browser that fulfills after cancellation without running bootstrap', async () => {
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    const controller = new AbortController();
    let release!: () => void;
    const late = new Promise<void>(done => { release = done; });
    let started!: () => void;
    const launching = new Promise<void>(done => { started = done; });
    let entered = false;
    const outcome = withLocalPasskeyBrowser(async () => { started(); await late; return browser; },
      async () => { entered = true; }, controller.signal).catch(error => error);
    try {
      await launching;
      controller.abort(new Error('PRIVATE_GRANT'));
      release();
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain('PRIVATE_GRANT');
      expect(entered).toBe(false);
      for (let attempt = 0; attempt < 100 && browser.isConnected(); attempt++) await delay(10);
      expect(browser.isConnected()).toBe(false);
    } finally { release(); await browser.close(); }
  });

  test('closes initialized contexts when cancellation interrupts a blocked browser operation', async () => {
    const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'chrome' });
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>(done => { entered = done; });
    let page: Awaited<ReturnType<Awaited<ReturnType<typeof browser.newContext>>['newPage']>> | undefined;
    const outcome = withLocalPasskeyBrowser(async () => browser, async owned => {
      const context = await owned.newContext();
      page = await context.newPage();
      entered();
      await page.waitForFunction(() => false, undefined, { timeout: 2_000 });
    }, controller.signal).catch(error => error);
    try {
      await ready;
      controller.abort();
      expect(await Promise.race([outcome.then(() => true), delay(1_000).then(() => false)]))
        .toBe(true);
      expect(browser.isConnected()).toBe(false);
      expect(page!.isClosed()).toBe(true);
    } finally { await browser.close(); }
  });
});

describe('independently expected bootstrap identity', () => {
  const valid = { userId: 'issued-root', status: 'pending', activationGrant: 'private-activation-grant',
    expiresAt: 1_791_460_000_000 };

  test('retains the actual CLI-issued ID and grant together', () => {
    expect(parseLocalRootBootstrapResult(JSON.stringify(valid))).toEqual(valid);
  });

  test.each([
    null, [], { ...valid, userId: undefined }, { ...valid, userId: '' },
    { ...valid, userId: 7 }, { ...valid, status: 'active' },
    { ...valid, activationGrant: undefined }, { ...valid, activationGrant: '' },
    { ...valid, expiresAt: undefined }, { ...valid, expiresAt: -1 },
    { ...valid, expiresAt: 1.5 },
  ])('refuses malformed CLI results without exposing private fields', value => {
    expect(() => parseLocalRootBootstrapResult(JSON.stringify(value))).toThrow();
    expect(() => parseLocalRootBootstrapResult(JSON.stringify(value)))
      .not.toThrow('private-activation-grant');
  });

  test('redacts malformed raw CLI output', () => {
    expect(() => parseLocalRootBootstrapResult('private-activation-grant invalid json')).toThrow();
    expect(() => parseLocalRootBootstrapResult('private-activation-grant invalid json'))
      .not.toThrow('private-activation-grant');
  });
});
