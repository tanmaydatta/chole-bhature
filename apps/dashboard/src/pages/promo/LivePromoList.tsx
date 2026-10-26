import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { OperatorProgramView, ProgramStatus } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';

const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--promo)]';
const panelClass = 'min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--panel)]';
const cellClass = 'px-4 py-3 text-left align-top';

export default function LivePromoList() {
  const auth = useAuth();
  const navigate = useNavigate();
  const canManage = auth.hasPermission('programs:manage');
  const [programs, setPrograms] = useState<OperatorProgramView[]>([]);
  const [status, setStatus] = useState<ProgramStatus | 'all'>('all');
  const [error, setError] = useState<BffClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPrograms((await programApi.list()).programs); }
    catch (cause) { setError(auth.handleError(cause)); }
    finally { setLoading(false); }
  }, [auth]);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <p role="status" className={`${panelClass} p-4 text-[13px] text-[var(--ink)]`}>Loading Promos…</p>;
  if (error) return <ErrorState error={error} retry={() => void load()} forceRetry />;
  const visible = programs.filter(program => status === 'all' || program.lifecycle.status === status);
  return <section aria-labelledby="promo-title" className="flex min-w-0 flex-col gap-4 text-[13px] text-[var(--ink)]">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <h1 id="promo-title" className="min-w-0 break-words text-[24px] font-semibold tracking-tight">Promo Codes</h1>
      {canManage && <Link className={`max-w-full rounded-[7px] bg-[#4f46e5] px-3 py-2 font-semibold text-white ${focusClass}`} to="/promo/new">New promo</Link>}
    </div>
    <label className="flex min-w-0 max-w-full flex-col gap-1 self-start font-medium">Status<select className={`max-w-full min-w-0 rounded-[7px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[var(--ink)] ${focusClass}`} value={status} onChange={event => setStatus(event.target.value as ProgramStatus | 'all')}><option value="all">All</option>{['draft','scheduled','active','paused','ended'].map(value => <option key={value}>{value}</option>)}</select></label>
    {visible.length === 0 ? <p className={`${panelClass} p-4`}>No Promos match this filter.</p> : <div role="region" aria-label="Promo table" tabIndex={0} className={`${panelClass} max-w-full overflow-x-auto ${focusClass}`}>
      <table className="w-full min-w-[640px] border-collapse"><thead className="bg-[var(--hover)] text-[12px]"><tr>{['Name', 'Trigger', 'Status', 'Revision', 'Schedule'].map(column => <th scope="col" className={cellClass} key={column}>{column}</th>)}</tr></thead><tbody>{visible.map(view => <tr className={`cursor-pointer border-t border-[var(--border)] hover:bg-[var(--hover)] ${focusClass}`} key={view.configuration.id} tabIndex={0} onClick={() => navigate(`/promo/${encodeURIComponent(view.configuration.id)}`)} onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) navigate(`/promo/${encodeURIComponent(view.configuration.id)}`); }}>
      <td className={`${cellClass} max-w-[320px] break-words font-semibold`}><Link className={`rounded-sm text-[var(--promo)] underline underline-offset-4 ${focusClass}`} to={`/promo/${encodeURIComponent(view.configuration.id)}`} onClick={event => event.stopPropagation()}>{view.configuration.name}</Link></td>
      <td className={cellClass}><span>{view.configuration.autoApply ? 'Automatic' : 'Code-triggered'}</span></td>
      <td className={cellClass}><span className="rounded-full bg-[var(--hover)] px-2 py-1 text-[12px] font-medium">{view.lifecycle.status}</span></td><td className={cellClass}>
        {view.lifecycle.activeRevision !== undefined && <span>Active revision {view.lifecycle.activeRevision}</span>}
        {view.lifecycle.activeRevision !== undefined && view.lifecycle.draftRevision !== undefined && ' · '}
        {view.lifecycle.draftRevision !== undefined && <span>Draft revision {view.lifecycle.draftRevision}</span>}
      </td><td className={`${cellClass} break-words`}>{view.configuration.startDate ?? 'Immediately'}</td>
    </tr>)}</tbody></table></div>}
  </section>;
}
