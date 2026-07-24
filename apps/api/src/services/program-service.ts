import {
  PromoProgramSchema,
  normalizePromoCode,
  type ApiFieldError,
  type CommerceReward,
  type OperatorProgramView,
  type PromoProgram,
  type ProgramLifecycle,
} from '@incentives/contracts';

import { ContextValidationError, NotFoundError } from '../errors.js';
import {
  ProgramConflictError,
  type Repositories,
} from '../repositories/types.js';
import { validateProgramConditions } from './program-condition-validation.js';
import { effectiveProgramStatus } from './program-runtime.js';
import { BUILTIN_VARIABLE_DEFINITIONS } from './schema-service.js';

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
  async function currentDefinitions(
    merchantId: string,
    status: PromoProgram['status'],
    forcePublished = false,
  ) {
    const current = status === 'draft' && !forcePublished
      ? await repositories.schemas.getLatestVersion(merchantId, 'draft')
        ?? await repositories.schemas.getLatestVersion(merchantId, 'published')
      : await repositories.schemas.getLatestVersion(merchantId, 'published');
    const [records, deprecatedKeys] = await Promise.all([
      current === null
        ? Promise.resolve([])
        : repositories.schemas.listDefinitions(merchantId, current.version),
      repositories.schemas.listDeprecatedKeys(merchantId),
    ]);
    return {
      schema: current,
      definitions: [
        ...BUILTIN_VARIABLE_DEFINITIONS,
        ...records
          .filter(record => !deprecatedKeys.has(record.definition.key))
          .map(record => record.definition),
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
    validateProgramConditions(program, current.definitions);
    return { program, schema: current.schema };
  }

  async function find(merchantId: string, externalRef: string) {
    const record = await repositories.programs.get(merchantId, externalRef);
    if (record === null) {
      throw new NotFoundError('Program not found', 'PROGRAM_NOT_FOUND');
    }
    return record;
  }

  async function active(merchantId: string, externalRef: string) {
    const record = await repositories.programs.getActive(merchantId, externalRef);
    if (record === null) throw new NotFoundError('Program not found', 'PROGRAM_NOT_FOUND');
    return record;
  }

  function lifecycle(record: Awaited<ReturnType<typeof find>>): ProgramLifecycle {
    return {
      programRef: record.externalRef,
      status: record.program.status,
      ...(
        record.activeRevision === undefined
          ? {}
          : { activeRevision: record.activeRevision }
      ),
      ...(
        record.draftRevision === undefined
          ? {}
          : { draftRevision: record.draftRevision }
      ),
      updatedAt: record.updatedAt,
    };
  }

  async function operatorView(
    merchantId: string,
    record: Awaited<ReturnType<typeof find>>,
  ): Promise<OperatorProgramView> {
    const activeRecord = record.activeRevision === undefined
      ? null
      : await repositories.programs.getActive(merchantId, record.externalRef);
    return {
      configuration: record.program,
      lifecycle: {
        programRef: record.externalRef,
        status: activeRecord?.program.status ?? record.program.status,
        ...(record.activeRevision === undefined
          ? {}
          : { activeRevision: record.activeRevision }),
        ...(record.draftRevision === undefined
          ? {}
          : { draftRevision: record.draftRevision }),
        updatedAt: record.updatedAt,
      },
    };
  }

  function effectiveStatus(program: PromoProgram): 'scheduled' | 'active' | 'ended' {
    const today = new Date().toISOString().slice(0, 10);
    if (program.endDate !== undefined && program.endDate < today) return 'ended';
    if (program.startDate !== undefined && program.startDate > today) return 'scheduled';
    return 'active';
  }

  function publicationWarnings(program: PromoProgram) {
    const seen = new Set<string>();
    const warnings: Array<{ code: string; message: string }> = [];
    for (const rule of program.rewardRules) {
      const signature = JSON.stringify(rule.conditions);
      if (seen.has(signature)) {
        warnings.push({
          code: 'OVERLAPPING_REWARD_RULES',
          message: `Reward rule ${rule.id} overlaps an earlier rule and may be unreachable`,
        });
      }
      seen.add(signature);
    }
    return warnings;
  }

  async function validateForPublishedSchema(
    merchantId: string,
    program: PromoProgram,
  ): Promise<void> {
    const current = await currentDefinitions(merchantId, program.status, true);
    if (current.schema === null) {
      throw new ProgramConflictError('A schema must be published before the program');
    }
    validateRewardAndCaps(program);
    validateProgramConditions(program, current.definitions);
  }

  return {
    async create(merchantId: string, input: unknown): Promise<PromoProgram> {
      const validated = await validatedProgram(merchantId, input);
      return (await repositories.programs.create({ merchantId, ...validated })).program;
    },

    async createDraft(merchantId: string, input: unknown): Promise<OperatorProgramView> {
      const validated = await validatedProgram(merchantId, input);
      if (validated.program.status !== 'draft') {
        throw new ProgramConflictError('New operator-authored programs must begin as drafts');
      }
      return operatorView(
        merchantId,
        await repositories.programs.create({ merchantId, ...validated }),
      );
    },

    async getForOperator(merchantId: string, externalRef: string): Promise<OperatorProgramView> {
      return operatorView(merchantId, await find(merchantId, externalRef));
    },

    async listForOperator(merchantId: string): Promise<{ programs: OperatorProgramView[] }> {
      const records = await repositories.programs.list(merchantId);
      return { programs: await Promise.all(records.map(record => operatorView(merchantId, record))) };
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

    async updateDraft(
      merchantId: string,
      externalRef: string,
      input: unknown,
    ): Promise<OperatorProgramView> {
      assertAddressableExternalRef(externalRef);
      const existing = await find(merchantId, externalRef);
      const validated = await validatedProgram(merchantId, input);
      if (validated.program.id !== externalRef) {
        throw new ProgramConflictError('The program external reference is immutable');
      }
      if (validated.program.status !== 'draft') {
        throw new ProgramConflictError('Program revision drafts must have draft status');
      }
      return operatorView(merchantId, await repositories.programs.updateDraft({
        merchantId,
        externalRef,
        ...validated,
        expectedProgram: existing.program,
        expectedUpdatedAt: existing.updatedAt,
      }));
    },

    async publish(merchantId: string, externalRef: string, actorUserId: string) {
      assertAddressableExternalRef(externalRef);
      const draft = await find(merchantId, externalRef);
      if (draft.draftRevision === undefined || draft.program.status !== 'draft') {
        throw new ProgramConflictError('There is no draft revision to publish');
      }
      await validateForPublishedSchema(merchantId, draft.program);
      const now = new Date();
      const publishedAt = now.toISOString();
      const code = draft.program.autoApply
        ? undefined
        : normalizePromoCode(draft.program.code);
      const published = await repositories.programs.publishDraftWithCodeClaim({
        merchantId,
        externalRef,
        expectedDraftRevision: draft.draftRevision,
        publishedAt,
        publishedBy: actorUserId,
        ...(code === undefined
          ? {}
          : {
              codeClaim: {
                merchantId,
                programId: draft.id,
                programRef: externalRef,
                activeRevision: draft.draftRevision,
                displayCode: code.display,
                normalizedCode: code.normalized,
                ...(draft.program.startDate === undefined
                  ? {}
                  : { startsAt: draft.program.startDate }),
                ...(draft.program.endDate === undefined
                  ? {}
                  : { endsAt: draft.program.endDate }),
                claimedAt: publishedAt,
              },
            }),
      });
      return {
        ...lifecycle(published),
        warnings: publicationWarnings(draft.program),
      };
    },

    async pause(merchantId: string, externalRef: string): Promise<ProgramLifecycle> {
      const current = await active(merchantId, externalRef);
      const status = effectiveProgramStatus(current.program, new Date());
      if (status !== 'active' && status !== 'scheduled') {
        throw new ProgramConflictError('Only active or scheduled programs can be paused');
      }
      return repositories.programs.updateLifecycle({
        merchantId,
        externalRef,
        expectedStatus: current.program.status,
        status: 'paused',
        updatedAt: new Date().toISOString(),
      });
    },

    async resume(merchantId: string, externalRef: string): Promise<ProgramLifecycle> {
      const current = await active(merchantId, externalRef);
      if (current.program.status === 'ended') {
        throw new ProgramConflictError('Ended programs cannot be resumed');
      }
      if (current.program.status !== 'paused') {
        throw new ProgramConflictError('Only paused programs can be resumed');
      }
      const status = effectiveStatus(current.program);
      if (status === 'ended') throw new ProgramConflictError('Expired programs cannot be resumed');
      return repositories.programs.updateLifecycle({
        merchantId,
        externalRef,
        expectedStatus: 'paused',
        status,
        updatedAt: new Date().toISOString(),
      });
    },

    async end(merchantId: string, externalRef: string): Promise<ProgramLifecycle> {
      const current = await active(merchantId, externalRef);
      if (current.program.status === 'ended') {
        throw new ProgramConflictError('The program has already ended');
      }
      return repositories.programs.updateLifecycle({
        merchantId,
        externalRef,
        expectedStatus: current.program.status,
        status: 'ended',
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
