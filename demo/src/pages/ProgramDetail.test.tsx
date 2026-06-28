import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProgramDetail from './ProgramDetail';
import { useProgramStore } from '../data/store';
import { useVariablesStore } from '../data/variablesStore';
import { PROGRAMS } from '../data/programs';
import { VARIABLES } from '../data/variables';

function renderAt(path: string, routePattern: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern} element={<ProgramDetail />} />
        <Route path="/promo" element={<div data-testid="promo-list">Promo List</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
  useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })) });
});

test('shows Edit link for a draft promo program', () => {
  // promo-draft-1 is a draft
  renderAt('/promo/promo-draft-1', '/promo/:id');
  expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument();
  expect(screen.queryByText(/only drafts can be edited/i)).not.toBeInTheDocument();
});

test('shows "Only drafts can be edited" and no Edit for an active promo program', () => {
  // promo-1 is active
  renderAt('/promo/promo-1', '/promo/:id');
  expect(screen.getByText(/only drafts can be edited/i)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
});

test('renders eligibility via ConditionView — condition variable name appears', () => {
  // promo-draft-1 has eligibility with variable 'basket_value' and 'customer_country'
  renderAt('/promo/promo-draft-1', '/promo/:id');
  expect(screen.getByText('basket_value')).toBeInTheDocument();
});

test('unknown id shows "Program not found" with a link home', () => {
  renderAt('/promo/does-not-exist', '/promo/:id');
  expect(screen.getByText(/program not found/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
});
