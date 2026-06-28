import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import _ProgramListPage from './_ProgramListPage';
import { useProgramStore } from '../data/store';
import { PROGRAMS } from '../data/programs';

beforeEach(() => {
  // Reset store to seed so tests stay independent.
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <_ProgramListPage type="promo" title="Promo Codes" newLabel="New promo" />
    </MemoryRouter>
  );
}

test('default view shows only Active programs (SUMMER15 present)', () => {
  renderPage();
  expect(screen.getByText('SUMMER15')).toBeInTheDocument();
});

test('default view hides paused programs (WELCOME10 absent)', () => {
  renderPage();
  expect(screen.queryByText('WELCOME10')).not.toBeInTheDocument();
});

test('clicking "All" filter then shows WELCOME10 too', () => {
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: /^All/ }));
  expect(screen.getByText('SUMMER15')).toBeInTheDocument();
  expect(screen.getByText('WELCOME10')).toBeInTheDocument();
});

test('filter counts reflect seed: promo Active=1, Paused=1, All=2', () => {
  renderPage();
  // Active filter button should show count 1
  const activeBtn = screen.getByRole('button', { name: /^Active/ });
  expect(activeBtn).toHaveTextContent('1');

  // Paused filter button should show count 1
  const pausedBtn = screen.getByRole('button', { name: /^Paused/ });
  expect(pausedBtn).toHaveTextContent('1');

  // All filter button should show count 2
  const allBtn = screen.getByRole('button', { name: /^All/ });
  expect(allBtn).toHaveTextContent('2');
});

test('renders page title and new button', () => {
  renderPage();
  expect(screen.getByText('Promo Codes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /New promo/i })).toBeInTheDocument();
});

test('Active filter carries the selected styling by default', () => {
  renderPage();
  const activeBtn = screen.getByRole('button', { name: /^Active/ });
  const pausedBtn = screen.getByRole('button', { name: /^Paused/ });
  // The selected button uses the panel background; unselected ones are transparent.
  expect(activeBtn.className).toContain('bg-[var(--panel)]');
  expect(pausedBtn.className).not.toContain('bg-[var(--panel)]');
});

test('empty state is shown when the filter yields zero programs', () => {
  // Use a type with no programs — 'loyalty' has no Scheduled entries in seed
  // Switch to Scheduled filter which has 0 promo programs
  renderPage();
  fireEvent.click(screen.getByRole('button', { name: /^Scheduled/ }));
  expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  expect(screen.getByText(/No scheduled programs yet/i)).toBeInTheDocument();
});

test('list reacts to addProgram: a new active promo appears without remount', () => {
  renderPage();
  expect(screen.queryByText('FLASH20')).not.toBeInTheDocument();

  act(() => {
    useProgramStore.getState().addProgram({
      id: 'promo-new',
      name: 'FLASH20',
      type: 'promo',
      status: 'active',
      rewardSummary: '20% off',
      redemptions: 0,
      subtitle: 'Flash sale',
    });
  });

  // Same render — store update must re-render the list (reactivity).
  expect(screen.getByText('FLASH20')).toBeInTheDocument();
  // Active count should now reflect the addition (was 1, now 2).
  expect(screen.getByRole('button', { name: /^Active/ })).toHaveTextContent('2');
});
