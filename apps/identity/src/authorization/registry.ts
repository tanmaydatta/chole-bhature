import type { PermissionKey } from '@incentives/contracts';

export type FixedRole = 'admin' | 'operator' | 'viewer';

export const REGISTERED_PERMISSIONS: readonly PermissionKey[] = [
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
export const ROLE_PERMISSIONS: Readonly<Record<FixedRole, readonly PermissionKey[]>> = {
  admin: REGISTERED_PERMISSIONS,
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

export function isRegisteredPermission(value: string): value is PermissionKey {
  return (REGISTERED_PERMISSIONS as readonly string[]).includes(value);
}

export function permissionsForRole(role: FixedRole): PermissionKey[] {
  return [...ROLE_PERMISSIONS[role]];
}
