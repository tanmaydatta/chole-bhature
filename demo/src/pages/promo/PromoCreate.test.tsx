import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PromoCreate from './PromoCreate';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

function renderPromoCreate() {
  return render(
    <MemoryRouter initialEntries={['/promo/new']}>
      <Routes>
        <Route path="/promo/new" element={<PromoCreate />} />
        <Route path="/promo" element={<div data-testid="promo-list-page">Promo List</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

test('renders steps rail with all 5 steps', () => {
  renderPromoCreate();
  // Each step label appears at least once (may also appear as a heading on the active step)
  expect(screen.getAllByText('Basics').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('Eligibility').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('Discount').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('Limits & schedule').length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText('Review').length).toBeGreaterThanOrEqual(1);
  // Verify step rail specifically via data-testid
  expect(screen.getByTestId('step-basics')).toBeInTheDocument();
  expect(screen.getByTestId('step-eligibility')).toBeInTheDocument();
  expect(screen.getByTestId('step-discount')).toBeInTheDocument();
  expect(screen.getByTestId('step-limits')).toBeInTheDocument();
  expect(screen.getByTestId('step-review')).toBeInTheDocument();
});

test('starts on Basics step showing name, code, auto-apply inputs', () => {
  renderPromoCreate();
  expect(screen.getByLabelText(/promo name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/auto.apply/i)).toBeInTheDocument();
});

test('navigating to Eligibility step shows ConditionBuilder with Add condition', () => {
  renderPromoCreate();
  fireEvent.click(screen.getByText('Eligibility'));
  expect(screen.getByText(/Add condition/i)).toBeInTheDocument();
});

test('Continue advances from Basics to Eligibility', () => {
  renderPromoCreate();
  // On Basics step
  expect(screen.getByLabelText(/promo name/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Continue →'));
  // Now on Eligibility
  expect(screen.getByText(/Add condition/i)).toBeInTheDocument();
});

test('Back from Eligibility goes to Basics', () => {
  renderPromoCreate();
  fireEvent.click(screen.getByText('Continue →')); // Basics → Eligibility
  fireEvent.click(screen.getByLabelText('Go back'));
  expect(screen.getByLabelText(/promo name/i)).toBeInTheDocument();
});

test('Cancel navigates to /promo', () => {
  renderPromoCreate();
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.getByTestId('promo-list-page')).toBeInTheDocument();
});

test('Back on Basics step navigates to /promo', () => {
  renderPromoCreate();
  // On first step, back arrow should go to /promo
  fireEvent.click(screen.getByLabelText('Go back'));
  expect(screen.getByTestId('promo-list-page')).toBeInTheDocument();
});

test('reaching Review and clicking Create adds a promo and navigates to /promo', () => {
  renderPromoCreate();

  const initialCount = useProgramStore.getState().byType('promo').length;

  // Basics step — fill name
  const nameInput = screen.getByLabelText(/promo name/i);
  fireEvent.change(nameInput, { target: { value: 'TESTCODE' } });
  fireEvent.click(screen.getByText('Continue →')); // → Eligibility

  fireEvent.click(screen.getByText('Continue →')); // → Discount

  fireEvent.click(screen.getByText('Continue →')); // → Limits

  fireEvent.click(screen.getByText('Continue →')); // → Review

  // Verify we're on the Review step — there will be at least one element matching "Review"
  expect(screen.getAllByText(/^Review$/i).length).toBeGreaterThanOrEqual(1);

  const createBtn = screen.getByRole('button', { name: /create/i });
  fireEvent.click(createBtn);

  const finalCount = useProgramStore.getState().byType('promo').length;
  expect(finalCount).toBe(initialCount + 1);

  expect(screen.getByTestId('promo-list-page')).toBeInTheDocument();
});
