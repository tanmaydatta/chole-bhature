import { describe, expect, test } from 'vitest';
import { RuntimeCapabilitiesResponseSchema } from './runtime-api.js';

describe('canonical runtime capability safety', () => {
  test.each(['local', 'staging'])('accepts explicit %s permission only', environment => {
    expect(RuntimeCapabilitiesResponseSchema.safeParse({ environment, simulatorAllowed: true }).success).toBe(true);
    expect(RuntimeCapabilitiesResponseSchema.safeParse({ environment, simulatorAllowed: false }).success).toBe(false);
  });
  test.each(['production', 'ci', 'unknown'])('cannot assert permission in %s', environment => {
    expect(RuntimeCapabilitiesResponseSchema.safeParse({ environment, simulatorAllowed: false }).success).toBe(true);
    expect(RuntimeCapabilitiesResponseSchema.safeParse({ environment, simulatorAllowed: true }).success).toBe(false);
  });
  test.each([{}, { environment: 'staging-copy', simulatorAllowed: true },
    { environment: 'local', simulatorAllowed: true, bypass: true },
    { environment: 'staging', simulatorAllowed: 'true' }])('rejects missing/unknown/extra/malformed authority', value => {
    expect(RuntimeCapabilitiesResponseSchema.safeParse(value).success).toBe(false);
  });
});
