import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgramStore } from '../data/store';
import { StatCard } from '../components/common/StatCard';
import { DataTable } from '../components/common/DataTable';
import { TypePill } from '../components/common/TypePill';
import { StatusBadge } from '../components/common/StatusBadge';
import { PageHeader } from '../components/common/PageHeader';

const TYPE_CHOICES = [
  { label: 'Promo', route: '/promo/new' },
  { label: 'Affiliate', route: '/affiliates/new' },
  { label: 'Referral', route: '/referrals/new' },
  { label: 'Loyalty', route: '/loyalty/new' },
] as const;

export default function Overview() {
  const navigate = useNavigate();
  const [chooserOpen, setChooserOpen] = useState(false);
  const chooserRef = useRef<HTMLDivElement>(null);
  const programs = useProgramStore(state => state.programs);

  // Close chooser on outside click
  useEffect(() => {
    if (!chooserOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) {
        setChooserOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chooserOpen]);

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
            <div ref={chooserRef} style={{ position: 'relative', display: 'inline-block' }}>
              <button
                className="inline-flex items-center gap-[6px] text-[13px] font-semibold px-[14px] py-[7px] rounded-[8px] bg-[var(--accent)] text-white border-none cursor-pointer"
                type="button"
                aria-haspopup="true"
                aria-expanded={chooserOpen}
                onClick={() => setChooserOpen(prev => !prev)}
              >
                ＋ New program
              </button>
              {chooserOpen && (
                <div
                  role="menu"
                  aria-label="Choose program type"
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    background: 'var(--panel, #fff)',
                    border: '1px solid var(--border, #e2e8f0)',
                    borderRadius: '10px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    padding: '6px',
                    minWidth: '160px',
                    zIndex: 100,
                  }}
                >
                  {TYPE_CHOICES.map(({ label, route }) => (
                    <button
                      key={label}
                      role="menuitem"
                      type="button"
                      onClick={() => { setChooserOpen(false); navigate(route); }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '8px 12px',
                        border: 'none',
                        background: 'transparent',
                        borderRadius: '7px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--ink, #1e293b)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--hover, #f1f5f9)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          }
        />
        <DataTable columns={columns} rows={rows} />
      </div>
    </div>
  );
}
