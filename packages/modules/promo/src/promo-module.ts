import type {
  CommerceReward,
  Condition,
  Effect,
  PromoProgram,
  VariableDefinition,
} from '@incentives/contracts';
import {
  SYSTEM_DEFAULT_FAILURE_MESSAGE,
  evaluateConditionGroup,
  resolveFailureMessage,
} from '@incentives/engine';
import type {
  IncentiveModule,
  ModuleDecision,
  ModuleEvaluationContext,
} from '@incentives/module-kit';

function baseDecision(config: PromoProgram): Pick<
  ModuleDecision,
  | 'programRef'
  | 'programRevision'
  | 'programType'
  | 'priority'
  | 'stackable'
  | 'stackingGroup'
> {
  return {
    programRef: config.id,
    programRevision: 1,
    programType: 'promo',
    priority: config.priority,
    stackable: config.stackable,
    ...(config.stackingGroup === undefined
      ? {}
      : { stackingGroup: config.stackingGroup }),
  };
}

function unavailableDecision(config: PromoProgram): ModuleDecision {
  return {
    ...baseDecision(config),
    outcome: 'unavailable',
    effects: [],
    reasonCodes: ['PROGRAM_UNAVAILABLE'],
    commitRequired: false,
    eligible: false,
  };
}

function currentUtcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function isAvailable(context: ModuleEvaluationContext, config: PromoProgram): boolean {
  if (config.status !== 'active') return false;

  const today = currentUtcDate(context.now);
  if (config.startDate !== undefined && today < config.startDate) return false;
  if (config.endDate !== undefined && today > config.endDate) return false;
  return true;
}

function allConditions(config: PromoProgram): Condition[] {
  return [
    ...config.eligibility.conditions,
    ...(config.eligibility.groups ?? []).flatMap((group) => group.conditions),
  ];
}

function resolvedFirstFailureMessage(
  config: PromoProgram,
  definitions: readonly VariableDefinition[],
  conditionId: string | undefined,
): string {
  const condition = allConditions(config).find(({ id }) => id === conditionId);
  if (!condition) return SYSTEM_DEFAULT_FAILURE_MESSAGE;

  const definition = definitions.find(({ key }) => key === condition.variable);
  if (!definition) {
    return condition.message?.trim() || SYSTEM_DEFAULT_FAILURE_MESSAGE;
  }

  return resolveFailureMessage(condition, definition);
}

function copyReward(reward: CommerceReward): Effect {
  if ('amount' in reward) {
    return { ...reward, amount: { ...reward.amount } };
  }
  return { ...reward };
}

function selectReward(
  context: ModuleEvaluationContext,
  config: PromoProgram,
): { rewardRuleRef: string; reward: CommerceReward } | null {
  for (const rule of config.rewardRules) {
    if (evaluateConditionGroup(rule.conditions, context.definitions, context.facts).passed) {
      return { rewardRuleRef: rule.id, reward: rule.reward };
    }
  }
  return config.fallbackReward === undefined
    ? null
    : {
      rewardRuleRef: config.fallbackReward.id,
      reward: config.fallbackReward.reward,
    };
}

export const PromoModule: IncentiveModule<PromoProgram> = {
  type: 'promo',

  async evaluate(context, config) {
    if (!isAvailable(context, config)) return [unavailableDecision(config)];

    if (
      !config.autoApply
      && (config.code === undefined || context.request.code !== config.code)
    ) {
      return [{
        ...baseDecision(config),
        outcome: 'invalid_code',
        effects: [],
        reasonCodes: ['INVALID_PROMO_CODE'],
        commitRequired: false,
        eligible: false,
      }];
    }

    const evaluation = evaluateConditionGroup(
      config.eligibility,
      context.definitions,
      context.facts,
    );
    if (!evaluation.passed) {
      return [{
        ...baseDecision(config),
        outcome: 'not_qualified',
        effects: [],
        reasonCodes: [evaluation.firstFailure?.reasonCode ?? 'CONDITION_NOT_MET'],
        message: resolvedFirstFailureMessage(
          config,
          context.definitions,
          evaluation.firstFailure?.conditionId,
        ),
        commitRequired: false,
        eligible: false,
      }];
    }

    const selected = selectReward(context, config);
    if (selected === null) {
      return [{
        ...baseDecision(config),
        outcome: 'not_qualified',
        effects: [],
        reasonCodes: ['NO_REWARD_RULE_MATCHED'],
        commitRequired: false,
        eligible: false,
      }];
    }

    return [{
      ...baseDecision(config),
      outcome: 'qualified',
      rewardRuleRef: selected.rewardRuleRef,
      effects: [copyReward(selected.reward)],
      reasonCodes: [],
      commitRequired: true,
      eligible: true,
    }];
  },
};
