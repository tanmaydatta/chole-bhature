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

  // Move condition at index up by one position
  function moveConditionUp(index: number) {
    if (index === 0) return;
    const conditions = [...group.conditions];
    [conditions[index - 1], conditions[index]] = [conditions[index], conditions[index - 1]];
    onChange({ ...group, conditions });
  }

  // Move condition at index down by one position
  function moveConditionDown(index: number) {
    if (index === group.conditions.length - 1) return;
    const conditions = [...group.conditions];
    [conditions[index], conditions[index + 1]] = [conditions[index + 1], conditions[index]];
    onChange({ ...group, conditions });
  }

  // Move nested group at index up
  function moveGroupUp(index: number) {
    if (index === 0) return;
    const groups = [...(group.groups ?? [])];
    [groups[index - 1], groups[index]] = [groups[index], groups[index - 1]];
    onChange({ ...group, groups });
  }

  // Move nested group at index down
  function moveGroupDown(index: number) {
    const groups = group.groups ?? [];
    if (index === groups.length - 1) return;
    const next = [...groups];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange({ ...group, groups: next });
  }

  function addNestedGroup() {
    onChange({ ...group, groups: [...(group.groups ?? []), { match: 'ALL', conditions: [] }] });
  }

  function groupCondition(conditionId: string) {
    const condition = group.conditions.find((c) => c.id === conditionId);
    if (!condition) return;
    const remaining = group.conditions.filter((c) => c.id !== conditionId);
    const newNestedGroup: ConditionGroup = { match: 'ALL', conditions: [condition] };
    const nextGroups = [...(group.groups ?? []), newNestedGroup];
    if (remaining.length === 0) {
      onChange({ ...group, groups: nextGroups, conditions: [] });
    } else {
      onChange({ ...group, conditions: remaining, groups: nextGroups });
    }
  }

  // Promote a condition from a nested group up to the parent group
  function promoteCondition(nestedIndex: number, conditionId: string) {
    const nested = group.groups?.[nestedIndex];
    if (!nested) return;
    const idx = nested.conditions.findIndex((c) => c.id === conditionId);
    if (idx < 0) return;
    const condition = nested.conditions[idx];
    const restConditions = nested.conditions.filter((c) => c.id !== conditionId);
    const restGroups = (group.groups ?? []).filter((_, i) => i !== nestedIndex);

    if (restConditions.length === 0) {
      // Remove the empty group entirely
      const nextGroups = restGroups;
      onChange({ ...group, conditions: [...group.conditions, condition], groups: nextGroups });
    } else {
      // Keep the rest in the nested group, promote this one
      onChange({
        ...group,
        conditions: [...group.conditions, condition],
        groups: [{ ...nested, conditions: restConditions }, ...restGroups],
      });
    }
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
    index: number,
    onConditionChange: (next: Condition) => void,
    remove: () => void,
    nestedIndex?: number,
  ) {
    const variable = varMap[condition.variable];
    if (!variable) return unresolvedCondition(condition, remove, nestedIndex);
    const issue = conditionIssue(condition, variables);
    const isNested = nestedIndex !== undefined;
    const canMoveUp = index > 0;
    const canMoveDown = index < group.conditions.length - 1;
    const canPromote = isNested;

    return <div key={condition.id} className="flex items-start gap-2">
      {/* Move controls */}
      <div className="flex flex-col gap-0.5 pt-1.5">
        {canMoveUp && (
          <button
            type="button"
            onClick={() => nestedIndex !== undefined ? undefined : moveConditionUp(index)}
            data-testid={`move-condition-up-${condition.id}`}
            aria-label="Move condition up"
            title="Move condition up"
            className="text-[10px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
          >
            ↑
          </button>
        )}
        {canMoveDown && (
          <button
            type="button"
            onClick={() => nestedIndex !== undefined ? undefined : moveConditionDown(index)}
            data-testid={`move-condition-down-${condition.id}`}
            aria-label="Move condition down"
            title="Move condition down"
            className="text-[10px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
          >
            ↓
          </button>
        )}
        {canPromote && (
          <button
            type="button"
            onClick={() => promoteCondition(nestedIndex, condition.id)}
            data-testid={`promote-condition-${condition.id}`}
            aria-label="Promote this condition to the parent group"
            title="Move this condition to the parent group"
            className="text-[10px] leading-none text-[var(--accent)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
          >
            ↑
          </button>
        )}
      </div>

      <div className="flex-1">
        <ConditionRow
          condition={condition}
          variable={variable}
          onChange={onConditionChange}
          onRemove={remove}
        />
        <div className="flex gap-2 mt-1">
          {!isNested && (
            <button
              type="button"
              onClick={() => groupCondition(condition.id)}
              data-testid={`group-condition-${condition.id}`}
              className="text-[var(--accent)] cursor-pointer text-[11px] border-0 bg-transparent font-bold"
              aria-label="Group this condition into a new nested group"
              title="Move this condition into a new nested group (AND branch)"
            >
              [ group ]
            </button>
          )}
          {isNested && (
            <button
              type="button"
              onClick={() => promoteCondition(nestedIndex, condition.id)}
              data-testid={`promote-condition-${condition.id}`}
              className="text-[var(--accent)] cursor-pointer text-[11px] border-0 bg-transparent font-bold"
              aria-label="Promote this condition to the parent group"
              title="Move this condition to the parent group"
            >
              [ promote ]
            </button>
          )}
        </div>
        {issue && <p role="alert" className="mt-1 text-[12px] text-amber-700">{issue}</p>}
      </div>
    </div>;
  }

  const indentPx = depth * 0;

  // Show hint in empty groups to guide users
  const hasConditions = (group.conditions ?? []).length > 0;
  const hasNestedGroups = (group.groups ?? []).length > 0;
  const showEmptyHint = !hasConditions && !hasNestedGroups;
  const nestedGroups = group.groups ?? [];

  return (
    <div>
      {/* Group header */}
      <div className="flex items-center gap-[8px] text-[13.5px] text-[var(--muted)] mb-[12px] flex-wrap">
        {groupIndex === null ? (
          <>
            <span>Customer must match </span>
            <select
              aria-label={`Condition group match root`}
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
              value={group.match}
              onChange={handleMatchChange}
            >
              <option value="ALL">ALL</option>
              <option value="ANY">ANY</option>
            </select>
            <span> of these conditions:</span>
            {group.groups?.length ? (
              <>
                <span className="text-[12px] text-[var(--muted)] opacity-70">
                  (Root conditions + groups are {group.match.toLowerCase()}. Use <code>[ group ]</code> on any condition to create a new AND/OR branch.)
                </span>
                {/* Reorder controls for nested groups — only at root where we have access to all siblings */}
                <div className="flex gap-1 ml-2">
                  {nestedGroups.length > 1 && nestedGroups.map((_, gi) => (
                    <span key={gi} className="flex items-center gap-0.5">
                      {gi > 0 && (
                        <button
                          type="button"
                          onClick={() => moveGroupUp(gi)}
                          data-testid={`move-group-up-${gi + 1}`}
                          aria-label="Move group up"
                          title="Move group up"
                          className="text-[11px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
                        >
                          ↑
                        </button>
                      )}
                      {gi < nestedGroups.length - 1 && (
                        <button
                          type="button"
                          onClick={() => moveGroupDown(gi)}
                          data-testid={`move-group-down-${gi + 1}`}
                          aria-label="Move group down"
                          title="Move group down"
                          className="text-[11px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer bg-transparent border-0 p-0"
                        >
                          ↓
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span>Nested group </span>
            <strong>{groupIndex + 1}</strong>
            <span> must match </span>
            <select
              aria-label={`Condition group match group ${groupIndex + 1}`}
              className="border border-[var(--border)] bg-[var(--bg)] rounded-[7px] px-[10px] py-[4px] font-bold text-[var(--ink)] cursor-pointer"
              value={group.match}
              onChange={handleMatchChange}
            >
              <option value="ALL">ALL</option>
              <option value="ANY">ANY</option>
            </select>
            <span>:</span>
          </>
        )}
        {groupIndex !== null && onRemove && (
          <button
            type="button"
            aria-label={`Remove group ${groupIndex + 1}`}
            className="text-[var(--muted)] cursor-pointer text-[13px] border-0 bg-transparent ml-auto"
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
        {/* Empty group hint */}
        {showEmptyHint && (
          <div className="mb-3 text-[12px] text-[var(--muted)] italic px-2">
            Empty — use the <strong>Add</strong> link below to start building this {group.match === 'ALL' ? 'AND' : 'OR'} branch.
          </div>
        )}

        {group.conditions.map((condition, index) => conditionRow(
          condition,
          index,
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

        {nestedGroups.map((nested, index) => (
          <GroupRenderer
            key={index}
            group={nested}
            groupIndex={index}
            variables={variables}
            depth={depth + 1}
            onChange={(nextNested) => updateNested(index, nextNested)}
            onRemove={() => onChange({ ...group, groups: (group.groups ?? []).filter((_, gi) => gi !== index) })}
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
