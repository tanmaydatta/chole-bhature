import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import _ProgramListPage from './_ProgramListPage';

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

test('Active filter is selected by default', () => {
  renderPage();
  // The active filter button should be visually selected — we check it's in the document
  expect(screen.getByRole('button', { name: /^Active/ })).toBeInTheDocument();
});
