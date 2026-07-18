import type {
  Condition,
  ConditionOperator,
  VariableDefinition,
  VariableType,
} from '@incentives/contracts';

export const SYSTEM_DEFAULT_FAILURE_MESSAGE = "This code isn't valid for your order.";

export const OPERATORS_BY_TYPE: Record<VariableType, ConditionOperator[]> = {
  number: ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between'],
  string: ['eq', 'neq', 'in'],
  boolean: ['is'],
  enum: ['eq', 'neq', 'in'],
  date: ['between', 'lt', 'gt'],
};

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
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

export function operatorLabel(operator: ConditionOperator): string {
  return OPERATOR_LABELS[operator];
}

export function resolveFailureMessage(
  condition: Condition,
  variable: VariableDefinition,
  programFallback?: string,
  systemDefault = SYSTEM_DEFAULT_FAILURE_MESSAGE,
): string {
  for (const candidate of [
    condition.message,
    variable.defaultErrorMessage,
    programFallback,
    systemDefault,
  ]) {
    if (candidate && candidate.trim() !== '') return candidate;
  }

  return SYSTEM_DEFAULT_FAILURE_MESSAGE;
}

export function money(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

const TOKEN_RE = /\{\{([^}]+)\}\}/g;
const SUBTRACTION_RE = /^\s*([\w.]+)\s*-\s*([\w.]+)\s*$/;

function resolveOperand(
  operand: string,
  context: Record<string, number | string>,
): number | null {
  const trimmed = operand.trim();
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    const value = context[trimmed];
    return value === undefined ? null : Number(value);
  }
  return Number(trimmed);
}

export function renderMessage(
  template: string,
  context: Record<string, number | string>,
): string {
  return template.replace(TOKEN_RE, (match, inner: string) => {
    try {
      const parts = inner.split('|');
      const rawExpression = parts[0] ?? '';
      const filter = parts[1]?.trim() ?? '';
      const expression = rawExpression.replace(/−/g, '-');
      let value: number | string;
      const subtraction = SUBTRACTION_RE.exec(expression);

      if (subtraction) {
        const left = resolveOperand(subtraction[1] ?? '', context);
        const right = resolveOperand(subtraction[2] ?? '', context);
        if (left === null || right === null) return '';
        value = left - right;
      } else {
        const trimmed = expression.trim();
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
          value = context[trimmed] ?? '';
        } else {
          value = Number(trimmed);
        }
      }

      return filter === 'money' ? money(Number(value)) : String(value);
    } catch {
      return match;
    }
  });
}

export interface RewardSummaryInput {
  kind: 'percent' | 'fixed' | 'free_shipping' | 'points' | 'credit';
  value?: number;
}

export function rewardSummaryFor(reward: RewardSummaryInput): string {
  switch (reward.kind) {
    case 'percent':
      return `${reward.value ?? 0}% off`;
    case 'fixed':
      return `$${reward.value ?? 0} off`;
    case 'free_shipping':
      return 'Free shipping';
    case 'points':
      return `${reward.value ?? 0}% back as points`;
    case 'credit':
      return `$${reward.value ?? 0} credit`;
  }
}
