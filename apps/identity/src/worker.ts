import type {
  IdentityListInvitationsRequest,
  IdentityListMembersRequest,
  IdentityAcceptInvitationRequest,
  IdentityChangeMemberRoleRequest,
  IdentityCreateInvitationRequest,
  IdentityGetProvisioningRequest,
  IdentityProvisionClientRequest,
  IdentityRootBrowserRequest,
  IdentityRootProvisioningRequest,
  IdentityRemoveMemberRequest,
  IdentityResolvePrincipalRequest,
  IdentityResolveBrowserPrincipalRequest,
  IdentityRetryInvitationRequest,
} from '@incentives/contracts';
import {
  ApiErrorSchema,
  IdentityResolveBrowserPrincipalRequestSchema,
  IdentityRootBrowserRequestSchema,
  IdentityRootProvisioningRequestSchema,
  OperatorPrincipalSchema,
} from '@incentives/contracts';
import { WorkerEntrypoint } from 'cloudflare:workers';

import { createIdentityAuth, validateIdentityEnvironment } from './auth.js';
import { createIdentityEmailAdapter } from './email.js';
import {
  beginRootRecovery,
  errorResponse,
  exchangeRecoveryGrant,
  getRecoverySession,
  reissueRecoveryCodes,
  rotateRecoveryCodes,
  writeIdentityAudit,
} from './recovery.js';
import { createIdentityOperatorService } from './routes/internal.js';
import type { CoreMerchantProvisioningClient } from './services/organizations.js';

export interface Env {
  AUTH_DB: D1Database;
  AUTH_SECRET: string;
  APP_ENV: 'local' | 'staging';
  PUBLIC_APP_ORIGIN: string;
  COOKIE_PREFIX: string;
  EMAIL_MODE: 'local-capture' | 'resend';
  MAGIC_LINK_TTL_SECONDS: string;
  EMAIL_RATE_LIMIT_MAX: string;
  EMAIL_RATE_LIMIT_WINDOW_SECONDS: string;
  STAGING_ALLOWED_RECIPIENTS: string;
  PASSKEY_RP_ID: string;
  PASSKEY_RP_NAME: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  CORE: CoreMerchantProvisioningClient;
}

function withCorrelationId(request: Request, correlationId: string): Request {
  if (request.headers.get('x-correlation-id')) return request;
  const headers = new Headers(request.headers);
  headers.set('x-correlation-id', correlationId);
  return new Request(request, { headers });
}

function correlated(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('x-correlation-id', correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function signupDisabled(correlationId: string): Response {
  return errorResponse(
    correlationId,
    404,
    'SIGNUP_DISABLED',
    'Self-service signup is unavailable.',
  );
}

function privateRouteNotFound(correlationId: string): Response {
  return errorResponse(
    correlationId,
    404,
    'NOT_FOUND',
    'The requested resource is unavailable.',
  );
}

function allowedRecipients(env: Env): ReadonlySet<string> {
  const parsed: unknown = JSON.parse(env.STAGING_ALLOWED_RECIPIENTS);
  if (!Array.isArray(parsed) || !parsed.every(value => typeof value === 'string')) {
    throw new Error('STAGING_ALLOWED_RECIPIENTS must be a JSON string array');
  }
  return new Set(parsed.map(value => value.trim().toLowerCase()));
}

function operatorService(env: Env) {
  return createIdentityOperatorService({
    database: env.AUTH_DB,
    core: env.CORE,
    email: createIdentityEmailAdapter({
      mode: env.EMAIL_MODE,
      database: env.AUTH_DB,
      allowedRecipients: allowedRecipients(env),
      ...(env.RESEND_API_KEY === undefined ? {} : { resendApiKey: env.RESEND_API_KEY }),
      ...(env.RESEND_FROM === undefined ? {} : { resendFrom: env.RESEND_FROM }),
    }),
    publicOrigin: env.PUBLIC_APP_ORIGIN,
  });
}

export class IdentityOperatorService extends WorkerEntrypoint<Env> {
  async resolveBrowserPrincipal(input: IdentityResolveBrowserPrincipalRequest) {
    const parsed = IdentityResolveBrowserPrincipalRequestSchema.safeParse(input);
    const correlationId = parsed.success && parsed.data.correlationId
      ? parsed.data.correlationId
      : crypto.randomUUID();
    if (!parsed.success) {
      return ApiErrorSchema.parse({
        error: {
          code: 'INVALID_REQUEST', message: 'Request validation failed',
          correlationId, retryable: false,
        },
      });
    }
    try {
      const headers = new Headers();
      if (parsed.data.cookieHeader) headers.set('cookie', parsed.data.cookieHeader);
      const session = await createIdentityAuth(this.env).getSession(headers);
      if (!session) {
        return ApiErrorSchema.parse({
          error: {
            code: 'UNAUTHORIZED', message: 'Authentication is required',
            correlationId, retryable: false,
          },
        });
      }
      const service = operatorService(this.env);
      const base = await service.resolvePrincipal({
        sessionId: session.session.id,
        correlationId,
      });
      if ('error' in base || !parsed.data.selectedMerchantId) return base;
      if (base.platformRole === 'root') {
        const organization = await this.env.AUTH_DB.prepare(`
          SELECT id FROM organizations
          WHERE merchant_id = ?1 AND status = 'active'
        `).bind(parsed.data.selectedMerchantId).first<{ id: string }>();
        if (!organization) {
          return ApiErrorSchema.parse({
            error: {
              code: 'FORBIDDEN', message: 'Operation is not permitted',
              correlationId, retryable: false,
            },
          });
        }
        const selected = await service.resolvePrincipal({
          sessionId: session.session.id,
          selectedMerchantId: parsed.data.selectedMerchantId,
          correlationId,
        });
        if ('error' in selected) return selected;
        return OperatorPrincipalSchema.parse({
          ...selected,
          organizationId: organization.id,
        });
      }
      return service.resolvePrincipal({
        sessionId: session.session.id,
        selectedMerchantId: parsed.data.selectedMerchantId,
        correlationId,
      });
    } catch {
      return ApiErrorSchema.parse({
        error: {
          code: 'IDENTITY_UNAVAILABLE', message: 'Identity is temporarily unavailable',
          correlationId, retryable: true,
        },
      });
    }
  }

  async resolvePrincipal(input: IdentityResolvePrincipalRequest) {
    return operatorService(this.env).resolvePrincipal(input);
  }

  async listClients(input: IdentityRootBrowserRequest) {
    const parsed = IdentityRootBrowserRequestSchema.parse(input);
    const principal = await this.resolveBrowserPrincipal(parsed);
    if ('error' in principal) return principal;
    if (principal.platformRole !== 'root') {
      return ApiErrorSchema.parse({
        error: {
          code: 'FORBIDDEN', message: 'Operation is not permitted',
          correlationId: parsed.correlationId, retryable: false,
        },
      });
    }
    return operatorService(this.env).listClients({
      sessionId: principal.sessionId,
      correlationId: parsed.correlationId,
    });
  }

  async getProvisioningForRoot(input: IdentityRootProvisioningRequest) {
    const parsed = IdentityRootProvisioningRequestSchema.parse(input);
    const principal = await this.resolveBrowserPrincipal({
      cookieHeader: parsed.cookieHeader,
      correlationId: parsed.correlationId,
    });
    if ('error' in principal) return principal;
    if (principal.platformRole !== 'root') {
      return ApiErrorSchema.parse({
        error: {
          code: 'FORBIDDEN', message: 'Operation is not permitted',
          correlationId: parsed.correlationId, retryable: false,
        },
      });
    }
    return operatorService(this.env).getProvisioningForRoot({
      sessionId: principal.sessionId,
      provisioningId: parsed.provisioningId,
      correlationId: parsed.correlationId,
    });
  }

  async provisionClient(input: IdentityProvisionClientRequest) {
    return operatorService(this.env).provisionClient(input);
  }

  async getProvisioning(input: IdentityGetProvisioningRequest) {
    return operatorService(this.env).getProvisioning(input);
  }

  async createInvitation(input: IdentityCreateInvitationRequest) {
    return operatorService(this.env).createInvitation(input);
  }

  async listMembers(input: IdentityListMembersRequest) {
    return operatorService(this.env).listMembers(input);
  }

  async listInvitations(input: IdentityListInvitationsRequest) {
    return operatorService(this.env).listInvitations(input);
  }

  async retryInvitation(input: IdentityRetryInvitationRequest) {
    return operatorService(this.env).retryInvitation(input);
  }

  async acceptInvitation(input: IdentityAcceptInvitationRequest) {
    return operatorService(this.env).acceptInvitation(input);
  }

  async removeMember(input: IdentityRemoveMemberRequest) {
    return operatorService(this.env).removeMember(input);
  }

  async changeMemberRole(input: IdentityChangeMemberRoleRequest) {
    return operatorService(this.env).changeMemberRole(input);
  }
}

export default {
  async fetch(originalRequest, env, executionContext) {
    const correlationId = originalRequest.headers.get('x-correlation-id') ?? crypto.randomUUID();
    const request = withCorrelationId(originalRequest, correlationId);
    try {
      validateIdentityEnvironment(env);
      const url = new URL(request.url);
      let response: Response;
      if (
        url.pathname.startsWith('/internal/')
        || url.pathname === '/auth/root/bootstrap'
      ) {
        response = privateRouteNotFound(correlationId);
      } else if (url.pathname.startsWith('/auth/sign-up/')) {
        response = signupDisabled(correlationId);
      } else if (url.pathname === '/auth/root/recovery' && request.method === 'POST') {
        response = await beginRootRecovery(request, env, correlationId);
      } else if (
        url.pathname === '/auth/root/recovery/exchange'
        && request.method === 'POST'
      ) {
        response = await exchangeRecoveryGrant(request, env, correlationId);
      } else if (
        url.pathname === '/auth/root/recovery/rotate-codes'
        && request.method === 'POST'
      ) {
        const identity = createIdentityAuth(env);
        const session = await identity.getSession(request.headers);
        const recovery = session
          ? await getRecoverySession(env, session.session.id)
          : null;
        if (recovery) {
          response = await rotateRecoveryCodes(env, recovery.sessionId, correlationId);
        } else if (
          session?.session.authenticationMethod === 'passkey'
          && session.session.recoveryOnly === false
        ) {
          response = await reissueRecoveryCodes(env, session.user.id, correlationId);
        } else {
          response = errorResponse(
              correlationId,
              403,
              'RECOVERY_RESTRICTED',
              'A recovery session or verified root passkey is required.',
            );
        }
      } else {
        const identity = createIdentityAuth(env);
        response = await identity.handler(request, executionContext);
      }
      return correlated(response, correlationId);
    } catch {
      await writeIdentityAudit(env, correlationId, {
        actorKind: 'system', actorId: 'identity', action: 'identity.worker_failure',
        targetType: 'identity', targetId: 'worker', outcome: 'failed',
      });
      return errorResponse(
        correlationId,
        503,
        'IDENTITY_UNAVAILABLE',
        'Identity is temporarily unavailable.',
        true,
      );
    }
  },
} satisfies ExportedHandler<Env>;
