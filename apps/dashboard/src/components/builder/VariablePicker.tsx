import { useState } from 'react';
import type { Variable, Origin } from '../../lib/types';

interface VariablePickerProps {
  variables: Variable[];
  onPick: (v: Variable) => void;
}

const ORIGIN_META: Record<Origin, { label: string; tag: string; swatchClass: string; tagClass: string }> = {
  user: {
    label: 'User attributes',
    tag: 'persistent',
    swatchClass: 'bg-[var(--user)]',
    tagClass: 'text-[var(--user)] bg-[var(--user-bg)]',
  },
  dynamic: {
    label: 'Dynamic / context',
    tag: 'per request',
    swatchClass: 'bg-[var(--dyn)]',
    tagClass: 'text-[var(--dyn)] bg-[var(--dyn-bg)]',
  },
  system: {
    label: 'System',
    tag: 'provided by us',
    swatchClass: 'bg-[var(--sys)]',
    tagClass: 'text-[var(--sys)] bg-[var(--sys-bg)]',
  },
};

const ORIGIN_ORDER: Origin[] = ['user', 'dynamic', 'system'];

export function VariablePicker({ variables, onPick }: VariablePickerProps) {
  const [search, setSearch] = useState('');

  const filtered = variables.filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  const byOrigin = ORIGIN_ORDER.reduce<Record<Origin, Variable[]>>(
    (acc, o) => {
      acc[o] = filtered.filter((v) => v.origin === o);
      return acc;
    },
    { user: [], dynamic: [], system: [] }
  );

  return (
    <div className="mt-[10px] border border-[var(--border)] rounded-[11px] bg-[var(--panel)] shadow-[var(--shadow)] overflow-hidden">
      <div className="px-[12px] py-[10px] border-b border-[var(--border)]">
        <input
          className="w-full border-none bg-transparent text-[13.5px] text-[var(--ink)] outline-none"
          placeholder="🔎  Search variables…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {ORIGIN_ORDER.map((origin) => {
        const group = byOrigin[origin];
        if (group.length === 0) return null;
        const meta = ORIGIN_META[origin];
        return (
          <div key={origin}>
            <div className="px-[12px] py-[8px] pb-[4px] text-[10.5px] tracking-[0.07em] uppercase text-[var(--faint)] font-bold flex items-center gap-[7px]">
              <span className={`w-[8px] h-[8px] rounded-[2px] flex-shrink-0 ${meta.swatchClass}`} />
              {meta.label}
              <span className={`text-[9.5px] px-[6px] py-[1px] rounded-full tracking-[0.02em] ${meta.tagClass}`}>
                {meta.tag}
              </span>
            </div>
            {group.map((v) => (
              <div
                key={v.name}
                className="flex items-center gap-[9px] px-[12px] py-[7px] cursor-pointer text-[13px] hover:bg-[var(--hover)]"
                onClick={() => onPick(v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onPick(v)}
              >
                <span className={`w-[8px] h-[8px] rounded-[2px] flex-shrink-0 ${meta.swatchClass}`} />
                <code className="font-bold">{v.name}</code>
                <span className="text-[var(--muted)] text-[12px] ml-auto">{v.type}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
