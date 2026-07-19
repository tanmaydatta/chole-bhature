import {
  PromoProgramSchema,
  type ApiFieldError,
  type CommerceReward,
  type Condition,
  type ConditionGroup,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { OPERATORS_BY_TYPE } from '@incentives/engine';

import { ContextValidationError, NotFoundError } from '../errors.js';
import {
  ProgramConflictError,
  type Repositories,
} from '../repositories/types.js';
import { BUILTIN_VARIABLE_DEFINITIONS } from './schema-service.js';

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

function validateConditions(
  program: PromoProgram,
  definitions: readonly VariableDefinition[],
): void {
  const definitionsByKey = new Map(definitions.map(definition => [definition.key, definition]));

  for (const { condition, path } of allConditionEntries(program)) {
    const definition = definitionsByKey.get(condition.variable);
    if (definition === undefined) {
      throw new ContextValidationError(
        'The program failed validation',
        [{
          path: `${path}.variable`,
          code: 'undefined_condition_variable',
          message: `Condition variable is not defined: ${condition.variable}`,
        }],
      );
    }
    const allowedOperators: readonly Condition['operator'][] = OPERATORS_BY_TYPE[definition.type];
    if (!allowedOperators.includes(condition.operator)) {
      throw new ContextValidationError(
        'The program failed validation',
        [{
          path: `${path}.operator`,
          code: 'invalid_condition_operator',
          message: `Operator ${condition.operator} is not valid for ${definition.type} variables`,
        }],
      );
    }
    if (!isConditionValueValid(condition, definition)) {
      throw new ContextValidationError(
        'The program failed validation',
        [{
          path: `${path}.value`,
          code: 'invalid_condition_value',
          message: `Condition ${condition.id} has an invalid value for ${definition.type}`,
        }],
      );
    }
  }
}

function selectableRewards(program: PromoProgram): Array<{
  reward: CommerceReward;
  path: string;
}> {
  return [
    ...program.rewardRules.map((rule, index) => ({
      reward: rule.reward,
      path: `rewardRules.${index}.reward`,
    })),
    ...(program.fallbackReward === undefined ? [] : [{
      reward: program.fallbackReward.reward,
      path: 'fallbackReward.reward',
    }]),
  ];
}

function validationError(field: ApiFieldError): ContextValidationError {
  return new ContextValidationError('The program failed validation', [field]);
}

function validateRewardAndCaps(program: PromoProgram): void {
  const rewards = selectableRewards(program);
  const fixedRewards = rewards.filter((entry): entry is typeof entry & {
    reward: Extract<CommerceReward, { calculation: 'fixed' }>;
  } => 'amount' in entry.reward);

  for (const { reward, path } of fixedRewards) {
    if (reward.amount.minorUnits <= 0) {
      throw validationError({
        path: `${path}.amount.minorUnits`,
        code: 'invalid_reward_amount',
        message: 'Fixed discount rewards must be positive',
      });
    }
  }

  const firstCurrency = fixedRewards[0]?.reward.amount.currency;
  const mismatchedCurrency = fixedRewards.find(({ reward }) => (
    firstCurrency !== undefined && reward.amount.currency !== firstCurrency
  ));
  if (mismatchedCurrency !== undefined) {
    throw validationError({
      path: `${mismatchedCurrency.path}.amount.currency`,
      code: 'mixed_reward_currencies',
      message: 'All fixed rewards must use the same currency',
    });
  }

  const freeShipping = rewards.find(({ reward }) => reward.type === 'free_shipping');
  if (freeShipping !== undefined && program.budget !== undefined) {
    throw validationError({
      path: freeShipping.path,
      code: 'free_shipping_budget_conflict',
      message: 'Free-shipping rewards cannot have a monetary budget',
    });
  }
  if (
    firstCurrency !== undefined
    && program.budget !== undefined
    && firstCurrency !== program.budget.currency
  ) {
    throw validationError({
      path: 'budget.currency',
      code: 'reward_budget_currency_mismatch',
      message: 'Reward and budget currencies must match',
    });
  }
  if (
    program.usageCap !== undefined
    && program.perCustomerCap !== undefined
    && program.perCustomerCap > program.usageCap
  ) {
    throw new ContextValidationError('Per-customer cap cannot exceed the total usage cap');
  }
}

function assertAddressableExternalRef(externalRef: string): void {
  if (externalRef === '.' || externalRef === '..') {
    throw new ContextValidationError('Program external reference cannot be . or ..');
  }
}

export function createProgramService(repositories: Repositories) {
  async function currentDefinitions(merchantId: string, status: PromoProgram['status']) {
    const current = status === 'draft'
      ? await repositories.schemas.getLatestVersion(merchantId, 'draft')
        ?? await repositories.schemas.getLatestVersion(merchantId, 'published')
      : await repositories.schemas.getLatestVersion(merchantId, 'published');
    return {
      schema: current,
      definitions: [
        ...BUILTIN_VARIABLE_DEFINITIONS,
        ...(current?.definitions ?? []),
      ],
    };
  }

  async function validatedProgram(
    merchantId: string,
    input: unknown,
  ) {
    const program = PromoProgramSchema.parse(input);
    assertAddressableExternalRef(program.id);
    validateRewardAndCaps(program);
    const current = await currentDefinitions(merchantId, program.status);
    validateConditions(program, current.definitions);
    return { program, schema: current.schema };
  }

  async function find(merchantId: string, externalRef: string) {
    const record = await repositories.programs.get(merchantId, externalRef);
    if (record === null) {
      throw new NotFoundError('Program not found', 'PROGRAM_NOT_FOUND');
    }
    return record;
  }

  return {
    async create(merchantId: string, input: unknown): Promise<PromoProgram> {
      const validated = await validatedProgram(merchantId, input);
      return (await repositories.programs.create({ merchantId, ...validated })).program;
    },

    async get(merchantId: string, externalRef: string): Promise<PromoProgram> {
      return (await find(merchantId, externalRef)).program;
    },

    async list(merchantId: string): Promise<{ programs: PromoProgram[] }> {
      const records = await repositories.programs.list(merchantId);
      return { programs: records.map(record => record.program) };
    },

    async update(
      merchantId: string,
      externalRef: string,
      input: unknown,
    ): Promise<PromoProgram> {
      assertAddressableExternalRef(externalRef);
      const existing = await find(merchantId, externalRef);
      if (existing.program.status !== 'draft') {
        throw new ProgramConflictError('Only draft programs can be edited');
      }

      const validated = await validatedProgram(merchantId, input);
      if (validated.program.id !== externalRef) {
        throw new ProgramConflictError('The program external reference is immutable');
      }

      return (await repositories.programs.updateDraft({
        merchantId,
        externalRef,
        ...validated,
        expectedProgram: existing.program,
        expectedUpdatedAt: existing.updatedAt,
      })).program;
    },
  };
}
