import {
  PromoProgramSchema,
  type Condition,
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

function allConditions(program: PromoProgram): Condition[] {
  return [
    ...program.eligibility.conditions,
    ...(program.eligibility.groups ?? []).flatMap(group => group.conditions),
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

  for (const condition of allConditions(program)) {
    const definition = definitionsByKey.get(condition.variable);
    if (definition === undefined) {
      throw new ContextValidationError(
        `Condition variable is not defined: ${condition.variable}`,
      );
    }
    const allowedOperators: readonly Condition['operator'][] = OPERATORS_BY_TYPE[definition.type];
    if (!allowedOperators.includes(condition.operator)) {
      throw new ContextValidationError(
        `Operator ${condition.operator} is not valid for ${definition.type} variables`,
      );
    }
    if (!isConditionValueValid(condition, definition)) {
      throw new ContextValidationError(
        `Condition ${condition.id} has an invalid value for ${definition.type}`,
      );
    }
  }
}

function validateRewardAndCaps(program: PromoProgram): void {
  if ('amount' in program.reward && program.reward.amount.minorUnits <= 0) {
    throw new ContextValidationError('Fixed discount rewards must be positive');
  }
  if (program.reward.type === 'free_shipping' && program.budget !== undefined) {
    throw new ContextValidationError('Free-shipping rewards cannot have a monetary budget');
  }
  if (
    'amount' in program.reward
    && program.budget !== undefined
    && program.reward.amount.currency !== program.budget.currency
  ) {
    throw new ContextValidationError('Reward and budget currencies must match');
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
  async function currentDefinitions(merchantId: string) {
    const current = await repositories.schemas.getLatestVersion(merchantId, 'draft')
      ?? await repositories.schemas.getLatestVersion(merchantId, 'published');
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
    const current = await currentDefinitions(merchantId);
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
