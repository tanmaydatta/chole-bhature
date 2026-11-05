import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CommerceReward,
  OperatorProgramView,
  PromoProgram,
} from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';
import type { Status } from '../../lib/types';

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
  return (
    <section className="flex flex-col gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
      <h2 className="text-[15px] font-bold text-[var(--ink)] m-0">{heading}</h2>
      <dl className="grid grid-cols-2 gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4 text-[13px]">
        <dt className="text-[var(--muted)] font-medium">External reference</dt>
        <dd className="font-semibold text-[var(--ink)]">
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 border border-[var(--border)] font-mono text-[12px]">
            {program.id}
          </code>
        </dd>
        <dt className="text-[var(--muted)] font-medium">Trigger</dt>
        <dd className="font-semibold text-[var(--ink)]">{trigger(program)}</dd>
        {!program.autoApply && (
          <>
            <dt className="text-[var(--muted)] font-medium">Code</dt>
            <dd className="font-semibold text-[var(--ink)]">
              <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 border border-[var(--border)] font-mono text-[12px]">
                {program.code}
              </code>
            </dd>
          </>
        )}
        <dt className="text-[var(--muted)] font-medium">Priority</dt>
        <dd className="font-semibold text-[var(--ink)]">{program.priority}</dd>
        {!program.autoApply && (
          <>
            <dt className="text-[var(--muted)] font-medium">Stackable</dt>
            <dd className="font-semibold text-[var(--ink)]">{program.stackable ? 'Yes' : 'No'}</dd>
          </>
        )}
        <dt className="text-[var(--muted)] font-medium">Schedule</dt>
        <dd className="font-semibold text-[var(--ink)]">
          {program.startDate ?? 'Immediately'} → {program.endDate ?? 'No end date'}
        </dd>
      </dl>
      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold text-[var(--muted)] uppercase tracking-wider">
          Ordered reward rules
        </h3>
        <div className="space-y-3">
          {program.rewardRules.map((rule, index) => (
            <article
              key={rule.id}
              className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-3.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[13.5px] font-bold text-[var(--ink)] m-0">
                  {index + 1}. {rule.name}
                </h4>
                <code className="text-[11px] text-[var(--muted)]">{rule.id}</code>
              </div>
              <p className="text-[13px] font-medium text-[var(--ink)]">
                <span className="inline-flex rounded-full bg-[var(--hover)] px-2.5 py-0.5 text-[12px] border border-[var(--border)]">
                  {rewardSummary(rule.reward)}
                </span>
              </p>
              <details className="text-[12px] text-[var(--muted)] cursor-pointer pt-1">
                <summary className="hover:text-[var(--ink)] font-medium">Exact reward details</summary>
                <pre className="mt-2 rounded-[6px] border border-[var(--border)] bg-[var(--panel)] p-2.5 font-mono text-[11.5px] overflow-x-auto text-[var(--ink)]">
                  {JSON.stringify(rule.reward, null, 2)}
                </pre>
              </details>
            </article>
          ))}
          {program.fallbackReward && (
            <article className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[13.5px] font-bold text-[var(--ink)] m-0">
                  Fallback: {program.fallbackReward.name}
                </h4>
                <code className="text-[11px] text-[var(--muted)]">{program.fallbackReward.id}</code>
              </div>
              <p className="text-[13px] font-medium text-[var(--ink)]">
                <span className="inline-flex rounded-full bg-[var(--hover)] px-2.5 py-0.5 text-[12px] border border-[var(--border)]">
                  {rewardSummary(program.fallbackReward.reward)}
                </span>
              </p>
              <details className="text-[12px] text-[var(--muted)] cursor-pointer pt-1">
                <summary className="hover:text-[var(--ink)] font-medium">Exact reward details</summary>
                <pre className="mt-2 rounded-[6px] border border-[var(--border)] bg-[var(--panel)] p-2.5 font-mono text-[11.5px] overflow-x-auto text-[var(--ink)]">
                  {JSON.stringify(program.fallbackReward.reward, null, 2)}
                </pre>
              </details>
            </article>
          )}
        </div>
      </section>
    </section>
  );
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
    setLoading(true);
    setError(null);
    try {
      setView(await programApi.get(id));
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setLoading(false);
    }
  }, [auth, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish() {
    setError(null);
    try {
      const result = await programApi.publish(id);
      setWarnings(result.warnings.map((warning) => warning.message));
      setReviewingPublication(false);
      await load();
    } catch (cause) {
      setError(auth.handleError(cause));
    }
  }

  async function transition(action: 'pause' | 'resume' | 'end') {
    if (action === 'end' && !window.confirm('Ending this Promo cannot be undone. Continue?')) {
      return;
    }
    setError(null);
    try {
      await programApi[action](id);
      await load();
    } catch (cause) {
      setError(auth.handleError(cause));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[14px] text-[var(--muted)]">
        <p>Loading Promo…</p>
      </div>
    );
  }

  if (error && !view) return <ErrorState error={error} retry={() => void load()} forceRetry />;
  if (!view) return <p className="text-[14px] text-[var(--muted)]">Promo not found.</p>;

  const { configuration: program, lifecycle } = view;
  const activeProgram = view.activeConfiguration;
  const draftProgram = view.draftConfiguration;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={program.name}
        action={
          canManage && lifecycle.status !== 'ended' ? (
            <Link
              to={`/promo/${encodeURIComponent(id)}/edit`}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--ink)] shadow-sm transition-colors hover:bg-[var(--hover)]"
            >
              Edit Promo
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={lifecycle.status as Status} />
        {lifecycle.activeRevision && (
          <span className="inline-flex items-center rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--muted)] border border-[var(--border)]">
            Active revision {lifecycle.activeRevision}
          </span>
        )}
        {lifecycle.draftRevision && (
          <span className="inline-flex items-center rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--muted)] border border-[var(--border)]">
            Draft revision {lifecycle.draftRevision}
          </span>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((warning) => (
            <p key={warning} className="rounded-[7px] bg-amber-50 px-3 py-2 text-[12px] text-amber-800 border border-amber-200">
              {warning}
            </p>
          ))}
        </div>
      )}

      {error && !reviewingPublication && <ErrorState error={error} />}

      {error?.code === 'PROMO_CODE_CONFLICT' && !reviewingPublication && (
        <p role="alert" className="rounded-[7px] bg-[var(--req-bg)] px-3.5 py-2.5 text-[12.5px] font-medium text-[var(--req)] border border-rose-200">
          Another published Promo already uses this code during an overlapping schedule. Change the code or schedule, then review and publish again.
        </p>
      )}

      <div className="flex flex-wrap gap-2.5">
        {canPublish && lifecycle.draftRevision && (
          <button
            type="button"
            onClick={() => setReviewingPublication(true)}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Publish revision
          </button>
        )}
        {canManage && ['active', 'scheduled'].includes(lifecycle.status) && (
          <button
            type="button"
            onClick={() => void transition('pause')}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink)] shadow-sm transition-colors hover:bg-[var(--hover)]"
          >
            Pause Promo
          </button>
        )}
        {canManage && lifecycle.status === 'paused' && (
          <button
            type="button"
            onClick={() => void transition('resume')}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2 text-[13px] font-semibold text-[var(--ink)] shadow-sm transition-colors hover:bg-[var(--hover)]"
          >
            Resume Promo
          </button>
        )}
        {canManage && lifecycle.status !== 'ended' && lifecycle.activeRevision && (
          <button
            type="button"
            onClick={() => void transition('end')}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-rose-300 bg-rose-50/50 px-3.5 py-2 text-[13px] font-semibold text-rose-600 shadow-sm transition-colors hover:bg-rose-50"
          >
            End Promo
          </button>
        )}
      </div>

      {reviewingPublication && draftProgram && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setReviewingPublication(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-pub-heading"
            tabIndex={-1}
            className="w-full max-w-lg rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl space-y-4 text-[13px] text-[var(--ink)] focus:outline-none"
          >
            <h2 id="review-pub-heading" className="text-[16px] font-bold text-[var(--ink)] m-0">Review publication</h2>
            {error && <ErrorState error={error} />}
            {error?.code === 'PROMO_CODE_CONFLICT' && (
              <p role="alert" className="rounded-[7px] bg-[var(--req-bg)] px-3.5 py-2.5 text-[12.5px] font-medium text-[var(--req)] border border-rose-200">
                Another published Promo already uses this code during an overlapping schedule. Change the code or schedule, then review and publish again.
              </p>
            )}
            <div className="space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-4 text-[13px]">
              <p>Trigger: {trigger(draftProgram)}</p>
              {!draftProgram.autoApply && (
                <p>
                  Code: <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px] border border-[var(--border)]">
                    {draftProgram.code}
                  </code>
                </p>
              )}
              {!draftProgram.autoApply && (
                <p>Stackable: {draftProgram.stackable ? 'Yes' : 'No'}</p>
              )}
              <p>Priority: {draftProgram.priority}</p>
              <p>Active revision: {lifecycle.activeRevision ?? 'none'}</p>
              <p>Draft revision: {lifecycle.draftRevision}</p>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReviewingPublication(false)}
                className="rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-4 py-2 font-semibold text-[var(--muted)] transition-colors hover:text-[var(--ink)] hover:bg-[var(--hover)]"
              >
                Cancel publication
              </button>
              <button
                type="button"
                onClick={() => void publish()}
                className="rounded-[8px] bg-[var(--accent)] px-4 py-2 font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                Confirm publish
              </button>
            </div>
          </section>
        </div>
      )}

      {activeProgram && draftProgram ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Configuration program={activeProgram} heading="Active configuration" />
          <Configuration program={draftProgram} heading="Draft configuration" />
        </div>
      ) : (
        <Configuration program={program} heading="Configuration" />
      )}
    </div>
  );
}
