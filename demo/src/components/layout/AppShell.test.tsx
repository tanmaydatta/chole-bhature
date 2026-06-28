import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

function renderAtPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<div>Overview page</div>} />
          <Route path="/promo" element={<div>Promo list</div>} />
          <Route path="/promo/:id" element={<div>Promo detail</div>} />
          <Route path="/affiliates/:id" element={<div>Affiliate detail</div>} />
          <Route path="/referrals/:id" element={<div>Referral detail</div>} />
          <Route path="/loyalty/:id" element={<div>Loyalty detail</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

test('static route — overview shows "Overview" in TopBar', () => {
  renderAtPath('/');
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('Overview');
});

test('static route — /promo shows "Promo Codes" in TopBar', () => {
  renderAtPath('/promo');
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('Promo Codes');
});

test('detail route — TopBar shows program name for a promo program', () => {
  // promo-1 has name 'SUMMER15'
  renderAtPath('/promo/promo-1');
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('SUMMER15');
});

test('detail route — TopBar shows program name for a loyalty program', () => {
  // loy-1 has name 'Order Rewards'
  renderAtPath('/loyalty/loy-1');
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('Order Rewards');
});

test('detail route — TopBar shows program name for an affiliate program', () => {
  // aff-1 has name 'ACME-EMPLOYEES'
  renderAtPath('/affiliates/aff-1');
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('ACME-EMPLOYEES');
});

test('detail route with unknown id falls back to "Incentives"', () => {
  renderAtPath('/promo/does-not-exist');
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveTextContent('Incentives');
});
