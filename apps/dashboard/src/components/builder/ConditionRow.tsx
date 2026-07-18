import { useState } from 'react';
import type { Condition, Variable, Operator, Origin } from '../../lib/types';
import { OPERATORS_BY_TYPE, operatorLabel, resolveMessage } from '../../lib/conditions';
import { MessageEditor } from './MessageEditor';

interface ConditionRowProps {
  condition: Condition;
  variable: Variable;
  onChange: (next: Condition) => void;
  onRemove: () => void;
}

const ORIGIN_CHIP_CLASS: Record<Origin, string> = {
  user: 'text-[var(--user)] bg-[var(--user-bg)]',
  dynamic: 'text-[var(--dyn)] bg-[var(--dyn-bg)]',
  system: 'text-[var(--sys)] bg-[var(--sys-bg)]',
};

const ORIGIN_ICON: Record<Origin, string> = {
  user: '◔',
  dynamic: '◇',
  system: '⚙',
};

function ValueControl({
  variable,
  condition,
  onChange,
}: {
  variable: Variable;
  condition: Condition;
  onChange: (next: Condition) => void;
}) {
  const strVal = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : condition.value;

  if (variable.type === 'boolean' || variable.type === 'enum') {
    if (variable.type === 'boolean') {
      return (
        <select
          className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium text-[12.5px]"
          value={strVal}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          aria-label="value"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    const opts = variable.enumValues ?? [];
    return (
      <select
        className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium text-[12.5px]"
        value={strVal}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        aria-label="value"
      >
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className="border border-[var(--border)] bg-[var(--panel)] rounded-[7px] px-[9px] py-[4px] min-w-[60px] text-[12.5px] text-[var(--ink)]"
      value={strVal}
      onChange={(e) => onChange({ ...condition, value: e.target.value })}
      aria-label="value"
    />
  );
}

export function ConditionRow({ condition, variable, onChange, onRemove }: ConditionRowProps) {
  const [showMsg, setShowMsg] = useState(() =>
    Boolean(condition.message && condition.message.trim() !== '')
  );

  const operators = OPERATORS_BY_TYPE[variable.type];
  const chipClass = ORIGIN_CHIP_CLASS[variable.origin];
  const icon = ORIGIN_ICON[variable.origin];

  const inherited = resolveMessage({ ...condition, message: undefined }, variable);
  const hasCustomMsg = Boolean(condition.message && condition.message.trim() !== '');

  return (
    <div className="mb-[8px]">
      <div className="flex items-center gap-[8px] flex-wrap p-[9px] border border-[var(--border)] rounded-[9px] bg-[var(--panel)]">
        <span
          className={`inline-flex items-center gap-[6px] font-semibold text-[12.5px] px-[9px] py-[4px] rounded-[7px] ${chipClass}`}
        >
          {icon} {variable.name}
        </span>

        <select
          className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[9px] py-[4px] text-[var(--ink)] font-medium cursor-pointer text-[12.5px]"
          value={condition.operator}
          onChange={(e) =>
            onChange({ ...condition, operator: e.target.value as Operator })
          }
          aria-label="operator"
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {operatorLabel(op)}
            </option>
          ))}
        </select>

        <ValueControl variable={variable} condition={condition} onChange={onChange} />

        <span
          className="ml-auto text-[var(--faint)] cursor-pointer text-[16px] px-[4px]"
          onClick={onRemove}
          role="button"
          aria-label="remove condition"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onRemove()}
        >
          ✕
        </span>
      </div>

      {showMsg ? (
        <MessageEditor condition={condition} variable={variable} onChange={onChange} />
      ) : (
        <div className="flex items-center gap-[7px] text-[12px] mt-[2px] ml-[2px]">
          <span>💬</span>
          <a
            className="text-[var(--accent)] cursor-pointer font-semibold no-underline"
            onClick={() => setShowMsg(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setShowMsg(true)}
          >
            {hasCustomMsg ? 'Customize' : 'Add custom message'}
          </a>
          <span className="text-[var(--faint)] italic">
            · {hasCustomMsg ? 'custom message set' : `using default: "${inherited}"`}
          </span>
        </div>
      )}
    </div>
  );
}
