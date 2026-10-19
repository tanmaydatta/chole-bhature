import { afterEach, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { E2eControlAccount } from '@incentives/contracts';
import { publishMemberState } from '../../src/member-state.js';
const directories: string[] = [], stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0))
  await stop(); for (const d of directories.splice(0))
  await rm(d, { recursive: true, force: true }); });
async function fixture(platformRole?: 'root') {
  const permissions = ['members:read', 'members:manage', 'schemas:read', 'schemas:manage', 'schemas:publish', 'customers:read', 'customers:manage',
    'programs:read', 'programs:manage', 'programs:publish', 'evaluations:run', 'redemptions:commit', 'credentials:read', 'credentials:manage', 'audit:read'];
  let gets = 0;
  const server = createServer((req, res) => {
    gets++;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/operator/v1/session')
      res.end(JSON.stringify({ userId: 'user-1', authenticationMethods: ['e2e-fixture'], authenticatedAt: '2026-10-16T00:00:00.000Z',
        organizationId: 'org-1', merchantId: 'merchant-1', membershipId: 'member-1', permissions, merchantSelectionRequired: false,
        display: { user: { name: 'Fixture Admin', email: 'fixture@e2e.invalid' }, role: platformRole ?? 'admin',
          client: { merchantId: 'merchant-1', organizationId: 'org-1', name: 'Fixture Client' } }, ...(platformRole ? { platformRole } : {}) }));
    else if (req.url === '/operator/v1/team')
      res.end(JSON.stringify({ members: [{ id: 'member-1', organizationId: 'org-1', userId: 'user-1', role: 'admin', status: 'active', email: 'fixture@e2e.invalid' }], invitations: [] }));
    else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  stops.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const directory = await mkdtemp(join(tmpdir(), 'preauth-member-test-'));
  directories.push(directory);
  await chmod(directory, 0o700);
  const account: E2eControlAccount = { runId: 'e2e_aaaaaaaaaaaaaaaaaaaaaaaa', merchantId: 'merchant-1', organizationId: 'org-1', userId: 'user-1', membershipId: 'member-1',
    email: 'fixture@e2e.invalid', role: 'admin', sessionId: 'sid-1', cookieHeader: 'signed=fixture', cookieAttributes: { name: 'signed', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expiresAt: Date.now() + 600000 } };
  return { target: { kind: 'local' as const, operatorOrigin: origin, apiOrigin: origin }, directory, account, gets: () => gets };
}
test('verifies real member identity/permissions before exclusive private state publication', async () => {
  const { target, directory, account, gets } = await fixture(), path = join(directory, 'member.json');
  expect(await publishMemberState(target, account, path)).toBe(path);
  expect(gets()).toBeGreaterThanOrEqual(2);
  const state = JSON.parse(await readFile(path, 'utf8'));
  expect(state.cookies).toEqual([{ name: 'signed', value: 'fixture', domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: Math.floor(account.cookieAttributes.expiresAt / 1000) }]);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const before = await readFile(path, 'utf8');
  await expect(publishMemberState(target, account, path)).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe(before);
});
test.each(['root', 'foreign merchant', 'expired', 'cookie attributes'])('refuses %s without publishing state', async (mode) => {
  const { target, directory, account } = await fixture(mode === 'root' ? 'root' : undefined), path = join(directory, 'member.json');
  if (mode === 'foreign merchant')
    account.merchantId = 'foreign';
  if (mode === 'expired')
    account.cookieAttributes.expiresAt = 0;
  if (mode === 'cookie attributes')
    account.cookieAttributes.secure = true;
  await expect(publishMemberState(target, account, path)).rejects.toThrow();
  await expect(access(path)).rejects.toThrow();
});
