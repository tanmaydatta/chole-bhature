import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Overview from './Overview';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

test('renders all three stat card labels', () => {
  renderWithRouter(<Overview />);
  expect(screen.getByText('Active programs')).toBeInTheDocument();
  expect(screen.getByText('Redemptions (30d)')).toBeInTheDocument();
  expect(screen.getByText('Incentive spend (30d)')).toBeInTheDocument();
});

test('renders stat card values', () => {
  renderWithRouter(<Overview />);
  expect(screen.getByText('11')).toBeInTheDocument();
  expect(screen.getByText('8,412')).toBeInTheDocument();
  expect(screen.getByText('$42,180')).toBeInTheDocument();
});

test('renders the programs table with at least one TypePill and StatusBadge', () => {
  renderWithRouter(<Overview />);
  const table = within(screen.getByRole('table'));
  // TypePill labels (scoped to the table)
  expect(table.getAllByText(/^(Promo|Affiliate|Referral|Loyalty)$/).length).toBeGreaterThan(0);
  // StatusBadge labels (scoped to the table)
  expect(table.getAllByText(/^(Active|Paused|Scheduled|Draft|Ended)$/).length).toBeGreaterThan(0);
});

test('Name cell renders subtitle, not a duplicate rewardSummary', () => {
  renderWithRouter(<Overview />);
  const table = within(screen.getByRole('table'));
  // subtitle descriptor from seed
  expect(table.getByText('Orders over $50')).toBeInTheDocument();
  // rewardSummary appears once (Reward column only), not duplicated in Name sub-line
  expect(table.getAllByText('15% off')).toHaveLength(1);
});

test('renders the "＋ New program" button', () => {
  renderWithRouter(<Overview />);
  expect(screen.getByRole('button', { name: /New program/i })).toBeInTheDocument();
});

test('renders "All programs" page header', () => {
  renderWithRouter(<Overview />);
  expect(screen.getByText('All programs')).toBeInTheDocument();
});
