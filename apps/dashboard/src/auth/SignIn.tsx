import { useState } from 'react';

import { BffClientError, bffClient } from '../lib/bff-client';
import { ErrorState } from './ErrorState';
import { RootAccess } from './RootAccess';
import { useAuth } from './AuthContext';

export function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<BffClientError | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await bffClient.requestMagicLink(email);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof BffClientError ? cause : new BffClientError(
        0, 'NETWORK_ERROR', 'Sign-in is temporarily unavailable', true, 'unavailable',
      ));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] p-6 text-[var(--ink)] flex items-center justify-center">
      <section className="w-full max-w-[420px] rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-7 shadow-[var(--shadow)]">
        <h1 className="text-[22px] font-bold">Sign in to Incentives</h1>
        <p className="mt-2 text-[13px] text-[var(--muted)]">Use your invited work email.</p>
        <form className="mt-5 space-y-4" onSubmit={submit}>
          <label className="block text-[13px] font-semibold">
            Work email
            <input
              className="mt-1 w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2"
              type="email" required autoComplete="email" value={email}
              onChange={event => setEmail(event.target.value)}
            />
          </label>
          <button type="submit" disabled={pending} className="w-full rounded-[8px] bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-60">
            {pending ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
        {sent && <p role="status" className="mt-4 text-[13px] text-[var(--green)]">If that address can sign in, a link is on its way.</p>}
        {error && <div className="mt-4"><ErrorState error={error} /></div>}
        <RootAccess onAuthenticated={auth.refresh} />
      </section>
    </main>
  );
}
