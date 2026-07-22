import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { OperatorProgramView, ProgramStatus } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';

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
  if (loading) return <p>Loading Promos…</p>;
  if (error) return <ErrorState error={error} retry={() => void load()} forceRetry />;
  const visible = programs.filter(program => status === 'all' || program.lifecycle.status === status);
  return <div className="flex flex-col gap-4">
    <div className="flex justify-between"><h1>Promo Codes</h1>{canManage && <Link to="/promo/new">New promo</Link>}</div>
    <label>Status<select value={status} onChange={event => setStatus(event.target.value as ProgramStatus | 'all')}><option value="all">All</option>{['draft','scheduled','active','paused','ended'].map(value => <option key={value}>{value}</option>)}</select></label>
    {visible.length === 0 ? <p>No Promos match this filter.</p> : <table><thead><tr><th>Name</th><th>Status</th><th>Revision</th><th>Schedule</th></tr></thead><tbody>{visible.map(view => <tr key={view.configuration.id} tabIndex={0} onClick={() => navigate(`/promo/${encodeURIComponent(view.configuration.id)}`)} onKeyDown={event => { if (event.key === 'Enter') navigate(`/promo/${encodeURIComponent(view.configuration.id)}`); }}>
      <td>{view.configuration.name}</td><td>{view.lifecycle.status}</td><td>
        {view.lifecycle.activeRevision !== undefined && <span>Active revision {view.lifecycle.activeRevision}</span>}
        {view.lifecycle.activeRevision !== undefined && view.lifecycle.draftRevision !== undefined && ' · '}
        {view.lifecycle.draftRevision !== undefined && <span>Draft revision {view.lifecycle.draftRevision}</span>}
      </td><td>{view.configuration.startDate ?? 'Immediately'}</td>
    </tr>)}</tbody></table>}
  </div>;
}
