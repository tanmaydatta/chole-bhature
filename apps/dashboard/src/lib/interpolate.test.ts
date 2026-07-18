import { renderMessage } from './interpolate';
test('interpolates subtraction with money filter', () => {
  expect(renderMessage('Add {{ 50 − basket_value | money }} more', { basket_value: 38 }))
    .toBe('Add $12 more');
});
test('plain variable substitution', () => {
  expect(renderMessage('Hi {{ customer_tier }}', { customer_tier: 'gold' })).toBe('Hi gold');
});
test('leaves text without tokens untouched', () => {
  expect(renderMessage('No tokens here', {})).toBe('No tokens here');
});
test('handles ASCII hyphen subtraction too', () => {
  expect(renderMessage('Add {{ 50 - basket_value | money }} more', { basket_value: 38 })).toBe('Add $12 more');
});
test('subtraction with an unknown operand renders empty', () => {
  expect(renderMessage('{{ unknown_var - 5 | money }}', {})).toBe('');
});
