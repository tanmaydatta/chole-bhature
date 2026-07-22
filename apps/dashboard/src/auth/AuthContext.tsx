import { createContext, useContext } from 'react';
import type { OperatorSessionView, PermissionKey } from '@incentives/contracts';

import type { BffClientError } from '../lib/bff-client';

export interface AuthContextValue {
  loading: boolean;
  session: OperatorSessionView | null;
  error: BffClientError | null;
  rootMerchantName: string | null;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  retryError(): Promise<void>;
  handleError(error: unknown): BffClientError;
  hasPermission(permission: PermissionKey): boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function usePermission(permission: PermissionKey): boolean {
  const context = useContext(AuthContext);
  return context?.hasPermission(permission) ?? false;
}
