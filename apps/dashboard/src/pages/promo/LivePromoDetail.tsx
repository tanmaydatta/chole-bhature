import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CommerceReward,
  OperatorProgramView,
  ProgramLifecycle,
  PromoProgram,
} from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';

function title(status: ProgramLifecycle['status']): string {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function rewardSummary(reward: CommerceReward): string {
  if (reward.type === 'free_shipping') return 'Free shipping';
  const target = reward.type === 'order_discount' ? 'order' : `line item ${reward.productRef}`;
  return reward.calculation === 'percent'
    ? `${reward.basisPoints / 100}% off ${target}`
    : `${reward.amount.currency} ${(reward.amount.minorUnits / 100).toFixed(2)} off ${target}`;
}

function trigger(program: PromoProgram): string {
  return program.autoApply ? 'Automatic' : 'Code-triggered';
}

function Configuration({
  program,
  heading,
}: {
  program: PromoProgram;
  heading: string;
}) {
  return <section className="flex flex-col gap-3 rounded border p-4">
    <h2>{heading}</h2>
    <dl>
      <dt>External reference</dt><dd><code>{program.id}</code></dd>
      <dt>Trigger</dt><dd>{trigger(program)}</dd>
      {!program.autoApply && <><dt>Code</dt><dd><code>{program.code}</code></dd></>}
      <dt>Priority</dt><dd>{program.priority}</dd>
      {!program.autoApply && <><dt>Stackable</dt><dd>{program.stackable ? 'Yes' : 'No'}</dd></>}
      <dt>Schedule</dt><dd>{program.startDate ?? 'Immediately'} → {program.endDate ?? 'No end date'}</dd>
    </dl>
    <section>
      <h3>Ordered reward rules</h3>
      {program.rewardRules.map((rule, index) => <article key={rule.id}>
        <h4>{index + 1}. {rule.name}</h4>
        <p>{rewardSummary(rule.reward)}</p>
        <code>{rule.id}</code>
        <details><summary>Exact reward details</summary><pre>{JSON.stringify(rule.reward, null, 2)}</pre></details>
      </article>)}
      {program.fallbackReward && <article>
        <h4>Fallback: {program.fallbackReward.name}</h4>
        <p>{rewardSummary(program.fallbackReward.reward)}</p>
        <details><summary>Exact reward details</summary><pre>{JSON.stringify(program.fallbackReward.reward, null, 2)}</pre></details>
      </article>}
    </section>
  </section>;
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
  const [reviewingPublication, setReviewingPublication] = useState(false);

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
      setReviewingPublication(false);
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
  const activeProgram = view.activeConfiguration;
  const draftProgram = view.draftConfiguration;
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between"><h1>{program.name}</h1>{canManage && lifecycle.status !== 'ended' && <Link to={`/promo/${encodeURIComponent(id)}/edit`}>Edit Promo</Link>}</div>
    <div className="flex gap-3"><span>{title(lifecycle.status)}</span>
      {lifecycle.activeRevision && <span>Active revision {lifecycle.activeRevision}</span>}
      {lifecycle.draftRevision && <span>Draft revision {lifecycle.draftRevision}</span>}
    </div>
    {warnings.map(warning => <p key={warning}>{warning}</p>)}
    {error && <ErrorState error={error}/>}
    {error?.code === 'PROMO_CODE_CONFLICT' && <p role="alert">
      Another published Promo already uses this code during an overlapping schedule. Change the code or schedule, then review and publish again.
    </p>}
    <div className="flex gap-2">
      {canPublish && lifecycle.draftRevision && <button type="button" onClick={() => setReviewingPublication(true)}>Publish revision</button>}
      {canManage && ['active', 'scheduled'].includes(lifecycle.status) && <button type="button" onClick={() => void transition('pause')}>Pause Promo</button>}
      {canManage && lifecycle.status === 'paused' && <button type="button" onClick={() => void transition('resume')}>Resume Promo</button>}
      {canManage && lifecycle.status !== 'ended' && lifecycle.activeRevision && <button type="button" onClick={() => void transition('end')}>End Promo</button>}
    </div>
    {reviewingPublication && draftProgram && <section role="dialog" aria-modal="true" className="rounded border p-4">
      <h2>Review publication</h2>
      <p>Trigger: {trigger(draftProgram)}</p>
      {!draftProgram.autoApply && <p>Code: <code>{draftProgram.code}</code></p>}
      {!draftProgram.autoApply && <p>Stackable: {draftProgram.stackable ? 'Yes' : 'No'}</p>}
      <p>Priority: {draftProgram.priority}</p>
      <p>Active revision: {lifecycle.activeRevision ?? 'none'}</p>
      <p>Draft revision: {lifecycle.draftRevision}</p>
      <button type="button" onClick={() => void publish()}>Confirm publish</button>
      <button type="button" onClick={() => setReviewingPublication(false)}>Cancel publication</button>
    </section>}
    {activeProgram && draftProgram
      ? <div className="grid gap-4 lg:grid-cols-2">
        <Configuration program={activeProgram} heading="Active configuration"/>
        <Configuration program={draftProgram} heading="Draft configuration"/>
      </div>
      : <Configuration program={program} heading="Configuration"/>}
  </div>;
}
