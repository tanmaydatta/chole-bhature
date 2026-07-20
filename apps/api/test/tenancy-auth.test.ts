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

async function preflight(
  path: string,
  origin: string,
  method: 'GET' | 'POST' | 'PATCH',
  requestedHeaders: string,
): Promise<Response> {
  return SELF.fetch(`https://core.example${path}`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': requestedHeaders,
    },
  });
}

function isoWithOffset(timestamp: number, offsetHours: number): string {
  const shifted = new Date(timestamp + offsetHours * 60 * 60 * 1_000).toISOString();
  const sign = offsetHours < 0 ? '-' : '+';
  return `${shifted.slice(0, -1)}${sign}${Math.abs(offsetHours).toString().padStart(2, '0')}:00`;
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

  test('keeps configuration authoring off public fetch and cannot mutate it with a secret key', async () => {
    await provisionMerchant('merchant-a');
    const minimalSecret = await createCredential('merchant-a', {
      kind: 'secret',
      scopes: ['customers:write'],
    });
    const headers = {
      authorization: `Bearer ${minimalSecret.token}`,
      'content-type': 'application/json',
    };

    for (const [method, path] of [
      ['GET', '/v1/programs'],
      ['POST', '/v1/programs'],
      ['GET', '/v1/programs/example'],
      ['PATCH', '/v1/programs/example'],
      ['GET', '/v1/schema/definitions'],
      ['POST', '/v1/schema/definitions'],
      ['PATCH', '/v1/schema/definitions/example'],
      ['DELETE', '/v1/schema/definitions/example'],
      ['POST', '/v1/schema/publish'],
    ] as const) {
      const response = await SELF.fetch(`https://core.example${path}`, {
        method,
        headers,
        ...(['POST', 'PATCH'].includes(method) ? { body: '{}' } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }

    expect(await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM programs WHERE merchant_id = 'merchant-a') AS programs,
        (SELECT COUNT(*) FROM schema_versions WHERE merchant_id = 'merchant-a') AS schemas,
        (SELECT COUNT(*) FROM variable_definitions WHERE merchant_id = 'merchant-a') AS definitions
    `).first()).toEqual({ programs: 0, schemas: 0, definitions: 0 });
  });

  test('enforces the exact kind and scope matrix on every remaining protected public route', async () => {
    await provisionMerchant('merchant-a');
    const publishableSchema = await createCredential('merchant-a', {
      name: 'publishable schema',
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://schema.example'],
    });
    const publishableEvaluation = await createCredential('merchant-a', {
      name: 'publishable evaluation',
      kind: 'publishable',
      scopes: ['evaluations:write'],
      allowedOrigins: ['https://evaluate.example'],
    });
    const secretSchema = await createCredential('merchant-a', {
      name: 'secret schema',
      kind: 'secret',
      scopes: ['schema:read'],
    });
    const secretEvaluation = await createCredential('merchant-a', {
      name: 'secret evaluation',
      kind: 'secret',
      scopes: ['evaluations:write'],
    });
    const secretCustomers = await createCredential('merchant-a', {
      name: 'secret customers',
      kind: 'secret',
      scopes: ['customers:write'],
    });
    const secretRedemptions = await createCredential('merchant-a', {
      name: 'secret redemptions',
      kind: 'secret',
      scopes: ['redemptions:write'],
    });

    expect((await publicRequest('/v1/schema/published', publishableEvaluation.token)).status)
      .toBe(403);
    expect((await publicRequest('/v1/schema/published', publishableSchema.token)).status)
      .not.toBe(403);
    expect((await publicRequest('/v1/schema/published', secretSchema.token)).status)
      .not.toBe(403);

    const evaluationRequest = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    } as const;
    expect((await publicRequest('/v1/evaluate', publishableSchema.token, evaluationRequest)).status)
      .toBe(403);
    expect((await publicRequest(
      '/v1/evaluate',
      publishableEvaluation.token,
      evaluationRequest,
    )).status).not.toBe(403);
    expect((await publicRequest('/v1/evaluate', secretEvaluation.token, evaluationRequest)).status)
      .not.toBe(403);

    expect((await publicRequest('/v1/customers/missing', secretEvaluation.token)).status).toBe(403);
    expect((await publicRequest('/v1/customers/missing', publishableEvaluation.token)).status)
      .toBe(403);
    expect((await publicRequest('/v1/customers/missing', secretCustomers.token)).status)
      .not.toBe(403);

    const redemptionRequest = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    } as const;
    expect((await publicRequest('/v1/redemptions', secretCustomers.token, redemptionRequest)).status)
      .toBe(403);
    expect((await publicRequest(
      '/v1/redemptions',
      secretRedemptions.token,
      redemptionRequest,
    )).status).not.toBe(403);

    expect((await SELF.fetch('https://core.example/v1/health')).status).toBe(200);
    expect((await SELF.fetch('https://core.example/v1/openapi.json')).status).toBe(200);
  });

  test('answers route-specific publishable preflights from active unexpired Origin policy', async () => {
    await provisionMerchant('merchant-a');
    const schema = await createCredential('merchant-a', {
      name: 'schema browser',
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://schema.example'],
    });
    const evaluation = await createCredential('merchant-a', {
      name: 'evaluation browser',
      kind: 'publishable',
      scopes: ['evaluations:write'],
      allowedOrigins: ['https://evaluate.example'],
    });
    const revoked = await createCredential('merchant-a', {
      name: 'revoked browser',
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://revoked.example'],
    });
    await createCredential('merchant-a', {
      name: 'expired browser',
      kind: 'publishable',
      scopes: ['evaluations:write'],
      allowedOrigins: ['https://expired.example'],
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    await operatorService().revokeCredential(
      operatorContext('merchant-a'),
      revoked.credential.id,
    );

    const schemaPreflight = await preflight(
      '/v1/schema/published',
      'https://schema.example',
      'GET',
      'authorization',
    );
    expect(schemaPreflight.status).toBe(204);
    expect(schemaPreflight.headers.get('access-control-allow-origin'))
      .toBe('https://schema.example');
    expect(schemaPreflight.headers.get('access-control-allow-methods')).toBe('GET');
    expect(schemaPreflight.headers.get('access-control-allow-headers')?.toLowerCase())
      .toContain('authorization');
    expect(schemaPreflight.headers.get('vary')).toContain('Origin');

    const evaluationPreflight = await preflight(
      '/v1/evaluate',
      'https://evaluate.example',
      'POST',
      'authorization, content-type',
    );
    expect(evaluationPreflight.status).toBe(204);
    expect(evaluationPreflight.headers.get('access-control-allow-origin'))
      .toBe('https://evaluate.example');
    expect(evaluationPreflight.headers.get('access-control-allow-methods')).toBe('POST');
    const evaluationHeaders = evaluationPreflight.headers
      .get('access-control-allow-headers')?.toLowerCase();
    expect(evaluationHeaders).toContain('authorization');
    expect(evaluationHeaders).toContain('content-type');

    expect((await publicRequest(
      '/v1/schema/published',
      schema.token,
      { headers: { origin: 'https://schema.example' } },
    )).headers.get('access-control-allow-origin')).toBe('https://schema.example');
    expect((await publicRequest(
      '/v1/evaluate',
      evaluation.token,
      {
        method: 'POST',
        headers: { origin: 'https://evaluate.example', 'content-type': 'application/json' },
        body: '{}',
      },
    )).headers.get('access-control-allow-origin')).toBe('https://evaluate.example');

    for (const [path, origin, method, headers] of [
      ['/v1/schema/published', 'https://evaluate.example', 'GET', 'authorization'],
      ['/v1/schema/published', 'https://revoked.example', 'GET', 'authorization'],
      ['/v1/evaluate', 'https://expired.example', 'POST', 'authorization, content-type'],
      ['/v1/evaluate', 'https://unknown.example', 'POST', 'authorization, content-type'],
    ] as const) {
      const response = await preflight(path, origin, method, headers);
      expect(response.status).not.toBe(204);
      expect(response.headers.has('access-control-allow-origin')).toBe(false);
    }
  });

  test('never grants preflight permission to secret routes', async () => {
    await provisionMerchant('merchant-a');
    await createCredential('merchant-a', {
      kind: 'publishable',
      scopes: ['evaluations:write'],
      allowedOrigins: ['https://shop.example'],
    });

    for (const [path, method] of [
      ['/v1/customers/customer-1', 'PATCH'],
      ['/v1/redemptions', 'POST'],
    ] as const) {
      const response = await preflight(
        path,
        'https://shop.example',
        method,
        'authorization, content-type',
      );
      expect(response.status).not.toBe(204);
      expect(response.headers.has('access-control-allow-origin')).toBe(false);
      expect(response.headers.has('access-control-allow-methods')).toBe(false);
    }
  });

  test('allows preflight for a future expiry instant serialized with a negative offset', async () => {
    await provisionMerchant('merchant-a');
    await createCredential('merchant-a', {
      kind: 'publishable',
      scopes: ['schema:read'],
      allowedOrigins: ['https://negative-offset-future.example'],
      expiresAt: isoWithOffset(Date.now() + 60 * 60 * 1_000, -12),
    });

    const response = await preflight(
      '/v1/schema/published',
      'https://negative-offset-future.example',
      'GET',
      'authorization',
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin'))
      .toBe('https://negative-offset-future.example');
  });

  test('denies preflight for a past expiry instant serialized with a positive offset', async () => {
    await provisionMerchant('merchant-a');
    await createCredential('merchant-a', {
      kind: 'publishable',
      scopes: ['evaluations:write'],
      allowedOrigins: ['https://positive-offset-past.example'],
      expiresAt: isoWithOffset(Date.now() - 60 * 60 * 1_000, 12),
    });

    const response = await preflight(
      '/v1/evaluate',
      'https://positive-offset-past.example',
      'POST',
      'authorization, content-type',
    );
    expect(response.status).not.toBe(204);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });
});
