import { resolveMessage } from '../../lib/conditions';
import { renderMessage } from '../../lib/interpolate';
import type { Condition, Variable } from '../../lib/types';

interface MessageEditorProps {
  condition: Condition;
  variable: Variable;
  onChange: (next: Condition) => void;
}

const SAMPLE_CTX: Record<string, number | string> = {
  basket_value: 38,
  customer_tier: 'gold',
  discount: 15,
};

const INSERT_CHIPS = [
  { label: 'basket_value', colorClass: 'text-[var(--dyn)]' },
  { label: 'customer_tier', colorClass: 'text-[var(--user)]' },
  { label: 'discount', colorClass: '' },
  { label: '| money', colorClass: '' },
];

export function MessageEditor({ condition, variable, onChange }: MessageEditorProps) {
  const inherited = resolveMessage(
    { ...condition, message: undefined },
    variable
  );
  const currentMessage = condition.message ?? '';
  const previewText = currentMessage
    ? renderMessage(currentMessage, SAMPLE_CTX)
    : renderMessage(inherited, SAMPLE_CTX);

  function insertChip(chip: string) {
    const token = chip.startsWith('|') ? ` {{ ${chip} }}` : `{{ ${chip} }}`;
    onChange({ ...condition, message: currentMessage + token });
  }

  return (
    <div className="my-[6px] mx-0 mb-[2px] p-[11px] border border-dashed border-[var(--accent)] rounded-[9px] bg-[var(--accent-soft)]">
      <div className="text-[11px] uppercase tracking-[0.05em] text-[var(--muted)] font-bold mb-[6px]">
        Message shown if this fails
      </div>
      <input
        aria-label="message"
        className="w-full border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[10px] py-[8px] text-[13px] text-[var(--ink)]"
        value={currentMessage}
        placeholder={inherited}
        onChange={(e) => onChange({ ...condition, message: e.target.value })}
      />
      <div className="flex gap-[6px] my-[8px] flex-wrap items-center">
        <span className="text-[var(--muted)] text-[11.5px] self-center">Insert:</span>
        {INSERT_CHIPS.map((chip) => (
          <span
            key={chip.label}
            className={`text-[11.5px] font-semibold border border-[var(--border)] bg-[var(--panel)] rounded-full px-[9px] py-[3px] cursor-pointer text-[var(--muted)] ${chip.colorClass}`}
            onClick={() => insertChip(chip.label)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && insertChip(chip.label)}
          >
            {chip.label}
          </span>
        ))}
      </div>
      <div className="text-[13px] bg-[var(--panel)] border border-[var(--border)] rounded-[8px] px-[11px] py-[8px] mt-[4px]">
        Preview → <b className="text-[var(--green)]">"{previewText}"</b>{' '}
        <span className="text-[var(--muted)]">(basket = $38)</span>
      </div>
    </div>
  );
}
