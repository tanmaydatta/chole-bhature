import { NavLink } from 'react-router-dom';
import type { OperatorSessionView, PermissionKey } from '@incentives/contracts';

type NavItem = { label: string; to: string; icon: string; color?: string; permission?: PermissionKey; rootOnly?: boolean; merchantRequired?: boolean };

const groups: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { label: 'Overview', to: '/', icon: '▦', permission: 'programs:read', merchantRequired: true },
    ],
  },
  {
    label: 'Incentives',
    items: [
      { label: 'Promo Codes', to: '/promo', icon: '◷', color: 'var(--promo)', permission: 'programs:read', merchantRequired: true },
      { label: 'Affiliates', to: '/affiliates', icon: '⊞', color: 'var(--aff)', permission: 'programs:read', merchantRequired: true },
      { label: 'Referrals', to: '/referrals', icon: '⇄', color: 'var(--ref)', permission: 'programs:read', merchantRequired: true },
      { label: 'Loyalty', to: '/loyalty', icon: '★', color: 'var(--loy)', permission: 'programs:read', merchantRequired: true },
    ],
  },
  {
    label: 'Setup',
    items: [
      { label: 'Variables', to: '/variables', icon: '{x}', permission: 'schemas:read', merchantRequired: true },
      { label: 'Events', to: '/events', icon: '⚡', permission: 'schemas:read', merchantRequired: true },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Analytics', to: '/analytics', icon: '📈', permission: 'programs:read', merchantRequired: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Clients', to: '/platform/clients', icon: '◇', rootOnly: true },
      { label: 'Team', to: '/settings/team', icon: '♙', permission: 'members:read', merchantRequired: true },
      { label: 'Credentials', to: '/settings/credentials', icon: '⌁', permission: 'credentials:read', merchantRequired: true },
    ],
  },
];

function canSee(item: NavItem, session?: OperatorSessionView): boolean {
  if (!session) return !item.rootOnly && item.permission === undefined;
  const root = session.platformRole === 'root';
  if (item.rootOnly) return root;
  if (
    root
    && item.merchantRequired
    && (session.merchantSelectionRequired || !session.merchantId)
  ) return false;
  if (item.permission) return root || session.permissions.includes(item.permission);
  return !root || !session.merchantSelectionRequired;
}

export function Sidebar({ session }: { session?: OperatorSessionView }) {
  return (
    <aside className="w-[228px] bg-[var(--panel)] border-r border-[var(--border)] px-3 py-4 flex-shrink-0 sticky top-0 h-screen overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2 font-bold text-[15px] px-2 pb-[14px] pt-[6px]">
        <span className="w-[22px] h-[22px] rounded-[6px] bg-gradient-to-br from-[var(--accent)] to-[#8b5cf6] flex items-center justify-center text-white text-[13px]">◆</span>
        Incentives
      </div>

      {/* Nav groups */}
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <div className="text-[10px] tracking-[0.09em] uppercase text-[var(--faint)] mx-2 mt-4 mb-[6px]">
              {group.label}
            </div>
          )}
          {group.items.filter(item => canSee(item, session)).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-[9px] px-[9px] py-[7px] rounded-[8px] my-[1px] font-medium cursor-pointer no-underline ${
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]'
                }`
              }
            >
              <span aria-hidden="true" className="w-4 text-center opacity-90" style={item.color ? { color: item.color } : {}}>
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}
