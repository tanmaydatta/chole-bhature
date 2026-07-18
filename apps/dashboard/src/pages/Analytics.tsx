import { PageHeader } from '../components/common/PageHeader';
import { StatCard } from '../components/common/StatCard';

const BAR_DATA = [
  { label: 'Promo', pct: 42 },
  { label: 'Loyalty', pct: 28 },
  { label: 'Affiliate', pct: 18 },
  { label: 'Referral', pct: 12 },
];

export default function Analytics() {
  return (
    <div className="flex flex-col gap-[20px]">
      <PageHeader title="Analytics" />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-[16px]">
        <StatCard
          label="Total redemptions"
          value="24,831"
          delta="↑ 12% vs last quarter"
        />
        <StatCard
          label="Incentive spend"
          value="$118,450"
          delta="$180,000 annual budget · 66% used"
          deltaTone="muted"
          bar={66}
        />
        <StatCard
          label="Active customers"
          value="5,204"
          delta="↑ 8% vs last quarter"
        />
      </div>

      {/* Bar chart stubs — redemptions by program type */}
      <div className="bg-[var(--panel)] border border-[var(--border)] rounded-[12px] px-[20px] py-[18px] shadow-[var(--shadow)]">
        <div className="text-[13px] font-semibold text-[var(--ink)] mb-[14px]">
          Redemptions by program type
        </div>
        <div className="flex flex-col gap-[10px]">
          {BAR_DATA.map(({ label, pct }) => (
            <div key={label} className="flex items-center gap-[12px]">
              <span className="w-[64px] text-[12px] text-[var(--muted)] text-right shrink-0">
                {label}
              </span>
              <div className="flex-1 h-[12px] rounded-full bg-[var(--hover)] overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-[32px] text-[12px] text-[var(--muted)] shrink-0">{pct}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coming soon note */}
      <p className="text-[12px] text-[var(--muted)] m-0">
        Deeper insights coming soon — cohort analysis, revenue attribution, and export.
      </p>
    </div>
  );
}
