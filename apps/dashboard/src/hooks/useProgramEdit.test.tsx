import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useProgramEdit } from './useProgramEdit';
import { useProgramStore } from '../data/store';
import { PROGRAMS } from '../data/programs';

// Probe component that renders the hook result
function Probe({ expectedType }: { expectedType: 'promo' | 'affiliate' | 'referral' | 'loyalty' }) {
  const { editMode, editing } = useProgramEdit(expectedType);
  return (
    <div>
      <span data-testid="editMode">{String(editMode)}</span>
      <span data-testid="editing">{editing ? editing.id : 'null'}</span>
    </div>
  );
}

function renderAtPath(path: string, routePattern: string, expectedType: 'promo' | 'affiliate' | 'referral' | 'loyalty' = 'promo') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern} element={<Probe expectedType={expectedType} />} />
        <Route path="/promo" element={<div data-testid="promo-list">Promo List</div>} />
        <Route path="/promo/:id" element={<div data-testid="promo-detail">Promo Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

// IDs for test cases
const DRAFT_PROMO_ID = 'promo-draft-1';
const ACTIVE_PROMO_ID = 'promo-1';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

test('draft id returns editMode=true and editing=the program', () => {
  renderAtPath(`/promo/${DRAFT_PROMO_ID}/edit`, '/promo/:id/edit');
  expect(screen.getByTestId('editMode').textContent).toBe('true');
  expect(screen.getByTestId('editing').textContent).toBe(DRAFT_PROMO_ID);
});

test('no id returns editMode=false and editing=null', () => {
  renderAtPath('/promo/new', '/promo/new');
  expect(screen.getByTestId('editMode').textContent).toBe('false');
  expect(screen.getByTestId('editing').textContent).toBe('null');
});

test('non-draft (active) id triggers redirect to detail page, editing=null', () => {
  renderAtPath(`/promo/${ACTIVE_PROMO_ID}/edit`, '/promo/:id/edit');
  // After redirect, promo-detail should be in the DOM
  expect(screen.getByTestId('promo-detail')).toBeInTheDocument();
});

test('unknown id triggers redirect to type list page, editing=null', () => {
  renderAtPath('/promo/non-existent/edit', '/promo/:id/edit');
  // After redirect, promo-list should be in the DOM
  expect(screen.getByTestId('promo-list')).toBeInTheDocument();
});
