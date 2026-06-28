import { useProgramStore } from './store';
import { PROGRAMS } from './programs';
import type { Program } from '../lib/types';

beforeEach(() => {
  useProgramStore.setState({ programs: PROGRAMS.map(p => ({ ...p })) });
});

test('addProgram: byType returns new promo program', () => {
  const newPromo: Program = {
    id: 'promo-test-99',
    name: 'TEST99',
    type: 'promo',
    status: 'draft',
    rewardSummary: '99% off',
    redemptions: 0,
  };
  useProgramStore.getState().addProgram(newPromo);
  const promos = useProgramStore.getState().byType('promo');
  expect(promos.find(p => p.id === 'promo-test-99')).toBeDefined();
});

test('setReferralPriority: priorities match new index+1 order', () => {
  // ref-2, ref-3, ref-1 → priorities become 1, 2, 3
  useProgramStore.getState().setReferralPriority(['ref-2', 'ref-3', 'ref-1']);
  const { programs } = useProgramStore.getState();
  expect(programs.find(p => p.id === 'ref-2')?.priority).toBe(1);
  expect(programs.find(p => p.id === 'ref-3')?.priority).toBe(2);
  expect(programs.find(p => p.id === 'ref-1')?.priority).toBe(3);
});
