import { afterEach, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, chmod, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlClient, createControlRecord, type LocalControlTarget } from '../../src/control-client.js';
const directories: string[] = [], stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0))
  await stop(); for (const d of directories.splice(0))
  await rm(d, { recursive: true, force: true }); });
async function fixture(handle: (body: Record<string, unknown>, headers: import('node:http').IncomingHttpHeaders) => {
  status?: number;
  body: unknown;
  location?: string;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'preauth-control-test-'));
  directories.push(directory);
  await chmod(directory, 0o700);
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req)
      body += String(chunk);
    const result = handle(JSON.parse(body), req.headers);
    res.writeHead(result.status ?? 200, { 'content-type': 'application/json', ...(result.location ? { location: result.location } : {}) });
    res.end(JSON.stringify(result.body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  stops.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const target: LocalControlTarget = { operatorOrigin: `http://127.0.0.1:${port}`, apiOrigin: 'http://127.0.0.1:8787', generation: 'a'.repeat(40), targetId: 'b'.repeat(64), setupSecret: 'private-setup-only' };
  return { directory, target };
}
test('durably stores independent run capabilities before any dispatch and never stores setup authority', async () => {
  const { directory, target } = await fixture(() => ({ body: {} })), path = join(directory, 'control.json');
  await createControlRecord(path, target);
  const text = await readFile(path, 'utf8'), record = JSON.parse(text);
  expect(record.operation).toBe('bootstrap');
  expect(record.runId).toMatch(/^e2e_[a-f0-9]{24}$/u);
  expect(record.proof).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(record.controllerToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(record.proof).not.toBe(record.controllerToken);
  expect(text).not.toContain(target.setupSecret);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  await expect(createControlRecord(path, target)).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe(text);
});
test('validates live v2 capabilities through the fixed non-browser setup surface', async () => {
  let browserHeaders: string[] = [];
  const { target } = await fixture((body, headers) => {
    browserHeaders = Object.keys(headers).filter(name => ['cookie', 'origin', 'referer'].includes(name) || name.startsWith('sec-fetch-') || name.startsWith('sec-ch-'));
    expect(body.operation).toBe('capabilities');
    expect(headers.authorization).toBe('E2E-Setup private-setup-only');
    expect(headers.cookie).toBeUndefined();
    expect(headers.origin).toBeUndefined();
    return { body: { protocol: 'incentives-e2e-control', version: 2, runtime: { environment: 'local', generation: 'a'.repeat(40), targetId: 'b'.repeat(64) }, operator: 2, identity: 2, product: 2,
        migrations: { auth: ['0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql', '0007_e2e_control_leases.sql'], product: ['0008_e2e_tenant_lifecycle.sql', '0009_e2e_control_leases.sql'] }, fencing: true, recovery: true } };
  });
  expect((await new ControlClient(target).capabilities()).version).toBe(2);
  expect(browserHeaders).toEqual([]);
});
test('refuses redirects without forwarding credentials to their destination', async () => {
  let dispatches = 0;
  const { target } = await fixture(() => { dispatches++; return { status: 302, location: 'http://127.0.0.1:1/secret', body: { private: 'RAW_PRIVATE_PAYLOAD' } }; });
  await expect(new ControlClient(target).capabilities()).rejects.toThrow(/control.*refused/iu);
  expect(dispatches).toBe(1);
});
test.each(['https://operator.staging.wastd.dev', 'http://user:password@127.0.0.1:8787', 'http://127.0.0.1:8787/path'])('refuses ambiguous/nonlocal target %s', async (operatorOrigin) => {
  const target = { operatorOrigin, apiOrigin: 'http://127.0.0.1:8787', generation: 'a'.repeat(40), targetId: 'b'.repeat(64), setupSecret: 'private' };
  expect(() => new ControlClient(target)).toThrow(/control.*refused/iu);
});
test('does not bootstrap a missing or changed durable record', async () => {
  let writes = 0;
  const { directory, target } = await fixture(() => { writes++; return { body: {} }; }), path = join(directory, 'control.json');
  await expect(new ControlClient(target).bootstrap(path)).rejects.toThrow();
  await writeFile(path, JSON.stringify({ operation: 'bootstrap', proof: 'PRIVATE_RAW' }), { mode: 0o600 });
  await expect(new ControlClient(target).bootstrap(path)).rejects.toThrow();
  expect(writes).toBe(0);
});
test.each(['empty', 'truncated'])('refuses %s cleanup inventory rather than treating it as zero rows', async (mode) => {
  const { directory, target } = await fixture(body => ({ body: { lease: { runId: body.runId, merchantId: '11111111-1111-4111-8111-111111111111',
        provisioningId: '22222222-2222-4222-8222-222222222222', generation: 'a'.repeat(40), targetId: 'b'.repeat(64), issuedAt: 0, expiresAt: 900000, phase: 'disposed' },
      auth: mode === 'empty' ? {} : { users: 0 }, product: mode === 'empty' ? {} : { merchants: 0 } } }));
  const path = await createControlRecord(join(directory, 'control.json'), target);
  await expect(new ControlClient(target).action(path, 'dispose')).rejects.toThrow(/control.*refused/iu);
});
