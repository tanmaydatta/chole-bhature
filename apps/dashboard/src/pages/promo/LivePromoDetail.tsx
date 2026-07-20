import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { OperatorProgramView, ProgramLifecycle } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';

function title(status: ProgramLifecycle['status']): string {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

export default function LivePromoDetail() {
  const auth = useAuth();
  const { id = '' } = useParams<{ id: string }>();
  const canManage = auth.hasPermission('programs:manage');
  const canPublish = auth.hasPermission('programs:publish');
  const [view, setView] = useState<OperatorProgramView | null>(null);
  const [error, setError] = useState<BffClientError | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setView(await programApi.get(id)); }
    catch (cause) { setError(auth.handleError(cause)); }
    finally { setLoading(false); }
  }, [auth, id]);
  useEffect(() => { void load(); }, [load]);

  async function publish() {
    setError(null);
    try {
      const result = await programApi.publish(id);
      setWarnings(result.warnings.map(warning => warning.message));
      await load();
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  async function transition(action: 'pause' | 'resume' | 'end') {
    if (action === 'end' && !window.confirm('Ending this Promo cannot be undone. Continue?')) return;
    setError(null);
    try {
      await programApi[action](id);
      await load();
    } catch (cause) { setError(auth.handleError(cause)); }
  }

  if (loading) return <p>Loading Promo…</p>;
  if (error && !view) return <ErrorState error={error} retry={() => void load()} forceRetry />;
  if (!view) return <p>Promo not found.</p>;
  const { configuration: program, lifecycle } = view;
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between"><h1>{program.name}</h1>{canManage && lifecycle.status !== 'ended' && <Link to={`/promo/${encodeURIComponent(id)}/edit`}>Edit Promo</Link>}</div>
    <div className="flex gap-3"><span>{title(lifecycle.status)}</span>
      {lifecycle.activeRevision && <span>Active revision {lifecycle.activeRevision}</span>}
      {lifecycle.draftRevision && <span>Draft revision {lifecycle.draftRevision}</span>}
    </div>
    {warnings.map(warning => <p key={warning}>{warning}</p>)}
    {error && <ErrorState error={error}/>}
    <div className="flex gap-2">
      {canPublish && lifecycle.draftRevision && <button type="button" onClick={() => void publish()}>Publish revision</button>}
      {canManage && ['active', 'scheduled'].includes(lifecycle.status) && <button type="button" onClick={() => void transition('pause')}>Pause Promo</button>}
      {canManage && lifecycle.status === 'paused' && <button type="button" onClick={() => void transition('resume')}>Resume Promo</button>}
      {canManage && lifecycle.status !== 'ended' && lifecycle.activeRevision && <button type="button" onClick={() => void transition('end')}>End Promo</button>}
    </div>
    <section><h2>Configuration</h2><dl>
      <dt>External reference</dt><dd><code>{program.id}</code></dd>
      <dt>Priority</dt><dd>{program.priority}</dd><dt>Stackable</dt><dd>{program.stackable ? 'Yes' : 'No'}</dd>
      <dt>Schedule</dt><dd>{program.startDate ?? 'Immediately'} → {program.endDate ?? 'No end date'}</dd>
    </dl></section>
    <section><h2>Ordered reward rules</h2>{program.rewardRules.map((rule, index) => <article key={rule.id}><h3>{index + 1}. {rule.name}</h3><code>{rule.id}</code><pre>{JSON.stringify(rule.reward, null, 2)}</pre></article>)}
      {program.fallbackReward && <article><h3>Fallback: {program.fallbackReward.name}</h3><pre>{JSON.stringify(program.fallbackReward.reward, null, 2)}</pre></article>}
    </section>
  </div>;
}
