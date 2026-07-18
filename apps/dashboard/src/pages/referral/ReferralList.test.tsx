import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import ReferralList from './ReferralList';
import { useProgramStore } from '../../data/store';
import { PROGRAMS } from '../../data/programs';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

function LocationProbe({ onLocation }: { onLocation: (path: string) => void }) {
  const loc = useLocation();
  onLocation(loc.pathname);
  return null;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ReferralList />
    </MemoryRouter>
  );
}

function renderPageWithLocationCapture() {
  let currentPath = '/';
  const setPath = (p: string) => { currentPath = p; };
  render(
    <MemoryRouter initialEntries={['/referrals']}>
      <Routes>
        <Route path="/referrals" element={<ReferralList />} />
        <Route path="*" element={<LocationProbe onLocation={setPath} />} />
      </Routes>
    </MemoryRouter>
  );
  return { getPath: () => currentPath };
}

test('default (All) view shows Active/Scheduled referral programs in the ranked section', () => {
  renderPage();
  // ref-1: Give $10, Get $10 — active
  expect(screen.getByText('Give $10, Get $10')).toBeInTheDocument();
  // ref-2: VIP Referral — active
  expect(screen.getByText('VIP Referral')).toBeInTheDocument();
  // ref-3: Holiday Referral — scheduled
  expect(screen.getByText('Holiday Referral')).toBeInTheDocument();
});

test('paused/ended referral programs appear under the "Not ranked" divider (All view)', () => {
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

  // The divider text should be present (default is All)
  expect(screen.getByText(/Not ranked/)).toBeInTheDocument();

  // The paused program should appear
  expect(screen.getByText('Paused Referral')).toBeInTheDocument();
});

test('default (All) view shows both ranked and not-ranked sections', () => {
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

test('status filter narrows the view: clicking Active hides scheduled and paused programs', () => {
  act(() => {
    useProgramStore.getState().addProgram({
      id: 'ref-paused-3',
      name: 'Paused Referral 3',
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

  // Default All view: scheduled + paused both visible
  expect(screen.getByText('Holiday Referral')).toBeInTheDocument();
  expect(screen.getByText('Paused Referral 3')).toBeInTheDocument();

  // Click "Active" — only active programs should remain
  fireEvent.click(screen.getByRole('button', { name: /^Active/ }));

  // Active programs still visible
  expect(screen.getByText('Give $10, Get $10')).toBeInTheDocument();
  expect(screen.getByText('VIP Referral')).toBeInTheDocument();
  // Scheduled program now hidden
  expect(screen.queryByText('Holiday Referral')).not.toBeInTheDocument();
  // Paused program now hidden (and divider gone since no not-ranked rows)
  expect(screen.queryByText('Paused Referral 3')).not.toBeInTheDocument();
  expect(screen.queryByText(/Not ranked/)).not.toBeInTheDocument();
});

test('status filter Paused shows only paused programs under the divider', () => {
  act(() => {
    useProgramStore.getState().addProgram({
      id: 'ref-paused-4',
      name: 'Paused Referral 4',
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
  fireEvent.click(screen.getByRole('button', { name: /^Paused/ }));

  // Paused program visible under the divider
  expect(screen.getByText('Paused Referral 4')).toBeInTheDocument();
  expect(screen.getByText(/Not ranked/)).toBeInTheDocument();
  // Active/scheduled programs hidden
  expect(screen.queryByText('Give $10, Get $10')).not.toBeInTheDocument();
  expect(screen.queryByText('VIP Referral')).not.toBeInTheDocument();
  expect(screen.queryByText('Holiday Referral')).not.toBeInTheDocument();
});

test('a draft referral appears in the not-ranked section (Drafts filter)', () => {
  act(() => {
    useProgramStore.getState().addProgram({
      id: 'ref-draft',
      name: 'Draft Referral',
      type: 'referral',
      status: 'draft',
      rewardSummary: '$5 / $5',
      redemptions: 0,
      referrerReward: '$5 credit',
      refereeReward: '$5 off',
      appliesTo: 'all customers',
    });
  });

  renderPage();

  // Default All view: draft visible under not-ranked divider
  expect(screen.getByText('Draft Referral')).toBeInTheDocument();
  expect(screen.getByText(/Not ranked/)).toBeInTheDocument();

  // Drafts filter: only the draft shows
  fireEvent.click(screen.getByRole('button', { name: /^Drafts/ }));
  expect(screen.getByText('Draft Referral')).toBeInTheDocument();
  expect(screen.queryByText('Give $10, Get $10')).not.toBeInTheDocument();
});

test('changing a priority number input reorders priorities through the store (by id)', () => {
  renderPage();

  // Seed ranked order (priority asc): ref-2(1) VIP, ref-3(2) Holiday, ref-1(3) Give $10
  const inputs = screen.getAllByRole('spinbutton');
  expect(inputs.length).toBe(3);

  // Verify seed priorities by id
  const getById = (id: string) =>
    useProgramStore.getState().programs.find(p => p.id === id);
  expect(getById('ref-2')?.priority).toBe(1);
  expect(getById('ref-3')?.priority).toBe(2);
  expect(getById('ref-1')?.priority).toBe(3);

  // The first input corresponds to the priority-1 program (ref-2).
  // Change it to '3' — ref-2 should move to position 3, others shift up.
  fireEvent.change(inputs[0], { target: { value: '3' } });

  // Assert the specific reordering by id:
  // ref-2 moved to priority 3; ref-3 -> 1; ref-1 -> 2
  expect(getById('ref-2')?.priority).toBe(3);
  expect(getById('ref-3')?.priority).toBe(1);
  expect(getById('ref-1')?.priority).toBe(2);
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

test('clicking a referral row navigates to its detail page', () => {
  const { getPath } = renderPageWithLocationCapture();
  // 'Give $10, Get $10' (ref-1) is visible in All view (ranked section)
  const row = screen.getByText('Give $10, Get $10').closest('[draggable]')!;
  fireEvent.click(row);
  expect(getPath()).toMatch(/^\/referrals\/.+/);
});

test('changing the priority input does NOT trigger row navigation', () => {
  const { getPath } = renderPageWithLocationCapture();
  const inputs = screen.getAllByRole('spinbutton');
  // The first input belongs to the priority-1 program (ref-2). Change THAT
  // program's input and assert THAT program's resulting priority, so the
  // assertion does not depend on reorder side-effects of sibling rows.
  fireEvent.change(inputs[0], { target: { value: '3' } });
  // Must not navigate to a referral detail page.
  expect(getPath()).not.toMatch(/^\/referrals\/.+/);
  // The program whose input we changed must reflect the new priority.
  const ref2 = useProgramStore.getState().programs.find(p => p.id === 'ref-2');
  expect(ref2?.priority).toBe(3);
});

test('clicking the kebab affordance does NOT navigate to the detail page', () => {
  const { getPath } = renderPageWithLocationCapture();
  // The kebab "⋮" affordance lives in each ranked/not-ranked row.
  const kebabs = screen.getAllByText('⋮');
  expect(kebabs.length).toBeGreaterThan(0);
  fireEvent.click(kebabs[0]);
  // Clicking the affordance must NOT navigate to a referral detail page.
  expect(getPath()).not.toMatch(/^\/referrals\/.+/);
});
