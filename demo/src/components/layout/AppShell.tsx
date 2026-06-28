import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

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

export function AppShell() {
  const { pathname } = useLocation();
  const title = titleMap[pathname] ?? 'Incentives';
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
