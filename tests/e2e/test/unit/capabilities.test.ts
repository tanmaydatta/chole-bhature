import { describe, expect, test } from 'vitest';

import { requireE2eCapabilities } from '../../src/operator-client.js';

const ready = {
  protocol: 'incentives-e2e', version: 1,
  operator: { version: 1 },
  identity: { version: 1, migrations: [
    '0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql',
  ] },
  product: { version: 1, migrations: ['0008_e2e_tenant_lifecycle.sql'],
    inspection: true, disposal: true },
};

describe('read-only prewrite E2E capability handshake', () => {
  test('accepts only the exact matching three-Worker and migration contract', async () => {
    await expect(requireE2eCapabilities({ request: async () => ready }))
      .resolves.toBeUndefined();
  });

  test.each([
    ['old BFF route', async () => { throw new Error('404 NOT_FOUND'); }],
    ['old Identity Worker', async () => ({ ...ready, identity: { ...ready.identity, version: 0 } })],
    ['old Core Worker', async () => ({ ...ready, product: { ...ready.product, version: 0 } })],
    ['missing Auth migration', async () => ({ ...ready, identity: {
      ...ready.identity, migrations: ['0005_e2e_tenant_lifecycle.sql'],
    } })],
    ['missing Product migration', async () => ({ ...ready, product: {
      ...ready.product, migrations: [],
    } })],
  ] as const)('fails closed on %s before any recipe write', async (_label, response) => {
    await expect(requireE2eCapabilities({ request: response }))
      .rejects.toThrow(/Product 0008.*Auth 0005.*0006.*Core.*Identity.*Operator/u);
  });
});
