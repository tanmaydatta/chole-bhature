import {
  CoreMerchantActivationResultSchema,
  CoreMerchantProvisionResultSchema,
  type MerchantActivationRequest,
  type CoreMerchantActivationResult,
  type CoreMerchantProvisionResult,
  type MerchantProvisionRequest,
  type MerchantProvisionResult,
  type OperatorCallContext,
  type OperatorPrincipal,
} from '@incentives/contracts';

import { authorize } from '../authorization/authorize.js';
import { permissionsForRole, type FixedRole } from '../authorization/registry.js';

export interface CoreMerchantProvisioningClient {
  provisionMerchant(
    context: OperatorCallContext,
    input: MerchantProvisionRequest,
  ): Promise<CoreMerchantProvisionResult>;
  activateMerchant(
    context: OperatorCallContext,
    input: MerchantActivationRequest,
  ): Promise<CoreMerchantActivationResult>;
}

export interface OrganizationServiceOptions {
  database: D1Database;
  core?: CoreMerchantProvisioningClient;
}

export interface ProvisionClientInput {
  provisioningId: string;
  merchantId: string;
  name: string;
  correlationId: string;
}

export type ProvisioningStep =
  | 'core_provision'
  | 'identity_organization'
  | 'core_activation'
  | 'identity_activation';

export interface ClientProvisioningView {
  provisioningId: string;
  merchantId: string;
  organizationId: string | null;
  name: string;
  status: 'provisioning' | 'failed' | 'active';
  failedStep: ProvisioningStep | null;
  retryable: boolean;
}

export interface MemberMutationInput {
  membershipId: string;
  correlationId: string;
}

export interface ChangeMemberRoleInput extends MemberMutationInput {
  role: FixedRole;
}

export interface MembershipView {
  id: string;
  organizationId: string;
  userId: string;
  role: FixedRole;
  status: 'active' | 'removed';
}

export class OrganizationOperationError extends Error {
  readonly retryable = false;
}

interface ProvisioningRow {
  provisioningId: string;
  merchantId: string;
  organizationId: string | null;
  name: string;
  status: 'provisioning' | 'failed' | 'active';
  failedStep: ProvisioningStep | null;
  retryable: number;
}

interface MembershipTarget extends MembershipView {
  merchantId: string;
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new OrganizationOperationError(`${name} is required`);
  return normalized;
}

function provisioningView(row: ProvisioningRow): ClientProvisioningView {
  return {
    provisioningId: row.provisioningId,
    merchantId: row.merchantId,
    organizationId: row.organizationId,
    name: row.name,
    status: row.status,
    failedStep: row.failedStep,
    retryable: row.retryable === 1,
  };
}

async function readProvisioning(
  database: D1Database,
  provisioningId: string,
): Promise<ProvisioningRow | null> {
  return database.prepare(`
    SELECT provisioning_id AS provisioningId, merchant_id AS merchantId,
      organization_id AS organizationId, name, status,
      failed_step AS failedStep, retryable
    FROM client_provisionings WHERE provisioning_id = ?1
  `).bind(provisioningId).first<ProvisioningRow>();
}

async function failProvisioning(
  database: D1Database,
  principal: OperatorPrincipal,
  input: ProvisionClientInput,
  step: ProvisioningStep,
  retryable: boolean,
): Promise<ClientProvisioningView> {
  const now = Date.now();
  await database.batch([
    database.prepare(`
      UPDATE client_provisionings
      SET status = 'failed', current_step = ?1, failed_step = ?1,
        retryable = ?2, updated_at = ?3, correlation_id = ?4
      WHERE provisioning_id = ?5 AND status <> 'active'
    `).bind(
      step, retryable ? 1 : 0, now, input.correlationId, input.provisioningId,
    ),
    database.prepare(`
      INSERT INTO identity_audit (
        id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
        target_id, outcome, correlation_id, metadata_json
      ) SELECT ?1, ?2, 'root', ?3, merchant_id,
        'organization.provisioning_failed', 'provisioning', provisioning_id,
        'failed', ?4, NULL
      FROM client_provisionings
      WHERE provisioning_id = ?5 AND status = 'failed' AND updated_at = ?2
    `).bind(
      crypto.randomUUID(), now, principal.userId, input.correlationId, input.provisioningId,
    ),
  ]);
  const row = await readProvisioning(database, input.provisioningId);
  if (!row) throw new Error('Provisioning state is unavailable');
  return provisioningView(row);
}

function coreFailureIsRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  if ('retryable' in error && typeof error.retryable === 'boolean') return error.retryable;
  if ('name' in error && error.name === 'ZodError') return false;
  if (
    'code' in error
    && (error.code === 'CONFLICT' || error.code === 'INVALID_ARGUMENT')
  ) return false;
  return true;
}

class PermanentProvisioningError extends Error {
  readonly retryable = false;
}

function exactProvisionResult(
  result: MerchantProvisionResult,
  input: ProvisionClientInput,
): boolean {
  return result.id === input.merchantId
    && result.name === input.name
    && result.provisioningId === input.provisioningId;
}

function exactActivationResult(
  result: MerchantProvisionResult,
  input: ProvisionClientInput,
): boolean {
  return result.id === input.merchantId
    && result.name === input.name
    && result.provisioningId === input.provisioningId;
}

async function membershipTarget(
  database: D1Database,
  membershipId: string,
): Promise<MembershipTarget | null> {
  return database.prepare(`
    SELECT memberships.id, memberships.organization_id AS organizationId,
      memberships.user_id AS userId, memberships.role, memberships.status,
      organizations.merchant_id AS merchantId
    FROM memberships
    INNER JOIN organizations ON organizations.id = memberships.organization_id
    WHERE memberships.id = ?1 AND organizations.status = 'active'
  `).bind(membershipId).first<MembershipTarget>();
}

function mayManageTarget(principal: OperatorPrincipal, target: MembershipTarget): boolean {
  if (!authorize(principal, 'members:manage', target.merchantId)) return false;
  if (principal.platformRole === 'root') return true;
  return principal.organizationId === target.organizationId;
}

function membershipView(target: MembershipTarget, role = target.role, status = target.status) {
  return {
    id: target.id,
    organizationId: target.organizationId,
    userId: target.userId,
    role,
    status,
  } satisfies MembershipView;
}

export function createOrganizationService(options: OrganizationServiceOptions) {
  const database = options.database;

  return {
    async resolvePrincipal(
      sessionId: string,
      selectedMerchantId?: string,
    ): Promise<OperatorPrincipal | null> {
      const now = Date.now();
      const root = await database.prepare(`
        SELECT session.id AS sessionId, session.userId AS userId,
          session.authenticationMethod, session.authenticatedAt
        FROM session
        INNER JOIN auth_profile ON auth_profile.user_id = session.userId
        WHERE session.id = ?1 AND session.expiresAt > ?2
          AND session.authenticationMethod = 'passkey' AND session.recoveryOnly = 0
          AND session.authenticatedAt IS NOT NULL
          AND auth_profile.subject_kind = 'root' AND auth_profile.status = 'active'
      `).bind(sessionId, now).first<{
        sessionId: string;
        userId: string;
        authenticationMethod: string;
        authenticatedAt: number;
      }>();
      if (root) {
        const selectedOrganization = selectedMerchantId
          ? await database.prepare(`
              SELECT id AS organizationId FROM organizations
              WHERE merchant_id = ?1 AND status = 'active'
            `).bind(selectedMerchantId).first<{ organizationId: string }>()
          : null;
        return {
          userId: root.userId,
          sessionId: root.sessionId,
          authenticationMethods: [root.authenticationMethod],
          authenticatedAt: new Date(root.authenticatedAt).toISOString(),
          platformRole: 'root',
          ...(selectedMerchantId ? {
            merchantId: selectedMerchantId,
            organizationId: selectedOrganization?.organizationId,
          } : {}),
          permissions: [],
        };
      }

      const member = await database.prepare(`
        SELECT session.id AS sessionId, session.userId AS userId,
          session.authenticationMethod, session.authenticatedAt,
          memberships.id AS membershipId, memberships.organization_id AS organizationId,
          memberships.role, organizations.merchant_id AS merchantId
        FROM session
        INNER JOIN auth_profile ON auth_profile.user_id = session.userId
        INNER JOIN memberships ON memberships.user_id = session.userId
        INNER JOIN organizations ON organizations.id = memberships.organization_id
        WHERE session.id = ?1 AND session.expiresAt > ?2
          AND session.authenticationMethod = 'magic-link' AND session.recoveryOnly = 0
          AND session.authenticatedAt IS NOT NULL
          AND auth_profile.subject_kind = 'employee' AND auth_profile.status = 'active'
          AND auth_profile.email_login_enabled = 1
          AND memberships.status = 'active' AND organizations.status = 'active'
      `).bind(sessionId, now).first<{
        sessionId: string;
        userId: string;
        authenticationMethod: string;
        authenticatedAt: number;
        membershipId: string;
        organizationId: string;
        role: FixedRole;
        merchantId: string;
      }>();
      if (!member || (selectedMerchantId && selectedMerchantId !== member.merchantId)) return null;
      return {
        userId: member.userId,
        sessionId: member.sessionId,
        authenticationMethods: [member.authenticationMethod],
        authenticatedAt: new Date(member.authenticatedAt).toISOString(),
        organizationId: member.organizationId,
        merchantId: member.merchantId,
        membershipId: member.membershipId,
        permissions: permissionsForRole(member.role),
      };
    },

    async provisionClient(
      principal: OperatorPrincipal,
      rawInput: ProvisionClientInput,
    ): Promise<ClientProvisioningView> {
      if (principal.platformRole !== 'root') {
        throw new OrganizationOperationError('Root authority is required');
      }
      const input: ProvisionClientInput = {
        provisioningId: requiredText(rawInput.provisioningId, 'provisioningId'),
        merchantId: requiredText(rawInput.merchantId, 'merchantId'),
        name: requiredText(rawInput.name, 'name'),
        correlationId: requiredText(rawInput.correlationId, 'correlationId'),
      };
      if (!authorize(principal, 'credentials:manage', input.merchantId)) {
        throw new OrganizationOperationError(
          'Provisioning is forbidden without explicit root merchant selection',
        );
      }
      if (!options.core) throw new Error('Core provisioning service is unavailable');

      const now = Date.now();
      await database.prepare(`
        INSERT INTO client_provisionings (
          provisioning_id, merchant_id, name, status, current_step, failed_step,
          retryable, attempt_count, created_at, updated_at, correlation_id
        ) VALUES (?1, ?2, ?3, 'provisioning', 'core_provision', NULL, 0, 0, ?4, ?4, ?5)
        ON CONFLICT DO NOTHING
      `).bind(
        input.provisioningId, input.merchantId, input.name, now, input.correlationId,
      ).run();
      const conflicts = await database.prepare(`
        SELECT provisioning_id AS provisioningId, merchant_id AS merchantId,
          organization_id AS organizationId, name, status,
          failed_step AS failedStep, retryable
        FROM client_provisionings
        WHERE provisioning_id = ?1 OR merchant_id = ?2
      `).bind(input.provisioningId, input.merchantId).all<ProvisioningRow>();
      if (
        conflicts.results.length !== 1
        || conflicts.results[0]?.provisioningId !== input.provisioningId
        || conflicts.results[0]?.merchantId !== input.merchantId
        || conflicts.results[0]?.name !== input.name
      ) throw new OrganizationOperationError('Client provisioning identity conflict');
      if (conflicts.results[0]?.status === 'active') {
        return provisioningView(conflicts.results[0]);
      }
      if (
        conflicts.results[0]?.status === 'failed'
        && conflicts.results[0].retryable === 0
      ) return provisioningView(conflicts.results[0]);
      await database.prepare(`
        UPDATE client_provisionings
        SET status = 'provisioning', current_step = 'core_provision', failed_step = NULL,
          retryable = 0, attempt_count = attempt_count + 1,
          updated_at = ?1, correlation_id = ?2
        WHERE provisioning_id = ?3 AND status <> 'active'
      `).bind(now, input.correlationId, input.provisioningId).run();

      const context: OperatorCallContext = {
        correlationId: input.correlationId,
        actorUserId: principal.userId,
        actorKind: 'root',
        merchantId: input.merchantId,
        permission: 'credentials:manage',
      };
      try {
        const provisioned = CoreMerchantProvisionResultSchema.parse(
          await options.core.provisionMerchant(context, {
          id: input.merchantId,
          name: input.name,
          provisioningId: input.provisioningId,
          }),
        );
        if (!provisioned.ok) {
          return failProvisioning(
            database, principal, input, 'core_provision', provisioned.error.retryable,
          );
        }
        if (!exactProvisionResult(provisioned.value, input)) {
          return failProvisioning(
            database, principal, input, 'core_provision', false,
          );
        }
      } catch (error) {
        return failProvisioning(
          database, principal, input, 'core_provision', coreFailureIsRetryable(error),
        );
      }

      let row = await readProvisioning(database, input.provisioningId);
      if (!row) throw new Error('Provisioning state is unavailable');
      const candidateOrganizationId = row.organizationId ?? crypto.randomUUID();
      try {
        await database.batch([
          database.prepare(`
            UPDATE client_provisionings
            SET organization_id = COALESCE(organization_id, ?1),
              current_step = 'identity_organization', updated_at = ?2
            WHERE provisioning_id = ?3 AND merchant_id = ?4 AND status <> 'active'
          `).bind(candidateOrganizationId, Date.now(), input.provisioningId, input.merchantId),
          database.prepare(`
            INSERT INTO organizations (
              id, merchant_id, provisioning_id, name, status, created_at, updated_at
            )
            SELECT organization_id, merchant_id, provisioning_id, name,
              'provisioning', ?1, ?1
            FROM client_provisionings WHERE provisioning_id = ?2
            ON CONFLICT DO NOTHING
          `).bind(Date.now(), input.provisioningId),
        ]);
        row = await readProvisioning(database, input.provisioningId);
        const organization = await database.prepare(`
          SELECT id, merchant_id AS merchantId, provisioning_id AS provisioningId, name
          FROM organizations WHERE provisioning_id = ?1 OR merchant_id = ?2
        `).bind(input.provisioningId, input.merchantId).first<{
          id: string;
          merchantId: string;
          provisioningId: string;
          name: string;
        }>();
        if (
          !row?.organizationId
          || !organization
          || organization.id !== row.organizationId
          || organization.merchantId !== input.merchantId
          || organization.provisioningId !== input.provisioningId
          || organization.name !== input.name
        ) throw new PermanentProvisioningError('Identity organization conflict');
      } catch (error) {
        return failProvisioning(
          database, principal, input, 'identity_organization', coreFailureIsRetryable(error),
        );
      }

      await database.prepare(`
        UPDATE client_provisionings SET current_step = 'core_activation', updated_at = ?1
        WHERE provisioning_id = ?2 AND status <> 'active'
      `).bind(Date.now(), input.provisioningId).run();
      try {
        const activated = CoreMerchantActivationResultSchema.parse(
          await options.core.activateMerchant(context, {
          id: input.merchantId,
          provisioningId: input.provisioningId,
          }),
        );
        if (!activated.ok) {
          return failProvisioning(
            database, principal, input, 'core_activation', activated.error.retryable,
          );
        }
        if (!exactActivationResult(activated.value, input)) {
          return failProvisioning(
            database, principal, input, 'core_activation', false,
          );
        }
      } catch (error) {
        return failProvisioning(
          database, principal, input, 'core_activation', coreFailureIsRetryable(error),
        );
      }

      try {
        const activatedAt = Date.now();
        await database.batch([
          database.prepare(`
            UPDATE organizations SET status = 'active', updated_at = ?1
            WHERE provisioning_id = ?2 AND merchant_id = ?3
          `).bind(activatedAt, input.provisioningId, input.merchantId),
          database.prepare(`
            UPDATE client_provisionings
            SET status = 'active', current_step = 'complete', failed_step = NULL,
              retryable = 0, updated_at = ?1, correlation_id = ?2
            WHERE provisioning_id = ?3 AND merchant_id = ?4
          `).bind(activatedAt, input.correlationId, input.provisioningId, input.merchantId),
          database.prepare(`
            INSERT INTO identity_audit (
              id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
              target_id, outcome, correlation_id, metadata_json
            ) SELECT ?1, ?2, 'root', ?3, merchant_id, 'organization.provisioned',
              'organization', organization_id, 'succeeded', ?4, NULL
            FROM client_provisionings WHERE provisioning_id = ?5 AND status = 'active'
          `).bind(
            crypto.randomUUID(), activatedAt, principal.userId,
            input.correlationId, input.provisioningId,
          ),
        ]);
      } catch {
        return failProvisioning(
          database, principal, input, 'identity_activation', true,
        );
      }
      row = await readProvisioning(database, input.provisioningId);
      if (!row) throw new Error('Provisioning state is unavailable');
      return provisioningView(row);
    },

    async getProvisioning(provisioningId: string): Promise<ClientProvisioningView | null> {
      const row = await readProvisioning(database, requiredText(provisioningId, 'provisioningId'));
      return row ? provisioningView(row) : null;
    },

    async listProvisionings(): Promise<ClientProvisioningView[]> {
      const rows = await database.prepare(`
        SELECT provisioning_id AS provisioningId, merchant_id AS merchantId,
          organization_id AS organizationId, name, status,
          failed_step AS failedStep, retryable
        FROM client_provisionings
        ORDER BY created_at, provisioning_id
      `).all<ProvisioningRow>();
      return rows.results.map(provisioningView);
    },

    async removeMember(
      principal: OperatorPrincipal,
      input: MemberMutationInput,
    ): Promise<MembershipView> {
      const target = await membershipTarget(database, requiredText(input.membershipId, 'membershipId'));
      if (!target || target.status !== 'active' || !mayManageTarget(principal, target)) {
        throw new OrganizationOperationError('Member operation is forbidden');
      }
      const now = Date.now();
      const results = await database.batch([
        database.prepare(`
          UPDATE memberships SET status = 'removed', updated_at = ?1
          WHERE id = ?2 AND status = 'active' AND (
            ?3 = 1 OR role <> 'admin' OR (
              SELECT COUNT(*) FROM memberships AS admins
              WHERE admins.organization_id = memberships.organization_id
                AND admins.role = 'admin' AND admins.status = 'active'
            ) > 1
          )
        `).bind(now, target.id, principal.platformRole === 'root' ? 1 : 0),
        database.prepare(`
          DELETE FROM session WHERE userId = ?1 AND EXISTS (
            SELECT 1 FROM memberships
            WHERE id = ?2 AND status = 'removed' AND updated_at = ?3
          )
        `).bind(target.userId, target.id, now),
        database.prepare(`
          INSERT INTO identity_audit (
            id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
            target_id, outcome, correlation_id, metadata_json
          ) SELECT ?1, ?2, ?3, ?4, ?5, 'membership.removed', 'membership',
            id, 'succeeded', ?6, NULL FROM memberships
          WHERE id = ?7 AND status = 'removed' AND updated_at = ?2
        `).bind(
          crypto.randomUUID(), now, principal.platformRole === 'root' ? 'root' : 'member',
          principal.userId, target.merchantId, input.correlationId, target.id,
        ),
      ]);
      if (results[0]?.meta.changes !== 1) {
        throw new OrganizationOperationError('The last Admin cannot be removed');
      }
      return membershipView(target, target.role, 'removed');
    },

    async changeMemberRole(
      principal: OperatorPrincipal,
      input: ChangeMemberRoleInput,
    ): Promise<MembershipView> {
      const target = await membershipTarget(database, requiredText(input.membershipId, 'membershipId'));
      if (!target || target.status !== 'active' || !mayManageTarget(principal, target)) {
        throw new OrganizationOperationError('Member operation is forbidden');
      }
      if (!['admin', 'operator', 'viewer'].includes(input.role)) {
        throw new OrganizationOperationError('Invalid role');
      }
      const now = Date.now();
      const results = await database.batch([
        database.prepare(`
          UPDATE memberships SET role = ?1, updated_at = ?2
          WHERE id = ?3 AND status = 'active' AND (
            ?4 = 1 OR role <> 'admin' OR ?1 = 'admin' OR (
              SELECT COUNT(*) FROM memberships AS admins
              WHERE admins.organization_id = memberships.organization_id
                AND admins.role = 'admin' AND admins.status = 'active'
            ) > 1
          )
        `).bind(input.role, now, target.id, principal.platformRole === 'root' ? 1 : 0),
        database.prepare(`
          DELETE FROM session WHERE userId = ?1 AND EXISTS (
            SELECT 1 FROM memberships
            WHERE id = ?2 AND role = ?3 AND updated_at = ?4
          )
        `).bind(target.userId, target.id, input.role, now),
        database.prepare(`
          INSERT INTO identity_audit (
            id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
            target_id, outcome, correlation_id, metadata_json
          ) SELECT ?1, ?2, ?3, ?4, ?5, 'membership.role_changed', 'membership',
            id, 'succeeded', ?6, NULL FROM memberships
          WHERE id = ?7 AND role = ?8 AND updated_at = ?2
        `).bind(
          crypto.randomUUID(), now, principal.platformRole === 'root' ? 'root' : 'member',
          principal.userId, target.merchantId, input.correlationId, target.id, input.role,
        ),
      ]);
      if (results[0]?.meta.changes !== 1) {
        throw new OrganizationOperationError('The last Admin cannot be demoted');
      }
      return membershipView(target, input.role, 'active');
    },
  };
}
