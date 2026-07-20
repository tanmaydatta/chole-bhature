import { Outlet, useLocation } from 'react-router-dom';
import type { OperatorSessionView } from '@incentives/contracts';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useProgramStore } from '../../data/store';

const titleMap: Record<string, string> = {
  '/': 'Overview',
  '/promo': 'Promo Codes',
  '/affiliates': 'Affiliates',
  '/referrals': 'Referrals',
  '/loyalty': 'Loyalty',
  '/variables': 'Variables',
  '/customers': 'Customers',
  '/events': 'Events',
  '/analytics': 'Analytics',
  '/platform/clients': 'Platform clients',
  '/settings/team': 'Team',
  '/settings/credentials': 'Credentials',
};

const DETAIL_SEGMENTS = new Set(['promo', 'affiliates', 'referrals', 'loyalty']);

function usePageTitle(pathname: string): string {
  const programs = useProgramStore(s => s.programs);

  // Check if this is a detail route: /<seg>/<id> where seg ∈ DETAIL_SEGMENTS and id !== 'new'
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && DETAIL_SEGMENTS.has(parts[0]) && parts[1] !== 'new') {
    const programId = parts[1];
    const program = programs.find(p => p.id === programId);
    if (program) return program.name;
  }

  return titleMap[pathname] ?? 'Incentives';
}

const liveRoutes = new Set(['/promo', '/variables', '/customers', '/platform/clients', '/settings/team', '/settings/credentials']);

export function AppShell({
  session,
  onSignOut,
}: {
  session?: OperatorSessionView;
  onSignOut?: () => void;
} = {}) {
  const { pathname } = useLocation();
  const title = usePageTitle(pathname);
  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <Sidebar session={session} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} onSignOut={onSignOut} />
        <main className="p-[24px_26px] overflow-auto flex-1">
          {!liveRoutes.has(pathname) && !pathname.startsWith('/promo/') && <div className="mb-4 inline-flex rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-bold text-[var(--accent)]">Demo data</div>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
