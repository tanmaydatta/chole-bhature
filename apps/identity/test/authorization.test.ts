import type { OperatorPrincipal, PermissionKey } from '@incentives/contracts';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { authorize } from '../src/authorization/authorize.js';
import {
  REGISTERED_PERMISSIONS,
  ROLE_PERMISSIONS,
  permissionsForRole,
  type FixedRole,
} from '../src/authorization/registry.js';
import { createOrganizationService } from '../src/services/organizations.js';

const testEnv = env as typeof env & { AUTH_DB: D1Database };

const allPermissions: PermissionKey[] = [
  'members:read',
  'members:manage',
  'schemas:read',
  'schemas:manage',
  'schemas:publish',
  'customers:read',
  'customers:manage',
  'programs:read',
  'programs:manage',
  'programs:publish',
  'evaluations:run',
  'redemptions:commit',
  'credentials:read',
  'credentials:manage',
  'audit:read',
];

const expectedByRole: Record<FixedRole, PermissionKey[]> = {
  admin: allPermissions,
  operator: [
    'schemas:read',
    'schemas:manage',
    'schemas:publish',
    'customers:read',
    'customers:manage',
    'programs:read',
    'programs:manage',
    'programs:publish',
    'evaluations:run',
    'redemptions:commit',
    'audit:read',
  ],
  viewer: [
    'schemas:read',
    'programs:read',
    'evaluations:run',
    'audit:read',
  ],
};

async function clearIdentityData(): Promise<void> {
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare('DELETE FROM identity_audit'),
    testEnv.AUTH_DB.prepare('DELETE FROM invitations'),
    testEnv.AUTH_DB.prepare('DELETE FROM memberships'),
    testEnv.AUTH_DB.prepare('DELETE FROM organizations'),
    testEnv.AUTH_DB.prepare('DELETE FROM client_provisionings'),
    testEnv.AUTH_DB.prepare('DELETE FROM local_email_capture'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_rate_limit'),
    testEnv.AUTH_DB.prepare('DELETE FROM root_recovery_code'),
    testEnv.AUTH_DB.prepare('DELETE FROM recovery_flow'),
    testEnv.AUTH_DB.prepare('DELETE FROM rateLimit'),
    testEnv.AUTH_DB.prepare('DELETE FROM passkey'),
    testEnv.AUTH_DB.prepare('DELETE FROM verification'),
    testEnv.AUTH_DB.prepare('DELETE FROM account'),
    testEnv.AUTH_DB.prepare('DELETE FROM session'),
    testEnv.AUTH_DB.prepare('DELETE FROM auth_profile'),
    testEnv.AUTH_DB.prepare('DELETE FROM user'),
  ]);
}

function principal(input: Partial<OperatorPrincipal> = {}): OperatorPrincipal {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T12:00:00.000Z',
    organizationId: 'org-a',
    merchantId: 'merchant-a',
    membershipId: 'membership-a',
    permissions: allPermissions,
    ...input,
  };
}

async function seedMember(input: {
  userId: string;
  sessionId: string;
  organizationId: string;
  merchantId: string;
  role: FixedRole;
  membershipStatus?: 'active' | 'removed';
  organizationStatus?: 'provisioning' | 'active';
}): Promise<void> {
  const now = Date.now();
  await testEnv.AUTH_DB.batch([
    testEnv.AUTH_DB.prepare(`
      INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?1, ?1, ?2, 1, ?3, ?3)
    `).bind(input.userId, `${input.userId}@example.test`, now),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO auth_profile (user_id, subject_kind, status, email_login_enabled)
      VALUES (?1, 'employee', 'active', 1)
    `).bind(input.userId),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO client_provisionings (
        provisioning_id, merchant_id, organization_id, name, status, current_step,
        failed_step, retryable, attempt_count, created_at, updated_at, correlation_id
      ) VALUES (?1, ?2, ?3, ?4, 'active', 'complete', NULL, 0, 1, ?5, ?5, ?6)
    `).bind(
      `provision-${input.merchantId}`,
      input.merchantId,
      input.organizationId,
      `Organization ${input.organizationId}`,
      now,
      `corr-${input.merchantId}`,
    ),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO organizations (
        id, merchant_id, provisioning_id, name, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `).bind(
      input.organizationId,
      input.merchantId,
      `provision-${input.merchantId}`,
      `Organization ${input.organizationId}`,
      input.organizationStatus ?? 'active',
      now,
    ),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO memberships (
        id, organization_id, user_id, role, status, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
    `).bind(
      `membership-${input.userId}`,
      input.organizationId,
      input.userId,
      input.role,
      input.membershipStatus ?? 'active',
      now,
    ),
    testEnv.AUTH_DB.prepare(`
      INSERT INTO session (
        id, expiresAt, token, createdAt, updatedAt, userId,
        authenticationMethod, authenticatedAt, recoveryOnly
      ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, 'magic-link', ?4, 0)
    `).bind(
      input.sessionId,
      now + 60_000,
      `token-${input.sessionId}`,
      now,
      input.userId,
    ),
  ]);
}

beforeEach(clearIdentityData);

describe('provider-neutral authorization registry', () => {
  test('defines the complete fixed-role matrix using only canonical permission keys', () => {
    expect(REGISTERED_PERMISSIONS).toEqual(allPermissions);
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(['admin', 'operator', 'viewer']);

    for (const role of ['admin', 'operator', 'viewer'] as const) {
      expect(permissionsForRole(role)).toEqual(expectedByRole[role]);
      for (const permission of allPermissions) {
        expect(permissionsForRole(role).includes(permission)).toBe(
          expectedByRole[role].includes(permission),
        );
      }
    }
  });

  test('denies an unknown future permission until it is registered and assigned', () => {
    expect(authorize(principal(), 'billing:manage' as PermissionKey, 'merchant-a')).toBe(false);
  });

  test('authorizes a member only for an assigned permission in their own merchant', () => {
    const operator = principal({ permissions: expectedByRole.operator });

    expect(authorize(operator, 'programs:publish', 'merchant-a')).toBe(true);
    expect(authorize(operator, 'credentials:manage', 'merchant-a')).toBe(false);
    expect(authorize(operator, 'programs:publish', 'merchant-b')).toBe(false);
  });

  test('requires root to explicitly select the requested merchant even with wildcard authority', () => {
    const root = principal({
      platformRole: 'root',
      organizationId: undefined,
      membershipId: undefined,
      merchantId: undefined,
      permissions: [],
    });

    expect(authorize(root, 'credentials:manage', undefined)).toBe(false);
    expect(authorize(root, 'credentials:manage', 'merchant-a')).toBe(false);
    expect(authorize({ ...root, merchantId: 'merchant-a' }, 'credentials:manage', 'merchant-a'))
      .toBe(true);
    expect(authorize({ ...root, merchantId: 'merchant-a' }, 'credentials:manage', 'merchant-b'))
      .toBe(false);
    expect(authorize(
      { ...root, merchantId: 'merchant-a' },
      'billing:manage' as PermissionKey,
      'merchant-a',
    )).toBe(false);
  });
});

describe('live principal resolution', () => {
  test('maps an active membership to canonical permissions without exposing a Better Auth role', async () => {
    await seedMember({
      userId: 'operator-1',
      sessionId: 'session-operator',
      organizationId: 'org-a',
      merchantId: 'merchant-a',
      role: 'operator',
    });
    const service = createOrganizationService({ database: testEnv.AUTH_DB });

    const resolved = await service.resolvePrincipal('session-operator');

    expect(resolved).toEqual({
      userId: 'operator-1',
      sessionId: 'session-operator',
      authenticationMethods: ['magic-link'],
      authenticatedAt: expect.any(String),
      organizationId: 'org-a',
      merchantId: 'merchant-a',
      membershipId: 'membership-operator-1',
      permissions: expectedByRole.operator,
    });
    expect(resolved).not.toHaveProperty('role');
  });

  test('fails closed for removed members, inactive organizations, and cross-organization selection', async () => {
    await seedMember({
      userId: 'removed-1',
      sessionId: 'session-removed',
      organizationId: 'org-removed',
      merchantId: 'merchant-removed',
      role: 'admin',
      membershipStatus: 'removed',
    });
    await seedMember({
      userId: 'inactive-1',
      sessionId: 'session-inactive',
      organizationId: 'org-inactive',
      merchantId: 'merchant-inactive',
      role: 'viewer',
      organizationStatus: 'provisioning',
    });
    const service = createOrganizationService({ database: testEnv.AUTH_DB });

    await expect(service.resolvePrincipal('session-removed')).resolves.toBeNull();
    await expect(service.resolvePrincipal('session-inactive')).resolves.toBeNull();
    await expect(service.resolvePrincipal('session-removed', 'merchant-other')).resolves.toBeNull();
  });
});
