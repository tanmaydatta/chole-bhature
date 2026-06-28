import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Status } from '../../lib/types';
import { useProgramStore } from '../../data/store';
import { PageHeader } from '../../components/common/PageHeader';
import { SegmentedFilter } from '../../components/common/SegmentedFilter';
import { StatusBadge } from '../../components/common/StatusBadge';

type FilterLabel = 'Active' | 'Scheduled' | 'Paused' | 'Ended' | 'Drafts' | 'All';

const FILTER_LABELS: FilterLabel[] = ['Active', 'Scheduled', 'Paused', 'Ended', 'Drafts', 'All'];

// Label → Status mapping for narrowing the view (All has no single status).
const STATUS_FOR: Record<Exclude<FilterLabel, 'All'>, Status> = {
  Active: 'active',
  Scheduled: 'scheduled',
  Paused: 'paused',
  Ended: 'ended',
  Drafts: 'draft',
};

function rewardDisplay(r: unknown): string {
  if (r === null || r === undefined) return '—';
  if (typeof r === 'string') return r;
  if (typeof r === 'object' && r !== null) {
    const obj = r as { kind?: string; value?: number };
    switch (obj.kind) {
      case 'percent': return `${obj.value ?? 0}% off`;
      case 'fixed': return `$${obj.value ?? 0} off`;
      case 'free_shipping': return 'Free shipping';
      case 'points': return `${obj.value ?? 0}% back as points`;
      case 'credit': return `$${obj.value ?? 0} credit`;
    }
  }
  return String(r);
}

export default function ReferralList() {
  const navigate = useNavigate();
  // Default to 'All' so the full ranked + not-ranked story shows up front.
  const [selected, setSelected] = useState<FilterLabel>('All');
  const programs = useProgramStore(state => state.programs);
  const setReferralPriority = useProgramStore(state => state.setReferralPriority);

  const all = programs.filter(p => p.type === 'referral');

  // Counts always derived from ALL referral programs.
  const counts: Record<FilterLabel, number> = {
    Active: all.filter(p => p.status === 'active').length,
    Scheduled: all.filter(p => p.status === 'scheduled').length,
    Paused: all.filter(p => p.status === 'paused').length,
    Ended: all.filter(p => p.status === 'ended').length,
    Drafts: all.filter(p => p.status === 'draft').length,
    All: all.length,
  };

  // Apply the selected filter to narrow the visible set.
  const filtered =
    selected === 'All' ? all : all.filter(p => p.status === STATUS_FOR[selected]);

  // Ranked: active + scheduled (from the filtered set), sorted by priority ascending.
  const ranked = filtered
    .filter(p => p.status === 'active' || p.status === 'scheduled')
    .sort(
      (a, b) =>
        (typeof a.priority === 'number' ? a.priority : 999) -
        (typeof b.priority === 'number' ? b.priority : 999)
    );

  // Not ranked: paused + ended + draft (from the filtered set), shown below the divider.
  const notRanked = filtered.filter(
    p => p.status === 'paused' || p.status === 'ended' || p.status === 'draft'
  );

  const options = FILTER_LABELS.map(label => ({
    label,
    count: counts[label],
  }));

  // Drag state
  const dragIdRef = useRef<string | null>(null);

  function handleDragStart(id: string) {
    dragIdRef.current = id;
  }

  function handleDrop(targetId: string) {
    const dragId = dragIdRef.current;
    if (!dragId || dragId === targetId) return;
    const ids = ranked.map(p => p.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...ids];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, dragId);
    setReferralPriority(reordered);
    dragIdRef.current = null;
  }

  function handlePriorityChange(id: string, newPriority: number) {
    const clampedPriority = Math.max(1, Math.min(ranked.length, newPriority));
    const currentIndex = ranked.findIndex(p => p.id === id);
    const newIndex = clampedPriority - 1;
    if (currentIndex === -1) return;
    const ids = ranked.map(p => p.id);
    const reordered = [...ids];
    reordered.splice(currentIndex, 1);
    reordered.splice(newIndex, 0, id);
    setReferralPriority(reordered);
  }

  const ROW_COLS = '48px 1fr 130px 130px 100px 32px';

  return (
    <div className="flex flex-col gap-[20px]">
      <PageHeader
        title="Referral Programs"
        action={
          <button
            className="inline-flex items-center gap-[6px] text-[13px] font-semibold px-[14px] py-[7px] rounded-[8px] bg-[var(--accent)] text-white border-none cursor-pointer"
            type="button"
            onClick={() => navigate('/referrals/new')}
          >
            ＋ New referral
          </button>
        }
      />

      <SegmentedFilter
        options={options}
        value={selected}
        onChange={label => setSelected(label as FilterLabel)}
      />

      {/* Ranked section — active + scheduled within the current filter */}
      {ranked.length > 0 && (
        <div className="flex flex-col gap-0">
          {/* Table header */}
          <div
            className="grid text-[11px] font-[600] text-[var(--muted)] uppercase tracking-wide px-[12px] py-[6px] border-b border-[var(--border)]"
            style={{ gridTemplateColumns: ROW_COLS }}
          >
            <span>#</span>
            <span>Program</span>
            <span>Referrer</span>
            <span>Referee</span>
            <span>Status</span>
            <span></span>
          </div>

          {ranked.map((p) => {
            const priority = typeof p.priority === 'number' ? p.priority : 999;
            const appliesToStr = typeof p.appliesTo === 'string' ? p.appliesTo : '';

            return (
              <div
                key={p.id}
                draggable
                onDragStart={() => handleDragStart(p.id)}
                onDragOver={e => e.preventDefault()}
                onDrop={() => handleDrop(p.id)}
                onClick={() => navigate(`/referrals/${p.id}`)}
                className="grid items-center px-[12px] py-[10px] border-b border-[var(--border)] hover:bg-[var(--hover)] cursor-grab"
                style={{ gridTemplateColumns: ROW_COLS }}
              >
                {/* Priority input */}
                <span>
                  <input
                    type="number"
                    min={1}
                    max={ranked.length}
                    value={priority}
                    onClick={e => e.stopPropagation()}
                    onMouseDown={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) handlePriorityChange(p.id, v);
                    }}
                    className="w-[40px] border border-[var(--border)] bg-[var(--bg)] rounded-[5px] px-[4px] py-[2px] text-[13px] text-center text-[var(--ink)]"
                  />
                </span>

                {/* Name + applies to chips */}
                <span>
                  <div className="font-[600] text-[14px] text-[var(--ink)]">{p.name}</div>
                  {appliesToStr && (
                    <span className="inline-block mt-[3px] text-[11px] bg-[var(--hover)] border border-[var(--border)] rounded-full px-[8px] py-[1px] text-[var(--muted)]">
                      {appliesToStr}
                    </span>
                  )}
                </span>

                {/* Referrer reward */}
                <span className="text-[13px] text-[var(--ink)]">
                  {rewardDisplay(p.referrerReward)}
                </span>

                {/* Referee reward */}
                <span className="text-[13px] text-[var(--ink)]">
                  {rewardDisplay(p.refereeReward)}
                </span>

                {/* Status */}
                <span>
                  <StatusBadge status={p.status} />
                </span>

                {/* Menu affordance */}
                <span className="text-[var(--muted)] text-[18px] cursor-pointer select-none">⋮</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state — shown when the filter yields no rows at all */}
      {ranked.length === 0 && notRanked.length === 0 && (
        <div
          className="flex flex-col items-center justify-center gap-[10px] py-[56px] text-center"
          data-testid="empty-state"
        >
          <span style={{ fontSize: '32px', opacity: 0.3 }}>○</span>
          <p className="text-[14px] text-[var(--muted)] font-medium">
            No {selected.toLowerCase()} programs yet.
          </p>
        </div>
      )}

      {/* Not-ranked divider and section — paused/ended/draft within the current filter */}
      {notRanked.length > 0 && (
        <div className="flex flex-col gap-0">
          <div className="flex items-center gap-[10px] my-[8px]">
            <hr className="flex-1 border-t border-[var(--border)]" />
            <span className="text-[11px] font-[600] text-[var(--muted)] whitespace-nowrap">
              Not ranked · excluded from matching
            </span>
            <hr className="flex-1 border-t border-[var(--border)]" />
          </div>

          {notRanked.map((p) => {
            const appliesToStr = typeof p.appliesTo === 'string' ? p.appliesTo : '';

            return (
              <div
                key={p.id}
                onClick={() => navigate(`/referrals/${p.id}`)}
                className="grid items-center px-[12px] py-[10px] border-b border-[var(--border)] opacity-60 cursor-pointer"
                style={{ gridTemplateColumns: ROW_COLS }}
              >
                <span className="text-[var(--faint)] text-[13px]">—</span>
                <span>
                  <div className="font-[600] text-[14px] text-[var(--muted)]">{p.name}</div>
                  {appliesToStr && (
                    <span className="inline-block mt-[3px] text-[11px] bg-[var(--hover)] border border-[var(--border)] rounded-full px-[8px] py-[1px] text-[var(--muted)]">
                      {appliesToStr}
                    </span>
                  )}
                </span>
                <span className="text-[13px] text-[var(--muted)]">
                  {rewardDisplay(p.referrerReward)}
                </span>
                <span className="text-[13px] text-[var(--muted)]">
                  {rewardDisplay(p.refereeReward)}
                </span>
                <span>
                  <StatusBadge status={p.status} />
                </span>
                <span className="text-[var(--muted)] text-[18px] cursor-pointer select-none">⋮</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
