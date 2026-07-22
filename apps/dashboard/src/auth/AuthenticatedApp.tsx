import type { ReactNode } from 'react';

import { ErrorState } from './ErrorState';
import { SignIn } from './SignIn';
import { useAuth } from './AuthContext';

export function AuthenticatedApp({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.loading) {
    return <main className="min-h-screen bg-[var(--bg)] p-8 text-[var(--ink)]">Checking your session…</main>;
  }
  if (auth.error && !auth.session) {
    return <main className="min-h-screen bg-[var(--bg)] p-8 text-[var(--ink)]"><ErrorState error={auth.error} retry={() => void auth.refresh()} /></main>;
  }
  if (!auth.session) return <SignIn />;
  return <>
    {children}
    {auth.error && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6" aria-modal="true" role="dialog" aria-label="Authentication action failed">
        <div className="w-full max-w-[480px]"><ErrorState error={auth.error} retry={() => void auth.retryError()} forceRetry /></div>
      </div>
    )}
  </>;
}
