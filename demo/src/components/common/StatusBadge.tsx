import type { Status } from '../../lib/types';

interface StatusBadgeProps {
  status: Status;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const isActive = status === 'active';
  const isScheduled = status === 'scheduled';

  let dotClass = 'w-2 h-2 rounded-full inline-block';
  let textClass = 'inline-flex items-center gap-[6px] font-semibold text-[12.5px]';

  if (isActive) {
    dotClass += ' bg-[var(--green)]';
  } else if (isScheduled) {
    dotClass += ' bg-[var(--accent)]';
    textClass += ' text-[var(--accent)]';
  } else {
    dotClass += ' bg-[var(--faint)]';
    textClass += ' text-[var(--muted)]';
  }

  return (
    <span className={textClass}>
      <span className={dotClass} />
      {capitalize(status)}
    </span>
  );
}
