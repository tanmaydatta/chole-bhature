import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Events from './Events';
import { useEventsStore } from '../../data/eventsStore';
import { EVENTS } from '../../data/events';

beforeEach(() => {
  useEventsStore.setState({ events: EVENTS.map(e => ({ ...e })) });
});

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

test('clicking Edit shows editable name and description inputs', () => {
  renderEvents();
  // Initially in read mode — name shown as heading
  expect(screen.getByRole('heading', { name: 'order_completed' })).toBeInTheDocument();
  // Click Edit
  fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
  // Name and description inputs should now be visible
  expect(screen.getByLabelText(/event name/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
  // Save button should appear
  expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
});

test('editing name + Save calls updateEvent and new name appears in detail', () => {
  const updateEvent = vi.spyOn(useEventsStore.getState(), 'updateEvent');
  renderEvents();

  fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));

  const nameInput = screen.getByLabelText(/event name/i);
  fireEvent.change(nameInput, { target: { value: 'order_confirmed' } });

  fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

  // updateEvent was called with original name and patch
  expect(updateEvent).toHaveBeenCalledWith(
    'order_completed',
    expect.objectContaining({ name: 'order_confirmed' })
  );

  // After save, new name appears (the store updates, component re-renders)
  expect(screen.getByRole('heading', { name: 'order_confirmed' })).toBeInTheDocument();
});

test('"＋ New event" calls addEvent and selects the new event in edit mode', () => {
  const addEvent = vi.spyOn(useEventsStore.getState(), 'addEvent');
  renderEvents();

  fireEvent.click(screen.getByRole('button', { name: /New event/i }));

  // addEvent was called
  expect(addEvent).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'new_event' })
  );

  // The new event is selected: name input should show 'new_event' (in edit mode)
  const nameInput = screen.getByLabelText(/event name/i);
  expect((nameInput as HTMLInputElement).value).toBe('new_event');

  // Save button is visible (edit mode)
  expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
});
