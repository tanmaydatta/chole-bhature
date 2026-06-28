import { render, screen, fireEvent } from '@testing-library/react';
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
