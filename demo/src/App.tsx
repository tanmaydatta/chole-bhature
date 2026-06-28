import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import Overview from './pages/Overview';
import PromoList from './pages/promo/PromoList';
import AffiliateList from './pages/affiliate/AffiliateList';
import LoyaltyList from './pages/loyalty/LoyaltyList';

const Placeholder = ({ name }: { name: string }) => (
  <div className="text-[var(--muted)] text-sm">{name} page — coming soon</div>
);

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="/promo" element={<PromoList />} />
        <Route path="/affiliates" element={<AffiliateList />} />
        <Route path="/referrals" element={<Placeholder name="Referrals" />} />
        <Route path="/loyalty" element={<LoyaltyList />} />
        <Route path="/variables" element={<Placeholder name="Variables" />} />
        <Route path="/events" element={<Placeholder name="Events" />} />
        <Route path="/analytics" element={<Placeholder name="Analytics" />} />
      </Route>
    </Routes>
  );
}
