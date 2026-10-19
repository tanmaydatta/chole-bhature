import { ApiErrorSchema } from '@incentives/contracts';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { createApp } from '../src/app.js';
import type { Env } from '../src/env.js';
import { PUBLISHABLE_TEST_TOKEN, SECRET_TEST_TOKEN } from './test-credentials.js';

const path = 'https://example.test/v1/runtime-capabilities';
function request(environment: string | undefined, token: string | null = SECRET_TEST_TOKEN) {
  const bindings: Env = { DB: env.DB };
  // Raw runtime configuration is intentionally tested beyond its declared type.
  if (environment !== undefined) Object.assign(bindings, { APP_ENV: environment });
  return createApp().request(path, { headers: token ? { authorization: `Bearer ${token}` } : {} }, bindings);
}

describe('read-only simulator runtime capabilities', () => {
  // Break caught: trusting CLI labels or treating an unspecified/unknown deployment as safe.
  test.each([
    ['local', { environment: 'local', simulatorAllowed: true }],
    ['staging', { environment: 'staging', simulatorAllowed: true }],
    ['production', { environment: 'production', simulatorAllowed: false }],
    ['ci', { environment: 'ci', simulatorAllowed: false }],
    [undefined, { environment: 'unknown', simulatorAllowed: false }],
    ['staging-copy', { environment: 'unknown', simulatorAllowed: false }],
  ])('derives %s capabilities only from server APP_ENV', async (environment, expected) => {
    const response = await request(environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();
  });

  // Break caught: unauthenticated or publishable credentials can access the secret-scoped marker.
  test.each([[null, 401, 'UNAUTHORIZED'], [PUBLISHABLE_TEST_TOKEN, 403, 'FORBIDDEN']] as const)(
    'rejects the wrong credential kind', async (token, status, code) => {
      const response = await request('local', token);
      expect(response.status).toBe(status);
      expect(ApiErrorSchema.parse(await response.json()).error.code).toBe(code);
    },
  );

  test('requires the existing schema:read scope', async () => {
    await env.DB.prepare("UPDATE api_credentials SET scopes_json = '[\"redemptions:write\"]' WHERE kind = 'secret'").run();
    const response = await request('local');
    expect(response.status).toBe(403);
    expect(ApiErrorSchema.parse(await response.json()).error.code).toBe('FORBIDDEN');
  });

  test('registers the authenticated canonical response in public OpenAPI without changing health', async () => {
    const app = createApp();
    const response = await app.request('https://example.test/v1/openapi.json', {}, { DB: env.DB });
    const document = await response.json() as { paths: Record<string, { get: { security: unknown; responses: Record<string, unknown> } }> };
    expect(document.paths['/v1/runtime-capabilities']?.get.security).toEqual([{ secretBearer: [] }]);
    expect(document.paths['/v1/runtime-capabilities']?.get.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/RuntimeCapabilitiesResponse' } } },
    });
    expect(await (await app.request('https://example.test/v1/health', {}, { DB: env.DB })).json()).toEqual({ status: 'ok' });
  });
});
