import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { INVITATION_ACCEPT_PATH } from '@incentives/contracts';

import { BffClientError, bffClient } from '../lib/bff-client';
import { ErrorState } from './ErrorState';

export function InviteAcceptance() {
  const location = useLocation();
  const [invitation] = useState(() => {
    const params = new URLSearchParams(location.search);
    return { token: params.get('token') ?? '', email: params.get('email') ?? '' };
  });
  const [email, setEmail] = useState(invitation.email);
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<BffClientError | null>(null);

  useEffect(() => {
    if (location.search) window.history.replaceState(null, '', INVITATION_ACCEPT_PATH);
  }, [location.search]);

  async function accept(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await bffClient.acceptInvitation(invitation.token, email);
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof BffClientError ? cause : new BffClientError(
        0, 'INVALID_INVITATION', 'The invitation could not be accepted', false, 'unavailable',
      ));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] p-6 text-[var(--ink)] flex items-center justify-center">
      <section className="w-full max-w-[440px] rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-7">
        <h1 className="text-[22px] font-bold">Accept invitation</h1>
        {accepted ? (
          <div className="mt-4 flex flex-col items-start gap-3">
            <p role="status">Invitation accepted. You can now sign in.</p>
            <Link className="rounded-[8px] bg-[var(--accent)] px-4 py-2 text-white" to="/">Sign in</Link>
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={accept}>
            <label className="block text-[13px] font-semibold">
              Invited email
              <input className="mt-1 w-full rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2" type="email" required value={email} onChange={event => setEmail(event.target.value)} />
            </label>
            <button type="submit" disabled={pending || invitation.token.length === 0} className="rounded-[8px] bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-60">
              {pending ? 'Accepting…' : 'Accept invitation'}
            </button>
          </form>
        )}
        {error && <div className="mt-4"><ErrorState error={error} /></div>}
      </section>
    </main>
  );
}
