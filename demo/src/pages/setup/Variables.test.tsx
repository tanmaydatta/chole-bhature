import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Variables from './Variables';
import { useVariablesStore } from '../../data/variablesStore';
import { VARIABLES } from '../../data/variables';

beforeEach(() => {
  useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })) });
});

function renderVariables() {
  return render(
    <MemoryRouter>
      <Variables />
    </MemoryRouter>
  );
}

test('renders the three origin group headers', () => {
  renderVariables();
  // Group headers use a more specific text including the descriptor
  expect(screen.getByText(/User attributes · persistent/i)).toBeInTheDocument();
  expect(screen.getByText(/Dynamic \/ context · passed in/i)).toBeInTheDocument();
  expect(screen.getByText(/System · provided by us/i)).toBeInTheDocument();
});

test('system variable budget_remaining shows lock indicator and "auto"', () => {
  renderVariables();
  expect(screen.getByText('budget_remaining')).toBeInTheDocument();
  // Per-row read-only locks are titled "Read-only" (distinct from the group-header 🔒).
  // Exactly one per system variable: budget_remaining, redemptions_total, customer_uses_count, today.
  expect(screen.getAllByTitle('Read-only')).toHaveLength(4);
  // "auto" appears in the used-in column for system vars
  const autoEls = screen.getAllByText('auto');
  expect(autoEls.length).toBeGreaterThan(0);
});

test('user variable customer_country shows its default message', () => {
  renderVariables();
  expect(screen.getByText(/This code isn't available in your region\./i)).toBeInTheDocument();
});

test('selecting System filter shows system vars and hides user/dynamic', () => {
  renderVariables();
  // Click the System filter button (accessible name includes the count text too)
  fireEvent.click(screen.getByRole('button', { name: /System/i }));
  // System vars visible
  expect(screen.getByText('budget_remaining')).toBeInTheDocument();
  expect(screen.getByText('today')).toBeInTheDocument();
  // User vars hidden
  expect(screen.queryByText('customer_country')).not.toBeInTheDocument();
  // Dynamic vars hidden
  expect(screen.queryByText('basket_value')).not.toBeInTheDocument();
});
