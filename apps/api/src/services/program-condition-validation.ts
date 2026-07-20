import type {
  Condition,
  ConditionGroup,
  PromoProgram,
  VariableDefinition,
} from '@incentives/contracts';
import { OPERATORS_BY_TYPE } from '@incentives/engine';

import { ContextValidationError } from '../errors.js';

interface ConditionEntry {
  condition: Condition;
  path: string;
}

function conditionEntries(group: ConditionGroup, prefix: string): ConditionEntry[] {
  return [
    ...group.conditions.map((condition, index) => ({
      condition,
      path: `${prefix}.conditions.${index}`,
    })),
    ...(group.groups ?? []).flatMap((nested, groupIndex) => (
      nested.conditions.map((condition, conditionIndex) => ({
        condition,
        path: `${prefix}.groups.${groupIndex}.conditions.${conditionIndex}`,
      }))
    )),
  ];
}

function allConditionEntries(program: PromoProgram): ConditionEntry[] {
  return [
    ...conditionEntries(program.eligibility, 'eligibility'),
    ...program.rewardRules.flatMap((rule, index) => (
      conditionEntries(rule.conditions, `rewardRules.${index}.conditions`)
    )),
  ];
}

function isScalarValid(definition: VariableDefinition, value: unknown): boolean {
  switch (definition.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      if (typeof value === 'number') return Number.isFinite(value);
      return typeof value === 'string'
        && value.trim() !== ''
        && Number.isFinite(Number(value));
    case 'boolean':
      return typeof value === 'boolean' || value === 'true' || value === 'false';
    case 'enum':
      return typeof value === 'string' && (definition.enumValues ?? []).includes(value);
    case 'date':
      return (typeof value === 'string' || typeof value === 'number')
        && !Number.isNaN(Date.parse(String(value)));
  }
}

function isConditionValueValid(
  condition: Condition,
  definition: VariableDefinition,
): boolean {
  if (condition.operator === 'in') {
    return Array.isArray(condition.value)
      && condition.value.length > 0
      && condition.value.every(value => isScalarValid(definition, value));
  }
  if (condition.operator === 'between') {
    return Array.isArray(condition.value)
      && condition.value.length === 2
      && condition.value.every(value => isScalarValid(definition, value));
  }
  return !Array.isArray(condition.value) && isScalarValid(definition, condition.value);
}

export function validateProgramConditions(
  program: PromoProgram,
  definitions: readonly VariableDefinition[],
): void {
  const definitionsByKey = new Map(definitions.map(definition => [definition.key, definition]));

  for (const { condition, path } of allConditionEntries(program)) {
    const definition = definitionsByKey.get(condition.variable);
    if (definition === undefined) {
      throw new ContextValidationError('The program failed validation', [{
        path: `${path}.variable`,
        code: 'undefined_condition_variable',
        message: `Condition variable is not defined: ${condition.variable}`,
      }]);
    }
    const allowedOperators: readonly Condition['operator'][] = OPERATORS_BY_TYPE[definition.type];
    if (!allowedOperators.includes(condition.operator)) {
      throw new ContextValidationError('The program failed validation', [{
        path: `${path}.operator`,
        code: 'invalid_condition_operator',
        message: `Operator ${condition.operator} is not valid for ${definition.type} variables`,
      }]);
    }
    if (!isConditionValueValid(condition, definition)) {
      throw new ContextValidationError('The program failed validation', [{
        path: `${path}.value`,
        code: 'invalid_condition_value',
        message: `Condition ${condition.id} has an invalid value for ${definition.type}`,
      }]);
    }
  }
}
