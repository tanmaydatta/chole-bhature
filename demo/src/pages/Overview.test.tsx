import { render, screen } from '@testing-library/react';
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

test('renders the programs table with at least one TypePill and StatusBadge', () => {
  renderWithRouter(<Overview />);
  // TypePill labels
  expect(screen.getAllByText(/Promo|Affiliate|Referral|Loyalty/).length).toBeGreaterThan(0);
  // StatusBadge labels
  expect(screen.getAllByText(/Active|Paused|Scheduled|Draft|Ended/).length).toBeGreaterThan(0);
});

test('renders the "＋ New program" button', () => {
  renderWithRouter(<Overview />);
  expect(screen.getByRole('button', { name: /New program/i })).toBeInTheDocument();
});

test('renders "All programs" page header', () => {
  renderWithRouter(<Overview />);
  expect(screen.getByText('All programs')).toBeInTheDocument();
});
