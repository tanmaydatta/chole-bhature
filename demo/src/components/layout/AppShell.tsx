import { Outlet, useLocation } from 'react-router-dom';
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
  '/events': 'Events',
  '/analytics': 'Analytics',
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

export function AppShell() {
  const { pathname } = useLocation();
  const title = usePageTitle(pathname);
  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={title} />
        <main className="p-[24px_26px] overflow-auto flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
