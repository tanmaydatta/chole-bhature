import { render, screen } from '@testing-library/react';
import { ConditionView } from './ConditionView';

test('renders each condition read-only with operator label', () => {
  const variables = [{ name: 'basket_value', type: 'number', origin: 'dynamic' }] as const;
  render(<ConditionView group={{ match: 'ALL', conditions: [{ id: '1', variable: 'basket_value', operator: 'gte', value: '50' }] }} variables={variables as never} />);
  expect(screen.getByText(/basket_value/)).toBeInTheDocument();
  expect(screen.getByText('≥')).toBeInTheDocument();
  expect(screen.getByText('50')).toBeInTheDocument();
});
test('empty group shows applies-to-everyone', () => {
  render(<ConditionView group={{ match: 'ALL', conditions: [] }} variables={[]} />);
  expect(screen.getByText(/applies to everyone/i)).toBeInTheDocument();
});
