import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { OperatorSessionView } from '@incentives/contracts';

import { BffClientError, bffClient } from '../lib/bff-client';
import { AuthContext, type AuthContextValue } from './AuthContext';

function normalized(error: unknown): BffClientError {
  return error instanceof BffClientError
    ? error
    : new BffClientError(
      0, 'UNEXPECTED_ERROR', 'The operator service is temporarily unavailable',
      true, 'unavailable',
    );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<OperatorSessionView | null>(null);
  const [error, setError] = useState<BffClientError | null>(null);
  const [errorAction, setErrorAction] = useState<'refresh' | 'signOut'>('refresh');
  const [rootMerchantName, setRootMerchantName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorAction('refresh');
    try {
      const current = await bffClient.session();
      setSession(current);
      if (current.platformRole === 'root' && current.merchantId) {
        const clients = await bffClient.clients();
        setRootMerchantName(
          clients.find(client => client.merchantId === current.merchantId)?.name
          ?? current.merchantId,
        );
      } else {
        setRootMerchantName(null);
      }
    } catch (cause) {
      const next = normalized(cause);
      if (next.status === 401) {
        setSession(null);
        setRootMerchantName(null);
      } else {
        setError(next);
        setErrorAction('refresh');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleError = useCallback((cause: unknown) => {
    const next = normalized(cause);
    if (next.status === 401) {
      setSession(null);
      setRootMerchantName(null);
      setError(null);
    }
    return next;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await bffClient.signOut();
      setSession(null);
      setRootMerchantName(null);
      setError(null);
    } catch (cause) {
      setError(normalized(cause));
      setErrorAction('signOut');
    }
  }, []);

  const retryError = useCallback(async () => {
    if (errorAction === 'signOut') await signOut();
    else await refresh();
  }, [errorAction, refresh, signOut]);

  const value = useMemo<AuthContextValue>(() => ({
    loading, session, error, rootMerchantName, refresh, signOut, retryError, handleError,
    hasPermission(permission) {
      return session?.platformRole === 'root' || session?.permissions.includes(permission) === true;
    },
  }), [error, handleError, loading, refresh, retryError, rootMerchantName, session, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
