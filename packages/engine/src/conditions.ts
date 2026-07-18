import type {
  Condition,
  ConditionGroup,
  VariableDefinition,
} from '@incentives/contracts';

import type { FactSet } from './facts.js';
import { OPERATORS_BY_TYPE } from './messages.js';

export interface ConditionFailure {
  conditionId: string;
  variable: string;
  reasonCode:
    | 'ATTRIBUTE_MISSING'
    | 'CONDITION_NOT_MET'
    | 'INVALID_CONDITION'
    | 'VARIABLE_NOT_DEFINED';
}

export type ConditionEvaluation =
  | { passed: true }
  | { passed: false; failure: ConditionFailure };

export type ConditionGroupEvaluation =
  | { passed: true }
  | { passed: false; firstFailure?: ConditionFailure };

const INVALID = Symbol('invalid-condition-value');

function parseValue(
  definition: VariableDefinition,
  value: unknown,
): string | number | boolean | typeof INVALID {
  switch (definition.type) {
    case 'string':
    case 'enum':
      return typeof value === 'string' ? value : INVALID;
    case 'number': {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : INVALID;
      }
      if (typeof value !== 'string' || value.trim() === '') return INVALID;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : INVALID;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return INVALID;
    case 'date': {
      if (typeof value !== 'string' && typeof value !== 'number') return INVALID;
      const parsed = Date.parse(String(value));
      return Number.isNaN(parsed) ? INVALID : parsed;
    }
  }
}

function compareValue(
  condition: Condition,
  definition: VariableDefinition,
  rawFact: unknown,
): boolean {
  const fact = parseValue(definition, rawFact);
  if (fact === INVALID) return false;

  if (condition.operator === 'in') {
    if (!Array.isArray(condition.value)) return false;
    return condition.value.some((candidate) => {
      const parsed = parseValue(definition, candidate);
      return parsed !== INVALID && parsed === fact;
    });
  }

  if (condition.operator === 'between') {
    if (!Array.isArray(condition.value) || condition.value.length !== 2) return false;
    if (definition.type !== 'number' && definition.type !== 'date') return false;
    const lower = parseValue(definition, condition.value[0]);
    const upper = parseValue(definition, condition.value[1]);
    return lower !== INVALID
      && upper !== INVALID
      && typeof fact === 'number'
      && typeof lower === 'number'
      && typeof upper === 'number'
      && fact >= lower
      && fact <= upper;
  }

  const expected = parseValue(definition, condition.value);
  if (expected === INVALID) return false;

  switch (condition.operator) {
    case 'eq':
      return fact === expected;
    case 'neq':
      return fact !== expected;
    case 'is':
      return definition.type === 'boolean'
        && typeof fact === 'boolean'
        && typeof expected === 'boolean'
        && fact === expected;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (definition.type !== 'number' && definition.type !== 'date') return false;
      if (typeof fact !== 'number' || typeof expected !== 'number') return false;
      if (condition.operator === 'gt') return fact > expected;
      if (condition.operator === 'gte') return fact >= expected;
      if (condition.operator === 'lt') return fact < expected;
      return fact <= expected;
    }
  }
}

function failureFor(
  condition: Condition,
  reasonCode: ConditionFailure['reasonCode'],
): ConditionEvaluation {
  return {
    passed: false,
    failure: conditionFailureFor(condition, reasonCode),
  };
}

function conditionFailureFor(
  condition: Condition,
  reasonCode: ConditionFailure['reasonCode'],
): ConditionFailure {
  return {
    conditionId: condition.id,
    variable: condition.variable,
    reasonCode,
  };
}

function isConditionConfigurationValid(
  condition: Condition,
  definition: VariableDefinition,
): boolean {
  if (!OPERATORS_BY_TYPE[definition.type].includes(condition.operator)) return false;
  if (definition.type !== 'enum') return true;

  const operands = condition.operator === 'in'
    ? condition.value
    : [condition.value];
  if (!Array.isArray(operands)) return false;

  const enumValues = definition.enumValues ?? [];
  return operands.every((operand) => (
    typeof operand === 'string' && enumValues.includes(operand)
  ));
}

export function evaluateCondition(
  condition: Condition,
  definitions: readonly VariableDefinition[],
  facts: FactSet,
): ConditionEvaluation {
  const definition = definitions.find(({ key }) => key === condition.variable);
  if (!definition) return failureFor(condition, 'VARIABLE_NOT_DEFINED');
  if (!isConditionConfigurationValid(condition, definition)) {
    return failureFor(condition, 'INVALID_CONDITION');
  }

  const values = definition.source === 'line_item'
    ? facts.lineItems
      .filter((item) => Object.hasOwn(item, condition.variable))
      .map((item) => item[condition.variable])
    : Object.hasOwn(facts.scalar, condition.variable)
      ? [facts.scalar[condition.variable]]
      : [];

  if (values.every((value) => value === undefined)) {
    return failureFor(condition, 'ATTRIBUTE_MISSING');
  }

  return values.some((value) => compareValue(condition, definition, value))
    ? { passed: true }
    : failureFor(condition, 'CONDITION_NOT_MET');
}

interface EvaluableGroup {
  match: 'ALL' | 'ANY';
  conditions: readonly Condition[];
  groups?: readonly EvaluableGroup[] | undefined;
}

function evaluateGroup(
  group: EvaluableGroup,
  definitions: readonly VariableDefinition[],
  facts: FactSet,
): ConditionGroupEvaluation {
  if (group.match === 'ALL') {
    let candidateLineItemIndexes = facts.lineItems.map((_item, index) => index);

    for (const condition of group.conditions) {
      const result = evaluateCondition(condition, definitions, facts);
      if (!result.passed) return { passed: false, firstFailure: result.failure };

      const definition = definitions.find(({ key }) => key === condition.variable);
      if (definition?.source !== 'line_item') continue;

      candidateLineItemIndexes = candidateLineItemIndexes.filter((index) => {
        const lineItem = facts.lineItems[index];
        if (!lineItem) return false;
        return evaluateCondition(condition, definitions, {
          scalar: facts.scalar,
          lineItems: [lineItem],
        }).passed;
      });

      if (candidateLineItemIndexes.length === 0) {
        return {
          passed: false,
          firstFailure: conditionFailureFor(condition, 'CONDITION_NOT_MET'),
        };
      }
    }

    for (const nested of group.groups ?? []) {
      const result = evaluateGroup(nested, definitions, facts);
      if (!result.passed) return result;
    }

    return { passed: true };
  }

  const results: ConditionGroupEvaluation[] = [
    ...group.conditions.map((condition): ConditionGroupEvaluation => {
      const result = evaluateCondition(condition, definitions, facts);
      return result.passed
        ? result
        : { passed: false, firstFailure: result.failure };
    }),
    ...(group.groups ?? []).map((nested) => evaluateGroup(nested, definitions, facts)),
  ];

  if (results.some((result) => result.passed)) return { passed: true };
  const firstFailure = results.find((result) => !result.passed)?.firstFailure;
  return firstFailure === undefined
    ? { passed: false }
    : { passed: false, firstFailure };
}

export function evaluateConditionGroup(
  group: ConditionGroup,
  definitions: readonly VariableDefinition[],
  facts: FactSet,
): ConditionGroupEvaluation {
  return evaluateGroup(group, definitions, facts);
}
