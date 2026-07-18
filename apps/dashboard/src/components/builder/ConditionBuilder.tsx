import { useState } from 'react';
import type { ConditionGroup, Variable, Condition } from '../../lib/types';
import { OPERATORS_BY_TYPE } from '../../lib/conditions';
import { ConditionRow } from './ConditionRow';
import { VariablePicker } from './VariablePicker';

interface ConditionBuilderProps {
  value: ConditionGroup;
  variables: Variable[];
  onChange: (next: ConditionGroup) => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `cond-${crypto.randomUUID()}`
    : `cond-${Math.random().toString(36).slice(2)}`;
}

function makeCondition(variable: Variable): Condition {
  const operator = OPERATORS_BY_TYPE[variable.type][0];
  let defaultValue: string | string[] = '';
  if (variable.type === 'boolean') defaultValue = 'true';
  else if (variable.type === 'enum' && variable.enumValues?.length)
    defaultValue = variable.enumValues[0];
  else if (variable.type === 'number') defaultValue = '0';

  return {
    id: newId(),
    variable: variable.name,
    operator,
    value: defaultValue,
  };
}

export function ConditionBuilder({ value, variables, onChange }: ConditionBuilderProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const varMap = Object.fromEntries(variables.map((v) => [v.name, v]));

  function handleMatchChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onChange({ ...value, match: e.target.value as 'ALL' | 'ANY' });
  }

  function handlePick(variable: Variable) {
    const condition = makeCondition(variable);
    onChange({ ...value, conditions: [...value.conditions, condition] });
    setPickerOpen(false);
  }

  function handleConditionChange(id: string, next: Condition) {
    onChange({
      ...value,
      conditions: value.conditions.map((c) => (c.id === id ? next : c)),
    });
  }

  function handleRemove(id: string) {
    onChange({
      ...value,
      conditions: value.conditions.filter((c) => c.id !== id),
    });
  }

  return (
    <div>
      {/* Match ALL / ANY bar */}
      <div className="flex items-center gap-[8px] text-[13.5px] text-[var(--muted)] mb-[12px]">
        Customer must match{' '}
        <select
          className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
          value={value.match}
          onChange={handleMatchChange}
        >
          <option value="ALL">ALL</option>
          <option value="ANY">ANY</option>
        </select>{' '}
        of these conditions:
      </div>

      {/* Condition group */}
      <div className="border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] rounded-[10px] p-[12px] bg-[var(--bg)]">
        {value.conditions.map((condition) => {
          const variable = varMap[condition.variable];
          if (!variable) return null;
          return (
            <ConditionRow
              key={condition.id}
              condition={condition}
              variable={variable}
              onChange={(next) => handleConditionChange(condition.id, next)}
              onRemove={() => handleRemove(condition.id)}
            />
          );
        })}

        <div className="flex gap-[14px] mt-[6px]">
          <span
            className="text-[var(--accent)] font-bold cursor-pointer text-[13px]"
            onClick={() => setPickerOpen((o) => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setPickerOpen((o) => !o)}
          >
            ＋ Add condition
          </span>
          <span className="text-[var(--muted)] font-bold cursor-pointer text-[13px]">
            ＋ Add nested group (AND / OR)
          </span>
        </div>

        {pickerOpen && (
          <VariablePicker variables={variables} onPick={handlePick} />
        )}
      </div>
    </div>
  );
}
