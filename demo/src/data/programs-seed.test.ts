import { PROGRAMS } from './programs';
test('one draft per program type exists', () => {
  for (const t of ['promo','affiliate','referral','loyalty'] as const) {
    expect(PROGRAMS.filter(p => p.type === t && p.status === 'draft')).toHaveLength(1);
  }
});
test('every program has a unique id', () => {
  const ids = PROGRAMS.map(p => p.id);
  expect(new Set(ids).size).toBe(ids.length);
});
test('an active promo carries eligibility config', () => {
  const p = PROGRAMS.find(x => x.type === 'promo' && x.status === 'active')!;
  expect(p.eligibility).toBeTruthy();
});
