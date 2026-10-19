import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setSession(null);
    setError(null);
    setErrorAction('refresh');
    try {
      const current = await bffClient.session();
      if (sequence !== refreshSequence.current) return;
      setSession(current);
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      const next = normalized(cause);
      setSession(null);
      if (next.status === 401) {
        setError(null);
      } else {
        setError(next);
        setErrorAction('refresh');
      }
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleError = useCallback((cause: unknown) => {
    const next = normalized(cause);
    if (next.status === 401) {
      ++refreshSequence.current;
      setLoading(false);
      setSession(null);
      setError(null);
    }
    return next;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await bffClient.signOut();
      ++refreshSequence.current;
      setLoading(false);
      setSession(null);
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
    loading, session, error, refresh, signOut, retryError, handleError,
    hasPermission(permission) {
      return session?.platformRole === 'root' || session?.permissions.includes(permission) === true;
    },
  }), [error, handleError, loading, refresh, retryError, session, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
