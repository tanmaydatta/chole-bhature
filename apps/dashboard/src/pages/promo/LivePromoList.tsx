import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { OperatorProgramView, ProgramStatus } from '@incentives/contracts';

import { useAuth } from '../../auth/AuthContext';
import { ErrorState } from '../../auth/ErrorState';
import { PageHeader } from '../../components/common/PageHeader';
import { StatusBadge } from '../../components/common/StatusBadge';
import { programApi } from '../../data/program-api';
import { BffClientError } from '../../lib/bff-client';

const STATUS_OPTIONS: Array<{ label: string; value: ProgramStatus | 'all' }> = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Ended', value: 'ended' },
];

export default function LivePromoList() {
  const auth = useAuth();
  const navigate = useNavigate();
  const canManage = auth.hasPermission('programs:manage');
  const [programs, setPrograms] = useState<OperatorProgramView[]>([]);
  const [status, setStatus] = useState<ProgramStatus | 'all'>('all');
  const [error, setError] = useState<BffClientError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPrograms((await programApi.list()).programs);
    } catch (cause) {
      setError(auth.handleError(cause));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[14px] text-[var(--muted)]">
        <p>Loading Promos…</p>
      </div>
    );
  }

  if (error) return <ErrorState error={error} retry={() => void load()} forceRetry />;

  const visible = programs.filter(
    (program) => status === 'all' || program.lifecycle.status === status
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Promo Codes"
        action={
          canManage ? (
            <Link
              to="/promo/new"
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            >
              ＋ New promo
            </Link>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2 text-[13px] font-medium text-[var(--muted)]">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ProgramStatus | 'all')}
            className="rounded-[7px] border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] font-normal text-[var(--ink)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] py-14 text-center shadow-sm">
          <span className="text-[32px] opacity-30">◷</span>
          <p className="text-[14px] font-medium text-[var(--muted)]">No Promos match this filter.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--panel)] shadow-sm">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--hover)] text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Trigger</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Revision</th>
                <th className="px-4 py-3">Schedule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-[13px]">
              {visible.map((view) => (
                <tr
                  key={view.configuration.id}
                  tabIndex={0}
                  onClick={() => navigate(`/promo/${encodeURIComponent(view.configuration.id)}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      navigate(`/promo/${encodeURIComponent(view.configuration.id)}`);
                    }
                  }}
                  className="cursor-pointer transition-colors hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus:outline-none"
                >
                  <td className="px-4 py-3.5 font-semibold text-[var(--ink)]">
                    {view.configuration.name}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center rounded-full bg-[var(--bg)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--muted)] border border-[var(--border)]">
                      {view.configuration.autoApply ? 'Automatic' : 'Code-triggered'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={view.lifecycle.status as any} />
                  </td>
                  <td className="px-4 py-3.5 text-[var(--muted)]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {view.lifecycle.activeRevision !== undefined && (
                        <span className="inline-flex items-center rounded-full bg-[var(--bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] border border-[var(--border)]">
                          Active revision {view.lifecycle.activeRevision}
                        </span>
                      )}
                      {view.lifecycle.activeRevision !== undefined &&
                        view.lifecycle.draftRevision !== undefined && (
                          <span className="text-[var(--faint)]">·</span>
                        )}
                      {view.lifecycle.draftRevision !== undefined && (
                        <span className="inline-flex items-center rounded-full bg-[var(--bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] border border-[var(--border)]">
                          Draft revision {view.lifecycle.draftRevision}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[var(--muted)]">
                    {view.configuration.startDate ?? 'Immediately'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
