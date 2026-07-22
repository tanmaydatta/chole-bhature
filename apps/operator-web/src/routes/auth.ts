import { ApiErrorSchema } from '@incentives/contracts';

import type { OperatorWebEnv } from './types.js';

const allowedAuthRoutes = new Set([
  'POST /auth/sign-in/magic-link',
  'GET /auth/magic-link/verify',
  'GET /auth/get-session',
  'POST /auth/sign-out',
  'GET /auth/passkey/generate-authenticate-options',
  'POST /auth/passkey/verify-authentication',
  'GET /auth/passkey/generate-register-options',
  'POST /auth/passkey/verify-registration',
  'POST /auth/root/recovery',
  'POST /auth/root/recovery/exchange',
  'POST /auth/root/recovery/rotate-codes',
]);

function notFound(correlationId: string): Response {
  return Response.json(ApiErrorSchema.parse({
    error: {
      code: 'NOT_FOUND', message: 'The requested resource is unavailable',
      correlationId, retryable: false,
    },
  }), { status: 404, headers: {
    'x-correlation-id': correlationId, 'cache-control': 'no-store',
  } });
}

function authError(
  correlationId: string,
  status: number,
  code: string,
  message: string,
  retryable = false,
): Response {
  return Response.json(ApiErrorSchema.parse({
    error: { code, message, correlationId, retryable },
  }), { status, headers: {
    'x-correlation-id': correlationId, 'cache-control': 'no-store',
  } });
}

function splitSetCookie(value: string): string[] {
  const cookies: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ',') continue;
    const remainder = value.slice(index + 1);
    if (!/^\s*[^=;,\s]+\s*=/u.test(remainder)) continue;
    cookies.push(value.slice(start, index).trim());
    start = index + 1;
  }
  cookies.push(value.slice(start).trim());
  return cookies.filter(Boolean);
}

export async function proxyAuth(
  request: Request,
  env: OperatorWebEnv,
  correlationId: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (!allowedAuthRoutes.has(`${request.method} ${url.pathname}`)) {
    return notFound(correlationId);
  }
  const publicOrigin = new URL(env.PUBLIC_APP_ORIGIN);
  if (publicOrigin.origin !== env.PUBLIC_APP_ORIGIN) {
    return authError(
      correlationId, 503, 'IDENTITY_UNAVAILABLE',
      'Identity is temporarily unavailable', true,
    );
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (
      request.headers.get('origin') !== env.PUBLIC_APP_ORIGIN
      || (
        request.headers.has('sec-fetch-site')
        && request.headers.get('sec-fetch-site') !== 'same-origin'
      )
    ) {
      return authError(correlationId, 403, 'FORBIDDEN', 'Operation is not permitted');
    }
  }
  const upstreamUrl = new URL(`${url.pathname}${url.search}`, publicOrigin);
  const headers = new Headers({
    'x-correlation-id': correlationId,
    origin: env.PUBLIC_APP_ORIGIN,
  });
  const cookie = request.headers.get('cookie');
  const contentType = request.headers.get('content-type');
  if (cookie !== null && cookie.length <= 8192) headers.set('cookie', cookie);
  if (contentType !== null && contentType.length <= 200) headers.set('content-type', contentType);
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
    if (body.byteLength > 65_536) {
      return Response.json(ApiErrorSchema.parse({
        error: {
          code: 'INVALID_REQUEST', message: 'Request validation failed',
          correlationId, retryable: false,
        },
      }), { status: 400, headers: {
        'x-correlation-id': correlationId, 'cache-control': 'no-store',
      } });
    }
  }
  let upstream: Response;
  try {
    upstream = await env.IDENTITY_AUTH.fetch(new Request(upstreamUrl.toString(), {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
    }));
  } catch {
    return authError(
      correlationId, 503, 'IDENTITY_UNAVAILABLE',
      'Identity is temporarily unavailable', true,
    );
  }
  const responseHeaders = new Headers({
    'x-correlation-id': correlationId,
    'cache-control': 'no-store',
  });
  for (const name of ['content-type', 'retry-after'] as const) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  for (const cookieValue of upstream.headers.getSetCookie().flatMap(splitSetCookie)) {
    responseHeaders.append('set-cookie', cookieValue);
  }
  const location = upstream.headers.get('location');
  if (location !== null && upstream.status >= 300 && upstream.status < 400) {
    let redirect: URL;
    try {
      redirect = new URL(location, publicOrigin);
    } catch {
      return authError(
        correlationId, 503, 'IDENTITY_UNAVAILABLE',
        'Identity is temporarily unavailable', true,
      );
    }
    if (redirect.origin !== env.PUBLIC_APP_ORIGIN) {
      return authError(
        correlationId, 503, 'IDENTITY_UNAVAILABLE',
        'Identity is temporarily unavailable', true,
      );
    }
    responseHeaders.set('location', location);
  }
  if (
    upstream.ok
    && (
      url.pathname === '/auth/passkey/verify-authentication'
      || url.pathname === '/auth/passkey/verify-registration'
    )
  ) {
    responseHeaders.set('content-type', 'application/json');
    return new Response(JSON.stringify({ ok: true }), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
