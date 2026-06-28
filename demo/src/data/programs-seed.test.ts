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

test('each draft carries its type-specific config', () => {
  const draft = (t: string) => PROGRAMS.find(p => p.type === t && p.status === 'draft')!;

  const promo = draft('promo');
  expect(promo.discount).toBeTruthy();
  expect(promo.budget).toBeTruthy();

  const affiliate = draft('affiliate');
  expect(affiliate.codeCount).toBeTruthy();

  const referral = draft('referral');
  expect(referral.referrerReward && referral.refereeReward && referral.priority).toBeTruthy();

  const loyalty = draft('loyalty');
  expect(loyalty.triggerEvent).toBeTruthy();
});

test('all programs of a type share the same config-key set (parity with create flows)', () => {
  // Config keys = everything beyond the base Program fields.
  const BASE = new Set(['id', 'name', 'type', 'status', 'rewardSummary', 'redemptions', 'subtitle']);
  const configKeys = (p: (typeof PROGRAMS)[number]) =>
    Object.keys(p).filter(k => !BASE.has(k)).sort().join(',');

  for (const t of ['promo', 'affiliate', 'referral', 'loyalty'] as const) {
    const ofType = PROGRAMS.filter(p => p.type === t);
    const keySets = new Set(ofType.map(configKeys));
    expect(keySets.size).toBe(1);
  }
});
