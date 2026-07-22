import { afterEach, beforeEach, expect, test } from 'vitest';

import { isoToLocalDateTime, localDateTimeToIso } from './credential-datetime';

const environment = (globalThis as unknown as {
  process: { env: Record<string, string | undefined> };
}).process.env;
const originalTimeZone = environment.TZ;

beforeEach(() => {
  environment.TZ = 'America/New_York';
});

afterEach(() => {
  environment.TZ = originalTimeZone;
});

test('renders an ISO instant as wall-clock time for datetime-local inputs', () => {
  expect(isoToLocalDateTime('2026-12-31T23:59:00.000Z')).toBe('2026-12-31T18:59');
});

test('converts datetime-local wall-clock input back to the corresponding ISO instant', () => {
  expect(localDateTimeToIso('2026-12-31T18:59')).toBe('2026-12-31T23:59:00.000Z');
});

test('preserves an absent optional expiry', () => {
  expect(isoToLocalDateTime(undefined)).toBe('');
  expect(localDateTimeToIso('')).toBeUndefined();
});
