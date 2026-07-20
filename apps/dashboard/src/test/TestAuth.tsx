import type { OperatorSessionView, PermissionKey } from '@incentives/contracts';
import type { ReactNode } from 'react';

import { AuthContext, type AuthContextValue } from '../auth/AuthContext';
import { BffClientError } from '../lib/bff-client';

const defaultPermissions: PermissionKey[] = [
  'programs:read', 'programs:manage', 'schemas:read', 'schemas:manage',
];

export function TestAuth({
  children,
  permissions = defaultPermissions,
}: {
  children: ReactNode;
  permissions?: PermissionKey[];
}) {
  const session: OperatorSessionView = {
    userId: 'test-user', authenticationMethods: ['magic-link'],
    authenticatedAt: '2026-07-20T10:00:00.000Z', organizationId: 'test-org',
    merchantId: 'test-merchant', membershipId: 'test-membership', permissions,
    merchantSelectionRequired: false,
  };
  const value: AuthContextValue = {
    loading: false,
    session,
    error: null,
    rootMerchantName: null,
    async refresh() {},
    async signOut() {},
    async retryError() {},
    handleError(error) {
      return error instanceof BffClientError
        ? error
        : new BffClientError(0, 'UNEXPECTED_ERROR', 'Test error', false, 'test');
    },
    hasPermission(permission) {
      return permissions.includes(permission);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
