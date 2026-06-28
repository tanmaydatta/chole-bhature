import { render, screen, fireEvent } from '@testing-library/react';
import { CreateFlowShell } from './CreateFlowShell';
import { RewardEditor } from '../rewards/RewardEditor';
import type { Reward } from '../../lib/types';

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'discount', label: 'Discount' },
  { key: 'limits', label: 'Limits & schedule' },
  { key: 'review', label: 'Review' },
];

const TYPE_META_REFERRAL = { label: 'Referral', color: '#0891b2', bg: '#e2f5fa', icon: '⇄' };

test('renders shell with 5 steps', () => {
  render(
    <CreateFlowShell
      typeMeta={TYPE_META_REFERRAL}
      steps={STEPS}
      activeStep="eligibility"
      onStep={() => {}}
      onCancel={() => {}}
      onSaveDraft={() => {}}
    >
      <div>Form content</div>
    </CreateFlowShell>
  );
  expect(screen.getByText('Basics')).toBeInTheDocument();
  expect(screen.getByText('Eligibility')).toBeInTheDocument();
  expect(screen.getByText('Discount')).toBeInTheDocument();
  expect(screen.getByText('Limits & schedule')).toBeInTheDocument();
  expect(screen.getByText('Review')).toBeInTheDocument();
  expect(screen.getByText('Form content')).toBeInTheDocument();
});

test('clicking step 3 fires onStep with that step key', () => {
  const onStep = vi.fn();
  render(
    <CreateFlowShell
      typeMeta={TYPE_META_REFERRAL}
      steps={STEPS}
      activeStep="eligibility"
      onStep={onStep}
      onCancel={() => {}}
      onSaveDraft={() => {}}
    >
      <div>Form content</div>
    </CreateFlowShell>
  );
  fireEvent.click(screen.getByText('Discount'));
  expect(onStep).toHaveBeenCalledWith('discount');
});

test('active step is rendered with accent color', () => {
  render(
    <CreateFlowShell
      typeMeta={TYPE_META_REFERRAL}
      steps={STEPS}
      activeStep="eligibility"
      onStep={() => {}}
      onCancel={() => {}}
      onSaveDraft={() => {}}
    >
      <div>Form content</div>
    </CreateFlowShell>
  );
  // The active step element should have inline color style for accent
  const eligibilityStep = screen.getByTestId('step-eligibility');
  expect(eligibilityStep).toHaveStyle({ color: '#0891b2' });
});

test('Cancel and Save draft buttons call handlers', () => {
  const onCancel = vi.fn();
  const onSaveDraft = vi.fn();
  render(
    <CreateFlowShell
      typeMeta={TYPE_META_REFERRAL}
      steps={STEPS}
      activeStep="basics"
      onStep={() => {}}
      onCancel={onCancel}
      onSaveDraft={onSaveDraft}
    >
      <div>Form content</div>
    </CreateFlowShell>
  );
  fireEvent.click(screen.getByText('Cancel'));
  expect(onCancel).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Save draft'));
  expect(onSaveDraft).toHaveBeenCalledTimes(1);
});

// RewardEditor tests
test('RewardEditor renders kind select with all options', () => {
  const onChange = vi.fn();
  const value: Reward = { kind: 'percent', value: 10 };
  render(<RewardEditor value={value} onChange={onChange} />);
  const select = screen.getByRole('combobox');
  expect(select).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Percent off' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Fixed amount' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Free shipping' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Points' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Credit' })).toBeInTheDocument();
});

test('RewardEditor changing kind fires onChange', () => {
  const onChange = vi.fn();
  const value: Reward = { kind: 'percent', value: 10 };
  render(<RewardEditor value={value} onChange={onChange} />);
  const select = screen.getByRole('combobox');
  fireEvent.change(select, { target: { value: 'fixed' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fixed' }));
});

test('RewardEditor shows value input for non free_shipping kinds', () => {
  const onChange = vi.fn();
  const value: Reward = { kind: 'percent', value: 15 };
  render(<RewardEditor value={value} onChange={onChange} />);
  const input = screen.getByRole('spinbutton');
  expect(input).toBeInTheDocument();
  expect(input).toHaveValue(15);
});

test('RewardEditor hides value input for free_shipping', () => {
  const onChange = vi.fn();
  const value: Reward = { kind: 'free_shipping' };
  render(<RewardEditor value={value} onChange={onChange} />);
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});

test('RewardEditor changing value input fires onChange', () => {
  const onChange = vi.fn();
  const value: Reward = { kind: 'percent', value: 10 };
  render(<RewardEditor value={value} onChange={onChange} />);
  const input = screen.getByRole('spinbutton');
  fireEvent.change(input, { target: { value: '25' } });
  expect(onChange).toHaveBeenCalledWith({ kind: 'percent', value: 25 });
});
