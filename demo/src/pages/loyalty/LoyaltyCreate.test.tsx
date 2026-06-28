import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoyaltyCreate from './LoyaltyCreate';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

function renderLoyaltyCreate() {
  return render(
    <MemoryRouter initialEntries={['/loyalty/new']}>
      <Routes>
        <Route path="/loyalty/new" element={<LoyaltyCreate />} />
        <Route path="/loyalty" element={<div data-testid="loyalty-list-page">Loyalty List</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

test('trigger step defaults to order_completed and shows its payload fields', () => {
  renderLoyaltyCreate();
  // Navigate to trigger step
  fireEvent.click(screen.getByText('Continue →')); // Basics → Trigger

  // Should show order_completed payload fields as chips
  expect(screen.getByText('order_value')).toBeInTheDocument();
  expect(screen.getByText('order_id')).toBeInTheDocument();
});

test('selecting review_submitted swaps payload chips to show rating, product_id, has_photo', () => {
  renderLoyaltyCreate();
  fireEvent.click(screen.getByText('Continue →')); // → Trigger

  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'review_submitted' } });

  expect(screen.getByText('rating')).toBeInTheDocument();
  expect(screen.getByText('product_id')).toBeInTheDocument();
  expect(screen.getByText('has_photo')).toBeInTheDocument();
  // order_completed fields should no longer be shown
  expect(screen.queryByText('order_value')).not.toBeInTheDocument();
});

test('ConditionBuilder variable set swaps with the selected event', () => {
  renderLoyaltyCreate();
  fireEvent.click(screen.getByText('Continue →')); // Basics → Trigger

  // Switch the trigger event to review_submitted
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'review_submitted' } });

  fireEvent.click(screen.getByText('Continue →')); // Trigger → Conditions

  // Open the variable picker
  fireEvent.click(screen.getByText(/Add condition/i));

  // review_submitted payload fields are now selectable variables
  expect(screen.getByText('rating')).toBeInTheDocument();
  expect(screen.getByText('product_id')).toBeInTheDocument();
  expect(screen.getByText('has_photo')).toBeInTheDocument();

  // order_completed-only payload field must NOT be selectable
  expect(screen.queryByText('order_value')).not.toBeInTheDocument();

  // User attributes remain available regardless of the selected event
  expect(screen.getByText('customer_tier')).toBeInTheDocument();
});

test('no-stacking banner is present on the trigger step', () => {
  renderLoyaltyCreate();
  fireEvent.click(screen.getByText('Continue →')); // → Trigger

  expect(screen.getByText(/do not stack/i)).toBeInTheDocument();
});

test('reaching Review and clicking Create adds a loyalty program with triggerEvent and navigates to /loyalty', () => {
  renderLoyaltyCreate();

  const initialCount = useProgramStore.getState().byType('loyalty').length;

  // Basics step — fill name
  const nameInput = screen.getByLabelText(/program name/i);
  fireEvent.change(nameInput, { target: { value: 'My Loyalty Program' } });
  fireEvent.click(screen.getByText('Continue →')); // → Trigger

  fireEvent.click(screen.getByText('Continue →')); // → Conditions

  fireEvent.click(screen.getByText('Continue →')); // → Reward

  fireEvent.click(screen.getByText('Continue →')); // → Review

  // Verify we're on the Review step
  expect(screen.getAllByText(/^Review$/i).length).toBeGreaterThanOrEqual(1);

  const createBtn = screen.getByRole('button', { name: /create/i });
  fireEvent.click(createBtn);

  const loyaltyPrograms = useProgramStore.getState().byType('loyalty');
  expect(loyaltyPrograms.length).toBe(initialCount + 1);

  const created = loyaltyPrograms[loyaltyPrograms.length - 1];
  expect(created.status).toBe('active');
  expect(created.type).toBe('loyalty');
  expect(created.name).toBe('My Loyalty Program');
  expect(created.triggerEvent).toBe('order_completed');

  expect(screen.getByTestId('loyalty-list-page')).toBeInTheDocument();
});

test('Save draft adds a draft loyalty program and navigates to /loyalty', () => {
  renderLoyaltyCreate();

  const initialCount = useProgramStore.getState().byType('loyalty').length;

  const nameInput = screen.getByLabelText(/program name/i);
  fireEvent.change(nameInput, { target: { value: 'Draft Loyalty' } });

  fireEvent.click(screen.getByText('Save draft'));

  const loyaltyPrograms = useProgramStore.getState().byType('loyalty');
  expect(loyaltyPrograms.length).toBe(initialCount + 1);

  const draft = loyaltyPrograms[loyaltyPrograms.length - 1];
  expect(draft.status).toBe('draft');
  expect(draft.name).toBe('Draft Loyalty');

  expect(screen.getByTestId('loyalty-list-page')).toBeInTheDocument();
});
