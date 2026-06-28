import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';

const Placeholder = ({ name }: { name: string }) => (
  <div className="text-[var(--muted)] text-sm">{name} page — coming soon</div>
);

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Placeholder name="Overview" />} />
        <Route path="/promo" element={<Placeholder name="Promo Codes" />} />
        <Route path="/affiliates" element={<Placeholder name="Affiliates" />} />
        <Route path="/referrals" element={<Placeholder name="Referrals" />} />
        <Route path="/loyalty" element={<Placeholder name="Loyalty" />} />
        <Route path="/variables" element={<Placeholder name="Variables" />} />
        <Route path="/events" element={<Placeholder name="Events" />} />
        <Route path="/analytics" element={<Placeholder name="Analytics" />} />
      </Route>
    </Routes>
  );
}
