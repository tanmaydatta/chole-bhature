import {
  OPERATORS_BY_TYPE,
  operatorLabel,
  resolveFailureMessage,
} from '@incentives/engine';
import type { VariableDefinition, VariableSource } from '@incentives/contracts';

import type { Condition, Variable } from './types';

export { OPERATORS_BY_TYPE, operatorLabel };

function sourceFor(variable: Variable): VariableSource {
  return variable.origin === 'system' ? 'system' : 'context';
}

function toVariableDefinition(variable: Variable): VariableDefinition {
  const source = sourceFor(variable);
  return {
    key: variable.name.includes('.') ? variable.name : `${source}.${variable.name}`,
    label: variable.name,
    source,
    type: variable.type,
    required: false,
    ...(variable.enumValues === undefined ? {} : { enumValues: variable.enumValues }),
    ...(variable.defaultMessage === undefined
      ? {}
      : { defaultErrorMessage: variable.defaultMessage }),
  };
}

export function resolveMessage(
  condition: Condition,
  variable: Variable,
  programFallback?: string,
): string {
  return resolveFailureMessage(
    condition,
    toVariableDefinition(variable),
    programFallback,
  );
}
