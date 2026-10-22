import { Link } from 'react-router-dom';
import { usePermission } from '../auth/AuthContext';

export default function Overview() {
  const canManage = usePermission('programs:manage');

  return (
    <section aria-labelledby="overview-unavailable" className="max-w-[680px] rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[var(--shadow)]">
      <h2 id="overview-unavailable" className="text-[20px] font-semibold text-[var(--ink)]">Overview metrics aren’t available yet</h2>
      <p className="mt-3 text-[14px] text-[var(--muted)]">Analytics are not available yet. View your promos to manage existing programs.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className="inline-flex rounded-[8px] bg-[#4f46e5] px-4 py-2 text-[13px] font-semibold text-white" to="/promo">View promos</Link>
        {canManage && <Link className="inline-flex rounded-[8px] border border-[var(--border)] px-4 py-2 text-[13px] font-semibold text-[var(--ink)]" to="/promo/new">New promo</Link>}
      </div>
    </section>
  );
}
