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

export function AccountContextStrip() {
  const { session } = useAuth();
  if (!session) return null;
  const { user, role, client } = session.display;
  const name = user.name?.trim() || user.email;
  const roleLabel = { root: 'ROOT', admin: 'Admin', operator: 'Operator', viewer: 'Viewer' }[role];
  const methodLabels = new Map([
    ['passkey', 'Passkey'], ['magic-link', 'Email link'], ['e2e-fixture', 'Test fixture'],
  ]);
  const methods = [...new Set(session.authenticationMethods.map(method => methodLabels.get(method) ?? 'Authenticated session'))];
  const clientLabel = client?.name ?? 'No client selected';
  return (
    <section aria-label="Account context" className="z-[80] min-w-0 shrink-0 border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[12px] text-[var(--ink)] sm:px-[26px]">
      {role === 'root' && <p aria-label="ROOT access warning" className="mb-2 rounded bg-[#4f46e5] px-3 py-2 font-bold text-white [overflow-wrap:anywhere]">Root access · {clientLabel}</p>}
      <dl className="flex min-w-0 flex-wrap gap-x-8 gap-y-2 [overflow-wrap:anywhere]">
        <div className="min-w-0 max-w-full"><dt className="text-[var(--muted)]">Account</dt><dd className="font-semibold"><span>{name}</span>{name !== user.email && <span className="block font-normal">{user.email}</span>}</dd></div>
        <div className="min-w-0"><dt className="text-[var(--muted)]">Role</dt><dd className="font-semibold">{roleLabel}</dd></div>
        <div className="min-w-0"><dt className="text-[var(--muted)]">Signed in with</dt><dd>{methods.join(', ')}</dd></div>
        <div className="min-w-0 max-w-full"><dt className="text-[var(--muted)]">Client</dt><dd className="font-semibold">{clientLabel}</dd></div>
      </dl>
    </section>
  );
}
