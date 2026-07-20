import type { PermissionKey } from '@incentives/contracts';
import { Link, Outlet } from 'react-router-dom';

import { useAuth } from './AuthContext';

function AccessMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[50vh] bg-[var(--bg)] p-8 text-[var(--ink)]">
      <section className="mx-auto max-w-[560px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
        {children}
      </section>
    </div>
  );
}

export function RootOnlyRoute() {
  const { session } = useAuth();
  if (session?.platformRole !== 'root') {
    return <AccessMessage><p className="font-semibold">You do not have permission to view this page.</p></AccessMessage>;
  }
  return <Outlet />;
}

export function MerchantRoute({ permission }: { permission?: PermissionKey }) {
  const auth = useAuth();
  if (
    auth.session?.platformRole === 'root'
    && (auth.session.merchantSelectionRequired || !auth.session.merchantId)
  ) {
    return (
      <AccessMessage>
        <p className="font-semibold">Select a client before using merchant settings.</p>
        <Link className="mt-3 inline-flex text-[var(--accent)] underline" to="/platform/clients">Select a client</Link>
      </AccessMessage>
    );
  }
  if (permission && !auth.hasPermission(permission)) {
    return <AccessMessage><p className="font-semibold">You do not have permission to view this page.</p></AccessMessage>;
  }
  return <Outlet />;
}

export function RootContextBanner() {
  const { session, rootMerchantName } = useAuth();
  if (session?.platformRole !== 'root') return null;
  return (
    <div className="sticky top-0 z-[80] bg-[#4f46e5] px-[26px] py-2 text-center text-[12px] font-bold text-white">
      Root access · {session.merchantSelectionRequired || !session.merchantId
        ? 'No client selected'
        : (rootMerchantName ?? session.merchantId)}
    </div>
  );
}
