import type { Condition, ConditionGroup } from '@incentives/contracts';

import { OPERATORS_BY_TYPE } from '../../lib/conditions';
import type { Variable } from '../../lib/types';

function scalarMatches(variable: Variable, value: string | number | boolean): boolean {
  if (variable.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (variable.type === 'boolean') return typeof value === 'boolean';
  if (typeof value !== 'string') return false;
  return variable.type !== 'enum' || (variable.enumValues ?? []).includes(value);
}

export function conditionIssue(
  condition: Condition,
  variables: readonly Variable[],
): string | null {
  const variable = variables.find(candidate => candidate.name === condition.variable);
  if (!variable) return `Missing variable definition for ${condition.variable}.`;
  if (!OPERATORS_BY_TYPE[variable.type].includes(condition.operator)) {
    return `Operator “${condition.operator}” is not valid for ${condition.variable}.`;
  }
  const operands = Array.isArray(condition.value) ? condition.value : [condition.value];
  const needsArray = condition.operator === 'in' || condition.operator === 'between';
  if (
    needsArray !== Array.isArray(condition.value)
    || (condition.operator === 'between' && operands.length !== 2)
    || operands.some(operand => !scalarMatches(variable, operand))
  ) return `Value is not valid for ${condition.variable} (${variable.type}).`;
  return null;
}

export function conditionGroupIsAuthorable(
  group: ConditionGroup,
  variables: readonly Variable[],
): boolean {
  return [
    ...group.conditions,
    ...(group.groups ?? []).flatMap(nested => nested.conditions),
  ].every(condition => conditionIssue(condition, variables) === null);
}
