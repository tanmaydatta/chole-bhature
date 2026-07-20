import { useCallback, useEffect, useState } from 'react';
import type { FixedOperatorRole, OperatorTeamResponse } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { BffClientError, bffClient } from '../../lib/bff-client';

const roles: FixedOperatorRole[] = ['admin', 'operator', 'viewer'];

export default function Team() {
  const auth = useAuth();
  const canManage = auth.hasPermission('members:manage');
  const [team, setTeam] = useState<OperatorTeamResponse>({ members: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BffClientError | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<FixedOperatorRole>('viewer');
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTeam(await bffClient.team());
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => { void load(); }, [load]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const invitation = await bffClient.createInvitation(email, role);
      setTeam(current => ({
        ...current,
        invitations: [...current.invitations.filter(item => item.id !== invitation.id), invitation],
      }));
      setEmail('');
    } catch (cause) {
      setError(auth.handleError(cause));
    }
  }

  async function retryInvitation(id: string) {
    setError(null);
    try {
      const invitation = await bffClient.retryInvitation(id);
      setTeam(current => ({
        ...current,
        invitations: current.invitations.map(item => item.id === invitation.id ? invitation : item),
      }));
    } catch (cause) {
      setError(auth.handleError(cause));
    }
  }

  async function changeRole(id: string, nextRole: FixedOperatorRole) {
    const current = team.members.find(member => member.id === id);
    if (!current || pendingAction) return;
    if (current.role === 'admin' && nextRole !== 'admin' && !window.confirm(
      `Demote ${current.email} from Admin?`,
    )) return;
    setPendingAction(`role:${id}`);
    setError(null);
    try {
      const member = await bffClient.changeMemberRole(id, nextRole);
      setTeam(current => ({
        ...current,
        members: current.members.map(item => item.id === member.id ? { ...item, ...member } : item),
      }));
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setPendingAction(null);
    }
  }

  async function remove(id: string) {
    const current = team.members.find(member => member.id === id);
    if (!current || pendingAction || !window.confirm(
      `Remove ${current.email}? Their active sessions will be revoked.`,
    )) return;
    setPendingAction(`remove:${id}`);
    setError(null);
    try {
      const member = await bffClient.removeMember(id);
      setTeam(current => ({
        ...current,
        members: current.members.map(item => item.id === member.id ? { ...item, ...member } : item),
      }));
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="space-y-5">
      <h2 className="text-[20px] font-bold">Team</h2>
      {canManage && (
        <form className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-4 grid grid-cols-[1fr_180px_auto] items-end gap-3" onSubmit={invite}>
          <label className="text-[13px] font-semibold">Invite email<input aria-label="Invite email" className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label className="text-[13px] font-semibold">Invite role<select aria-label="Invite role" className="mt-1 w-full rounded-[7px] border border-[var(--border)] bg-transparent px-3 py-2" value={role} onChange={event => setRole(event.target.value as FixedOperatorRole)}>{roles.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <button type="submit" className="rounded-[7px] bg-[var(--accent)] px-4 py-2 text-white">Invite user</button>
        </form>
      )}
      {error && <ErrorState error={error} retry={error.retryable ? () => void load() : undefined} />}
      {loading ? <p>Loading team…</p> : (
        <>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <h3 className="border-b border-[var(--border)] p-4 font-semibold">Members</h3>
            {team.members.length === 0 ? <p className="p-4 text-[var(--muted)]">No members.</p> : (
              <ul>{team.members.map(member => (
                <li key={member.id} className="border-b border-[var(--border)] p-4 last:border-0 flex items-center justify-between">
                  <div><p className="font-semibold">{member.email}</p><p className="text-[12px] capitalize text-[var(--muted)]">{member.status}</p></div>
                  {canManage ? <div className="flex items-center gap-2">
                    <select aria-label={`Role for ${member.email}`} disabled={pendingAction !== null} value={member.role} onChange={event => void changeRole(member.id, event.target.value as FixedOperatorRole)} className="rounded-[7px] border border-[var(--border)] bg-transparent px-2 py-1 disabled:opacity-50">{roles.map(item => <option key={item} value={item}>{item}</option>)}</select>
                    {member.status === 'active' && <button type="button" disabled={pendingAction !== null} onClick={() => void remove(member.id)} className="rounded-[7px] border border-[var(--border)] px-3 py-1 disabled:opacity-50">{pendingAction === `remove:${member.id}` ? 'Removing…' : `Remove ${member.email}`}</button>}
                  </div> : <span className="capitalize">{member.role}</span>}
                </li>
              ))}</ul>
            )}
          </div>
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <h3 className="border-b border-[var(--border)] p-4 font-semibold">Invitations</h3>
            {team.invitations.length === 0 ? <p className="p-4 text-[var(--muted)]">No pending invitations.</p> : (
              <ul>{team.invitations.map(invitation => <li key={invitation.id} className="border-b border-[var(--border)] p-4 last:border-0 flex items-center justify-between"><div><p>{invitation.email}</p><p className="text-[12px] text-[var(--muted)]">{invitation.role} · {invitation.status}</p></div>{canManage && invitation.status === 'delivery_failed' && <button type="button" className="rounded-[7px] border border-[var(--border)] px-3 py-1" onClick={() => void retryInvitation(invitation.id)}>Retry {invitation.email}</button>}</li>)}</ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
