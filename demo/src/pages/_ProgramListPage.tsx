import { useState } from 'react';
import type { ProgramType, Status } from '../lib/types';
import { useProgramStore } from '../data/store';
import { PageHeader } from '../components/common/PageHeader';
import { SegmentedFilter } from '../components/common/SegmentedFilter';
import { DataTable } from '../components/common/DataTable';
import { TypePill } from '../components/common/TypePill';
import { StatusBadge } from '../components/common/StatusBadge';

interface ProgramListPageProps {
  type: ProgramType;
  title: string;
  newLabel: string;
}

type FilterLabel = 'Active' | 'Scheduled' | 'Paused' | 'Ended' | 'Drafts' | 'All';

const FILTER_TO_STATUS: Record<FilterLabel, Status | null> = {
  Active: 'active',
  Scheduled: 'scheduled',
  Paused: 'paused',
  Ended: 'ended',
  Drafts: 'draft',
  All: null,
};

const FILTER_LABELS: FilterLabel[] = ['Active', 'Scheduled', 'Paused', 'Ended', 'Drafts', 'All'];

export default function _ProgramListPage({ type, title, newLabel }: ProgramListPageProps) {
  const [selected, setSelected] = useState<FilterLabel>('Active');
  const byType = useProgramStore(state => state.byType);
  const all = byType(type);

  const counts: Record<FilterLabel, number> = {
    Active: all.filter(p => p.status === 'active').length,
    Scheduled: all.filter(p => p.status === 'scheduled').length,
    Paused: all.filter(p => p.status === 'paused').length,
    Ended: all.filter(p => p.status === 'ended').length,
    Drafts: all.filter(p => p.status === 'draft').length,
    All: all.length,
  };

  const statusFilter = FILTER_TO_STATUS[selected];
  const programs = statusFilter === null ? all : all.filter(p => p.status === statusFilter);

  const options = FILTER_LABELS.map(label => ({
    label,
    count: counts[label],
  }));

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'type', header: 'Type' },
    { key: 'reward', header: 'Reward' },
    { key: 'redemptions', header: 'Redemptions' },
    { key: 'status', header: 'Status' },
  ];

  const rows = programs.map(p => ({
    name: (
      <div>
        <div className="font-medium text-[var(--ink)]">{p.name}</div>
        {p.subtitle && (
          <div className="text-[11px] text-[var(--muted)] mt-[2px]">{p.subtitle as string}</div>
        )}
      </div>
    ),
    type: <TypePill type={p.type} />,
    reward: <span className="text-[var(--ink)]">{p.rewardSummary}</span>,
    redemptions: <span>{p.redemptions.toLocaleString()}</span>,
    status: <StatusBadge status={p.status} />,
  }));

  return (
    <div className="flex flex-col gap-[20px]">
      <PageHeader
        title={title}
        action={
          <button
            className="inline-flex items-center gap-[6px] text-[13px] font-semibold px-[14px] py-[7px] rounded-[8px] bg-[var(--accent)] text-white border-none cursor-pointer"
            type="button"
          >
            ＋ {newLabel}
          </button>
        }
      />
      <SegmentedFilter
        options={options}
        value={selected}
        onChange={label => setSelected(label as FilterLabel)}
      />
      <DataTable columns={columns} rows={rows} />
    </div>
  );
}
