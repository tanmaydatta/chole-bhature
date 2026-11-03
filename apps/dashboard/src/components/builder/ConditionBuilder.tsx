import { useEffect, useState } from 'react';
import type {
  Condition,
  ConditionGroup,
  ConditionValue,
} from '@incentives/contracts';
import type { Variable } from '../../lib/types';
import { OPERATORS_BY_TYPE } from '../../lib/conditions';
import { ConditionRow } from './ConditionRow';
import { VariablePicker } from './VariablePicker';
import { conditionGroupIsAuthorable, conditionIssue } from './condition-validation';

interface ConditionBuilderProps {
  value: ConditionGroup;
  variables: Variable[];
  onChange: (next: ConditionGroup) => void;
  onValidityChange?: (valid: boolean) => void;
}

export type ConditionBuilderVariable = Variable;

function displayValue(value: ConditionValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `cond-${crypto.randomUUID()}`
    : `cond-${Math.random().toString(36).slice(2)}`;
}

function makeCondition(variable: Variable): Condition {
  const operator = OPERATORS_BY_TYPE[variable.type][0];
  let defaultValue: Condition['value'] = '';
  if (variable.type === 'boolean') defaultValue = true;
  else if (variable.type === 'enum' && variable.enumValues?.length)
    defaultValue = variable.enumValues[0];
  else if (variable.type === 'number') defaultValue = 0;

  return {
    id: newId(),
    variable: variable.name,
    operator,
    value: defaultValue,
  };
}

// ── Recursive sub-group renderer ──────────────────────────────────

interface GroupRendererProps {
  group: ConditionGroup;
  groupIndex: number | null;
  variables: Variable[];
  depth: number;
  onChange: (next: ConditionGroup) => void;
  onValidityChange?: (valid: boolean) => void;
  onRemove?: () => void;
}

function GroupRenderer({
  group,
  groupIndex,
  variables,
  depth,
  onChange,
  onValidityChange,
  onRemove,
}: GroupRendererProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replacement, setReplacement] = useState<{
    conditionId: string;
    nestedIndex?: number;
  } | null>(null);

  const varMap = Object.fromEntries(variables.map((v) => [v.name, v]));
  const valid = conditionGroupIsAuthorable(group, variables);

  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  function handleMatchChange(e: React.ChangeEvent<HTMLSelectElement>) {
    onChange({ ...group, match: e.target.value as 'ALL' | 'ANY' });
  }

  function handlePick(variable: Variable) {
    const condition = makeCondition(variable);
    onChange({ ...group, conditions: [...group.conditions, condition] });
    setPickerOpen(false);
  }

  function handleConditionChange(id: string, next: Condition) {
    onChange({
      ...group,
      conditions: group.conditions.map((c) => (c.id === id ? next : c)),
    });
  }

  function handleRemove(id: string) {
    onChange({
      ...group,
      conditions: group.conditions.filter((c) => c.id !== id),
    });
  }

  function addNestedGroup() {
    onChange({ ...group, groups: [...(group.groups ?? []), { match: 'ALL', conditions: [] }] });
  }

  function updateNested(index: number, nestedGroup: NonNullable<ConditionGroup['groups']>[number]) {
    onChange({
      ...group,
      groups: (group.groups ?? []).map((existing, gi) => (
        gi === index ? nestedGroup : existing
      )),
    });
  }

  function unresolvedCondition(
    condition: Condition,
    remove: () => void,
    nestedIndex?: number,
  ) {
    const replacing = replacement?.conditionId === condition.id
      && replacement.nestedIndex === nestedIndex;
    return (
      <div
        key={condition.id}
        role="group"
        aria-label={`Unresolved condition ${condition.variable}`}
        className="mb-2 rounded-[9px] border border-amber-500 bg-amber-50 p-3 text-[12.5px] text-slate-900"
      >
        <div className="flex flex-wrap items-center gap-2">
          <code>{condition.variable}</code>
          <code>{condition.operator}</code>
          <code>{displayValue(condition.value)}</code>
          <button type="button" onClick={() => setReplacement({ conditionId: condition.id, ...(nestedIndex === undefined ? {} : { nestedIndex }) })}>
            Replace {condition.variable}
          </button>
          <button type="button" onClick={remove}>Remove {condition.variable}</button>
        </div>
        <p role="alert">Missing variable definition for {condition.variable}.</p>
        {replacing && <VariablePicker variables={variables} onPick={variable => {
          const next = { ...makeCondition(variable), id: condition.id };
          if (nestedIndex === undefined) handleConditionChange(condition.id, next);
          else {
            const g = group.groups?.[nestedIndex];
            if (g) updateNested(nestedIndex, {
              ...g,
              conditions: g.conditions.map(existing => existing.id === condition.id ? next : existing),
            });
          }
          setReplacement(null);
        }} />}
      </div>
    );
  }

  function conditionRow(
    condition: Condition,
    onConditionChange: (next: Condition) => void,
    remove: () => void,
    nestedIndex?: number,
  ) {
    const variable = varMap[condition.variable];
    if (!variable) return unresolvedCondition(condition, remove, nestedIndex);
    const issue = conditionIssue(condition, variables);
    return <div key={condition.id}>
      <ConditionRow
        condition={condition}
        variable={variable}
        onChange={onConditionChange}
        onRemove={remove}
      />
      {issue && <p role="alert" className="mb-2 text-[12px] text-amber-700">{issue}</p>}
    </div>;
  }

  const indentPx = depth * 20;
  const labelPrefix = groupIndex === null ? 'root' : `group ${groupIndex + 1}`;

  return (
    <div>
      <div className="flex items-center gap-[8px] text-[13.5px] text-[var(--muted)] mb-[12px]">
        Customer must match{' '}
        <select
          aria-label={`Condition group match ${labelPrefix}`}
          className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
          value={group.match}
          onChange={handleMatchChange}
        >
          <option value="ALL">ALL</option>
          <option value="ANY">ANY</option>
        </select>{' '}
        of these conditions:
        {groupIndex !== null && onRemove && (
          <button
            type="button"
            aria-label={`Remove group ${groupIndex + 1}`}
            className="text-[var(--muted)] cursor-pointer text-[13px] border-0 bg-transparent"
            onClick={onRemove}
          >
            Remove group {groupIndex + 1}
          </button>
        )}
      </div>

      <div
        className="border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] rounded-[10px] p-[12px] bg-[var(--bg)]"
        style={{ marginLeft: indentPx }}
      >
        {group.conditions.map(condition => conditionRow(
          condition,
          next => handleConditionChange(condition.id, next),
          () => handleRemove(condition.id),
        ))}

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
          <button type="button" onClick={addNestedGroup} className="text-[var(--muted)] font-bold cursor-pointer text-[13px] border-0 bg-transparent">
            ＋ Add nested group (AND / OR)
          </button>
        </div>

        {pickerOpen && (
          <VariablePicker variables={variables} onPick={handlePick} />
        )}

        {(group.groups ?? []).map((nested, index) => (
          <GroupRenderer
            key={index}
            group={nested}
            groupIndex={index}
            variables={variables}
            depth={depth + 1}
            onChange={(nextNested) => updateNested(index, nextNested)}
            onRemove={onRemove
              ? () => onRemove()
              : () => onChange({ ...group, groups: (group.groups ?? []).filter((_, gi) => gi !== index) })
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── Top-level entry point ─────────────────────────────────────────

export function ConditionBuilder({
  value,
  variables,
  onChange,
  onValidityChange,
}: ConditionBuilderProps) {
  return (
    <div>
      <GroupRenderer
        group={value}
        groupIndex={null}
        variables={variables}
        depth={0}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />
    </div>
  );
}
