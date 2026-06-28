import { useProgramStore } from '../data/store';
import { StatCard } from '../components/common/StatCard';
import { DataTable } from '../components/common/DataTable';
import { TypePill } from '../components/common/TypePill';
import { StatusBadge } from '../components/common/StatusBadge';
import { PageHeader } from '../components/common/PageHeader';

export default function Overview() {
  const programs = useProgramStore(state => state.programs);

  const rows = programs.map(p => ({
    name: (
      <div>
        <div className="font-medium text-[var(--ink)]">{p.name}</div>
        {p.subtitle && (
          <div className="text-[11px] text-[var(--muted)] mt-[2px]">{p.subtitle}</div>
        )}
      </div>
    ),
    type: <TypePill type={p.type} />,
    reward: <span className="text-[var(--ink)]">{p.rewardSummary}</span>,
    redemptions: <span>{p.redemptions.toLocaleString()}</span>,
    status: <StatusBadge status={p.status} />,
  }));

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'type', header: 'Type' },
    { key: 'reward', header: 'Reward' },
    { key: 'redemptions', header: 'Redemptions' },
    { key: 'status', header: 'Status' },
  ];

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Stat cards row */}
      <div className="grid grid-cols-3 gap-[16px]">
        <StatCard
          label="Active programs"
          value="11"
          delta="+3 this month"
        />
        <StatCard
          label="Redemptions (30d)"
          value="8,412"
          delta="↑ 18% vs prev"
        />
        <StatCard
          label="Incentive spend (30d)"
          value="$42,180"
          delta="$65,000 budget · 64% used"
          deltaTone="muted"
          bar={64}
        />
      </div>

      {/* All programs table */}
      <div className="flex flex-col gap-[12px]">
        <PageHeader
          title="All programs"
          action={
            <button
              className="inline-flex items-center gap-[6px] text-[13px] font-semibold px-[14px] py-[7px] rounded-[8px] bg-[var(--accent)] text-white border-none cursor-pointer"
              type="button"
            >
              ＋ New program
            </button>
          }
        />
        <DataTable columns={columns} rows={rows} />
      </div>
    </div>
  );
}
