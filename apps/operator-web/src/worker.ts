import {
  ApiErrorSchema,
  ClientProvisioningViewSchema,
  IdentityClientsResponseSchema,
  IdentityAcceptInvitationRequestSchema,
  MembershipViewSchema,
  OperatorClientProvisionRequestSchema,
  OperatorInvitationAcceptRequestSchema,
  OperatorMerchantSelectionRequestSchema,
  OperatorSessionViewSchema,
  type ApiError,
} from '@incentives/contracts';

import { proxyAuth } from './routes/auth.js';
import { credentialRoutes } from './routes/credentials.js';
import { customerRoutes } from './routes/customers.js';
import { platformRoutes } from './routes/platform.js';
import { programRoutes } from './routes/programs.js';
import { schemaRoutes } from './routes/schemas.js';
import { teamRoutes } from './routes/team.js';
import type { OperatorWebEnv, ProtectedRoute } from './routes/types.js';
import {
  apiError,
  apiErrorStatus,
  deriveProvisioningIds,
  operatorContext,
  principalForOperation,
  resolveBrowserPrincipal,
  selectedMerchant,
  selectionCookie,
} from './session.js';

const protectedRoutes = [
  ...platformRoutes,
  ...teamRoutes,
  ...credentialRoutes,
  ...schemaRoutes,
  ...customerRoutes,
  ...programRoutes,
] as const;

function correlationId(request: Request): string {
  const supplied = request.headers.get('x-correlation-id')?.trim();
  return supplied && supplied.length <= 200 ? supplied : crypto.randomUUID();
}

function responseHeaders(id: string): Headers {
  return new Headers({
    'content-type': 'application/json',
    'x-correlation-id': id,
    'cache-control': 'no-store',
  });
}

function errorResponse(error: ApiError): Response {
  return new Response(JSON.stringify(ApiErrorSchema.parse(error)), {
    status: apiErrorStatus(error),
    headers: responseHeaders(error.error.correlationId),
  });
}

function notFound(id: string): Response {
  return errorResponse(apiError(
    id, 'NOT_FOUND', 'The requested resource is unavailable',
  ));
}

function invalidRequest(id: string): Response {
  return errorResponse(apiError(id, 'INVALID_REQUEST', 'Request validation failed'));
}

function unsafeOperatorRequest(request: Request, env: OperatorWebEnv): boolean {
  if (!new URL(request.url).pathname.startsWith('/operator/v1/')) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  return request.headers.get('origin') !== env.PUBLIC_APP_ORIGIN
    || (
      request.headers.has('sec-fetch-site')
      && request.headers.get('sec-fetch-site') !== 'same-origin'
    );
}

async function requestBody(request: Request): Promise<unknown> {
  if (request.body === null) return undefined;
  const text = await request.text();
  if (text.length > 65_536) throw new Error('Request body is too large');
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

function matchedRoute(pathname: string, method: string): {
  route: ProtectedRoute;
  params: Record<string, string>;
} | null {
  for (const route of protectedRoutes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    for (const [index, name] of (route.parameterNames ?? []).entries()) {
      const raw = match[index + 1];
      if (raw === undefined) return null;
      params[name] = decodeURIComponent(raw);
    }
    return { route, params };
  }
  return null;
}

function remotePromoCodeConflictRef(name: string, message: string): string | null {
  const prefix = 'PROMO_CODE_CONFLICT:';
  if (name !== 'PromoCodeConflictError' || !message.startsWith(prefix)) return null;
  try {
    const payload = JSON.parse(message.slice(prefix.length)) as unknown;
    if (
      typeof payload !== 'object'
      || payload === null
      || Object.keys(payload).length !== 1
      || typeof Reflect.get(payload, 'conflictingProgramRef') !== 'string'
      || (Reflect.get(payload, 'conflictingProgramRef') as string).length < 1
    ) return null;
    return Reflect.get(payload, 'conflictingProgramRef') as string;
  } catch {
    return null;
  }
}

function downstreamError(id: string, downstream: 'identity' | 'core', error: unknown): ApiError {
  if (typeof error === 'object' && error !== null) {
    const name = typeof Reflect.get(error, 'name') === 'string'
      ? Reflect.get(error, 'name') as string
      : '';
    const code = typeof Reflect.get(error, 'code') === 'string'
      ? Reflect.get(error, 'code') as string
      : '';
    const message = typeof Reflect.get(error, 'message') === 'string'
      ? Reflect.get(error, 'message') as string
      : '';
    const conflictingProgramRef = downstream === 'core'
      ? remotePromoCodeConflictRef(name, message)
      : null;
    if (conflictingProgramRef !== null) {
      return apiError(
        id,
        'PROMO_CODE_CONFLICT',
        `This code overlaps published Promo ${JSON.stringify(conflictingProgramRef)}`,
      );
    }
    if (name === 'NotFoundError' || code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND')) {
      return apiError(id, 'NOT_FOUND', 'The requested resource was not found');
    }
    if (name === 'ForbiddenError' || code === 'FORBIDDEN' || message === 'ROOT_REQUIRED') {
      return apiError(id, 'FORBIDDEN', 'Operation is not permitted');
    }
    if (
      ['ZodError', 'ContextValidationError', 'CredentialPolicyError'].includes(name)
      || ['INVALID_ARGUMENT', 'INVALID_REQUEST', 'CONTEXT_VALIDATION_FAILED'].includes(code)
    ) {
      return apiError(id, 'INVALID_REQUEST', 'Request validation failed');
    }
    if (
      ['OptimisticVersionConflictError', 'VersionConflictError'].includes(name)
      || code === 'VERSION_CONFLICT'
    ) {
      return apiError(id, 'VERSION_CONFLICT', 'The submitted version conflicts');
    }
    if (
      ['SchemaRevisionConflictError', 'SchemaConflictError'].includes(name)
      || code === 'SCHEMA_CONFLICT'
    ) {
      return apiError(id, 'SCHEMA_CONFLICT', 'The schema state conflicts');
    }
    if (name === 'ProgramConflictError' || code === 'PROGRAM_CONFLICT') {
      return apiError(id, 'PROGRAM_CONFLICT', 'The program state conflicts');
    }
  }
  return downstream === 'identity'
    ? apiError(id, 'IDENTITY_UNAVAILABLE', 'Identity is temporarily unavailable', true)
    : apiError(id, 'CORE_UNAVAILABLE', 'Core is temporarily unavailable', true);
}

async function handleSession(
  request: Request,
  env: OperatorWebEnv,
  id: string,
): Promise<Response> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const principal = await resolveBrowserPrincipal(env, cookieHeader, id);
  if ('error' in principal) return errorResponse(principal);
  let livePrincipal = principal;
  if (principal.platformRole === 'root') {
    const merchantId = await selectedMerchant(env, cookieHeader, principal);
    if (merchantId) {
      const selected = await resolveBrowserPrincipal(env, cookieHeader, id, merchantId);
      if ('error' in selected) return errorResponse(selected);
      if (
        selected.platformRole === 'root'
        && selected.sessionId === principal.sessionId
        && selected.merchantId === merchantId
      ) livePrincipal = selected;
    }
  }
  const { sessionId: privateSessionId, ...browserPrincipal } = livePrincipal;
  void privateSessionId;
  const view = OperatorSessionViewSchema.parse({
    ...browserPrincipal,
    merchantSelectionRequired: livePrincipal.platformRole === 'root' && !livePrincipal.merchantId,
  });
  return new Response(JSON.stringify(view), { status: 200, headers: responseHeaders(id) });
}

async function handleSelection(
  request: Request,
  env: OperatorWebEnv,
  id: string,
): Promise<Response> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const base = await resolveBrowserPrincipal(env, cookieHeader, id);
  if ('error' in base) return errorResponse(base);
  if (base.platformRole !== 'root') {
    return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
  }
  let body;
  try {
    body = OperatorMerchantSelectionRequestSchema.parse(await requestBody(request));
  } catch {
    return invalidRequest(id);
  }
  const selected = await resolveBrowserPrincipal(env, cookieHeader, id, body.merchantId);
  if ('error' in selected) return errorResponse(selected);
  if (
    selected.platformRole !== 'root'
    || selected.sessionId !== base.sessionId
    || selected.merchantId !== body.merchantId
  ) return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
  const headers = new Headers({
    'x-correlation-id': id,
    'cache-control': 'no-store',
    'set-cookie': await selectionCookie(env, base, body.merchantId),
  });
  return new Response(null, { status: 204, headers });
}

async function handleProvisionClient(
  request: Request,
  env: OperatorWebEnv,
  id: string,
): Promise<Response> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const principal = await resolveBrowserPrincipal(env, cookieHeader, id);
  if ('error' in principal) return errorResponse(principal);
  if (principal.platformRole !== 'root') {
    return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
  }
  let body;
  try {
    body = OperatorClientProvisionRequestSchema.parse(await requestBody(request));
  } catch {
    return invalidRequest(id);
  }
  try {
    const { provisioningId, merchantId } = await deriveProvisioningIds(
      env, principal.userId, body.idempotencyKey,
    );
    const raw = await env.IDENTITY.provisionClient({
      sessionId: principal.sessionId,
      selectedMerchantId: merchantId,
      input: { provisioningId, merchantId, name: body.name, correlationId: id },
    });
    const failure = ApiErrorSchema.safeParse(raw);
    if (failure.success) {
      if (failure.data.error.correlationId !== id) {
        throw new Error('Identity returned an invalid correlation id');
      }
      return errorResponse(failure.data);
    }
    const output = ClientProvisioningViewSchema.parse(raw);
    if (
      output.provisioningId !== provisioningId
      || output.merchantId !== merchantId
      || output.name !== body.name
    ) throw new Error('Identity provisioning response did not match the request');
    return new Response(JSON.stringify(output), { status: 201, headers: responseHeaders(id) });
  } catch (error) {
    return errorResponse(downstreamError(id, 'identity', error));
  }
}

async function handleRootPlatformRead(
  request: Request,
  env: OperatorWebEnv,
  id: string,
  provisioningId?: string,
): Promise<Response> {
  if ([...new URL(request.url).searchParams].length > 0) return invalidRequest(id);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const principal = await resolveBrowserPrincipal(env, cookieHeader, id);
  if ('error' in principal) return errorResponse(principal);
  if (principal.platformRole !== 'root') {
    return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
  }
  try {
    const raw = provisioningId === undefined
      ? await env.IDENTITY.listClients({ cookieHeader, correlationId: id })
      : await env.IDENTITY.getProvisioningForRoot({
        cookieHeader, provisioningId, correlationId: id,
      });
    const failure = ApiErrorSchema.safeParse(raw);
    if (failure.success) {
      if (failure.data.error.correlationId !== id) {
        throw new Error('Identity returned an invalid correlation id');
      }
      return errorResponse(failure.data);
    }
    const output = provisioningId === undefined
      ? IdentityClientsResponseSchema.parse(raw)
      : ClientProvisioningViewSchema.parse(raw);
    if (
      provisioningId !== undefined
      && ClientProvisioningViewSchema.parse(output).provisioningId !== provisioningId
    ) throw new Error('Identity provisioning response did not match the request');
    return new Response(JSON.stringify(output), { status: 200, headers: responseHeaders(id) });
  } catch (error) {
    return errorResponse(downstreamError(id, 'identity', error));
  }
}

async function handleProvisioningRetry(
  request: Request,
  env: OperatorWebEnv,
  id: string,
  provisioningId: string,
): Promise<Response> {
  if ([...new URL(request.url).searchParams].length > 0) return invalidRequest(id);
  try {
    const body = await requestBody(request);
    if (
      body !== undefined
      && (typeof body !== 'object' || body === null || Object.keys(body).length > 0)
    ) return invalidRequest(id);
  } catch {
    return invalidRequest(id);
  }
  const cookieHeader = request.headers.get('cookie') ?? '';
  const principal = await resolveBrowserPrincipal(env, cookieHeader, id);
  if ('error' in principal) return errorResponse(principal);
  if (principal.platformRole !== 'root') {
    return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
  }
  try {
    const rawCurrent = await env.IDENTITY.getProvisioningForRoot({
      cookieHeader, provisioningId, correlationId: id,
    });
    const currentFailure = ApiErrorSchema.safeParse(rawCurrent);
    if (currentFailure.success) {
      if (currentFailure.data.error.correlationId !== id) {
        throw new Error('Identity returned an invalid correlation id');
      }
      return errorResponse(currentFailure.data);
    }
    const current = ClientProvisioningViewSchema.parse(rawCurrent);
    if (current.provisioningId !== provisioningId) {
      throw new Error('Identity provisioning response did not match the request');
    }
    if (current.status !== 'failed' || !current.retryable) {
      return errorResponse(apiError(
        id, 'OPERATION_FAILED', 'Provisioning cannot be retried',
      ));
    }
    const rawRetried = await env.IDENTITY.provisionClient({
      sessionId: principal.sessionId,
      selectedMerchantId: current.merchantId,
      input: {
        provisioningId: current.provisioningId,
        merchantId: current.merchantId,
        name: current.name,
        correlationId: id,
      },
    });
    const retryFailure = ApiErrorSchema.safeParse(rawRetried);
    if (retryFailure.success) {
      if (retryFailure.data.error.correlationId !== id) {
        throw new Error('Identity returned an invalid correlation id');
      }
      return errorResponse(retryFailure.data);
    }
    const retried = ClientProvisioningViewSchema.parse(rawRetried);
    if (
      retried.provisioningId !== current.provisioningId
      || retried.merchantId !== current.merchantId
      || retried.name !== current.name
    ) throw new Error('Identity provisioning response did not match the request');
    return new Response(JSON.stringify(retried), {
      status: 200, headers: responseHeaders(id),
    });
  } catch (error) {
    return errorResponse(downstreamError(id, 'identity', error));
  }
}

async function handleInvitationAcceptance(
  request: Request,
  env: OperatorWebEnv,
  id: string,
): Promise<Response> {
  let input;
  try {
    const body = OperatorInvitationAcceptRequestSchema.parse(await requestBody(request));
    input = IdentityAcceptInvitationRequestSchema.parse({
      ...body, correlationId: id,
    });
  } catch {
    return invalidRequest(id);
  }
  try {
    const raw = await env.IDENTITY.acceptInvitation(input);
    const failure = ApiErrorSchema.safeParse(raw);
    if (failure.success) {
      if (failure.data.error.correlationId !== id) {
        throw new Error('Identity returned an invalid correlation id');
      }
      return errorResponse(failure.data);
    }
    const membership = MembershipViewSchema.parse(raw);
    return new Response(JSON.stringify(membership), {
      status: 200, headers: responseHeaders(id),
    });
  } catch (error) {
    return errorResponse(downstreamError(id, 'identity', error));
  }
}

async function handleProtected(
  request: Request,
  env: OperatorWebEnv,
  id: string,
  match: NonNullable<ReturnType<typeof matchedRoute>>,
): Promise<Response> {
  if ([...new URL(request.url).searchParams].length > 0) return invalidRequest(id);
  const cookieHeader = request.headers.get('cookie') ?? '';
  const principal = await principalForOperation(env, cookieHeader, id);
  if ('error' in principal) return errorResponse(principal);
  const operator = operatorContext(principal, match.route.permission, id);
  if (!operator) return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
  let body: unknown;
  try {
    body = match.route.bodySchema?.parse(await requestBody(request));
  } catch {
    return invalidRequest(id);
  }
  try {
    const routeContext = {
      env, principal, operator, params: match.params, body, correlationId: id,
    };
    const raw = await match.route.invoke(routeContext);
    const failure = ApiErrorSchema.safeParse(raw);
    if (failure.success) {
      if (failure.data.error.correlationId !== id) {
        throw new Error('Downstream returned an invalid correlation id');
      }
      return errorResponse(failure.data);
    }
    let output: unknown;
    try {
      output = match.route.responseSchema.parse(raw);
    } catch {
      throw new Error('Downstream returned a malformed response');
    }
    match.route.validateOutput?.(output, routeContext);
    return new Response(JSON.stringify(output), {
      status: match.route.status ?? 200,
      headers: responseHeaders(id),
    });
  } catch (error) {
    return errorResponse(downstreamError(id, match.route.downstream, error));
  }
}

export function createOperatorWebWorker(): ExportedHandler<OperatorWebEnv> {
  return {
    async fetch(request, env) {
      const id = correlationId(request);
      const url = new URL(request.url);
      try {
        if (unsafeOperatorRequest(request, env)) {
          return errorResponse(apiError(id, 'FORBIDDEN', 'Operation is not permitted'));
        }
        if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/internal/')) {
          return await proxyAuth(request, env, id);
        }
        if (url.pathname === '/operator/v1/session' && request.method === 'GET') {
          return handleSession(request, env, id);
        }
        if (
          url.pathname === '/operator/v1/platform/merchant-selection'
          && request.method === 'POST'
        ) return handleSelection(request, env, id);
        if (url.pathname === '/operator/v1/platform/clients' && request.method === 'POST') {
          return handleProvisionClient(request, env, id);
        }
        if (url.pathname === '/operator/v1/platform/clients' && request.method === 'GET') {
          return handleRootPlatformRead(request, env, id);
        }
        const provisioningMatch = /^\/operator\/v1\/platform\/provisionings\/([^/]+)$/u
          .exec(url.pathname);
        if (provisioningMatch && request.method === 'GET') {
          const provisioningId = provisioningMatch[1];
          if (provisioningId === undefined) return notFound(id);
          return handleRootPlatformRead(request, env, id, decodeURIComponent(provisioningId));
        }
        const provisioningRetryMatch =
          /^\/operator\/v1\/platform\/provisionings\/([^/]+)\/retry$/u.exec(url.pathname);
        if (provisioningRetryMatch && request.method === 'POST') {
          const provisioningId = provisioningRetryMatch[1];
          if (provisioningId === undefined) return notFound(id);
          return handleProvisioningRetry(
            request, env, id, decodeURIComponent(provisioningId),
          );
        }
        if (
          url.pathname === '/operator/v1/invitations/accept'
          && request.method === 'POST'
        ) return handleInvitationAcceptance(request, env, id);
        if (url.pathname.startsWith('/operator/v1/')) {
          const match = matchedRoute(url.pathname, request.method);
          return match ? handleProtected(request, env, id, match) : notFound(id);
        }
        return await env.ASSETS.fetch(request);
      } catch {
        return errorResponse(apiError(
          id, 'OPERATOR_WEB_UNAVAILABLE', 'Operator service is temporarily unavailable', true,
        ));
      }
    },
  };
}

export default createOperatorWebWorker();
