import { ApiErrorSchema } from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { describe, expect, test } from 'vitest';

import { createApp } from '../src/app.js';
import {
  requirePublishable,
  requireSecret,
  SEEDED_MERCHANT_ID,
} from '../src/auth/static-token.js';
import type { Env } from '../src/env.js';
import {
  DecisionExpiredError,
  ExhaustedError,
  NotFoundError,
} from '../src/errors.js';
import { OptimisticVersionConflictError } from '../src/repositories/types.js';

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
  authorization = 'Bearer publishable-test',
): Promise<Response> {
  const app = createApp();
  app.get('/v1/config-test', requirePublishable, (context) => context.json({ ok: true }));
  return app.request(
    `https://example.test${path}`,
    { headers: { authorization } },
    bindings,
  );
}

describe('Worker API composition', () => {
  test.each([
    ['/v1/health', undefined, 200],
    ['/v1/test-publishable', undefined, 401],
    ['/v1/test-publishable', 'publishable-test', 200],
    ['/v1/test-publishable', 'secret-test', 200],
    ['/v1/test-secret', 'publishable-test', 403],
    ['/v1/test-secret', 'secret-test', 200],
  ])('%s enforces key kind for %s', async (path, token, expected) => {
    const response = await request(path, token);
    expect(response.status).toBe(expected);
  });

  test('request context contains merchant, repositories, and the response correlation id', async () => {
    const correlationId = 'corr-from-request';
    const response = await request('/v1/test-publishable', 'publishable-test', correlationId);

    expect(response.headers.get(correlationHeader)).toBe(correlationId);
    expect(await response.json()).toMatchObject({
      merchantId: expect.any(String),
      correlationId,
      repositories: true,
    });
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
        headers: { authorization: 'Bearer secret-test' },
      },
      {
        DB: env.DB,
        PUBLISHABLE_TOKEN: 'publishable-test',
        SECRET_TOKEN: 'secret-test',
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
    ['publishable-test', 403, 'FORBIDDEN'],
  ])('auth failures use canonical errors without leaking credentials', async (token, status, code) => {
    const response = await request('/v1/test-secret', token, 'corr-auth');
    const body = await expectCanonicalError(response, { status, code, retryable: false });

    expect(JSON.stringify(body)).not.toContain(token ?? 'secret-test');
  });

  test.each([
    ['', 'secret-test'],
    ['publishable-test', ''],
    ['publishable-test', 'publishable-test'],
    ['short', 'secret-test'],
    ['publishable-test', 'short'],
    [' publishable-test', 'secret-test'],
    ['publishable-test', `${'x'.repeat(513)}`],
  ])('invalid static-token configuration fails closed', async (publishable, secret) => {
    const response = await requestApp('/v1/config-test', {
      DB: env.DB,
      PUBLISHABLE_TOKEN: publishable,
      SECRET_TOKEN: secret,
    });
    const body = await expectCanonicalError(response, {
      status: 503,
      code: 'EVALUATION_UNAVAILABLE',
      retryable: true,
    });

    for (const configuredToken of [publishable, secret]) {
      if (configuredToken.length > 0) {
        expect(JSON.stringify(body)).not.toContain(configuredToken);
      }
    }
  });

  test.each([
    ['Basic publishable-test'],
    ['Bearer'],
    ['Bearer publishable-test suffix'],
    [`Bearer ${'x'.repeat(513)}`],
  ])('malformed or oversized authorization is rejected', async (authorization) => {
    const response = await requestApp(
      '/v1/config-test',
      {
        DB: env.DB,
        PUBLISHABLE_TOKEN: 'publishable-test',
        SECRET_TOKEN: 'secret-test',
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
          authorization: 'Bearer publishable-test',
          [correlationHeader]: 'corr-error',
        },
      },
      {
        DB: env.DB,
        PUBLISHABLE_TOKEN: 'publishable-test',
        SECRET_TOKEN: 'secret-test',
      },
    );

    const body = await expectCanonicalError(response, expected);
    expect(JSON.stringify(body)).not.toContain('private failure detail');
    expect(JSON.stringify(body)).not.toContain('secret-test');
    expect(JSON.stringify(body)).not.toContain('publishable-test');
  });
});
