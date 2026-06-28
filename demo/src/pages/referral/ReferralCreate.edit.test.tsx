import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ReferralCreate from './ReferralCreate';
import { ToastProvider } from '../../components/common/Toast';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

const DRAFT_REF = PROGRAMS.find(p => p.id === 'ref-draft-1')!;

function renderReferralEdit(draftId: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/referrals/${draftId}/edit`]}>
        <Routes>
          <Route path="/referrals/:id/edit" element={<ReferralCreate />} />
          <Route path="/referrals" element={<div data-testid="referral-list-page">Referral List</div>} />
          <Route path="/referrals/:id" element={<div data-testid="referral-detail-page">Referral Detail</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  );
}

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

test('editing a draft referral prefills the name field', () => {
  renderReferralEdit(DRAFT_REF.id);
  const nameInput = screen.getByLabelText(/program name/i) as HTMLInputElement;
  expect(nameInput.value).toBe(DRAFT_REF.name);
});

test('editing a draft referral shows "Save changes" button on review step', () => {
  renderReferralEdit(DRAFT_REF.id);
  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Rewards
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review
  expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
});

test('edit mode: clicking "Save changes" calls updateProgram and navigates to /referrals/:id', () => {
  renderReferralEdit(DRAFT_REF.id);

  fireEvent.click(screen.getByText('Continue →')); // → Eligibility
  fireEvent.click(screen.getByText('Continue →')); // → Rewards
  fireEvent.click(screen.getByText('Continue →')); // → Limits
  fireEvent.click(screen.getByText('Continue →')); // → Review

  const saveBtn = screen.getByRole('button', { name: /save changes/i });
  fireEvent.click(saveBtn);

  const updated = useProgramStore.getState().programs.find(p => p.id === DRAFT_REF.id);
  expect(updated?.status).toBe('active');
  // Priority must be preserved on edit (not incremented again)
  expect(updated?.priority).toBe(DRAFT_REF.priority);

  expect(screen.getByTestId('referral-detail-page')).toBeInTheDocument();
});
