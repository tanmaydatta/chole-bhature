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

const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--promo)]';
const panelClass = 'min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-3 sm:p-5';
const buttonClass = `max-w-full rounded-[7px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 font-semibold text-[var(--ink)] hover:bg-[var(--hover)] ${focusClass}`;
const primaryClass = `max-w-full rounded-[7px] bg-[#4f46e5] px-3 py-2 font-semibold text-white ${focusClass}`;
const summaryClass = `cursor-pointer rounded-sm font-medium text-[var(--promo)] ${focusClass}`;
const jsonClass = `mt-2 max-w-full overflow-x-auto rounded-[7px] bg-[var(--bg)] p-2 text-[12px] text-[var(--ink)] ${focusClass}`;

function title(status: ProgramLifecycle['status']): string {
  return status.slice(0, 1).toUpperCase() + status.slice(1);
}

function rewardSummary(reward: CommerceReward): string {
  if (reward.type === 'free_shipping') return 'Free shipping';
  const target = reward.type === 'order_discount' ? 'order' : `line item ${reward.productRef}`;
  return reward.calculation === 'percent'
    ? `${reward.basisPoints / 100}% off ${target}${
      reward.maximumDiscountAmount === undefined
        ? ''
        : ` (maximum ${reward.maximumDiscountAmount.currency} ${(reward.maximumDiscountAmount.minorUnits / 100).toFixed(2)})`
    }`
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
  const headingId = `promo-${heading.toLowerCase().replaceAll(' ', '-')}`;
  return <section aria-labelledby={headingId} className={`${panelClass} flex flex-col gap-4`}>
    <h2 id={headingId} className="text-[16px] font-semibold">{heading}</h2>
    <dl className="grid min-w-0 gap-2 [overflow-wrap:anywhere] sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="font-medium text-[var(--muted)]">External reference</dt><dd className="min-w-0"><code>{program.id}</code></dd>
      <dt className="font-medium text-[var(--muted)]">Trigger</dt><dd>{trigger(program)}</dd>
      {!program.autoApply && <><dt className="font-medium text-[var(--muted)]">Code</dt><dd className="min-w-0"><code>{program.code}</code></dd></>}
      <dt className="font-medium text-[var(--muted)]">Priority</dt><dd>{program.priority}</dd>
      {!program.autoApply && <><dt className="font-medium text-[var(--muted)]">Stackable</dt><dd>{program.stackable ? 'Yes' : 'No'}</dd></>}
      <dt className="font-medium text-[var(--muted)]">Schedule</dt><dd>{program.startDate ?? 'Immediately'} → {program.endDate ?? 'No end date'}</dd>
    </dl>
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="font-semibold">Ordered reward rules</h3>
      {program.rewardRules.map((rule, index) => <article className="min-w-0 rounded-[7px] border border-[var(--border)] p-2 [overflow-wrap:anywhere] sm:p-3" key={rule.id}>
        <h4 className="font-semibold">{index + 1}. {rule.name}</h4>
        <p className="my-2">{rewardSummary(rule.reward)}</p>
        <code className="text-[12px] text-[var(--muted)]">{rule.id}</code>
        <details className="mt-3 min-w-0"><summary className={summaryClass}>Exact reward details</summary><pre role="region" aria-label="Exact reward JSON" tabIndex={0} className={jsonClass}>{JSON.stringify(rule.reward, null, 2)}</pre></details>
      </article>)}
      {program.fallbackReward && <article className="min-w-0 rounded-[7px] border border-[var(--border)] p-2 [overflow-wrap:anywhere] sm:p-3">
        <h4 className="font-semibold">Fallback: {program.fallbackReward.name}</h4>
        <p className="my-2">{rewardSummary(program.fallbackReward.reward)}</p>
        <details className="min-w-0"><summary className={summaryClass}>Exact reward details</summary><pre role="region" aria-label="Exact reward JSON" tabIndex={0} className={jsonClass}>{JSON.stringify(program.fallbackReward.reward, null, 2)}</pre></details>
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

  if (loading) return <p role="status" className={`${panelClass} text-[13px] text-[var(--ink)]`}>Loading Promo…</p>;
  if (error && !view) return <ErrorState error={error} retry={() => void load()} forceRetry />;
  if (!view) return <p className={`${panelClass} text-[13px] text-[var(--ink)]`}>Promo not found.</p>;
  const { configuration: program, lifecycle } = view;
  const activeProgram = view.activeConfiguration;
  const draftProgram = view.draftConfiguration;
  return <section aria-labelledby="promo-title" className="flex min-w-0 flex-col gap-4 text-[13px] text-[var(--ink)] [overflow-wrap:anywhere]">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3"><h1 id="promo-title" className="min-w-0 text-[24px] font-semibold tracking-tight">{program.name}</h1>{canManage && lifecycle.status !== 'ended' && <Link className={buttonClass} to={`/promo/${encodeURIComponent(id)}/edit`}>Edit Promo</Link>}</div>
    <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--ink)]">{title(lifecycle.status)}</span>
      {lifecycle.activeRevision && <span>Active revision {lifecycle.activeRevision}</span>}
      {lifecycle.draftRevision && <span>Draft revision {lifecycle.draftRevision}</span>}
    </div>
    {warnings.map(warning => <p className={`${panelClass} border-l-4 border-l-[var(--promo)]`} key={warning}>{warning}</p>)}
    {error && <ErrorState error={error}/>}
    {error?.code === 'PROMO_CODE_CONFLICT' && <p role="alert" className="min-w-0 rounded-[7px] bg-[var(--req-bg)] p-3 text-[var(--req)]">
      Another published Promo already uses this code during an overlapping schedule. Change the code or schedule, then review and publish again.
    </p>}
    <div className="flex min-w-0 flex-wrap gap-2">
      {canPublish && lifecycle.draftRevision && <button className={primaryClass} type="button" onClick={() => setReviewingPublication(true)}>Publish revision</button>}
      {canManage && ['active', 'scheduled'].includes(lifecycle.status) && <button className={buttonClass} type="button" onClick={() => void transition('pause')}>Pause Promo</button>}
      {canManage && lifecycle.status === 'paused' && <button className={buttonClass} type="button" onClick={() => void transition('resume')}>Resume Promo</button>}
      {canManage && lifecycle.status !== 'ended' && lifecycle.activeRevision && <button className={buttonClass} type="button" onClick={() => void transition('end')}>End Promo</button>}
    </div>
    {reviewingPublication && draftProgram && <section aria-labelledby="publication-review-title" className={`${panelClass} flex flex-col gap-2`}>
      <h2 id="publication-review-title" className="text-[16px] font-semibold">Review publication</h2>
      <p>Trigger: {trigger(draftProgram)}</p>
      {!draftProgram.autoApply && <p>Code: <code>{draftProgram.code}</code></p>}
      {!draftProgram.autoApply && <p>Stackable: {draftProgram.stackable ? 'Yes' : 'No'}</p>}
      <p>Priority: {draftProgram.priority}</p>
      <p>Active revision: {lifecycle.activeRevision ?? 'none'}</p>
      <p>Draft revision: {lifecycle.draftRevision}</p>
      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
        <button className={primaryClass} type="button" onClick={() => void publish()}>Confirm publish</button>
        <button className={buttonClass} type="button" onClick={() => setReviewingPublication(false)}>Cancel publication</button>
      </div>
    </section>}
    {activeProgram && draftProgram
      ? <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Configuration program={activeProgram} heading="Active configuration"/>
        <Configuration program={draftProgram} heading="Draft configuration"/>
      </div>
      : <Configuration program={program} heading="Configuration"/>}
  </section>;
}
