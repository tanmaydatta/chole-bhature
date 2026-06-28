import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import Overview from './pages/Overview';
import PromoList from './pages/promo/PromoList';
import PromoCreate from './pages/promo/PromoCreate';
import AffiliateList from './pages/affiliate/AffiliateList';
import AffiliateCreate from './pages/affiliate/AffiliateCreate';
import LoyaltyList from './pages/loyalty/LoyaltyList';
import LoyaltyCreate from './pages/loyalty/LoyaltyCreate';
import ReferralList from './pages/referral/ReferralList';
import ReferralCreate from './pages/referral/ReferralCreate';
import Variables from './pages/setup/Variables';

const Placeholder = ({ name }: { name: string }) => (
  <div className="text-[var(--muted)] text-sm">{name} page — coming soon</div>
);

export default function App() {
  return (
    <Routes>
      <Route path="/promo/new" element={<PromoCreate />} />
      <Route path="/affiliates/new" element={<AffiliateCreate />} />
      <Route path="/referrals/new" element={<ReferralCreate />} />
      <Route path="/loyalty/new" element={<LoyaltyCreate />} />
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="/promo" element={<PromoList />} />
        <Route path="/affiliates" element={<AffiliateList />} />
        <Route path="/referrals" element={<ReferralList />} />
        <Route path="/loyalty" element={<LoyaltyList />} />
        <Route path="/variables" element={<Variables />} />
        <Route path="/events" element={<Placeholder name="Events" />} />
        <Route path="/analytics" element={<Placeholder name="Analytics" />} />
      </Route>
    </Routes>
  );
}
