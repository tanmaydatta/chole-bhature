import {
  AcceptInvitationInputSchema,
  ApiErrorSchema,
  ClientProvisioningViewSchema,
  IdentityAcceptInvitationRequestSchema,
  IdentityChangeMemberRoleRequestSchema,
  IdentityCreateInvitationRequestSchema,
  IdentityGetProvisioningRequestSchema,
  IdentityClientsResponseSchema,
  IdentityInvitationsResponseSchema,
  IdentityListInvitationsRequestSchema,
  IdentityListMembersRequestSchema,
  IdentityMembersResponseSchema,
  IdentityProvisionClientRequestSchema,
  IdentityRemoveMemberRequestSchema,
  IdentityResolvePrincipalRequestSchema,
  IdentityRootSessionProvisioningRequestSchema,
  IdentityRootSessionRequestSchema,
  IdentityRetryInvitationRequestSchema,
  InvitationViewSchema,
  MembershipViewSchema,
  OperatorPrincipalSchema,
  type ApiError,
  type OperatorPrincipal,
} from '@incentives/contracts';

import { authorize } from '../authorization/authorize.js';
import {
  createInvitationService,
  InvitationInvalidError,
  InvitationOperationError,
  type InvitationEmailAdapter,
} from '../services/invitations.js';
import {
  createOrganizationService,
  OrganizationOperationError,
  type CoreMerchantProvisioningClient,
} from '../services/organizations.js';

export interface IdentityOperatorServiceOptions {
  database: D1Database;
  core: CoreMerchantProvisioningClient;
  email: InvitationEmailAdapter;
  publicOrigin: string;
}

type RpcFailureCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'INVITATION_INVALID'
  | 'OPERATION_FAILED'
  | 'IDENTITY_UNAVAILABLE';

function correlationIdFrom(input: unknown): string {
  if (typeof input !== 'object' || input === null) return crypto.randomUUID();
  const direct = Reflect.get(input, 'correlationId');
  if (typeof direct === 'string' && direct.trim()) return direct;
  const nested = Reflect.get(input, 'input');
  if (typeof nested === 'object' && nested !== null) {
    const value = Reflect.get(nested, 'correlationId');
    if (typeof value === 'string' && value.trim()) return value;
  }
  return crypto.randomUUID();
}

function failure(
  correlationId: string,
  code: RpcFailureCode,
  message: string,
  retryable = false,
): ApiError {
  return ApiErrorSchema.parse({
    error: { code, message, correlationId, retryable },
  });
}

async function auditDenial(
  database: D1Database,
  principal: OperatorPrincipal | null,
  correlationId: string,
): Promise<void> {
  try {
    await database.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'authorization.denied',
        'operation', 'private_rpc', 'denied', ?6, NULL)
    `).bind(
      crypto.randomUUID(),
      Date.now(),
      principal?.platformRole === 'root' ? 'root' : principal ? 'member' : 'anonymous',
      principal?.userId ?? 'anonymous',
      principal?.merchantId ?? null,
      correlationId,
    ).run();
  } catch {
    // Denial remains fail-closed when the audit sink is unavailable.
  }
}

export function createIdentityOperatorService(options: IdentityOperatorServiceOptions) {
  const organizations = createOrganizationService({
    database: options.database,
    core: options.core,
  });
  const invitations = createInvitationService({
    database: options.database,
    email: options.email,
    publicOrigin: options.publicOrigin,
  });

  async function principalFor(
    sessionId: string,
    selectedMerchantId: string,
    correlationId: string,
  ): Promise<OperatorPrincipal | ApiError> {
    const live = await organizations.resolvePrincipal(sessionId);
    if (!live) {
      await auditDenial(options.database, null, correlationId);
      return failure(correlationId, 'UNAUTHORIZED', 'Authentication is required');
    }
    if (live.platformRole !== 'root' && live.merchantId !== selectedMerchantId) {
      await auditDenial(options.database, live, correlationId);
      return failure(correlationId, 'FORBIDDEN', 'Operation is not permitted');
    }
    const principal = live.platformRole === 'root'
      ? await organizations.resolvePrincipal(sessionId, selectedMerchantId)
      : live;
    if (principal) return OperatorPrincipalSchema.parse(principal);
    await auditDenial(options.database, live, correlationId);
    return failure(correlationId, 'FORBIDDEN', 'Operation is not permitted');
  }

  async function rootPrincipalFor(
    sessionId: string,
    correlationId: string,
  ): Promise<OperatorPrincipal | ApiError> {
    const principal = await organizations.resolvePrincipal(sessionId);
    if (!principal) {
      await auditDenial(options.database, null, correlationId);
      return failure(correlationId, 'UNAUTHORIZED', 'Authentication is required');
    }
    if (principal.platformRole === 'root') return OperatorPrincipalSchema.parse(principal);
    await auditDenial(options.database, principal, correlationId);
    return failure(correlationId, 'FORBIDDEN', 'Operation is not permitted');
  }

  function parseFailure(input: unknown): ApiError {
    return failure(
      correlationIdFrom(input),
      'INVALID_REQUEST',
      'Request validation failed',
    );
  }

  async function requirePermission(
    principal: OperatorPrincipal,
    permission: 'members:read' | 'members:manage' | 'credentials:manage',
    merchantId: string,
    correlationId: string,
  ): Promise<ApiError | null> {
    if (authorize(principal, permission, merchantId)) return null;
    await auditDenial(options.database, principal, correlationId);
    return failure(correlationId, 'FORBIDDEN', 'Operation is not permitted');
  }

  async function normalizeRpc<T>(
    rawInput: unknown,
    operation: () => Promise<T>,
  ): Promise<T | ApiError> {
    try {
      return await operation();
    } catch {
      return failure(
        correlationIdFrom(rawInput),
        'IDENTITY_UNAVAILABLE',
        'Identity is temporarily unavailable',
        true,
      );
    }
  }

  const unsafeService = {
    async resolvePrincipal(rawInput: unknown) {
      const parsed = IdentityResolvePrincipalRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await organizations.resolvePrincipal(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
      );
      if (!principal) {
        await auditDenial(options.database, null, parsed.data.correlationId);
        return failure(
          parsed.data.correlationId,
          'UNAUTHORIZED',
          'Authentication is required',
        );
      }
      return OperatorPrincipalSchema.parse(principal);
    },

    async provisionClient(rawInput: unknown) {
      const parsed = IdentityProvisionClientRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.input.correlationId,
      );
      if ('error' in principal) return principal;
      if (principal.platformRole !== 'root') {
        await auditDenial(options.database, principal, parsed.data.input.correlationId);
        return failure(
          parsed.data.input.correlationId,
          'FORBIDDEN',
          'Operation is not permitted',
        );
      }
      const denied = await requirePermission(
        principal,
        'credentials:manage',
        parsed.data.input.merchantId,
        parsed.data.input.correlationId,
      );
      if (denied) return denied;
      try {
        return ClientProvisioningViewSchema.parse(
          await organizations.provisionClient(principal, parsed.data.input),
        );
      } catch (error) {
        if (!(error instanceof OrganizationOperationError)) throw error;
        return failure(
          parsed.data.input.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
    },

    async getProvisioning(rawInput: unknown) {
      const parsed = IdentityGetProvisioningRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if ('error' in principal) return principal;
      if (principal.platformRole !== 'root') {
        await auditDenial(options.database, principal, parsed.data.correlationId);
        return failure(
          parsed.data.correlationId,
          'FORBIDDEN',
          'Operation is not permitted',
        );
      }
      const row = await organizations.getProvisioning(parsed.data.provisioningId);
      if (!row || row.merchantId !== parsed.data.selectedMerchantId) {
        return failure(
          parsed.data.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
      return ClientProvisioningViewSchema.parse(row);
    },

    async listClients(rawInput: unknown) {
      const parsed = IdentityRootSessionRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await rootPrincipalFor(parsed.data.sessionId, parsed.data.correlationId);
      if ('error' in principal) return principal;
      return IdentityClientsResponseSchema.parse({
        clients: await organizations.listProvisionings(),
      });
    },

    async getProvisioningForRoot(rawInput: unknown) {
      const parsed = IdentityRootSessionProvisioningRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await rootPrincipalFor(parsed.data.sessionId, parsed.data.correlationId);
      if ('error' in principal) return principal;
      const row = await organizations.getProvisioning(parsed.data.provisioningId);
      if (!row) {
        return failure(
          parsed.data.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
      return ClientProvisioningViewSchema.parse(row);
    },

    async createInvitation(rawInput: unknown) {
      const parsed = IdentityCreateInvitationRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.input.correlationId,
      );
      if ('error' in principal) return principal;
      const denied = await requirePermission(
        principal,
        'members:manage',
        parsed.data.selectedMerchantId,
        parsed.data.input.correlationId,
      );
      if (denied) return denied;
      try {
        return InvitationViewSchema.parse(
          await invitations.createInvitation(principal, parsed.data.input),
        );
      } catch (error) {
        if (!(error instanceof InvitationOperationError)) throw error;
        return failure(
          parsed.data.input.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
    },

    async listMembers(rawInput: unknown) {
      const parsed = IdentityListMembersRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if ('error' in principal) return principal;
      const denied = await requirePermission(
        principal,
        'members:read',
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if (denied) return denied;
      const rows = await options.database.prepare(`
        SELECT memberships.id, memberships.organization_id AS organizationId,
          memberships.user_id AS userId, memberships.role, memberships.status
        FROM memberships
        INNER JOIN organizations ON organizations.id = memberships.organization_id
        WHERE organizations.merchant_id = ?1 AND organizations.status = 'active'
        ORDER BY memberships.id
      `).bind(parsed.data.selectedMerchantId).all();
      return IdentityMembersResponseSchema.parse({ members: rows.results });
    },

    async listInvitations(rawInput: unknown) {
      const parsed = IdentityListInvitationsRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if ('error' in principal) return principal;
      const denied = await requirePermission(
        principal,
        'members:read',
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if (denied) return denied;
      const rows = await options.database.prepare(`
        SELECT invitations.id, invitations.organization_id AS organizationId,
          invitations.email, invitations.role, invitations.status,
          invitations.expires_at AS expiresAt
        FROM invitations
        INNER JOIN organizations ON organizations.id = invitations.organization_id
        WHERE organizations.merchant_id = ?1 AND organizations.status = 'active'
        ORDER BY invitations.id
      `).bind(parsed.data.selectedMerchantId).all<{
        id: string;
        organizationId: string;
        email: string;
        role: 'admin' | 'operator' | 'viewer';
        status: 'pending' | 'sent' | 'delivery_failed' | 'accepted' | 'revoked' | 'expired';
        expiresAt: number;
      }>();
      return IdentityInvitationsResponseSchema.parse({
        invitations: rows.results.map(row => ({
          ...row,
          status: row.expiresAt <= Date.now() && ['pending', 'sent', 'delivery_failed']
            .includes(row.status)
            ? 'expired'
            : row.status,
          expiresAt: new Date(row.expiresAt).toISOString(),
        })),
      });
    },

    async retryInvitation(rawInput: unknown) {
      const parsed = IdentityRetryInvitationRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if ('error' in principal) return principal;
      const denied = await requirePermission(
        principal,
        'members:manage',
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if (denied) return denied;
      try {
        return InvitationViewSchema.parse(await invitations.retryInvitation(
          principal,
          parsed.data.invitationId,
          parsed.data.correlationId,
        ));
      } catch (error) {
        if (!(error instanceof InvitationOperationError)) throw error;
        return failure(
          parsed.data.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
    },

    async acceptInvitation(rawInput: unknown) {
      const parsed = IdentityAcceptInvitationRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return failure(
          correlationIdFrom(rawInput),
          'INVITATION_INVALID',
          'Invitation is invalid',
        );
      }
      try {
        return MembershipViewSchema.parse(await invitations.acceptInvitation(
          AcceptInvitationInputSchema.parse(parsed.data),
        ));
      } catch (error) {
        if (!(error instanceof InvitationInvalidError)) throw error;
        return failure(
          parsed.data.correlationId,
          'INVITATION_INVALID',
          'Invitation is invalid',
        );
      }
    },

    async removeMember(rawInput: unknown) {
      const parsed = IdentityRemoveMemberRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if ('error' in principal) return principal;
      const denied = await requirePermission(
        principal,
        'members:manage',
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if (denied) return denied;
      try {
        return MembershipViewSchema.parse(await organizations.removeMember(principal, {
          membershipId: parsed.data.membershipId,
          correlationId: parsed.data.correlationId,
        }));
      } catch (error) {
        if (!(error instanceof OrganizationOperationError)) throw error;
        return failure(
          parsed.data.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
    },

    async changeMemberRole(rawInput: unknown) {
      const parsed = IdentityChangeMemberRoleRequestSchema.safeParse(rawInput);
      if (!parsed.success) return parseFailure(rawInput);
      const principal = await principalFor(
        parsed.data.sessionId,
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if ('error' in principal) return principal;
      const denied = await requirePermission(
        principal,
        'members:manage',
        parsed.data.selectedMerchantId,
        parsed.data.correlationId,
      );
      if (denied) return denied;
      try {
        return MembershipViewSchema.parse(await organizations.changeMemberRole(principal, {
          membershipId: parsed.data.membershipId,
          role: parsed.data.role,
          correlationId: parsed.data.correlationId,
        }));
      } catch (error) {
        if (!(error instanceof OrganizationOperationError)) throw error;
        return failure(
          parsed.data.correlationId,
          'OPERATION_FAILED',
          'Operation could not be completed',
        );
      }
    },
  };

  return {
    resolvePrincipal: (input: unknown) => normalizeRpc(
      input, () => unsafeService.resolvePrincipal(input),
    ),
    provisionClient: (input: unknown) => normalizeRpc(
      input, () => unsafeService.provisionClient(input),
    ),
    getProvisioning: (input: unknown) => normalizeRpc(
      input, () => unsafeService.getProvisioning(input),
    ),
    listClients: (input: unknown) => normalizeRpc(
      input, () => unsafeService.listClients(input),
    ),
    getProvisioningForRoot: (input: unknown) => normalizeRpc(
      input, () => unsafeService.getProvisioningForRoot(input),
    ),
    createInvitation: (input: unknown) => normalizeRpc(
      input, () => unsafeService.createInvitation(input),
    ),
    listMembers: (input: unknown) => normalizeRpc(
      input, () => unsafeService.listMembers(input),
    ),
    listInvitations: (input: unknown) => normalizeRpc(
      input, () => unsafeService.listInvitations(input),
    ),
    retryInvitation: (input: unknown) => normalizeRpc(
      input, () => unsafeService.retryInvitation(input),
    ),
    acceptInvitation: (input: unknown) => normalizeRpc(
      input, () => unsafeService.acceptInvitation(input),
    ),
    removeMember: (input: unknown) => normalizeRpc(
      input, () => unsafeService.removeMember(input),
    ),
    changeMemberRole: (input: unknown) => normalizeRpc(
      input, () => unsafeService.changeMemberRole(input),
    ),
  };
}
