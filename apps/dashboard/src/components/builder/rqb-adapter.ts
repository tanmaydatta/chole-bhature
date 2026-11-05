import type {
  Condition,
  ConditionGroup,
  ConditionOperator,
  ConditionValue,
} from '@incentives/contracts';
import type { Field, RuleGroupType, RuleType } from 'react-querybuilder';
import type { Variable } from '../../lib/types';
import { OPERATORS_BY_TYPE, operatorLabel } from '../../lib/conditions';

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? `cond-${crypto.randomUUID()}`
    : `cond-${Math.random().toString(36).slice(2)}`;
}

export function conditionGroupToRuleGroup(
  group: ConditionGroup,
  path: string = 'root'
): RuleGroupType {
  const leafRules: RuleType[] = (group.conditions ?? []).map((c) => ({
    id: c.id,
    field: c.variable,
    operator: c.operator,
    value: c.value,
    message: c.message,
  }));

  const subGroupRules: RuleGroupType[] = (group.groups ?? []).map((sub, idx) =>
    conditionGroupToRuleGroup(sub, `${path}-${idx}`)
  );

  return {
    id: (group as any).id || (path === 'root' ? 'root' : `group-${path}`),
    combinator: group.match === 'ANY' ? 'or' : 'and',
    rules: [...leafRules, ...subGroupRules],
  };
}

function coerceValue(
  value: unknown,
  operator: string,
  variable?: Variable,
): ConditionValue {
  if (!variable) {
    return value as ConditionValue;
  }

  const isNumber = variable?.type === 'number';
  const isBoolean = variable?.type === 'boolean' || operator === 'is';

  if (operator === 'between') {
    const arr = Array.isArray(value)
      ? value
      : typeof value === 'string'
      ? value.split(',').map((s) => s.trim())
      : [value, value];
    const first = arr[0] ?? '';
    const second = arr[1] ?? first;
    return [
      isNumber ? (first === '' ? 0 : Number(first)) : String(first),
      isNumber ? (second === '' ? 0 : Number(second)) : String(second),
    ];
  }

  if (operator === 'in') {
    if (Array.isArray(value)) {
      return value.map((v) => (isNumber ? Number(v) : String(v)));
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((v) => (isNumber ? Number(v) : v));
    }
    return [];
  }

  if (isBoolean) {
    return value === true || value === 'true';
  }

  if (isNumber) {
    if (typeof value === 'number') return value;
    if (value === '' || value === null || value === undefined) return 0;
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  return value === undefined || value === null ? '' : String(value);
}

export function ruleGroupToConditionGroup(
  rg: RuleGroupType,
  variables?: readonly Variable[],
  depth = 0,
): ConditionGroup {
  const varMap = new Map((variables ?? []).map((v) => [v.name, v]));
  const conditions: Condition[] = [];
  const groups: ConditionGroup[] = [];

  for (const ruleOrGroup of rg.rules ?? []) {
    if ('rules' in ruleOrGroup) {
      groups.push(ruleGroupToConditionGroup(ruleOrGroup, variables, depth + 1));
    } else {
      const variable = varMap.get(ruleOrGroup.field);
      const coerced = coerceValue(ruleOrGroup.value, ruleOrGroup.operator, variable);
      const msg = (ruleOrGroup as any).message;
      const condition: Condition = {
        id: ruleOrGroup.id || newId(),
        variable: ruleOrGroup.field,
        operator: ruleOrGroup.operator as ConditionOperator,
        value: coerced,
        ...(msg ? { message: msg as string } : {}),
      };
      conditions.push(condition);
    }
  }

  return {
    match: rg.combinator === 'or' ? 'ANY' : 'ALL',
    conditions,
    ...(depth === 0 ? { groups } : groups.length > 0 ? { groups } : {}),
  };
}

export function variablesToFields(variables: readonly Variable[]): Field[] {
  return variables.map((variable) => {
    const operators = OPERATORS_BY_TYPE[variable.type] ?? [];
    return {
      name: variable.name,
      label: variable.name,
      inputType:
        variable.type === 'number'
          ? 'number'
          : variable.type === 'date'
          ? 'date'
          : 'text',
      operators: operators.map((op) => ({
        name: op,
        label: operatorLabel(op),
      })),
      values: variable.enumValues?.map((val) => ({
        name: val,
        label: val,
      })),
      origin: variable.origin,
      defaultMessage: variable.defaultMessage,
      datatype: variable.type,
    } as Field;
  });
}
