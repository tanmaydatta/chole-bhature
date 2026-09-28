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
  IdentityE2eCapabilitiesSchema,
  ProductE2eCapabilitiesSchema,
  E2eFixtureAccountRequestSchema,
  E2eFixtureAccountSchema,
  E2eRunActionRequestSchema,
  E2eRunInventorySchema,
  E2eRunInspectionRequestSchema,
  E2eRunInspectionSchema,
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
import { createOrganizationService } from './services/organizations.js';
import { createIdentityE2eLifecycle, type E2eTenantIdentity } from './services/e2e-lifecycle.js';
import { assertAuthE2eMigrations } from './services/e2e-capabilities.js';
import { createIdentityE2eFixtures } from './services/e2e-fixtures.js';
import type { OperatorCallContext } from '@incentives/contracts';

interface CoreE2eLifecycleClient {
  getE2eCapabilities(context: { actorUserId: string;
    actorKind: 'root'; correlationId: string }): Promise<unknown>;
  inspectE2eRun(context: OperatorCallContext, input: E2eTenantIdentity, query: {
    evaluationId: string; idempotencyKey: string; programRefs: string[];
  }): Promise<unknown>;
  previewE2eRun(context: OperatorCallContext, input: E2eTenantIdentity): Promise<{
    status: string; counts: Record<string, number>;
  }>;
  disposeE2eRun(context: OperatorCallContext, input: E2eTenantIdentity): Promise<{
    status: string; counts: Record<string, number>;
  }>;
}

export interface Env {
  AUTH_DB: D1Database;
  AUTH_SECRET: string;
  APP_ENV: 'local' | 'staging';
  E2E_LOCAL_TEST_MODE?: string;
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
  CORE: CoreMerchantProvisioningClient & CoreE2eLifecycleClient;
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
    appEnv: env.APP_ENV,
    localTestMode: env.E2E_LOCAL_TEST_MODE,
  });
}

export class IdentityOperatorService extends WorkerEntrypoint<Env> {
  async getE2eCapabilities(input: unknown) {
    const parsed = input && typeof input === 'object'
      ? input as { sessionId?: unknown; correlationId?: unknown } : {};
    const correlationId = typeof parsed.correlationId === 'string'
      && parsed.correlationId.length > 0 && parsed.correlationId.length <= 200
      ? parsed.correlationId : crypto.randomUUID();
    const failure = (code: 'NOT_FOUND' | 'INVALID_REQUEST' | 'UNAUTHORIZED'
      | 'FORBIDDEN' | 'IDENTITY_UNAVAILABLE') => ApiErrorSchema.parse({
      error: { code, message: 'E2E capability handshake is unavailable',
        correlationId, retryable: code === 'IDENTITY_UNAVAILABLE' },
    });
    if (this.env.APP_ENV !== 'staging'
      && !(this.env.APP_ENV === 'local' && this.env.E2E_LOCAL_TEST_MODE === '1')) {
      return failure('NOT_FOUND');
    }
    if (typeof parsed.sessionId !== 'string' || !parsed.sessionId
      || typeof parsed.correlationId !== 'string' || !parsed.correlationId) {
      return failure('INVALID_REQUEST');
    }
    try {
      const principal = await createOrganizationService({ database: this.env.AUTH_DB })
        .resolvePrincipal(parsed.sessionId);
      if (!principal) return failure('UNAUTHORIZED');
      if (principal.platformRole !== 'root') return failure('FORBIDDEN');
      await assertAuthE2eMigrations(this.env.AUTH_DB);
      const product = ProductE2eCapabilitiesSchema.parse(
        await this.env.CORE.getE2eCapabilities({ actorKind: 'root',
          actorUserId: principal.userId, correlationId }),
      );
      return IdentityE2eCapabilitiesSchema.parse({ version: 1,
        migrations: ['0005_e2e_tenant_lifecycle.sql', '0006_e2e_fixture_session.sql'],
        product });
    } catch {
      return failure('IDENTITY_UNAVAILABLE');
    }
  }

  async createE2eAccount(input: unknown) {
    const parsed = E2eFixtureAccountRequestSchema.safeParse(input);
    const correlationId = parsed.success ? parsed.data.correlationId : crypto.randomUUID();
    const failure = (code: 'NOT_FOUND' | 'INVALID_REQUEST' | 'UNAUTHORIZED'
      | 'FORBIDDEN' | 'IDENTITY_UNAVAILABLE') => ApiErrorSchema.parse({
      error: { code, message: 'Operation is not permitted', correlationId,
        retryable: code === 'IDENTITY_UNAVAILABLE' },
    });
    if (this.env.APP_ENV !== 'staging') return failure('NOT_FOUND');
    if (!parsed.success) return failure('INVALID_REQUEST');
    try {
      const principal = await createOrganizationService({ database: this.env.AUTH_DB })
        .resolvePrincipal(parsed.data.sessionId);
      if (!principal) return failure('UNAUTHORIZED');
      if (principal.platformRole !== 'root') return failure('FORBIDDEN');
      const digest = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(parsed.data.proof),
      );
      const proofHash = [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const claim = await this.env.AUTH_DB.prepare(`
        SELECT merchant_id AS merchantId, provisioning_id AS provisioningId,
          proof_hash AS proofHash, status FROM e2e_run_claims WHERE run_id = ?1
      `).bind(parsed.data.runId).first<{
        merchantId: string; provisioningId: string; proofHash: string; status: string;
      }>();
      if (!claim || claim.proofHash !== proofHash || claim.status !== 'active') {
        return failure('FORBIDDEN');
      }
      const auth = createIdentityAuth(this.env);
      const fixtures = createIdentityE2eFixtures({
        database: this.env.AUTH_DB, appEnv: this.env.APP_ENV,
        createSession: (userId, runId, merchantId) => auth.createFixtureSession({
          userId, runId, merchantId,
        }),
      });
      return E2eFixtureAccountSchema.parse(await fixtures.createAccount({
        runId: parsed.data.runId, merchantId: claim.merchantId,
        provisioningId: claim.provisioningId, proofHash,
        slug: parsed.data.slug, role: parsed.data.role,
      }, principal.userId, correlationId));
    } catch {
      return failure('IDENTITY_UNAVAILABLE');
    }
  }

  async inspectE2eRun(input: unknown) {
    return this.e2eRunAction(input, 'inspect');
  }

  async previewE2eRun(input: unknown) {
    return this.e2eRunAction(input, 'preview');
  }

  async disposeE2eRun(input: unknown) {
    return this.e2eRunAction(input, 'dispose');
  }

  private async e2eRunAction(input: unknown, action: 'preview' | 'dispose' | 'inspect') {
    const parsed = action === 'inspect'
      ? E2eRunInspectionRequestSchema.safeParse(input)
      : E2eRunActionRequestSchema.safeParse(input);
    const correlationId = parsed.success ? parsed.data.correlationId : crypto.randomUUID();
    const failure = (code: 'NOT_FOUND' | 'INVALID_REQUEST' | 'UNAUTHORIZED'
      | 'FORBIDDEN' | 'IDENTITY_UNAVAILABLE', retryable = false) => ApiErrorSchema.parse({
      error: { code, message: code === 'IDENTITY_UNAVAILABLE'
        ? 'Identity is temporarily unavailable' : 'Operation is not permitted',
      correlationId, retryable },
    });
    if (this.env.APP_ENV !== 'staging'
      && !(this.env.APP_ENV === 'local' && this.env.E2E_LOCAL_TEST_MODE === '1')) {
      return failure('NOT_FOUND');
    }
    if (!parsed.success) return failure('INVALID_REQUEST');
    try {
      const principal = await createOrganizationService({ database: this.env.AUTH_DB })
        .resolvePrincipal(parsed.data.sessionId);
      if (!principal) return failure('UNAUTHORIZED');
      if (principal.platformRole !== 'root') return failure('FORBIDDEN');
      const digest = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(parsed.data.proof),
      );
      const proofHash = [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const claim = await this.env.AUTH_DB.prepare(`
        SELECT merchant_id AS merchantId, provisioning_id AS provisioningId,
          proof_hash AS proofHash FROM e2e_run_claims WHERE run_id = ?1
      `).bind(parsed.data.runId).first<{
        merchantId: string; provisioningId: string; proofHash: string;
      }>();
      if (!claim || claim.proofHash !== proofHash) return failure('FORBIDDEN');
      const identity = { runId: parsed.data.runId, merchantId: claim.merchantId,
        provisioningId: claim.provisioningId, proofHash };
      const context: OperatorCallContext = {
        actorKind: 'root', actorUserId: principal.userId,
        merchantId: claim.merchantId, permission: 'credentials:manage', correlationId,
      };
      const lifecycle = createIdentityE2eLifecycle({
        database: this.env.AUTH_DB, appEnv: this.env.APP_ENV,
        localTestMode: this.env.E2E_LOCAL_TEST_MODE,
        core: {
          preview: tenant => this.env.CORE.previewE2eRun(context, tenant),
          dispose: tenant => this.env.CORE.disposeE2eRun(context, tenant),
        },
      });
      if (action === 'inspect') {
        const query = E2eRunInspectionRequestSchema.parse(parsed.data);
        await lifecycle.preview(identity);
        return E2eRunInspectionSchema.parse(await this.env.CORE.inspectE2eRun(context, identity, {
          evaluationId: query.evaluationId, idempotencyKey: query.idempotencyKey,
          programRefs: query.programRefs,
        }));
      }
      return E2eRunInventorySchema.parse(action === 'preview'
        ? await lifecycle.preview(identity)
        : await lifecycle.dispose(identity, principal.userId, correlationId));
    } catch {
      return failure('IDENTITY_UNAVAILABLE', true);
    }
  }

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
