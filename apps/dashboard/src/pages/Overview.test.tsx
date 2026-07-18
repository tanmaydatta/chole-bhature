import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Overview from './Overview';
import { useProgramStore } from '../data/store';
import { PROGRAMS } from '../data/programs';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

function LocationProbe({ onLocation }: { onLocation: (path: string) => void }) {
  const loc = useLocation();
  onLocation(loc.pathname);
  return null;
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function renderWithLocationCapture() {
  let currentPath = '/';
  const setPath = (p: string) => { currentPath = p; };
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="*" element={<LocationProbe onLocation={setPath} />} />
      </Routes>
    </MemoryRouter>
  );
  return { getPath: () => currentPath };
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

test('clicking a program row navigates to its detail page', () => {
  const { getPath } = renderWithLocationCapture();
  // SUMMER15 is the first active promo (promo-1). Click its row.
  const row = screen.getByText('SUMMER15').closest('tr')!;
  fireEvent.click(row);
  expect(getPath()).toMatch(/^\/promo\/.+/);
});

test('"＋ New program" opens a type chooser with all four program types', () => {
  renderWithRouter(<Overview />);
  const newBtn = screen.getByRole('button', { name: /New program/i });

  // Chooser should not be visible initially
  expect(screen.queryByRole('menuitem', { name: /Promo/i })).not.toBeInTheDocument();

  fireEvent.click(newBtn);

  // All four type options must appear
  expect(screen.getByRole('menuitem', { name: 'Promo' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Affiliate' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Referral' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Loyalty' })).toBeInTheDocument();
});
