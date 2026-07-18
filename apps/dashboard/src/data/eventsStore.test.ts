import { useEventsStore } from './eventsStore';
import { EVENTS } from './events';

beforeEach(() => {
  useEventsStore.setState({ events: EVENTS.map(e => ({ ...e })) });
});

test('seeds from EVENTS on init', () => {
  const { events } = useEventsStore.getState();
  expect(events).toHaveLength(EVENTS.length);
  expect(events[0].name).toBe('order_completed');
});

test('addEvent appends a new event', () => {
  const newEvent = {
    name: 'test_event',
    description: 'A test event',
    live: false,
    usedIn: 0,
    fields: [],
    sample: {},
  };
  useEventsStore.getState().addEvent(newEvent);
  const { events } = useEventsStore.getState();
  expect(events).toHaveLength(EVENTS.length + 1);
  expect(events[events.length - 1].name).toBe('test_event');
});

test('updateEvent patches an existing event by name', () => {
  useEventsStore.getState().updateEvent('order_completed', { description: 'Updated description' });
  const { events } = useEventsStore.getState();
  const updated = events.find(e => e.name === 'order_completed');
  expect(updated?.description).toBe('Updated description');
  // other fields unchanged
  expect(updated?.live).toBe(true);
});

test('updateEvent does not mutate other events', () => {
  useEventsStore.getState().updateEvent('order_completed', { usedIn: 99 });
  const { events } = useEventsStore.getState();
  const other = events.find(e => e.name === 'review_submitted');
  expect(other?.usedIn).toBe(1);
});

test('seeded events are defensive copies (not the same references as EVENTS)', () => {
  const { events } = useEventsStore.getState();
  expect(events[0]).not.toBe(EVENTS[0]);
});
