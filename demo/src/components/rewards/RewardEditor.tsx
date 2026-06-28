import type { Reward } from '../../lib/types';

interface RewardEditorProps {
  value: Reward;
  onChange: (next: Reward) => void;
}

const KIND_OPTIONS: { value: Reward['kind']; label: string }[] = [
  { value: 'percent', label: 'Percent off' },
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'free_shipping', label: 'Free shipping' },
  { value: 'points', label: 'Points' },
  { value: 'credit', label: 'Credit' },
];

const NEEDS_AMOUNT: Reward['kind'][] = ['percent', 'fixed', 'points', 'credit'];

export function RewardEditor({ value, onChange }: RewardEditorProps) {
  const needsAmount = NEEDS_AMOUNT.includes(value.kind);

  function handleKindChange(kind: Reward['kind']) {
    if (kind === 'free_shipping') {
      onChange({ kind });
    } else {
      onChange({ kind, value: value.value ?? 0 });
    }
  }

  function handleValueChange(v: number) {
    onChange({ ...value, value: v });
  }

  return (
    <div className="flex items-center gap-[10px] flex-wrap">
      <select
        className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[6px] text-[13px] font-[600] text-[var(--ink)] cursor-pointer"
        value={value.kind}
        onChange={(e) => handleKindChange(e.target.value as Reward['kind'])}
      >
        {KIND_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {needsAmount && (
        <input
          type="number"
          className="border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[10px] py-[6px] text-[13px] text-[var(--ink)] w-[90px]"
          value={value.value ?? ''}
          min={0}
          onChange={(e) => handleValueChange(Number(e.target.value))}
        />
      )}
    </div>
  );
}
