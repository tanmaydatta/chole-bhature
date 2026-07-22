import type { OperatorPrincipal, PermissionKey } from '@incentives/contracts';

import { isRegisteredPermission } from './registry.js';

export function authorize(
  principal: OperatorPrincipal,
  permission: PermissionKey,
  merchantId: string | undefined,
): boolean {
  if (!merchantId || !isRegisteredPermission(permission)) return false;
  if (principal.merchantId !== merchantId) return false;
  if (principal.platformRole === 'root') return true;
  return Boolean(
    principal.organizationId
    && principal.membershipId
    && principal.permissions.includes(permission),
  );
}
