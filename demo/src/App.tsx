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
import Events from './pages/setup/Events';
import Analytics from './pages/Analytics';
import ProgramDetail from './pages/ProgramDetail';

export default function App() {
  return (
    <Routes>
      <Route path="/promo/new" element={<PromoCreate />} />
      <Route path="/promo/:id/edit" element={<PromoCreate />} />
      <Route path="/affiliates/new" element={<AffiliateCreate />} />
      <Route path="/referrals/new" element={<ReferralCreate />} />
      <Route path="/loyalty/new" element={<LoyaltyCreate />} />
      <Route element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="/promo" element={<PromoList />} />
        <Route path="/promo/:id" element={<ProgramDetail />} />
        <Route path="/affiliates" element={<AffiliateList />} />
        <Route path="/affiliates/:id" element={<ProgramDetail />} />
        <Route path="/referrals" element={<ReferralList />} />
        <Route path="/referrals/:id" element={<ProgramDetail />} />
        <Route path="/loyalty" element={<LoyaltyList />} />
        <Route path="/loyalty/:id" element={<ProgramDetail />} />
        <Route path="/variables" element={<Variables />} />
        <Route path="/events" element={<Events />} />
        <Route path="/analytics" element={<Analytics />} />
      </Route>
    </Routes>
  );
}
