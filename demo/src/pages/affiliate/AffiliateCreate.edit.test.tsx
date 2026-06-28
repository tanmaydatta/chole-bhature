import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AffiliateCreate from './AffiliateCreate';
import { ToastProvider } from '../../components/common/Toast';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

const DRAFT_AFF = PROGRAMS.find(p => p.id === 'aff-draft-1')!;

function renderAffiliateEdit(draftId: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/affiliates/${draftId}/edit`]}>
        <Routes>
          <Route path="/affiliates/:id/edit" element={<AffiliateCreate />} />
          <Route path="/affiliates" element={<div data-testid="affiliate-list-page">Affiliate List</div>} />
          <Route path="/affiliates/:id" element={<div data-testid="affiliate-detail-page">Affiliate Detail</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

test('editing a draft affiliate prefills the name field', () => {
  renderAffiliateEdit(DRAFT_AFF.id);
  const nameInput = screen.getByLabelText(/program name/i) as HTMLInputElement;
  expect(nameInput.value).toBe(DRAFT_AFF.name);
});

test('editing a draft affiliate shows "Save changes" button on review step', () => {
  renderAffiliateEdit(DRAFT_AFF.id);
  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Discount
  fireEvent.click(screen.getByText('Continue →')); // → Generate codes
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review
  expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
});

test('edit mode: clicking "Save changes" calls updateProgram and navigates to /affiliates/:id', () => {
  renderAffiliateEdit(DRAFT_AFF.id);

  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Discount
  fireEvent.click(screen.getByText('Continue →')); // → Generate codes
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review

  const saveBtn = screen.getByRole('button', { name: /save changes/i });
  fireEvent.click(saveBtn);

  const updated = useProgramStore.getState().programs.find(p => p.id === DRAFT_AFF.id);
  expect(updated?.status).toBe('active');

  expect(screen.getByTestId('affiliate-detail-page')).toBeInTheDocument();
});
