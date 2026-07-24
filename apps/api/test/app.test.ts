import { ApiErrorSchema } from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { describe, expect, test, vi } from 'vitest';

import { createApp } from '../src/app.js';
import {
  requirePublishable,
  requireSecret,
} from '../src/auth/api-credentials.js';
import type { Env } from '../src/env.js';
import {
  DecisionExpiredError,
  ExhaustedError,
  NotFoundError,
} from '../src/errors.js';
import { OptimisticVersionConflictError } from '../src/repositories/types.js';
import { SEEDED_MERCHANT_ID } from './test-credentials.js';
import workerSource from '../src/worker.ts?raw';
import wranglerConfiguration from '../wrangler.toml?raw';

const correlationHeader = 'x-correlation-id';

type ExpectedError = {
  code: string;
  retryable: boolean;
  status: number;
};

async function request(path: string, token?: string, correlationId?: string): Promise<Response> {
  const headers = new Headers();
  if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
  if (correlationId !== undefined) headers.set(correlationHeader, correlationId);

  return SELF.fetch(`https://example.test${path}`, { headers });
}

async function expectCanonicalError(
  response: Response,
  expected: ExpectedError,
): Promise<ReturnType<typeof ApiErrorSchema.parse>> {
  expect(response.status).toBe(expected.status);
  const body = ApiErrorSchema.parse(await response.json());
  expect(body.error).toMatchObject({
    code: expected.code,
    retryable: expected.retryable,
    correlationId: response.headers.get(correlationHeader),
  });
  return body;
}

async function requestApp(
  path: string,
  bindings: Env,
  authorization = 'Bearer pk_test_publishable_credential_material_00000001',
  correlationId?: string,
): Promise<Response> {
  const app = createApp();
  app.get('/__test/config', requirePublishable, (context) => context.json({
    merchantId: context.get('merchantId'),
    correlationId: context.get('correlationId'),
    repositories: context.get('repositories') !== undefined,
  }));
  const headers = new Headers({ authorization });
  if (correlationId !== undefined) headers.set(correlationHeader, correlationId);
  return app.request(
    `https://example.test${path}`,
    { headers },
    bindings,
  );
}

describe('Worker API composition', () => {
  test('configures Wrangler with public fetch and a named private operator entrypoint', async () => {
    const configuredMain = /^main\s*=\s*"([^"]+)"$/mu.exec(wranglerConfiguration)?.[1];
    const workerEntrypoint = await import('../src/worker.js');

    expect(configuredMain).toBe('src/worker.ts');
    expect(Object.keys(workerEntrypoint).sort()).toEqual(['CoreOperatorService', 'default']);
    expect(workerEntrypoint.default).toBeDefined();
  });

  test('keeps every private Worker method on canonical typed RPC boundaries', () => {
    const serviceSource = /export class CoreOperatorService[\s\S]*?\n\}\n\nexport default/u
      .exec(workerSource)?.[0];
    expect(serviceSource).toBeDefined();
    expect(serviceSource).not.toContain('input: unknown');
    expect(serviceSource).not.toContain('Parameters<typeof');
    expect(serviceSource).not.toContain("from './repositories/types.js'");
    expect(serviceSource).toContain('MerchantProvisionRequest');
    expect(serviceSource).toContain('MerchantActivationRequest');
    expect(serviceSource).toContain('ApiCredentialCreateInput');
  });

  test.each([
    ['/v1/health', undefined, 200],
    ['/v1/schema/published', undefined, 401],
    ['/v1/schema/published', 'pk_test_publishable_credential_material_00000001', 404],
    ['/v1/schema/published', 'sk_test_secret_credential_material_000000000001', 404],
    ['/v1/customers/missing', 'pk_test_publishable_credential_material_00000001', 403],
    ['/v1/customers/missing', 'sk_test_secret_credential_material_000000000001', 404],
  ])('%s enforces key kind for %s', async (path, token, expected) => {
    const response = await request(path, token);
    expect(response.status).toBe(expected);
  });

  test('request context contains merchant, repositories, and the response correlation id', async () => {
    const correlationId = 'corr-from-request';
    const response = await requestApp(
      '/__test/config',
      { DB: env.DB },
      'Bearer pk_test_publishable_credential_material_00000001',
      correlationId,
    );

    expect(response.headers.get(correlationHeader)).toBe(correlationId);
    expect(await response.json()).toMatchObject({
      merchantId: expect.any(String),
      correlationId,
      repositories: true,
    });
  });

  test('does not expose diagnostic credential probes in production or OpenAPI', async () => {
    for (const path of ['/v1/test-publishable', '/v1/test-secret']) {
      expect((await request(
        path,
        'sk_test_secret_credential_material_000000000001',
      )).status).toBe(404);
    }
    const document = await (await request('/v1/openapi.json')).json() as {
      paths?: Record<string, unknown>;
    };
    expect(document.paths).not.toHaveProperty('/v1/test-publishable');
    expect(document.paths).not.toHaveProperty('/v1/test-secret');
  });

  test('the migrated merchant supports authenticated request-scoped repository writes', async () => {
    const seeded = await env.DB.prepare(
      'SELECT id FROM merchants WHERE id = ?1',
    ).bind(SEEDED_MERCHANT_ID).first<{ id: string }>();
    expect(seeded).toEqual({ id: SEEDED_MERCHANT_ID });

    const app = createApp();
    app.post('/v1/request-scoped-customer', requireSecret, async (context) => {
      const merchantId = context.get('merchantId');
      const repositories = context.get('repositories');
      await repositories.customers.create(merchantId, {
        externalRef: 'request-scoped-customer',
        attributes: { tier: 'gold' },
      });
      const customer = await repositories.customers.get(
        merchantId,
        'request-scoped-customer',
      );
      return context.json(customer, 201);
    });

    const response = await app.request(
      'https://example.test/v1/request-scoped-customer',
      {
        method: 'POST',
        headers: { authorization: 'Bearer sk_test_secret_credential_material_000000000001' },
      },
      {
        DB: env.DB,
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      externalRef: 'request-scoped-customer',
      attributes: { tier: 'gold' },
      version: 1,
    });
    const stored = await env.DB.prepare(
      'SELECT merchant_id FROM customers WHERE external_ref = ?1',
    ).bind('request-scoped-customer').first<{ merchant_id: string }>();
    expect(stored).toEqual({ merchant_id: SEEDED_MERCHANT_ID });
  });

  test.each([
    [undefined, 401, 'UNAUTHORIZED'],
    ['not-a-token', 401, 'UNAUTHORIZED'],
    ['pk_test_publishable_credential_material_00000001', 403, 'FORBIDDEN'],
  ])('auth failures use canonical errors without leaking credentials', async (token, status, code) => {
    const response = await request('/v1/customers/missing', token, 'corr-auth');
    const body = await expectCanonicalError(response, { status, code, retryable: false });

    expect(JSON.stringify(body)).not.toContain(token ?? 'sk_test_secret_credential_material_000000000001');
  });

  test.each([
    ['Basic pk_test_publishable_credential_material_00000001'],
    ['Bearer'],
    ['Bearer pk_test_publishable_credential_material_00000001 suffix'],
    [`Bearer ${'x'.repeat(513)}`],
  ])('malformed or oversized authorization is rejected', async (authorization) => {
    const response = await requestApp(
      '/__test/config',
      {
        DB: env.DB,
      },
      authorization,
    );

    await expectCanonicalError(response, {
      status: 401,
      code: 'UNAUTHORIZED',
      retryable: false,
    });
  });

  test('unknown routes return canonical not-found errors', async () => {
    const response = await request('/v1/does-not-exist', undefined, 'corr-not-found');
    await expectCanonicalError(response, {
      status: 404,
      code: 'NOT_FOUND',
      retryable: false,
    });
  });

  test('emits one sanitized structured event at the authenticated error boundary', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const app = createApp();
      app.post('/v1/error-test', requirePublishable, () => {
        throw new Error('private dependency stack and request detail');
      });
      const response = await app.request(
        'https://example.test/v1/error-test?customerRef=private-customer',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer pk_test_publishable_credential_material_00000001',
            'content-type': 'application/json',
            [correlationHeader]: 'correlation-123',
          },
          body: JSON.stringify({
            code: 'PRIVATE-CODE',
            customerRef: 'private-customer',
            attributes: { tier: 'private-tier' },
          }),
        },
        { DB: env.DB },
      );

      const body = await expectCanonicalError(response, {
        status: 503,
        code: 'EVALUATION_UNAVAILABLE',
        retryable: true,
      });
      expect(response.headers.get(correlationHeader)).toBe('correlation-123');
      expect(body.error.correlationId).toBe('correlation-123');
      expect(errorLog).toHaveBeenCalledTimes(1);

      const serialized = String(errorLog.mock.calls[0]?.[0]);
      expect(JSON.parse(serialized)).toMatchObject({
        event: 'api_request_failed',
        correlationId: 'correlation-123',
        route: '/unknown',
        method: 'POST',
        code: 'EVALUATION_UNAVAILABLE',
        status: 503,
        retryable: true,
        merchantId: SEEDED_MERCHANT_ID,
        credentialId: expect.any(String),
      });
      expect(serialized).not.toContain('Authorization');
      expect(serialized).not.toContain('00000001');
      expect(serialized).not.toContain('PRIVATE-CODE');
      expect(serialized).not.toContain('private-customer');
      expect(serialized).not.toContain('private-tier');
      expect(serialized).not.toContain('private dependency stack');
    } finally {
      errorLog.mockRestore();
    }
  });

  test.each([
    ['unsafe characters', 'unsafe correlation'],
    ['oversized value', `correlation-${'x'.repeat(200)}`],
  ])('replaces an inbound correlation ID with $unsafeCase before responding or logging', async (
    _unsafeCase,
    suppliedCorrelationId,
  ) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const app = createApp();
      app.post('/v1/error-test', requirePublishable, () => {
        throw new Error('private dependency stack');
      });
      const response = await app.request('https://example.test/v1/error-test', {
        method: 'POST',
        headers: {
          authorization: 'Bearer pk_test_publishable_credential_material_00000001',
          [correlationHeader]: suppliedCorrelationId,
        },
      }, { DB: env.DB });
      const body = await expectCanonicalError(response, {
        status: 503,
        code: 'EVALUATION_UNAVAILABLE',
        retryable: true,
      });

      const replacement = response.headers.get(correlationHeader);
      expect(replacement).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u);
      expect(replacement).not.toBe(suppliedCorrelationId);
      expect(body.error.correlationId).toBe(replacement);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const serialized = String(errorLog.mock.calls[0]?.[0]);
      expect(JSON.parse(serialized)).toMatchObject({ correlationId: replacement });
      expect(serialized).not.toContain(suppliedCorrelationId);
    } finally {
      errorLog.mockRestore();
    }
  });

  test.each([
    [
      () => z.object({ context: z.string() }).parse({}),
      { status: 400, code: 'CONTEXT_VALIDATION_FAILED', retryable: false },
    ],
    [
      () => { throw new NotFoundError('Customer not found', 'CUSTOMER_NOT_FOUND'); },
      { status: 404, code: 'CUSTOMER_NOT_FOUND', retryable: false },
    ],
    [
      () => { throw new OptimisticVersionConflictError(); },
      { status: 409, code: 'VERSION_CONFLICT', retryable: false },
    ],
    [
      () => { throw new DecisionExpiredError(); },
      { status: 410, code: 'DECISION_EXPIRED', retryable: false },
    ],
    [
      () => { throw new ExhaustedError(); },
      { status: 409, code: 'EXHAUSTED', retryable: false },
    ],
    [
      () => { throw new Error('private failure detail'); },
      { status: 503, code: 'EVALUATION_UNAVAILABLE', retryable: true },
    ],
  ])('maps application failures to canonical error envelopes', async (fail, expected) => {
    const app = createApp();
    app.get('/v1/error-test', requirePublishable, () => fail());
    const response = await app.request(
      'https://example.test/v1/error-test',
      {
        headers: {
          authorization: 'Bearer pk_test_publishable_credential_material_00000001',
          [correlationHeader]: 'corr-error',
        },
      },
      {
        DB: env.DB,
      },
    );

    const body = await expectCanonicalError(response, expected);
    expect(JSON.stringify(body)).not.toContain('private failure detail');
    expect(JSON.stringify(body)).not.toContain('sk_test_secret_credential_material_000000000001');
    expect(JSON.stringify(body)).not.toContain('pk_test_publishable_credential_material_00000001');
  });
});
