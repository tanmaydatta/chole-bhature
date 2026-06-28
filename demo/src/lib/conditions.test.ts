import { resolveMessage, operatorLabel } from './conditions';
const v = { name:'budget_remaining', type:'number', origin:'system', defaultMessage:'Offer ended' } as const;
test('falls back to variable default then program then system', () => {
  expect(resolveMessage({ id:'1', variable:'budget_remaining', operator:'gt', value:'0' }, v))
    .toBe('Offer ended');
  expect(resolveMessage({ id:'1', variable:'x', operator:'gt', value:'0' }, { ...v, defaultMessage: undefined }, 'Prog msg'))
    .toBe('Prog msg');
  expect(resolveMessage({ id:'1', variable:'x', operator:'gt', value:'0', message:'Row msg' }, v)).toBe('Row msg');
});
test('operator label maps gte to ≥', () => { expect(operatorLabel('gte')).toBe('≥'); });
