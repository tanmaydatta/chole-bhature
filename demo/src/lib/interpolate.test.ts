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
