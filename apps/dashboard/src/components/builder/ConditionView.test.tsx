import { render, screen } from '@testing-library/react';
import { ConditionView } from './ConditionView';

test('renders each condition read-only with operator label', () => {
  const variables = [{ name: 'basket_value', type: 'number', origin: 'dynamic' }] as const;
  render(
    <ConditionView
      group={{
        match: 'ALL',
        conditions: [{ id: '1', variable: 'basket_value', operator: 'gte', value: '50' }],
      }}
      variables={variables as never}
    />
  );
  expect(screen.getByText(/basket_value/)).toBeInTheDocument();
  expect(screen.getByText('≥')).toBeInTheDocument();
  expect(screen.getByText('50')).toBeInTheDocument();
});

test('empty group shows applies-to-everyone', () => {
  render(<ConditionView group={{ match: 'ALL', conditions: [] }} variables={[]} />);
  expect(screen.getByText(/applies to everyone/i)).toBeInTheDocument();
});

test('renders nested condition groups recursively', () => {
  const variables = [
    { name: 'customer.tier', type: 'enum', origin: 'user' },
    { name: 'cart.subtotal', type: 'number', origin: 'dynamic' },
  ] as const;

  render(
    <ConditionView
      group={{
        match: 'ANY',
        conditions: [{ id: '1', variable: 'customer.tier', operator: 'eq', value: 'gold' }],
        groups: [
          {
            match: 'ALL',
            conditions: [{ id: '2', variable: 'cart.subtotal', operator: 'gte', value: 700 }],
          },
        ],
      }}
      variables={variables as never}
    />
  );

  expect(screen.getByText(/customer\.tier/)).toBeInTheDocument();
  expect(screen.getByText('gold')).toBeInTheDocument();
  expect(screen.getByText(/cart\.subtotal/)).toBeInTheDocument();
  expect(screen.getByText('700')).toBeInTheDocument();
});

test('renders default and custom failure messages', () => {
  const variables = [
    {
      name: 'customer.tier',
      type: 'enum',
      origin: 'user',
      defaultMessage: "This code isn't valid for your order.",
    },
    {
      name: 'cart.subtotal',
      type: 'number',
      origin: 'dynamic',
    },
  ] as const;

  render(
    <ConditionView
      group={{
        match: 'ALL',
        conditions: [
          { id: '1', variable: 'customer.tier', operator: 'eq', value: 'gold' },
          { id: '2', variable: 'cart.subtotal', operator: 'gte', value: 700, message: 'Minimum cart total is $700' },
        ],
      }}
      variables={variables as never}
    />
  );

  expect(screen.getByText(/using default: "This code isn't valid for your order\."/)).toBeInTheDocument();
  expect(screen.getByText(/"Minimum cart total is \$700"/)).toBeInTheDocument();
});
