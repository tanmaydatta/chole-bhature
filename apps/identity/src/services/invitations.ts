import type { OperatorPrincipal } from '@incentives/contracts';

import { authorize } from '../authorization/authorize.js';
import type { FixedRole } from '../authorization/registry.js';
import { sha256 } from '../recovery.js';

export interface InvitationEmailAdapter {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export interface InvitationServiceOptions {
  database: D1Database;
  email: InvitationEmailAdapter;
  publicOrigin: string;
  now?: () => number;
}

export interface CreateInvitationInput {
  organizationId: string;
  email: string;
  role: FixedRole;
  expiresInSeconds: number;
  correlationId: string;
}

export interface AcceptInvitationInput {
  token: string;
  email: string;
  correlationId: string;
}

export interface InvitationView {
  id: string;
  organizationId: string;
  email: string;
  role: FixedRole;
  status: 'pending' | 'sent' | 'delivery_failed' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
}

export interface AcceptedMembershipView {
  id: string;
  organizationId: string;
  userId: string;
  role: FixedRole;
  status: 'active';
}

export class InvitationInvalidError extends Error {
  readonly code = 'INVITATION_INVALID';
  readonly retryable = false;
}

export class InvitationOperationError extends Error {
  readonly retryable = false;
}

interface InvitationRow {
  id: string;
  organizationId: string;
  merchantId: string;
  email: string;
  role: FixedRole;
  status: InvitationView['status'];
  expiresAt: number;
  tokenHash: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new InvitationOperationError('A valid email is required');
  return email;
}

function requiredText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new InvitationOperationError(`${name} is required`);
  return normalized;
}

function view(row: InvitationRow): InvitationView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}

async function invitationById(
  database: D1Database,
  invitationId: string,
): Promise<InvitationRow | null> {
  return database.prepare(`
    SELECT invitations.id, invitations.organization_id AS organizationId,
      organizations.merchant_id AS merchantId, invitations.email,
      invitations.role, invitations.status, invitations.expires_at AS expiresAt,
      invitations.token_hash AS tokenHash
    FROM invitations
    INNER JOIN organizations ON organizations.id = invitations.organization_id
    WHERE invitations.id = ?1
  `).bind(invitationId).first<InvitationRow>();
}

async function invitationByToken(
  database: D1Database,
  tokenHash: string,
): Promise<InvitationRow | null> {
  return database.prepare(`
    SELECT invitations.id, invitations.organization_id AS organizationId,
      organizations.merchant_id AS merchantId, invitations.email,
      invitations.role, invitations.status, invitations.expires_at AS expiresAt,
      invitations.token_hash AS tokenHash
    FROM invitations
    INNER JOIN organizations ON organizations.id = invitations.organization_id
    WHERE invitations.token_hash = ?1 AND organizations.status = 'active'
  `).bind(tokenHash).first<InvitationRow>();
}

async function canManageInvitations(
  database: D1Database,
  principal: OperatorPrincipal,
  organizationId: string,
  merchantId: string,
): Promise<boolean> {
  if (!authorize(principal, 'members:manage', merchantId)) return false;
  if (principal.platformRole === 'root') return true;
  if (principal.organizationId !== organizationId || !principal.membershipId) return false;
  return await database.prepare(`
    SELECT id FROM memberships
    WHERE id = ?1 AND organization_id = ?2 AND user_id = ?3 AND status = 'active'
  `).bind(principal.membershipId, organizationId, principal.userId).first() !== null;
}

async function deliver(
  options: InvitationServiceOptions,
  row: InvitationRow,
  token: string,
  correlationId: string,
): Promise<InvitationView> {
  const link = new URL('/invitations/accept', options.publicOrigin);
  link.searchParams.set('token', token);
  let status: 'sent' | 'delivery_failed' = 'sent';
  try {
    await options.email.send({
      to: row.email,
      subject: 'You are invited to Incentives Operator',
      text: `Use this single-use invitation before it expires.\n${link.toString()}`,
    });
  } catch {
    status = 'delivery_failed';
  }
  const updatedAt = (options.now ?? Date.now)();
  try {
    await options.database.batch([
      options.database.prepare(`
        UPDATE invitations SET status = ?1, updated_at = ?2
        WHERE id = ?3 AND token_hash = ?4 AND status = 'pending'
      `).bind(status, updatedAt, row.id, row.tokenHash),
      options.database.prepare(`
        INSERT INTO identity_audit (
          id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
          target_id, outcome, correlation_id, metadata_json
        ) SELECT ?1, ?2, 'system', 'identity', ?3, 'invitation.delivery',
          'invitation', id, ?4, ?5, NULL FROM invitations
        WHERE id = ?6 AND token_hash = ?7 AND status = ?8 AND updated_at = ?2
      `).bind(
        crypto.randomUUID(), updatedAt, row.merchantId,
        status === 'sent' ? 'succeeded' : 'failed', correlationId,
        row.id, row.tokenHash, status,
      ),
    ]);
  } catch {
    // The D1 batch rolls the status transition back to retryable pending.
  }
  const updated = await invitationById(options.database, row.id);
  if (!updated) throw new Error('Invitation state is unavailable');
  return view(updated);
}

export function createInvitationService(options: InvitationServiceOptions) {
  const database = options.database;
  const clock = options.now ?? Date.now;

  return {
    async createInvitation(
      principal: OperatorPrincipal,
      input: CreateInvitationInput,
    ): Promise<InvitationView> {
      const organizationId = requiredText(input.organizationId, 'organizationId');
      const email = normalizedEmail(input.email);
      if (!['admin', 'operator', 'viewer'].includes(input.role)) {
        throw new InvitationOperationError('Invalid role');
      }
      if (!Number.isSafeInteger(input.expiresInSeconds) || input.expiresInSeconds <= 0) {
        throw new InvitationOperationError('Invitation expiry must be positive');
      }
      const now = clock();
      const organization = await database.prepare(`
        SELECT id, merchant_id AS merchantId, status
        FROM organizations WHERE id = ?1
      `).bind(organizationId).first<{
        id: string;
        merchantId: string;
        status: 'provisioning' | 'active';
      }>();
      if (!organization || organization.status !== 'active') {
        throw new InvitationOperationError('Invitations require an active organization');
      }
      if (!await canManageInvitations(database, principal, organization.id, organization.merchantId)) {
        throw new InvitationOperationError('Invitation is forbidden');
      }

      const existingMember = await database.prepare(`
        SELECT memberships.organization_id AS organizationId
        FROM user INNER JOIN memberships ON memberships.user_id = user.id
        WHERE lower(user.email) = ?1 AND memberships.status = 'active'
      `).bind(email).first<{ organizationId: string }>();
      if (existingMember?.organizationId === organizationId) {
        throw new InvitationOperationError('Email is already an active member');
      }
      if (existingMember) {
        throw new InvitationOperationError('Email is unavailable for invitation');
      }
      let existingInvite = await database.prepare(`
        SELECT invitations.id, invitations.organization_id AS organizationId,
          organizations.merchant_id AS merchantId, invitations.email,
          invitations.role, invitations.status, invitations.expires_at AS expiresAt,
          invitations.token_hash AS tokenHash
        FROM invitations
        INNER JOIN organizations ON organizations.id = invitations.organization_id
        WHERE invitations.organization_id = ?1 AND invitations.email = ?2
          AND invitations.status IN ('pending', 'sent', 'delivery_failed')
      `).bind(organizationId, email).first<InvitationRow>();
      if (existingInvite && existingInvite.expiresAt <= now) {
        await database.prepare(`
          UPDATE invitations SET status = 'expired', updated_at = ?1
          WHERE id = ?2 AND expires_at <= ?1
            AND status IN ('pending', 'sent', 'delivery_failed')
        `).bind(now, existingInvite.id).run();
        existingInvite = null;
      }
      if (existingInvite) {
        if (existingInvite.role !== input.role) {
          throw new InvitationOperationError('Pending invitation role conflict');
        }
        return view(existingInvite);
      }

      const token = randomToken();
      const tokenHash = await sha256(token);
      const invitationId = crypto.randomUUID();
      try {
        await database.batch([
          database.prepare(`
            INSERT INTO invitations (
              id, organization_id, email, role, token_hash, status, invited_by,
              expires_at, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?8)
          `).bind(
            invitationId, organizationId, email, input.role, tokenHash, principal.userId,
            now + input.expiresInSeconds * 1_000, now,
          ),
          database.prepare(`
            INSERT INTO identity_audit (
              id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
              target_id, outcome, correlation_id, metadata_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'invitation.created',
              'invitation', ?6, 'succeeded', ?7, NULL)
          `).bind(
            crypto.randomUUID(), now,
            principal.platformRole === 'root' ? 'root' : 'member',
            principal.userId, organization.merchantId, invitationId, input.correlationId,
          ),
        ]);
      } catch {
        const raced = await database.prepare(`
          SELECT invitations.id, invitations.organization_id AS organizationId,
            organizations.merchant_id AS merchantId, invitations.email,
            invitations.role, invitations.status, invitations.expires_at AS expiresAt,
            invitations.token_hash AS tokenHash
          FROM invitations
          INNER JOIN organizations ON organizations.id = invitations.organization_id
          WHERE invitations.organization_id = ?1 AND invitations.email = ?2
            AND invitations.status IN ('pending', 'sent', 'delivery_failed')
        `).bind(organizationId, email).first<InvitationRow>();
        if (raced?.role === input.role) return view(raced);
        if (raced) throw new InvitationOperationError('Pending invitation conflict');
        throw new Error('Invitation creation is unavailable');
      }
      const row = await invitationById(database, invitationId);
      if (!row) throw new Error('Invitation state is unavailable');
      return deliver(options, row, token, input.correlationId);
    },

    async retryInvitation(
      principal: OperatorPrincipal,
      invitationId: string,
      correlationId: string,
    ): Promise<InvitationView> {
      const row = await invitationById(database, requiredText(invitationId, 'invitationId'));
      if (
        !row
        || !['pending', 'sent', 'delivery_failed'].includes(row.status)
        || !await canManageInvitations(database, principal, row.organizationId, row.merchantId)
      ) throw new InvitationOperationError('Invitation is forbidden');
      const now = clock();
      if (row.expiresAt <= now) {
        throw new InvitationOperationError('Invitation is no longer retryable');
      }
      const token = randomToken();
      const tokenHash = await sha256(token);
      const rotation = await database.batch([
        database.prepare(`
          UPDATE invitations SET token_hash = ?1, status = 'pending', updated_at = ?2
          WHERE id = ?3 AND token_hash = ?4 AND status = ?5
        `).bind(tokenHash, now, row.id, row.tokenHash, row.status),
        database.prepare(`
          INSERT INTO identity_audit (
            id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
            target_id, outcome, correlation_id, metadata_json
          ) SELECT ?1, ?2, ?3, ?4, ?5, 'invitation.retried',
            'invitation', id, 'succeeded', ?6, NULL FROM invitations
          WHERE id = ?7 AND token_hash = ?8 AND status = 'pending' AND updated_at = ?2
        `).bind(
          crypto.randomUUID(), now,
          principal.platformRole === 'root' ? 'root' : 'member',
          principal.userId, row.merchantId, correlationId, row.id, tokenHash,
        ),
      ]);
      if (rotation[0]?.meta.changes !== 1) {
        throw new InvitationOperationError('Invitation is no longer retryable');
      }
      const updated = await invitationById(database, row.id);
      if (!updated) throw new Error('Invitation state is unavailable');
      return deliver(options, updated, token, correlationId);
    },

    async acceptInvitation(input: AcceptInvitationInput): Promise<AcceptedMembershipView> {
      const email = normalizedEmail(input.email);
      if (!TOKEN_PATTERN.test(input.token)) throw new InvitationInvalidError('Invitation is invalid');
      const tokenHash = await sha256(input.token);
      const row = await invitationByToken(database, tokenHash);
      const now = clock();
      if (
        !row
        || row.status !== 'sent'
        || row.email !== email
        || row.expiresAt <= now
      ) {
        if (row && row.expiresAt <= now) {
          await database.prepare(`
            UPDATE invitations SET status = 'expired', updated_at = ?1
            WHERE id = ?2 AND status = 'sent'
          `).bind(now, row.id).run();
        }
        throw new InvitationInvalidError('Invitation is invalid');
      }
      const existingUser = await database.prepare(`
        SELECT user.id FROM user WHERE lower(user.email) = ?1
      `).bind(email).first<{ id: string }>();
      if (existingUser) throw new InvitationInvalidError('Invitation is invalid');

      const userId = crypto.randomUUID();
      const membershipId = crypto.randomUUID();
      try {
        const results = await database.batch([
          database.prepare(`
            UPDATE invitations SET status = 'accepted', accepted_at = ?1, updated_at = ?1
            WHERE id = ?2 AND token_hash = ?3 AND email = ?4
              AND status = 'sent' AND expires_at > ?1
          `).bind(now, row.id, tokenHash, email),
          database.prepare(`
            INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
            SELECT ?1, ?2, ?3, 1, ?4, ?4 FROM invitations
            WHERE id = ?5 AND status = 'accepted' AND accepted_at = ?4 AND accepted_by IS NULL
          `).bind(userId, email.split('@')[0] ?? 'Invited user', email, now, row.id),
          database.prepare(`
            INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
            SELECT ?1, 'employee', 'active', 1 FROM invitations
            WHERE id = ?2 AND status = 'accepted' AND accepted_at = ?3 AND accepted_by IS NULL
          `).bind(userId, row.id, now),
          database.prepare(`
            INSERT INTO memberships (
              id, organization_id, user_id, role, status, created_at, updated_at
            ) SELECT ?1, organization_id, ?2, role, 'active', ?3, ?3
            FROM invitations
            WHERE id = ?4 AND status = 'accepted' AND accepted_at = ?3 AND accepted_by IS NULL
          `).bind(membershipId, userId, now, row.id),
          database.prepare(`
            UPDATE invitations SET accepted_by = ?1
            WHERE id = ?2 AND status = 'accepted' AND accepted_at = ?3 AND accepted_by IS NULL
          `).bind(userId, row.id, now),
          database.prepare(`
            INSERT INTO identity_audit (
              id, occurred_at, actor_kind, actor_id, merchant_id, action, target_type,
              target_id, outcome, correlation_id, metadata_json
            ) SELECT ?1, ?2, 'member', ?3, ?4, 'invitation.accepted',
              'invitation', id, 'succeeded', ?5, NULL FROM invitations
            WHERE id = ?6 AND accepted_by = ?3 AND accepted_at = ?2
          `).bind(
            crypto.randomUUID(), now, userId, row.merchantId, input.correlationId, row.id,
          ),
        ]);
        if (results[0]?.meta.changes !== 1) {
          throw new InvitationInvalidError('Invitation is invalid');
        }
      } catch {
        throw new InvitationInvalidError('Invitation is invalid');
      }
      return {
        id: membershipId,
        organizationId: row.organizationId,
        userId,
        role: row.role,
        status: 'active',
      };
    },
  };
}
