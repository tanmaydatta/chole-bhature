import type { ProgramType } from '../../lib/types';
import { TYPE_META } from '../../lib/types';

interface TypePillProps {
  type: ProgramType;
}

export function TypePill({ type }: TypePillProps) {
  const meta = TYPE_META[type];
  return (
    <span
      className="inline-flex items-center gap-[6px] text-[11.5px] font-semibold px-[9px] py-[3px] rounded-full"
      style={{ color: meta.color, background: meta.bg }}
    >
      <span>{meta.icon}</span>
      <span>{meta.label}</span>
    </span>
  );
}
