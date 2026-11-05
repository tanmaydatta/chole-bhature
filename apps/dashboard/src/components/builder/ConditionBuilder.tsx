import { useEffect, useMemo } from 'react';
import type { ConditionGroup } from '@incentives/contracts';
import { QueryBuilder } from 'react-querybuilder';
import type { Variable } from '../../lib/types';
import {
  conditionGroupToRuleGroup,
  ruleGroupToConditionGroup,
  variablesToFields,
} from './rqb-adapter';
import type { BuilderCallbacks } from './rqb-controls';
import { customControlElements } from './rqb-controls';
import { ConditionBuilderContext } from './ConditionBuilderContext';
import { conditionGroupIsAuthorable } from './condition-validation';

import 'react-querybuilder/dist/query-builder.css';

export interface ConditionBuilderProps {
  value: ConditionGroup;
  variables: Variable[];
  onChange: (next: ConditionGroup) => void;
  onValidityChange?: (valid: boolean) => void;
}

export type ConditionBuilderVariable = Variable;

export function ConditionBuilder({
  value,
  variables,
  onChange,
  onValidityChange,
}: ConditionBuilderProps) {
  const fields = useMemo(() => variablesToFields(variables), [variables]);

  const callbacks = useMemo<BuilderCallbacks>(() => ({
    onGroupCondition: (conditionId: string) => {
      const condition = value.conditions.find((c) => c.id === conditionId);
      if (!condition) return;
      const remaining = value.conditions.filter((c) => c.id !== conditionId);
      const newNestedGroup: ConditionGroup = { match: 'ALL', conditions: [condition] };
      const nextGroups = [...(value.groups ?? []), newNestedGroup];
      onChange({ ...value, conditions: remaining, groups: nextGroups });
    },
    onPromoteCondition: (conditionId: string) => {
      const nestedGroups = value.groups ?? [];
      for (let gi = 0; gi < nestedGroups.length; gi++) {
        const nested = nestedGroups[gi];
        const idx = nested.conditions.findIndex((c) => c.id === conditionId);
        if (idx >= 0) {
          const condition = nested.conditions[idx];
          const restConditions = nested.conditions.filter((c) => c.id !== conditionId);
          const restGroups = nestedGroups.filter((_, i) => i !== gi);
          if (restConditions.length === 0 && (!nested.groups || nested.groups.length === 0)) {
            onChange({
              ...value,
              conditions: [...value.conditions, condition],
              groups: restGroups,
            });
          } else {
            onChange({
              ...value,
              conditions: [...value.conditions, condition],
              groups: [{ ...nested, conditions: restConditions }, ...restGroups],
            });
          }
          return;
        }
      }
    },
    onMoveCondition: (conditionId: string, direction: 'up' | 'down') => {
      const idx = value.conditions.findIndex((c) => c.id === conditionId);
      if (idx < 0) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= value.conditions.length) return;
      const next = [...value.conditions];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      onChange({ ...value, conditions: next });
    },
    onMoveGroup: (index: number, direction: 'up' | 'down') => {
      const groups = value.groups ?? [];
      const targetIdx = direction === 'up' ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= groups.length) return;
      const next = [...groups];
      [next[index], next[targetIdx]] = [next[targetIdx], next[index]];
      onChange({ ...value, groups: next });
    },
    canMoveConditionUp: (conditionId: string) => {
      const idx = value.conditions.findIndex((c) => c.id === conditionId);
      return idx > 0;
    },
    canMoveConditionDown: (conditionId: string) => {
      const idx = value.conditions.findIndex((c) => c.id === conditionId);
      return idx >= 0 && idx < value.conditions.length - 1;
    },
  }), [value, onChange]);

  const contextValue = useMemo(
    () => ({ variables, callbacks }),
    [variables, callbacks]
  );

  const query = useMemo(() => conditionGroupToRuleGroup(value), [value]);

  useEffect(() => {
    const valid = conditionGroupIsAuthorable(value, variables);
    onValidityChange?.(valid);
  }, [value, variables, onValidityChange]);

  const handleQueryChange = (nextQuery: any) => {
    const nextGroup = ruleGroupToConditionGroup(nextQuery, variables);
    const valid = conditionGroupIsAuthorable(nextGroup, variables);
    onValidityChange?.(valid);
    onChange(nextGroup);
  };

  return (
    <ConditionBuilderContext.Provider value={contextValue}>
      <div className="condition-builder-wrapper">
        <QueryBuilder
          fields={fields}
          query={query}
          context={contextValue}
          onQueryChange={handleQueryChange}
          controlElements={customControlElements}
          showNotToggle={false}
          enableMountQueryChange={false}
          translations={{
            addRule: { label: '＋ Add condition', title: 'Add condition' },
            addGroup: { label: '＋ Add nested group (AND / OR)', title: 'Add nested group' },
            removeRule: { label: '✕', title: 'Remove condition' },
            removeGroup: { label: '✕', title: 'Remove group' },
          }}
          controlClassnames={{
            queryBuilder: 'flex flex-col gap-3 font-sans text-sm',
            ruleGroup: 'p-3 rounded-[10px] bg-[var(--bg)] border border-[var(--border)] border-l-[3px] border-l-[var(--accent)]',
            rule: 'flex items-center gap-2 flex-wrap w-full',
            addRule: 'text-[var(--accent)] font-bold cursor-pointer text-[13px] bg-transparent border-0 p-0',
            addGroup: 'text-[var(--muted)] hover:text-[var(--ink)] font-bold cursor-pointer text-[13px] bg-transparent border-0 p-0',
          }}
        />
      </div>
    </ConditionBuilderContext.Provider>
  );
}
