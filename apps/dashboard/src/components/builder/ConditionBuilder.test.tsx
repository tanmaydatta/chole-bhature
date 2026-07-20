import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConditionBuilder } from './ConditionBuilder';
import type { ConditionGroup, Variable } from '../../lib/types';

const SAMPLE_VARIABLES: Variable[] = [
  {
    name: 'basket_value',
    type: 'number',
    origin: 'dynamic',
    defaultMessage: 'Your basket must meet the minimum.',
  },
  {
    name: 'customer_tier',
    type: 'enum',
    origin: 'user',
    enumValues: ['gold', 'silver', 'bronze'],
    defaultMessage: 'This offer is for gold members only.',
  },
  {
    name: 'budget_remaining',
    type: 'number',
    origin: 'system',
    defaultMessage: 'This offer has ended — check back soon!',
  },
  {
    name: 'context.channel',
    type: 'string',
    origin: 'dynamic',
  },
  {
    name: 'customer.birthday',
    type: 'date',
    origin: 'user',
  },
];

function Wrapper({
  initial = { match: 'ALL', conditions: [] },
}: {
  initial?: ConditionGroup;
}) {
  const [value, setValue] = useState<ConditionGroup>(initial);
  return (
    <ConditionBuilder
      value={value}
      variables={SAMPLE_VARIABLES}
      onChange={setValue}
    />
  );
}

// Test 1: opening the picker and clicking a variable appends a condition row
test('add condition via picker appends a condition row', () => {
  render(<Wrapper />);

  fireEvent.click(screen.getByText('＋ Add condition'));
  // picker should be visible now; click the variable (rendered inside <code> in picker)
  fireEvent.click(screen.getByText('basket_value'));
  // After picking, the picker closes; the chip in ConditionRow contains the variable name
  // The chip text is "◇ basket_value"; use getByText with regex to find it
  expect(screen.getByText(/basket_value/)).toBeInTheDocument();
});

// Test 2: typing a per-condition message updates the live preview
test('typing a per-condition message updates live preview', () => {
  render(<Wrapper />);

  // Add a condition
  fireEvent.click(screen.getByText('＋ Add condition'));
  fireEvent.click(screen.getByText('basket_value'));

  // Open the message editor
  const addMsgLink = screen.getByText('Add custom message');
  fireEvent.click(addMsgLink);

  // Type a message with a template token
  const msgInput = screen.getByRole('textbox', { name: /message/i });
  fireEvent.change(msgInput, {
    target: { value: 'Add {{ 50 - basket_value | money }} more!' },
  });

  // Live preview should render using sampleCtx { basket_value: 38 }
  // 50 - 38 = 12, formatted as $12
  expect(screen.getByText(/Add \$12 more!/)).toBeInTheDocument();
});

// Test 3: a row with no message shows the variable's default as placeholder/inherited hint
test('row with no message shows variable default as inherited hint', () => {
  render(<Wrapper />);

  fireEvent.click(screen.getByText('＋ Add condition'));
  fireEvent.click(screen.getByText('basket_value'));

  // Should show "using default" or "inherited" text with the variable's defaultMessage
  expect(
    screen.getByText(/Your basket must meet the minimum\./i)
  ).toBeInTheDocument();
});

// Test 4: switching ALL→ANY fires onChange with the new match
test('switching ALL to ANY fires onChange with new match', () => {
  const onChange = vi.fn();
  const group: ConditionGroup = { match: 'ALL', conditions: [] };
  render(
    <ConditionBuilder value={group} variables={SAMPLE_VARIABLES} onChange={onChange} />
  );

  // Find the match selector and change it to ANY
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'ANY' } });

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ match: 'ANY' })
  );
});

// Test 5: a condition that already has a non-empty message renders the editor open
test('condition with an existing custom message shows the editor open with that text', () => {
  const group: ConditionGroup = {
    match: 'ALL',
    conditions: [
      {
        id: 'c1',
        variable: 'basket_value',
        operator: 'gte',
        value: '50',
        message: 'Spend a bit more to qualify!',
      },
    ],
  };
  render(
    <ConditionBuilder value={group} variables={SAMPLE_VARIABLES} onChange={vi.fn()} />
  );

  // The MessageEditor should be open without the user clicking "Customize"
  const msgInput = screen.getByRole('textbox', { name: /message/i });
  expect(msgInput).toBeInTheDocument();
  expect(msgInput).toHaveValue('Spend a bit more to qualify!');
});

test('adds one contract-supported nested ALL/ANY group and keeps condition ids unique', () => {
  let latest: ConditionGroup = { match: 'ALL', conditions: [] };
  function NestedWrapper() {
    const [value, setValue] = useState(latest);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={(next) => {
      latest = next;
      setValue(next);
    }} />;
  }
  render(<NestedWrapper />);

  fireEvent.click(screen.getByText('＋ Add nested group (AND / OR)'));
  fireEvent.change(screen.getByLabelText('Nested group match 1'), { target: { value: 'ANY' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add condition to nested group 1' }));
  fireEvent.click(screen.getByText('basket_value'));
  fireEvent.click(screen.getAllByText('＋ Add condition')[0]!);
  fireEvent.click(screen.getAllByText('basket_value')[0]!);

  expect(latest.groups).toHaveLength(1);
  expect(latest.groups?.[0]?.match).toBe('ANY');
  expect(latest.groups?.[0]?.conditions).toHaveLength(1);
  const ids = [
    ...latest.conditions.map(condition => condition.id),
    ...(latest.groups ?? []).flatMap(group => group.conditions.map(condition => condition.id)),
  ];
  expect(new Set(ids).size).toBe(ids.length);
});

test('emits true numbers and booleans instead of display strings', () => {
  let latest: ConditionGroup = {
    match: 'ALL',
    conditions: [{ id: 'number-condition', variable: 'basket_value', operator: 'gte', value: 0 }],
  };
  const { rerender } = render(
    <ConditionBuilder value={latest} variables={SAMPLE_VARIABLES} onChange={next => { latest = next; }} />,
  );
  fireEvent.change(screen.getByLabelText('value'), { target: { value: '125.5' } });
  expect(latest.conditions[0]?.value).toBe(125.5);

  latest = {
    match: 'ALL',
    conditions: [{ id: 'boolean-condition', variable: 'customer_tier', operator: 'eq', value: 'gold' }],
  };
  const booleanVariables: Variable[] = [{ name: 'customer.active', type: 'boolean', origin: 'user' }];
  latest = {
    match: 'ALL',
    conditions: [{ id: 'boolean-condition', variable: 'customer.active', operator: 'is', value: true }],
  };
  rerender(<ConditionBuilder value={latest} variables={booleanVariables} onChange={next => { latest = next; }} />);
  fireEvent.change(screen.getByLabelText('value'), { target: { value: 'false' } });
  expect(latest.conditions[0]?.value).toBe(false);
});

test('authors string and enum in-values as arrays and normalizes when the operator changes', async () => {
  let latest: ConditionGroup = {
    match: 'ALL',
    conditions: [{ id: 'enum-in', variable: 'customer_tier', operator: 'eq', value: 'gold' }],
  };
  function Capture({ initial }: { initial: ConditionGroup }) {
    const [value, setValue] = useState(initial);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={next => { latest = next; setValue(next); }} />;
  }
  const { rerender } = render(<Capture initial={latest}/>);
  fireEvent.change(screen.getByLabelText('operator'), { target: { value: 'in' } });
  expect(latest.conditions[0]?.value).toEqual(['gold']);
  await userEvent.selectOptions(screen.getByLabelText('values'), ['gold', 'silver']);
  expect(latest.conditions[0]?.value).toEqual(['gold', 'silver']);

  latest = {
    match: 'ALL',
    conditions: [{ id: 'string-in', variable: 'context.channel', operator: 'in', value: ['store'] }],
  };
  rerender(<Capture key="string-in" initial={latest}/>);
  fireEvent.change(screen.getByLabelText('values'), { target: { value: 'store, web' } });
  expect(latest.conditions[0]?.value).toEqual(['store', 'web']);
});

test('authors typed number and nested date between bounds and normalizes on operator change', () => {
  let latest: ConditionGroup = {
    match: 'ALL',
    conditions: [{ id: 'number-between', variable: 'basket_value', operator: 'gte', value: 10 }],
    groups: [{
      match: 'ANY',
      conditions: [{
        id: 'date-between', variable: 'customer.birthday', operator: 'between',
        value: ['1990-01-01', '2000-12-31'],
      }],
    }],
  };
  function Capture() {
    const [value, setValue] = useState(latest);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={next => { latest = next; setValue(next); }} />;
  }
  render(<Capture/>);
  const rows = screen.getAllByLabelText('operator').map(control => control.closest('div')!);
  fireEvent.change(within(rows[0]!).getByLabelText('operator'), { target: { value: 'between' } });
  expect(latest.conditions[0]?.value).toEqual([10, 10]);
  const minimums = screen.getAllByLabelText('minimum value');
  const maximums = screen.getAllByLabelText('maximum value');
  fireEvent.change(minimums[0]!, { target: { value: '25' } });
  fireEvent.change(maximums[0]!, { target: { value: '75' } });
  expect(latest.conditions[0]?.value).toEqual([25, 75]);
  fireEvent.change(minimums[1]!, { target: { value: '1995-02-03' } });
  fireEvent.change(maximums[1]!, { target: { value: '2001-04-05' } });
  expect(latest.groups?.[0]?.conditions[0]?.value).toEqual(['1995-02-03', '2001-04-05']);
});
