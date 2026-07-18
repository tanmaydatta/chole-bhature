import { ApiErrorSchema } from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { describe, expect, test } from 'vitest';

import { createApp } from '../src/app.js';
import { requirePublishable } from '../src/auth/static-token.js';
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

  test.each([
    [undefined, 401, 'UNAUTHORIZED'],
    ['not-a-token', 401, 'UNAUTHORIZED'],
    ['publishable-test', 403, 'FORBIDDEN'],
  ])('auth failures use canonical errors without leaking credentials', async (token, status, code) => {
    const response = await request('/v1/test-secret', token, 'corr-auth');
    const body = await expectCanonicalError(response, { status, code, retryable: false });

    expect(JSON.stringify(body)).not.toContain(token ?? 'secret-test');
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
