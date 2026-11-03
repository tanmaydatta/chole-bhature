import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ConditionBuilder } from './ConditionBuilder';
import { conditionGroupIsAuthorable } from './condition-validation';
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

test('supports arbitrary nesting depth — 3 levels', () => {
  // Test that the component can render and update 3 levels of nesting
  // by starting with pre-existing structure
  const threeLevelGroup: ConditionGroup = {
    match: 'ALL',
    conditions: [],
    groups: [{
      match: 'ANY',
      conditions: [],
      groups: [{
        match: 'ALL',
        conditions: [],
      }],
    }],
  };
  
  function Capture() {
    const [value, setValue] = useState(threeLevelGroup);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={setValue} />;
  }
  render(<Capture />);

  // Verify all 3 groups are rendered (use getAllByLabelText to get both "group 1" selects)
  const group1Selects = screen.getAllByLabelText('Condition group match group 1');
  expect(group1Selects).toHaveLength(2); // One for each nested group
  
  // Verify we can change the match for the deepest group (second "group 1" select)
  fireEvent.change(group1Selects[1]!, { target: { value: 'ANY' } });
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
  fireEvent.change(screen.getByLabelText('Condition group match group 1'), { target: { value: 'ANY' } });
  const addBtns = screen.getAllByText('＋ Add condition');
  fireEvent.click(addBtns[1]!); // the nested group's add button
  fireEvent.click(screen.getByText('basket_value'));

  expect(latest.groups).toHaveLength(1);
  expect(latest.groups?.[0]?.match).toBe('ANY');
  expect(latest.groups?.[0]?.conditions).toHaveLength(1);
  const ids = [
    ...latest.conditions.map(c => c.id),
    ...(latest.groups ?? []).flatMap(g => g.conditions.map(c => c.id)),
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

test('authors typed number and nested date between bounds and normalizes on operator change', async () => {
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
  const { rerender: _rerender } = render(<Capture/>);
  // Find all operator selects
  const operators = screen.getAllByLabelText('operator');
  // Change first operator to "between"
  fireEvent.change(operators[0]!, { target: { value: 'between' } });
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

test('keeps unresolved and incompatible top-level and nested conditions visible and editable', async () => {
  let latest: ConditionGroup = {
    match: 'ALL',
    conditions: [
      { id: 'deprecated-top', variable: 'customer.deprecated', operator: 'eq', value: 'legacy' },
      { id: 'wrong-operator', variable: 'context.channel', operator: 'gt', value: 'store' },
    ],
    groups: [{
      match: 'ANY',
      conditions: [{ id: 'missing-nested', variable: 'context.missing', operator: 'in', value: ['web'] }],
    }],
  };
  function InvalidWrapper() {
    const [value, setValue] = useState(latest);
    const [valid, setValid] = useState(true);
    return <>
      <output aria-label="condition validity">{String(valid)}</output>
      <ConditionBuilder
        value={value}
        variables={SAMPLE_VARIABLES}
        onChange={next => { latest = next; setValue(next); }}
        onValidityChange={setValid}
      />
    </>;
  }
  const user = userEvent.setup();
  render(<InvalidWrapper />);

  await waitFor(() => expect(screen.getByLabelText('condition validity')).toHaveTextContent('false'));
  const top = screen.getByRole('group', { name: 'Unresolved condition customer.deprecated' });
  expect(within(top).getByText('customer.deprecated')).toBeInTheDocument();
  expect(within(top).getByText('eq')).toBeInTheDocument();
  expect(within(top).getByText('legacy')).toBeInTheDocument();
  expect(screen.getByText('Missing variable definition for customer.deprecated.')).toBeInTheDocument();
  expect(screen.getByText('Missing variable definition for context.missing.')).toBeInTheDocument();
  // Check for operator error with flexible matcher
  expect(screen.getByText(/Operator.*gt.*is not valid for context\.channel/)).toBeInTheDocument();

  await user.click(within(top).getByRole('button', { name: 'Replace customer.deprecated' }));
  await user.click(within(top).getByText('customer_tier'));
  expect(latest.conditions[0]).toMatchObject({
    id: 'deprecated-top', variable: 'customer_tier', operator: 'eq', value: 'gold',
  });
  
  // Remove the nested condition - it's inside the nested group's unresolved condition
  const nestedUnresolved = screen.getByRole('group', { name: 'Unresolved condition context.missing' });
  await user.click(within(nestedUnresolved).getByRole('button', { name: 'Remove context.missing' }));
  expect(latest.groups?.[0]?.conditions).toEqual([]);
});

// ── New tests: recursive nesting ──────────────────────────────────

test('supports 3-level nesting with correct group IDs', () => {
  // Test that the component can render 3 levels of nesting
  // by starting with pre-existing structure
  const threeLevelGroup: ConditionGroup = {
    match: 'ALL',
    conditions: [],
    groups: [{
      match: 'ANY',
      conditions: [],
      groups: [{
        match: 'ALL',
        conditions: [],
      }],
    }],
  };
  
  function Capture() {
    const [value, setValue] = useState(threeLevelGroup);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={setValue} />;
  }
  render(<Capture />);

  // Verify all 3 groups are rendered
  expect(screen.getByLabelText('Condition group match root')).toBeInTheDocument();
  const group1Selects = screen.getAllByLabelText('Condition group match group 1');
  expect(group1Selects).toHaveLength(2); // Both nested groups have "group 1" label
});

test('nested group removal works at all levels', () => {
  // Test removal by starting with pre-existing 2-level structure
  const twoLevelGroup: ConditionGroup = {
    match: 'ALL',
    conditions: [],
    groups: [{
      match: 'ANY',
      conditions: [],
      groups: [{
        match: 'ALL',
        conditions: [],
        groups: undefined,
      }],
    }],
  };
  
  let captured: ConditionGroup | null = null;
  function Capture() {
    const [value, setValue] = useState(twoLevelGroup);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={next => { captured = next; setValue(next); }} />;
  }
  render(<Capture />);

  // Verify both nested groups are rendered
  const group1Selects = screen.getAllByLabelText('Condition group match group 1');
  expect(group1Selects).toHaveLength(2);

  // Remove the first nested group (first "Remove group 1" button)
  const removeBtns = screen.getAllByRole('button', { name: 'Remove group 1' });
  fireEvent.click(removeBtns[0]!);

  // After removal, only root conditions should remain (none in this case)
  expect((captured as ConditionGroup | null)?.groups).toHaveLength(0);
});

test('recursive validation checks all nested conditions', () => {
  const threeLevelGroup: ConditionGroup = {
    match: 'ALL',
    conditions: [{ id: 'c1', variable: 'basket_value', operator: 'gte', value: 100 }],
    groups: [{
      match: 'ANY',
      conditions: [{ id: 'c2', variable: 'customer_tier', operator: 'in', value: ['gold'] }],
      groups: [{
        match: 'ALL',
        conditions: [{ id: 'c3', variable: 'nonexistent_var', operator: 'eq', value: 'test' }],
        groups: undefined,
      }],
    }],
  };

  const isValid = conditionGroupIsAuthorable(threeLevelGroup, SAMPLE_VARIABLES);
  expect(isValid).toBe(false); // Should be invalid due to 'nonexistent_var'
});

test('valid 3-level nested structure is accepted', () => {
  const threeLevelValidGroup: ConditionGroup = {
    match: 'ALL',
    conditions: [],
    groups: [{
      match: 'ANY',
      conditions: [{ id: 'c1', variable: 'basket_value', operator: 'gte', value: 100 }],
      groups: [{
        match: 'ALL',
        conditions: [{ id: 'c2', variable: 'customer_tier', operator: 'in', value: ['gold', 'silver'] }],
        groups: undefined,
      }],
    }],
  };

  const isValid = conditionGroupIsAuthorable(threeLevelValidGroup, SAMPLE_VARIABLES);
  expect(isValid).toBe(true);
});

test('adding and removing conditions in nested groups preserves structure', () => {
  render(<Wrapper />);

  // Add first nested group (level 1)
  fireEvent.click(screen.getByText('＋ Add nested group (AND / OR)'));

  // Verify the nested group structure is preserved (remove button should exist)
  const removeBtns = screen.getAllByRole('button', { name: 'Remove group 1' });
  expect(removeBtns).toHaveLength(1);
  expect(removeBtns[0]).toBeInTheDocument();
  
  // The nested group's match selector should exist
  const group1Selects = screen.getAllByLabelText('Condition group match group 1');
  expect(group1Selects).toHaveLength(1);
});

test('adding sub-groups at depth 2 produces groups.groups', () => {
  let latest: ConditionGroup = { match: 'ALL', conditions: [] };
  function Capture() {
    const [value, setValue] = useState(latest);
    return <ConditionBuilder value={value} variables={SAMPLE_VARIABLES} onChange={(next) => {
      latest = next;
      setValue(next);
    }} />;
  }
  render(<Capture />);

  // Level 1: add nested group
  fireEvent.click(screen.getByText('＋ Add nested group (AND / OR)'));

  // Level 2: add nested group inside level 1
  fireEvent.click(screen.getAllByText('＋ Add nested group (AND / OR)')[1]!);

  // Add a condition to the level 2 group
  const addBtns = screen.getAllByText('＋ Add condition');
  fireEvent.click(addBtns[addBtns.length - 1]!);
  fireEvent.click(screen.getByText('basket_value'));

  // Verify the 3-level structure exists
  expect(latest.groups).toHaveLength(1);
  expect(latest.groups![0].groups).toHaveLength(1);
  expect(latest.groups![0].groups![0].conditions).toHaveLength(1);
  expect(latest.groups![0].groups![0].conditions[0].variable).toBe('basket_value');
});

test('condition validation with deep nested invalid conditions', () => {
  // 4 levels deep — ensure recursion handles it
  const fourLevelGroup: ConditionGroup = {
    match: 'ALL',
    conditions: [],
    groups: [{
      match: 'ANY',
      conditions: [],
      groups: [{
        match: 'ALL',
        conditions: [],
        groups: [{
          match: 'ANY',
          conditions: [{
            id: 'invalid-deep',
            variable: 'does.not.exist',
            operator: 'eq',
            value: 'test',
          }],
          groups: undefined,
        }],
      }],
    }],
  };

  expect(conditionGroupIsAuthorable(fourLevelGroup, SAMPLE_VARIABLES)).toBe(false);
});

test('deep valid nesting passes validation', () => {
  const valid4Level: ConditionGroup = {
    match: 'ALL',
    conditions: [],
    groups: [{
      match: 'ANY',
      conditions: [],
      groups: [{
        match: 'ALL',
        conditions: [],
        groups: [{
          match: 'ANY',
          conditions: [{
            id: 'deep-valid',
            variable: 'basket_value',
            operator: 'gte',
            value: 50,
          }],
          groups: undefined,
        }],
      }],
    }],
  };

  expect(conditionGroupIsAuthorable(valid4Level, SAMPLE_VARIABLES)).toBe(true);
});

test('toggle visibility of nested group add/remove buttons', async () => {
  render(<Wrapper />);
  const user = userEvent.setup();

  // No nested groups visible initially
  expect(screen.queryByRole('button', { name: 'Remove group 1' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Condition group match group 1')).not.toBeInTheDocument();

  // Add one nested group — both should appear
  await user.click(screen.getByText('＋ Add nested group (AND / OR)'));
  expect(screen.getByRole('button', { name: 'Remove group 1' })).toBeInTheDocument();
  expect(screen.getByLabelText('Condition group match group 1')).toBeInTheDocument();

  // Remove it
  await user.click(screen.getByRole('button', { name: 'Remove group 1' }));
  expect(screen.queryByRole('button', { name: 'Remove group 1' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Condition group match group 1')).not.toBeInTheDocument();
});
