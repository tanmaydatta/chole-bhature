import type { Reward } from '../../lib/types';
import { RewardEditor } from './RewardEditor';

interface DualRewardEditorProps {
  referrer: Reward;
  referee: Reward;
  onChange: (next: { referrer: Reward; referee: Reward }) => void;
}

export function DualRewardEditor({ referrer, referee, onChange }: DualRewardEditorProps) {
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[6px]">
        <label className="text-[13px] font-[600] text-[var(--ink)]">Referrer gets</label>
        <RewardEditor
          value={referrer}
          onChange={(next) => onChange({ referrer: next, referee })}
        />
      </div>
      <div className="flex flex-col gap-[6px]">
        <label className="text-[13px] font-[600] text-[var(--ink)]">Referee gets</label>
        <RewardEditor
          value={referee}
          onChange={(next) => onChange({ referrer, referee: next })}
        />
      </div>
    </div>
  );
}
