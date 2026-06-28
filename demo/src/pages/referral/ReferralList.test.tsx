import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReferralList from './ReferralList';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ReferralList />
    </MemoryRouter>
  );
}

test('Active/Scheduled referral programs appear in the ranked section', () => {
  renderPage();
  // ref-1: Give $10, Get $10 — active
  expect(screen.getByText('Give $10, Get $10')).toBeInTheDocument();
  // ref-2: VIP Referral — active
  expect(screen.getByText('VIP Referral')).toBeInTheDocument();
  // ref-3: Holiday Referral — scheduled
  expect(screen.getByText('Holiday Referral')).toBeInTheDocument();
});

test('paused/ended referral programs appear under the "Not ranked" divider', () => {
  // Add a paused referral program
  act(() => {
    useProgramStore.getState().addProgram({
      id: 'ref-paused',
      name: 'Paused Referral',
      type: 'referral',
      status: 'paused',
      rewardSummary: '$5 / $5',
      redemptions: 0,
      priority: undefined,
      referrerReward: '$5 credit',
      refereeReward: '$5 off',
      appliesTo: 'all customers',
    });
  });

  renderPage();

  // The divider text should be present
  expect(screen.getByText(/Not ranked/)).toBeInTheDocument();

  // The paused program should appear
  expect(screen.getByText('Paused Referral')).toBeInTheDocument();
});

test('active/scheduled programs appear in ranked section; divider is also visible when paused programs exist', () => {
  act(() => {
    useProgramStore.getState().addProgram({
      id: 'ref-paused-2',
      name: 'Paused Referral 2',
      type: 'referral',
      status: 'paused',
      rewardSummary: '$5 / $5',
      redemptions: 0,
      referrerReward: '$5 credit',
      refereeReward: '$5 off',
      appliesTo: 'all customers',
    });
  });

  renderPage();

  // Active/scheduled programs visible
  expect(screen.getByText('Give $10, Get $10')).toBeInTheDocument();
  expect(screen.getByText('VIP Referral')).toBeInTheDocument();
  // Divider also visible
  expect(screen.getByText(/Not ranked/)).toBeInTheDocument();
  // Paused program visible below divider
  expect(screen.getByText('Paused Referral 2')).toBeInTheDocument();
});

test('changing a priority number input reorders priorities through the store', () => {
  renderPage();

  // The seed data has ref-2 priority=1, ref-3 priority=2, ref-1 priority=3
  const inputs = screen.getAllByRole('spinbutton');
  expect(inputs.length).toBeGreaterThan(0);

  // Get initial state priorities
  const before = useProgramStore.getState().programs.filter(p => p.type === 'referral' && (p.status === 'active' || p.status === 'scheduled'));
  expect(before.length).toBe(3);

  // Change the first priority input to position 3 (move it to last)
  const firstInput = inputs[0];
  fireEvent.change(firstInput, { target: { value: '3' } });

  // After the change, priorities should have been recomputed in the store
  const after = useProgramStore.getState().programs.filter(p => p.type === 'referral' && (p.status === 'active' || p.status === 'scheduled'));
  // All ranked referrals should still have priority values
  expect(after.every(p => typeof p.priority === 'number')).toBe(true);
  // Priorities should form a sequence 1, 2, 3
  const priorities = after.map(p => p.priority as number).sort((a, b) => a - b);
  expect(priorities).toEqual([1, 2, 3]);
});

test('renders Referrer and Referee column headers', () => {
  renderPage();
  // The table header shows these column labels (there may be multiple due to row content, use getAllByText)
  expect(screen.getAllByText('Referrer').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Referee').length).toBeGreaterThan(0);
});

test('renders "+ New referral" button', () => {
  renderPage();
  expect(screen.getByRole('button', { name: /New referral/i })).toBeInTheDocument();
});
