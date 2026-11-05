import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryBuilder } from 'react-querybuilder';
import type { Variable } from '../../lib/types';
import { createCustomControlElements } from './rqb-controls';
import { variablesToFields } from './rqb-adapter';

const SAMPLE_VARIABLES: Variable[] = [
  {
    name: 'cart.subtotal',
    type: 'number',
    origin: 'dynamic',
    defaultMessage: 'Subtotal must meet minimum.',
  },
  {
    name: 'customer.tier',
    type: 'enum',
    origin: 'user',
    enumValues: ['gold', 'silver', 'bronze'],
  },
  {
    name: 'customer.is_vip',
    type: 'boolean',
    origin: 'user',
  },
];

describe('rqb-controls', () => {
  it('combinator selector switches between ALL and ANY', () => {
    const onQueryChange = vi.fn();
    const controlElements = createCustomControlElements(SAMPLE_VARIABLES);
    const fields = variablesToFields(SAMPLE_VARIABLES);

    render(
      <QueryBuilder
        fields={fields}
        query={{ combinator: 'and', rules: [] }}
        onQueryChange={onQueryChange}
        controlElements={controlElements}
        showNotToggle={false}
      />
    );

    const select = screen.getByLabelText(/Condition group match/i);
    expect(select).toHaveValue('and');

    fireEvent.change(select, { target: { value: 'or' } });
    expect(onQueryChange).toHaveBeenCalledWith(
      expect.objectContaining({ combinator: 'or' })
    );
  });

  it('field selector displays origin icon and variable name', () => {
    const controlElements = createCustomControlElements(SAMPLE_VARIABLES);
    const fields = variablesToFields(SAMPLE_VARIABLES);

    render(
      <QueryBuilder
        fields={fields}
        query={{
          combinator: 'and',
          rules: [{ id: 'r-1', field: 'cart.subtotal', operator: 'gte', value: 10 }],
        }}
        onQueryChange={vi.fn()}
        controlElements={controlElements}
      />
    );

    // Dynamic variable icon is ◇
    const fieldBtn = screen.getByRole('button', { name: /field selector/i });
    expect(fieldBtn).toHaveTextContent('◇');
    expect(fieldBtn).toHaveTextContent('cart.subtotal');
  });

  it('value editor renders two inputs for between and multi-select for in', async () => {
    const onQueryChange = vi.fn();
    const controlElements = createCustomControlElements(SAMPLE_VARIABLES);
    const fields = variablesToFields(SAMPLE_VARIABLES);

    const { rerender } = render(
      <QueryBuilder
        fields={fields}
        query={{
          combinator: 'and',
          rules: [{ id: 'r-between', field: 'cart.subtotal', operator: 'between', value: [10, 50] }],
        }}
        onQueryChange={onQueryChange}
        controlElements={controlElements}
      />
    );

    expect(screen.getByLabelText('minimum value')).toHaveValue(10);
    expect(screen.getByLabelText('maximum value')).toHaveValue(50);

    rerender(
      <QueryBuilder
        fields={fields}
        query={{
          combinator: 'and',
          rules: [{ id: 'r-in', field: 'customer.tier', operator: 'in', value: ['gold'] }],
        }}
        onQueryChange={onQueryChange}
        controlElements={controlElements}
      />
    );

    expect(screen.getByLabelText('values')).toBeInTheDocument();
  });

  it('rule component renders unresolved variable warning when variable is unknown', () => {
    const controlElements = createCustomControlElements(SAMPLE_VARIABLES);
    const fields = variablesToFields(SAMPLE_VARIABLES);

    render(
      <QueryBuilder
        fields={fields}
        query={{
          combinator: 'and',
          rules: [{ id: 'r-missing', field: 'unknown.var', operator: 'eq', value: 'foo' }],
        }}
        onQueryChange={vi.fn()}
        controlElements={controlElements}
      />
    );

    expect(
      screen.getByText(/Missing variable definition for unknown\.var/i)
    ).toBeInTheDocument();
  });

  it('message toggle reveals MessageEditor and live preview', async () => {
    const user = userEvent.setup();
    const controlElements = createCustomControlElements(SAMPLE_VARIABLES);
    const fields = variablesToFields(SAMPLE_VARIABLES);

    render(
      <QueryBuilder
        fields={fields}
        query={{
          combinator: 'and',
          rules: [{ id: 'r-1', field: 'cart.subtotal', operator: 'gte', value: 50 }],
        }}
        onQueryChange={vi.fn()}
        controlElements={controlElements}
      />
    );

    // Initial state: shows "Add custom message" link or button
    const toggleBtn = screen.getByText(/Add custom message/i);
    await user.click(toggleBtn);

    // After clicking, the MessageEditor textbox should be visible
    expect(screen.getByRole('textbox', { name: /message/i })).toBeInTheDocument();
  });
});
