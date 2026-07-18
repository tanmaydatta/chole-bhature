interface Option {
  label: string;
  count?: number;
}

interface SegmentedFilterProps {
  options: Option[];
  value: string;
  onChange: (label: string) => void;
}

export function SegmentedFilter({ options, value, onChange }: SegmentedFilterProps) {
  return (
    <div className="inline-flex bg-[var(--hover)] border border-[var(--border)] rounded-[9px] p-[3px]">
      {options.map((opt) => {
        const isActive = opt.label === value;
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.label)}
            className={[
              'border-none font-semibold text-[12.5px] px-[11px] py-[5px] rounded-[7px] cursor-pointer',
              isActive
                ? 'bg-[var(--panel)] text-[var(--ink)] shadow-[var(--shadow)]'
                : 'bg-transparent text-[var(--muted)]',
            ].join(' ')}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className="text-[var(--faint)] font-medium ml-1">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
