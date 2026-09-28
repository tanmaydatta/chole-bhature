import { createServer } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';

import { verifyFixtureMemberSession } from '../../src/operator-client.js';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
});

async function origin(role: 'viewer' | 'admin') {
  const server = createServer((request, response) => {
    expect(request.headers.cookie).toBe('signed=fixture');
    if (request.url === '/operator/v1/session') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ userId: 'user-1', authenticationMethods: ['e2e-fixture'],
        authenticatedAt: '2026-09-25T00:00:00.000Z', organizationId: 'org-1',
        merchantId: 'merchant-1', membershipId: 'member-1',
        permissions: role === 'viewer'
          ? ['schemas:read', 'programs:read', 'evaluations:run', 'audit:read']
          : ['members:read', 'members:manage', 'schemas:read', 'schemas:manage',
            'schemas:publish', 'customers:read', 'customers:manage', 'programs:read',
            'programs:manage', 'programs:publish', 'evaluations:run',
            'redemptions:commit', 'credentials:read', 'credentials:manage', 'audit:read'],
        merchantSelectionRequired: false }));
      return;
    }
    if (request.url === '/operator/v1/team') {
      if (role === 'viewer') { response.writeHead(403); response.end(); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ members: [{ id: 'member-1', organizationId: 'org-1',
        userId: 'user-1', role, status: 'active', email: 'fixture@example.test' }],
      invitations: [] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('No server address');
  return `http://127.0.0.1:${bound.port}`;
}

describe('real signed fixture-session verification', () => {
  test.each(['viewer', 'admin'] as const)('%s role checks exact session and API authorization', async role => {
    const operatorOrigin = await origin(role);
    await verifyFixtureMemberSession({ kind: 'local', operatorOrigin, apiOrigin: operatorOrigin },
      { cookieHeader: 'signed=fixture', userId: 'user-1', membershipId: 'member-1',
        merchantId: 'merchant-1', role });
    await expect(verifyFixtureMemberSession({ kind: 'local', operatorOrigin,
      apiOrigin: operatorOrigin }, { cookieHeader: 'signed=fixture', userId: 'user-foreign',
      membershipId: 'member-1', merchantId: 'merchant-1', role }))
      .rejects.toThrow(/identity/u);
  });
});
