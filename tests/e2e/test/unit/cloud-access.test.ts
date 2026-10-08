import { request } from '@playwright/test';
import { localTransport } from '../support/cloud-access-transport.js';
import { describe, expect, test, vi } from 'vitest';
import { createCloudAccessPolicy, openCloudAccessRequestContext } from '../../src/cloud-access.js';

const api = 'https://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev';
const operator = 'https://cb-e2e-1dcb45133da23b01d244-operator.fixture.workers.dev';
const key = { repository_id: 42, repository: 'owner/repo', pr: 17,
  head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', run_id: 900, attempt: 1 };
function inputs(): [
  { stackKey: typeof key; apiOrigin: string; operatorOrigin: string },
  { currentRun: typeof key; workersSubdomain: string },
  { clientId: string; clientSecret: string },
] {
  return [{ stackKey: { ...key }, apiOrigin: api, operatorOrigin: operator },
    { currentRun: { ...key }, workersSubdomain: 'fixture' },
    { clientId: 'fixture-client', clientSecret: 'fixture-secret' }];
}

describe('Access credential dispatch policy', () => {
  test('adds Access only at each exact API and Operator origin', () => {
    const policy = createCloudAccessPolicy(...inputs());
    for (const origin of [api, operator]) {
      expect(policy.headersFor(`${origin}/asset.js?x=1`, { accept: 'application/json' }))
        .toEqual({ accept: 'application/json', 'CF-Access-Client-Id': 'fixture-client',
          'CF-Access-Client-Secret': 'fixture-secret' });
    }
  });

  test.each([
    'https://cb-e2e-1dcb45133da23b01d244-identity.fixture.workers.dev/',
    'https://cb-e2e-00000000000000000000-api.fixture.workers.dev/',
    'https://preview.cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev/',
    'https://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev.evil.example/',
    'https://api.staging.wastd.dev/', 'http://localhost:8787/',
    'http://cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev/',
    `${api}:8443/`, 'https://foreign.example/',
  ])('never adds Access to foreign URL %s', url => {
    expect(createCloudAccessPolicy(...inputs()).headersFor(url, { accept: 'text/plain' }))
      .toEqual({ accept: 'text/plain' });
  });

  test.each(['', '/path', '//foreign.example/', 'file:///tmp/file',
    `${api}/#fragment`, `${api}/\n`, ` ${api}/`,
    'https://user:pass@cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev/',
    `${api}:443/`, 'https://CB-E2E-1dcb45133da23b01d244-api.fixture.workers.dev/',
  ])('refuses malformed or ambiguous request URL %s', url => {
    expect(() => createCloudAccessPolicy(...inputs()).headersFor(url)).toThrow(/Access/u);
  });

  test.each(['CF-Access-Client-Id', 'cf-access-client-secret', 'Cf-AcCeSs-ClIeNt-Id'])
    ('refuses pre-existing Access header %s at protected and foreign origins', name => {
      const policy = createCloudAccessPolicy(...inputs());
      for (const url of [`${api}/`, 'https://foreign.example/']) {
        expect(() => policy.headersFor(url, { [name]: 'untrusted-secret' })).toThrow(/Access/u);
      }
    });

  test.each([['accept\r\n', 'ok'], ['accept', 'bad\r\nvalue'], ['accept', 123]])
    ('refuses malformed request headers', (name, value) => {
      expect(() => createCloudAccessPolicy(...inputs()).headersFor(`${api}/`, { [name]: value }))
        .toThrow(/Access/u);
    });

  test.each([null, {}, { clientId: '', clientSecret: 'fixture-secret' },
    { clientId: 'fixture-client', clientSecret: '' },
    { clientId: 'fixture-client', clientSecret: 'fixture-secret\r\nX: leak' },
    { clientId: ' fixture-client', clientSecret: 'fixture-secret' },
    { clientId: 'fixture-client', clientSecret: 'fixture-secret', extra: true },
  ])('refuses malformed credentials without including values in errors', credential => {
    const [candidate, expectation] = inputs();
    let caught: unknown;
    try { createCloudAccessPolicy(candidate, expectation, credential); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('fixture-secret');
    expect(String(caught)).not.toContain('fixture-client');
  });

  test('snapshots candidate and credential against later caller mutation', () => {
    const [candidate, expectation, credential] = inputs();
    const policy = createCloudAccessPolicy(candidate, expectation, credential);
    candidate.apiOrigin = 'https://foreign.example';
    candidate.stackKey.attempt = 2;
    credential.clientSecret = 'replacement-secret';
    const headers = policy.headersFor(`${api}/`);
    headers['CF-Access-Client-Secret'] = 'modified-return';
    expect(policy.headersFor(`${api}/`)['CF-Access-Client-Secret']).toBe('fixture-secret');
    expect(policy.headersFor('https://foreign.example/')).toEqual({});
  });

  test('refuses credential/header getters without invoking them', () => {
    let reads = 0;
    const [candidate, expectation, credential] = inputs();
    Object.defineProperty(credential, 'clientSecret', { enumerable: true,
      get() { reads++; return 'fixture-secret'; } });
    expect(() => createCloudAccessPolicy(candidate, expectation, credential)).toThrow(/Access/u);
    const policy = createCloudAccessPolicy(...inputs());
    const headers = Object.defineProperty({}, 'accept', { enumerable: true,
      get() { reads++; return 'application/json'; } });
    expect(() => policy.headersFor(`${api}/`, headers)).toThrow(/Access/u);
    expect(reads).toBe(0);
  });

  test('refuses spoofed Host before Access headers can reach a foreign virtual host', () => {
    expect(() => createCloudAccessPolicy(...inputs()).headersFor(`${api}/`, { Host: 'foreign.example' }))
      .toThrow(/Access/u);
  });

  test('sanitizes credential and header Proxy reflection failures', () => {
    const fail = () => { throw new Error('fixture-secret-from-proxy'); };
    const [candidate, expectation] = inputs();
    const credential = new Proxy({}, { getPrototypeOf: fail });
    let credentialError: unknown;
    try { createCloudAccessPolicy(candidate, expectation, credential); } catch (error) { credentialError = error; }
    expect(String(credentialError)).not.toContain('fixture-secret');
    const policy = createCloudAccessPolicy(...inputs());
    let headerError: unknown;
    try { policy.headersFor(`${api}/`, new Proxy({}, { ownKeys: fail })); } catch (error) { headerError = error; }
    expect(String(headerError)).not.toContain('fixture-secret');
    expect(credentialError).toBeInstanceOf(Error);
    expect(headerError).toBeInstanceOf(Error);
  });
});

describe('real controlled local Access HTTP transport', () => {
  test('API context scopes headers, refuses collisions/redirects and closes dispatch lifetime', async () => {
    const fixture = await localTransport();
    const original = request.newContext.bind(request);
    const [candidate, expectation, credential] = inputs();
    const spy = vi.spyOn(request, 'newContext').mockImplementation(options => {
      credential.clientSecret = 'mutation-during-context-creation';
      candidate.apiOrigin = 'https://foreign.example';
      return original({ ...options, ...fixture.transport });
    });
    try {
      const context = await openCloudAccessRequestContext(candidate, expectation, credential);
      try {
        credential.clientSecret = 'later-mutation';
        await (await context.fetch(`${api}/protected`)).dispose();
        expect(fixture.receipts).toEqual([
          { host: 'cb-e2e-1dcb45133da23b01d244-api.fixture.workers.dev', path: '/protected',
            id: 'fixture-client', secret: 'fixture-secret' },
        ]);
        const count = fixture.receipts.length;
        await expect(context.fetch(`${api}/collision`, { headers: { 'cf-access-client-id': 'bad' } }))
          .rejects.toThrow(/Access/u);
        await expect(context.fetch(`${api}/override`, { maxRedirects: 10 } as never))
          .rejects.toThrow(/Access/u);
        await expect(context.fetch(`${api}/malformed`, { headers: { accept: 'bad\r\nvalue' } }))
          .rejects.toThrow(/Access/u);
        expect(fixture.receipts).toHaveLength(count);
        for (const path of ['/redirect-foreign', '/redirect-same']) {
          await expect(context.fetch(`${operator}${path}`)).rejects.toThrow(/redirect/u);
        }
        expect(fixture.receipts.filter(item => item.path === '/destination')).toEqual([]);
        await context.dispose();
        const finalCount = fixture.receipts.length;
        await expect(context.fetch(`${api}/after-close`)).rejects.toThrow();
        expect(fixture.receipts).toHaveLength(finalCount);
      } finally { await context.dispose(); }
    } finally { spy.mockRestore(); await fixture.close(); }
  });

  test('owned API refuses foreign URLs, spoofed Host and reflection failures before receiver dispatch', async () => {
    const fixture = await localTransport();
    const original = request.newContext.bind(request);
    const spy = vi.spyOn(request, 'newContext').mockImplementation(options =>
      original({ ...options, ...fixture.transport }));
    try {
      const context = await openCloudAccessRequestContext(...inputs());
      try {
        const attempts: [string, unknown][] = [
          ['https://foreign.example/sensitive', { headers: { authorization: 'Bearer private', cookie: 'private' }, data: { private: true }, method: 'POST' }],
          [`${api}/spoof`, { headers: { Host: 'foreign.example' } }],
          [`${api}/proxy`, new Proxy({}, { ownKeys() { throw new Error('fixture-secret-from-proxy'); } })],
        ];
        const errors: string[] = [];
        for (const [url, options] of attempts) {
          try { const response = await context.fetch(url, options as never); await response.dispose(); }
          catch (error) { errors.push(String(error)); }
        }
        expect(fixture.receipts).toEqual([]);
        expect(errors).toHaveLength(3);
        expect(errors.join(' ')).not.toContain('fixture-secret');
      } finally { await context.dispose(); }
    } finally { spy.mockRestore(); await fixture.close(); }
  });
});
