import type { VarType, Operator, Variable, Condition } from './types';

export const OPERATORS_BY_TYPE: Record<VarType, Operator[]> = {
  number: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between'],
  string: ['eq', 'neq', 'in'],
  boolean: ['is'],
  enum: ['eq', 'neq', 'in'],
  date: ['between', 'lt', 'gt'],
};

const OPERATOR_LABELS: Record<Operator, string> = {
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  between: 'between',
  is: 'is',
};

export function operatorLabel(op: Operator): string {
  return OPERATOR_LABELS[op];
}

export function resolveMessage(condition: Condition, variable: Variable, programFallback?: string): string {
  for (const candidate of [condition.message, variable.defaultMessage, programFallback]) {
    if (candidate && candidate.trim() !== '') return candidate;
  }
  return "This code isn't valid for your order.";
}
