import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PromoCreate from './PromoCreate';
import { ToastProvider } from '../../components/common/Toast';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

// Draft promo from seed data
const DRAFT_PROMO = PROGRAMS.find(p => p.id === 'promo-draft-1')!;

function renderPromoEdit(draftId: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/promo/${draftId}/edit`]}>
        <Routes>
          <Route path="/promo/:id/edit" element={<PromoCreate />} />
          <Route path="/promo" element={<div data-testid="promo-list-page">Promo List</div>} />
          <Route path="/promo/:id" element={<div data-testid="promo-detail-page">Promo Detail</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

function renderPromoCreate() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/promo/new']}>
        <Routes>
          <Route path="/promo/new" element={<PromoCreate />} />
          <Route path="/promo" element={<div data-testid="promo-list-page">Promo List</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
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

  const promos = useProgramStore.getState().byType('promo');
  expect(promos.length).toBe(initialCount + 1);

  // The newly created promo is active
  const created = promos[promos.length - 1];
  expect(created.status).toBe('active');
  expect(created.name).toBe('TESTCODE');

  expect(screen.getByTestId('promo-list-page')).toBeInTheDocument();
});

test('Save draft adds a draft promo and navigates to /promo', () => {
  renderPromoCreate();

  const initialCount = useProgramStore.getState().byType('promo').length;

  // Fill name on the Basics step, then Save draft from this step
  const nameInput = screen.getByLabelText(/promo name/i);
  fireEvent.change(nameInput, { target: { value: 'DRAFTPROMO' } });

  fireEvent.click(screen.getByText('Save draft'));

  const promos = useProgramStore.getState().byType('promo');
  expect(promos.length).toBe(initialCount + 1);

  const draft = promos[promos.length - 1];
  expect(draft.status).toBe('draft');
  expect(draft.name).toBe('DRAFTPROMO');

  expect(screen.getByTestId('promo-list-page')).toBeInTheDocument();
});

test('clicking Create shows a "Promo created" toast', () => {
  renderPromoCreate();

  // Navigate through all steps to reach Review
  fireEvent.click(screen.getByText('Continue →')); // Basics → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // Eligibility → Discount
  fireEvent.click(screen.getByText('Continue →')); // Discount → Limits
  fireEvent.click(screen.getByText('Continue →')); // Limits → Review

  const createBtn = screen.getByRole('button', { name: /create/i });
  fireEvent.click(createBtn);

  // Toast text must appear in the DOM
  expect(screen.getByText('Promo created')).toBeInTheDocument();
});

test('clicking Save draft shows a "Draft saved" toast', () => {
  renderPromoCreate();

  fireEvent.click(screen.getByText('Save draft'));

  expect(screen.getByText('Draft saved')).toBeInTheDocument();
});

// ——— Edit mode tests ———

test('editing a draft prefills the name field from the draft program', () => {
  renderPromoEdit(DRAFT_PROMO.id);
  // The name input should be pre-populated with the draft's name
  const nameInput = screen.getByLabelText(/promo name/i) as HTMLInputElement;
  expect(nameInput.value).toBe(DRAFT_PROMO.name);
});

test('editing a draft shows "Save changes" button on review step', () => {
  renderPromoEdit(DRAFT_PROMO.id);
  // Navigate to review step
  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Discount
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review
  expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
});

test('edit mode: clicking "Save changes" calls updateProgram and navigates to /promo/:id', () => {
  renderPromoEdit(DRAFT_PROMO.id);

  // Navigate to review step
  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Discount
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review

  const saveBtn = screen.getByRole('button', { name: /save changes/i });
  fireEvent.click(saveBtn);

  // The draft should now be active in the store
  const updated = useProgramStore.getState().programs.find(p => p.id === DRAFT_PROMO.id);
  expect(updated?.status).toBe('active');

  // Should navigate to /promo/:id (promo detail)
  expect(screen.getByTestId('promo-detail-page')).toBeInTheDocument();
});

test('create mode: "Create" button still works and navigates to /promo', () => {
  renderPromoCreate();
  const initialCount = useProgramStore.getState().byType('promo').length;

  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Discount
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review

  const createBtn = screen.getByRole('button', { name: /create/i });
  fireEvent.click(createBtn);

  expect(useProgramStore.getState().byType('promo').length).toBe(initialCount + 1);
  expect(screen.getByTestId('promo-list-page')).toBeInTheDocument();
});
