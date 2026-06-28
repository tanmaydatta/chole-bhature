import { VARIABLES } from './variables'; import { EVENTS } from './events'; import { PROGRAMS } from './programs';
test('variables cover all three origins incl. system read-only', () => {
  expect(VARIABLES.some(v => v.origin === 'system' && v.readOnly)).toBe(true);
  expect(new Set(VARIABLES.map(v => v.origin))).toEqual(new Set(['user','dynamic','system']));
});
test('seed has all four program types', () => {
  expect(new Set(PROGRAMS.map(p => p.type))).toEqual(new Set(['promo','affiliate','referral','loyalty']));
});
test('order_completed event exposes payload fields', () => {
  expect(EVENTS.find(e => e.name === 'order_completed')!.fields.length).toBeGreaterThan(0);
});
