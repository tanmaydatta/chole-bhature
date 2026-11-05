import { useEffect, useMemo } from 'react';
import type { ConditionGroup } from '@incentives/contracts';
import { QueryBuilder } from 'react-querybuilder';
import type { Variable } from '../../lib/types';
import {
  conditionGroupToRuleGroup,
  ruleGroupToConditionGroup,
  variablesToFields,
} from './rqb-adapter';
import { createCustomControlElements } from './rqb-controls';
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
  const controlElements = useMemo(() => createCustomControlElements(variables), [variables]);

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
    <div className="condition-builder-wrapper">
      <QueryBuilder
        fields={fields}
        query={query}
        onQueryChange={handleQueryChange}
        controlElements={controlElements}
        showNotToggle={false}
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
  );
}
