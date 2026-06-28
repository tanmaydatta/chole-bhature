import { render, screen, fireEvent } from '@testing-library/react';
import { DualRewardEditor } from './DualRewardEditor';
import type { Reward } from '../../lib/types';

test('renders Referrer gets / Referee gets labels', () => {
  const referrer: Reward = { kind: 'percent', value: 10 };
  const referee: Reward = { kind: 'fixed', value: 5 };
  render(
    <DualRewardEditor referrer={referrer} referee={referee} onChange={() => {}} />
  );
  expect(screen.getByText('Referrer gets')).toBeInTheDocument();
  expect(screen.getByText('Referee gets')).toBeInTheDocument();
});

test('editing the referrer fires onChange with updated referrer, referee unchanged', () => {
  const onChange = vi.fn();
  const referrer: Reward = { kind: 'percent', value: 10 };
  const referee: Reward = { kind: 'fixed', value: 5 };
  render(
    <DualRewardEditor referrer={referrer} referee={referee} onChange={onChange} />
  );
  // The first numeric input belongs to the referrer editor.
  const inputs = screen.getAllByRole('spinbutton');
  fireEvent.change(inputs[0], { target: { value: '25' } });
  expect(onChange).toHaveBeenCalledWith({
    referrer: { kind: 'percent', value: 25 },
    referee: { kind: 'fixed', value: 5 },
  });
});
