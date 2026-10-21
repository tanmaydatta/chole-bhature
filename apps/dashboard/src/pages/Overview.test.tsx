import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PermissionKey } from '@incentives/contracts';
import Overview from './Overview';
import { useProgramStore } from '../data/store';
import { PROGRAMS } from '../data/programs';
import { TestAuth } from '../test/TestAuth';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

function renderOverview(permissions: PermissionKey[] = ['programs:read', 'programs:manage']) {
  return render(<TestAuth permissions={permissions}><MemoryRouter>
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/promo" element={<h1>Live Promo list</h1>} />
      <Route path="/promo/new" element={<h1>Create live Promo</h1>} />
    </Routes>
  </MemoryRouter></TestAuth>);
}

test.each(['populated', 'empty'])('keeps analytics unavailable with a %s browser-local store', store => {
  if (store === 'empty') useProgramStore.setState({ programs: [] });
  renderOverview();

  expect(screen.getByRole('heading', { name: 'Overview metrics aren’t available yet' })).toBeVisible();
  expect(screen.getByText('Analytics are not available yet. View your promos to manage existing programs.')).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText(/Active programs|Redemptions \(30d\)|Incentive spend|All programs/)).not.toBeInTheDocument();
  expect(screen.queryByText(/8,412|\$42,180|\$65,000|64%|\+3 this month|18% vs prev/)).not.toBeInTheDocument();
  expect(screen.queryByText('SUMMER15')).not.toBeInTheDocument();
  expect(screen.queryByText(/no (programs|promos)/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /New program/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test.each([
  [['programs:read', 'programs:manage'], true],
  [['programs:read'], false],
] satisfies [PermissionKey[], boolean][])('derives live actions from permissions %j', (permissions, canManage) => {
  renderOverview(permissions);
  expect(screen.getByRole('link', { name: 'View promos' })).toHaveAttribute('href', '/promo');
  const create = screen.queryByRole('link', { name: 'New promo' });
  if (canManage) expect(create).toHaveAttribute('href', '/promo/new');
  else expect(create).not.toBeInTheDocument();
});

test('a reader can open the live Promo list from Overview', async () => {
  renderOverview(['programs:read']);
  await userEvent.click(screen.getByRole('link', { name: 'View promos' }));
  expect(screen.getByRole('heading', { name: 'Live Promo list' })).toBeVisible();
});

test('a manager can open the live Promo editor directly', async () => {
  renderOverview();
  await userEvent.click(screen.getByRole('link', { name: 'New promo' }));
  expect(screen.getByRole('heading', { name: 'Create live Promo' })).toBeVisible();
});
