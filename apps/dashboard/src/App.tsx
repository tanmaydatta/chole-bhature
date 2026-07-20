import { Outlet, Routes, Route } from 'react-router-dom';
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
import { useAuth } from './auth/AuthContext';
import { AuthProvider } from './auth/AuthProvider';
import { AuthenticatedApp } from './auth/AuthenticatedApp';
import { InviteAcceptance } from './auth/InviteAcceptance';
import Clients from './pages/platform/Clients';
import Team from './pages/settings/Team';
import Credentials from './pages/settings/Credentials';
import { MerchantRoute, RootContextBanner, RootOnlyRoute } from './auth/RouteAccess';

function AuthenticatedRoute() {
  return <AuthenticatedApp><RootContextBanner /><Outlet /></AuthenticatedApp>;
}

function DemoBuilderRoute() {
  return <><div className="fixed right-4 top-12 z-50 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-bold text-[var(--accent)]">Demo data</div><Outlet /></>;
}

function AuthenticatedShell() {
  const auth = useAuth();
  return <AppShell session={auth.session ?? undefined} onSignOut={() => void auth.signOut()} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/invite/accept" element={<InviteAcceptance />} />
        <Route element={<AuthenticatedRoute />}>
          <Route element={<DemoBuilderRoute />}>
            <Route element={<MerchantRoute permission="programs:manage" />}>
              <Route path="/promo/new" element={<PromoCreate />} />
              <Route path="/promo/:id/edit" element={<PromoCreate />} />
              <Route path="/affiliates/new" element={<AffiliateCreate />} />
              <Route path="/affiliates/:id/edit" element={<AffiliateCreate />} />
              <Route path="/referrals/new" element={<ReferralCreate />} />
              <Route path="/referrals/:id/edit" element={<ReferralCreate />} />
              <Route path="/loyalty/new" element={<LoyaltyCreate />} />
              <Route path="/loyalty/:id/edit" element={<LoyaltyCreate />} />
            </Route>
          </Route>
          <Route element={<AuthenticatedShell />}>
            <Route element={<MerchantRoute permission="programs:read" />}>
              <Route index element={<Overview />} />
              <Route path="/promo" element={<PromoList />} />
              <Route path="/promo/:id" element={<ProgramDetail />} />
              <Route path="/affiliates" element={<AffiliateList />} />
              <Route path="/affiliates/:id" element={<ProgramDetail />} />
              <Route path="/referrals" element={<ReferralList />} />
              <Route path="/referrals/:id" element={<ProgramDetail />} />
              <Route path="/loyalty" element={<LoyaltyList />} />
              <Route path="/loyalty/:id" element={<ProgramDetail />} />
              <Route path="/analytics" element={<Analytics />} />
            </Route>
            <Route element={<MerchantRoute permission="schemas:read" />}>
              <Route path="/variables" element={<Variables />} />
              <Route path="/events" element={<Events />} />
            </Route>
            <Route element={<RootOnlyRoute />}>
              <Route path="/platform/clients" element={<Clients />} />
            </Route>
            <Route element={<MerchantRoute permission="members:read" />}>
              <Route path="/settings/team" element={<Team />} />
            </Route>
            <Route element={<MerchantRoute permission="credentials:read" />}>
              <Route path="/settings/credentials" element={<Credentials />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
