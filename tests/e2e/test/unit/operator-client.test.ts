import { createServer } from 'node:http';
import { describe, expect, test } from 'vitest';
import { request } from '@playwright/test';

import { OperatorClient, requireOperatorStorageState } from '../../src/operator-client.js';

describe('operator authentication boundary', () => {
  test('rejects a missing session file before any API call', () => {
    expect(() => requireOperatorStorageState({})).toThrow(/E2E_OPERATOR_STORAGE_STATE/u);
  });

  test('rejects a non-root session and never attempts provisioning', async () => {
    const paths: string[] = [];
    const server = createServer((incoming, outgoing) => {
      paths.push(incoming.url ?? '');
      outgoing.setHeader('content-type', 'application/json');
      outgoing.end(JSON.stringify({ userId: 'member', permissions: [], merchantSelectionRequired: false }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const socket = server.address();
      if (!socket || typeof socket === 'string') throw new Error('Expected TCP address');
      const context = await request.newContext({ baseURL: `http://127.0.0.1:${socket.port}` });
      try {
        await expect(new OperatorClient(context, `http://127.0.0.1:${socket.port}`)
          .requireRoot()).rejects.toThrow(/root/u);
        expect(paths).toEqual(['/operator/v1/session']);
      } finally {
        await context.dispose();
      }
    } finally {
      server.close();
    }
  });
});
