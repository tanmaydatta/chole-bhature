import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Events from './Events';

function renderEvents() {
  return render(
    <MemoryRouter>
      <Events />
    </MemoryRouter>
  );
}

test('defaults to order_completed and shows its payload field order_value', () => {
  renderEvents();
  // The payload schema table should show a field from order_completed
  expect(screen.getByText('order_value')).toBeInTheDocument();
  // The POST heading should reference order_completed
  expect(screen.getByText(/POST \/v1\/events\/order_completed/i)).toBeInTheDocument();
});

test('clicking subscription_renewed swaps detail to its fields and updates POST heading', () => {
  renderEvents();
  // Click on subscription_renewed in the event list
  fireEvent.click(screen.getByText('subscription_renewed'));
  // Fields of subscription_renewed should appear
  expect(screen.getByText('plan')).toBeInTheDocument();
  expect(screen.getByText('term_months')).toBeInTheDocument();
  expect(screen.getByText('mrr')).toBeInTheDocument();
  // POST heading updates
  expect(screen.getByText(/POST \/v1\/events\/subscription_renewed/i)).toBeInTheDocument();
  // order_completed fields should no longer be visible
  expect(screen.queryByText('order_value')).not.toBeInTheDocument();
});

test('the "+ New event" action button is present', () => {
  renderEvents();
  expect(screen.getByRole('button', { name: /New event/i })).toBeInTheDocument();
});
