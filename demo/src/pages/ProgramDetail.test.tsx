import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, type Mock } from 'vitest';
import ProgramDetail from './ProgramDetail';
import { useProgramStore } from '../data/store';
import { useVariablesStore } from '../data/variablesStore';
import { useEventsStore } from '../data/eventsStore';
import { PROGRAMS } from '../data/programs';
import { VARIABLES } from '../data/variables';
import { EVENTS } from '../data/events';

vi.mock('../lib/codes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/codes')>();
  return {
    ...actual,
    downloadCSV: vi.fn(),
  };
});

import { downloadCSV } from '../lib/codes';

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
  useEventsStore.setState({ events: EVENTS.map(e => ({ ...e })) });
});

test('shows Edit link for a draft promo program', () => {
  // promo-draft-1 is a draft
  renderAt('/promo/promo-draft-1', '/promo/:id');
  const editLink = screen.getByRole('link', { name: /edit/i });
  expect(editLink).toBeInTheDocument();
  expect(editLink).toHaveAttribute('href', '/promo/promo-draft-1/edit');
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

// Fix 1: Loyalty — trigger event payload fields + no-stacking note
test('loyalty detail shows trigger event payload field names', () => {
  // loy-1 uses triggerEvent 'order_completed' which has fields: order_id, order_value, currency, …
  renderAt('/loyalty/loy-1', '/loyalty/:id');
  expect(screen.getByText('order_id')).toBeInTheDocument();
  expect(screen.getByText('order_value')).toBeInTheDocument();
});

test('loyalty detail shows "No stacking (fixed rule)" note', () => {
  renderAt('/loyalty/loy-1', '/loyalty/:id');
  expect(screen.getByText(/no stacking \(fixed rule\)/i)).toBeInTheDocument();
});

// Fix 1: Affiliate — code-batch info (codeCount)
test('affiliate detail shows code count', () => {
  // aff-1 has codeCount: 500
  renderAt('/affiliates/aff-1', '/affiliates/:id');
  expect(screen.getByText('500')).toBeInTheDocument();
});

test('affiliate detail shows uses-per-code if present', () => {
  // Seed an affiliate program with usesPerCode to verify the row renders
  useProgramStore.setState({
    programs: [
      ...PROGRAMS.map(p => ({ ...p })),
      {
        id: 'aff-test-upc',
        name: 'UPC Test Affiliate',
        type: 'affiliate' as const,
        status: 'draft' as const,
        rewardSummary: '10% off',
        redemptions: 0,
        codeCount: 100,
        usesPerCode: 3,
      },
    ],
  });
  renderAt('/affiliates/aff-test-upc', '/affiliates/:id');
  expect(screen.getByText(/uses per code/i)).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
});

// Task 3: Codes panel tests
test('affiliate detail shows a Codes panel with a status summary and preview rows', () => {
  useProgramStore.setState({
    programs: [
      ...PROGRAMS.map(p => ({ ...p })),
      {
        id: 'aff-codes-60',
        name: 'Multi Use Partner',
        type: 'affiliate' as const,
        status: 'active' as const,
        rewardSummary: '15% off',
        redemptions: 0,
        codeCount: 60,
        usesPerCode: 5,
      },
    ],
  });
  renderAt('/affiliates/aff-codes-60', '/affiliates/:id');
  expect(screen.getByText('Codes')).toBeInTheDocument();
  // status summary paragraph contains "unused"
  expect(screen.getByText(/unused · \d+ redeemed/i)).toBeInTheDocument();
  expect(screen.getByText(/\+\s*10 more/i)).toBeInTheDocument();
});

test('affiliate detail Download CSV downloads codes-only', () => {
  vi.mocked(downloadCSV).mockClear();
  useProgramStore.setState({
    programs: [
      ...PROGRAMS.map(p => ({ ...p })),
      {
        id: 'aff-codes-60',
        name: 'Multi Use Partner',
        type: 'affiliate' as const,
        status: 'active' as const,
        rewardSummary: '15% off',
        redemptions: 0,
        codeCount: 60,
        usesPerCode: 5,
      },
    ],
  });
  renderAt('/affiliates/aff-codes-60', '/affiliates/:id');
  fireEvent.click(screen.getByRole('button', { name: /download csv/i }));
  const csv = (downloadCSV as Mock).mock.calls[0][1] as string;
  expect(csv.split('\n')[0]).toBe('code');
  expect(csv).not.toMatch(/status|uses/i);
});

test('affiliate detail single-use codes show — in Uses column', () => {
  // aff-1 has usesPerCode: 1 (single-use)
  renderAt('/affiliates/aff-1', '/affiliates/:id');
  // Uses column header should be present
  expect(screen.getByText('Uses')).toBeInTheDocument();
  // Single-use codes should show — (em-dash)
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});
