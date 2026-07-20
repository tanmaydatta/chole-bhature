import type {
  ApiCredentialScope,
  OperatorCallContext,
  PermissionKey,
} from '@incentives/contracts';
import { SELF, createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Env } from '../src/env.js';
import { CoreOperatorService } from '../src/worker.js';

const futureExpiry = '2099-01-01T00:00:00.000Z';

function operatorContext(
  merchantId: string,
  permission: PermissionKey = 'credentials:manage',
): OperatorCallContext {
  return {
    correlationId: `corr-${merchantId}-${permission}`,
    actorUserId: 'root-user',
    actorKind: 'root',
    merchantId,
    permission,
  };
}

function operatorService(): CoreOperatorService {
  return new CoreOperatorService(createExecutionContext(), env as Env);
}

async function provisionMerchant(merchantId: string) {
  return operatorService().provisionMerchant(operatorContext(merchantId), {
    id: merchantId,
    name: `Merchant ${merchantId}`,
    provisioningId: `provision-${merchantId}`,
  });
}

async function createCredential(
  merchantId: string,
  input: {
    name?: string;
    kind: 'publishable' | 'secret';
    scopes: ApiCredentialScope[];
    allowedOrigins?: string[];
    expiresAt?: string;
  },
) {
  return operatorService().createCredential(operatorContext(merchantId), {
    name: input.name ?? `${input.kind} key`,
    environment: 'production',
    kind: input.kind,
    scopes: input.scopes,
    allowedOrigins: input.allowedOrigins,
    expiresAt: input.expiresAt ?? futureExpiry,
  });
}

async function publicRequest(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return SELF.fetch(`https://core.example${path}`, { ...init, headers });
}

describe('merchant credential authentication and tenancy', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM product_audit'),
      env.DB.prepare('DELETE FROM api_credentials'),
      env.DB.prepare('DELETE FROM redemptions'),
      env.DB.prepare('DELETE FROM evaluation_decisions'),
      env.DB.prepare('DELETE FROM program_counters'),
      env.DB.prepare('DELETE FROM program_revisions'),
      env.DB.prepare('DELETE FROM programs'),
      env.DB.prepare('DELETE FROM customers'),
      env.DB.prepare('DELETE FROM schema_versions'),
      env.DB.prepare('DELETE FROM variable_definitions'),
      env.DB.prepare("DELETE FROM merchants WHERE id <> 'phase-0-merchant'"),
    ]);
  });

  test('derives request tenancy from each credential and isolates two merchants', async () => {
    await provisionMerchant('merchant-a');
    await provisionMerchant('merchant-b');
    const keyA = await createCredential('merchant-a', {
      kind: 'secret',
      scopes: ['customers:write'],
    });
    const keyB = await createCredential('merchant-b', {
      kind: 'secret',
      scopes: ['customers:write'],
    });

    const [responseA, responseB] = await Promise.all([
      publicRequest('/v1/test-secret', keyA.token),
      publicRequest('/v1/test-secret', keyB.token),
    ]);

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(await responseA.json()).toMatchObject({ merchantId: 'merchant-a' });
    expect(await responseB.json()).toMatchObject({ merchantId: 'merchant-b' });
  });

  test('does not expose an operator route or trust forged operator and merchant headers', async () => {
    await provisionMerchant('merchant-a');
    await provisionMerchant('merchant-b');
    const keyA = await createCredential('merchant-a', {
      kind: 'secret',
      scopes: ['customers:write'],
    });
    const forgedHeaders = {
      authorization: `Bearer ${keyA.token}`,
      'x-merchant-id': 'merchant-b',
      'x-operator-user-id': 'root-user',
      'x-operator-permission': 'credentials:manage',
    };

    const authenticated = await SELF.fetch('https://core.example/v1/test-secret', {
      headers: forgedHeaders,
    });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toMatchObject({ merchantId: 'merchant-a' });

    for (const path of ['/internal/merchants', '/v1/internal/credentials']) {
      const response = await SELF.fetch(`https://core.example${path}`, {
        method: 'POST',
        headers: forgedHeaders,
      });
      expect(response.status).toBe(404);
    }

    const staticFallback = await publicRequest('/v1/test-secret', 'sk_test_secret_credential_material_000000000001');
    expect(staticFallback.status).toBe(401);
  });

  test('rejects credentials with the wrong kind or missing route scope', async () => {
    await provisionMerchant('merchant-a');
    const publishable = await createCredential('merchant-a', {
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://shop.example'],
    });
    const wrongScope = await createCredential('merchant-a', {
      kind: 'secret',
      scopes: ['evaluations:write'],
    });

    const publishableOnSecret = await publicRequest('/v1/test-secret', publishable.token);
    expect(publishableOnSecret.status).toBe(403);

    const missingScope = await publicRequest('/v1/test-secret', wrongScope.token);
    expect(missingScope.status).toBe(403);
  });

  test('rejects revoked and expired credentials immediately', async () => {
    await provisionMerchant('merchant-a');
    const revoked = await createCredential('merchant-a', {
      name: 'revoked key',
      kind: 'secret',
      scopes: ['customers:write'],
    });
    const expired = await createCredential('merchant-a', {
      name: 'expired key',
      kind: 'secret',
      scopes: ['customers:write'],
      expiresAt: '2000-01-01T00:00:00.000Z',
    });

    await operatorService().revokeCredential(
      operatorContext('merchant-a'),
      revoked.credential.id,
    );

    expect((await publicRequest('/v1/test-secret', revoked.token)).status).toBe(401);
    expect((await publicRequest('/v1/test-secret', expired.token)).status).toBe(401);
  });

  test('allows only an exact configured Origin for publishable browser requests', async () => {
    await provisionMerchant('merchant-a');
    const publishable = await createCredential('merchant-a', {
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://shop.example'],
    });

    const allowed = await publicRequest('/v1/test-publishable', publishable.token, {
      headers: { origin: 'https://shop.example' },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://shop.example');
    expect(allowed.headers.get('vary')).toContain('Origin');

    for (const origin of [
      'https://evil.example',
      'https://shop.example.evil.test',
      'https://SHOP.example',
      'https://shop.example/',
    ]) {
      const disallowed = await publicRequest('/v1/test-publishable', publishable.token, {
        headers: { origin },
      });
      expect(disallowed.status).toBe(403);
      expect(disallowed.headers.has('access-control-allow-origin')).toBe(false);
    }
  });

  test('never opts secret routes into browser CORS', async () => {
    await provisionMerchant('merchant-a');
    const secret = await createCredential('merchant-a', {
      kind: 'secret',
      scopes: ['customers:write'],
    });

    const response = await publicRequest('/v1/test-secret', secret.token, {
      headers: { origin: 'https://shop.example' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
  });

  test('keeps old and new rotation keys active until the old key is revoked', async () => {
    await provisionMerchant('merchant-a');
    const oldKey = await createCredential('merchant-a', {
      name: 'old key',
      kind: 'secret',
      scopes: ['customers:write'],
    });
    const newKey = await createCredential('merchant-a', {
      name: 'new key',
      kind: 'secret',
      scopes: ['customers:write'],
    });

    expect((await publicRequest('/v1/test-secret', oldKey.token)).status).toBe(200);
    expect((await publicRequest('/v1/test-secret', newKey.token)).status).toBe(200);

    await operatorService().revokeCredential(
      operatorContext('merchant-a'),
      oldKey.credential.id,
    );

    expect((await publicRequest('/v1/test-secret', oldKey.token)).status).toBe(401);
    expect((await publicRequest('/v1/test-secret', newKey.token)).status).toBe(200);
  });
});
