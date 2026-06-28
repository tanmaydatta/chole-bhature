import { useVariablesStore } from './variablesStore';
import { VARIABLES } from './variables';

beforeEach(() => useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })) }));

test('seeds from VARIABLES and supports add/update', () => {
  const s = useVariablesStore.getState();
  expect(s.variables.length).toBeGreaterThan(0);
  s.addVariable({ name: 'promo_seen', type: 'boolean', origin: 'user' });
  expect(useVariablesStore.getState().variables.some(v => v.name === 'promo_seen')).toBe(true);
  s.updateVariable('promo_seen', { type: 'string' });
  expect(useVariablesStore.getState().variables.find(v => v.name === 'promo_seen')!.type).toBe('string');
});
