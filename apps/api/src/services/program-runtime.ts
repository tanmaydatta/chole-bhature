import type { PromoProgram, ProgramStatus } from '@incentives/contracts';

export function effectiveProgramStatus(
  program: PromoProgram,
  now: Date,
): ProgramStatus {
  if (program.status === 'draft' || program.status === 'paused' || program.status === 'ended') {
    return program.status;
  }
  const today = now.toISOString().slice(0, 10);
  if (program.endDate !== undefined && program.endDate < today) return 'ended';
  if (program.startDate !== undefined && program.startDate > today) return 'scheduled';
  return 'active';
}

export function effectiveProgram(program: PromoProgram, now: Date): PromoProgram {
  return { ...program, status: effectiveProgramStatus(program, now) };
}

export function programCurrency(program: PromoProgram): string | undefined {
  if (program.budget !== undefined) return program.budget.currency;
  const rewards = [
    ...program.rewardRules.map(rule => rule.reward),
    ...(program.fallbackReward === undefined ? [] : [program.fallbackReward.reward]),
  ];
  return rewards.find(reward => 'amount' in reward)?.amount.currency;
}
