import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, type APIRequestContext } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { parseLocalRootBootstrapResult, saveLocalPasskeyRootState } from '../../src/passkey-bootstrap.js';

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
