import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Analytics from './Analytics';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

test('renders the Analytics heading', () => {
  renderWithRouter(<Analytics />);
  expect(screen.getByText('Analytics')).toBeInTheDocument();
});

test('renders at least one StatCard — Total redemptions label', () => {
  renderWithRouter(<Analytics />);
  expect(screen.getByText('Total redemptions')).toBeInTheDocument();
});

test('renders the "coming soon" note', () => {
  renderWithRouter(<Analytics />);
  expect(screen.getByText(/Deeper insights coming soon/i)).toBeInTheDocument();
});
