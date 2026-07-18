import {
  EffectSchema,
  IncentiveDecisionSchema,
} from '@incentives/contracts';

import type {
  IncentiveModule,
  ModuleDecision,
  ModuleEvaluationContext,
} from './module.js';

export interface ModuleConformanceFixture<TConfig> {
  context: ModuleEvaluationContext;
  config: TConfig;
}

export interface ModuleConformanceResult {
  passed: true;
}

const REASON_CODE = /^[A-Z][A-Z0-9_]*$/;

function canonicalize(value: unknown): unknown {
  if (value === undefined) return { $type: 'undefined' };
  if (value instanceof Date) return { $type: 'date', value: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function snapshot(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertFixtureUnchanged<TConfig>(
  fixture: ModuleConformanceFixture<TConfig>,
  before: { request: string; facts: string; config: string },
): void {
  if (snapshot(fixture.context.request) !== before.request) {
    throw new Error('Module must not mutate the request fixture');
  }
  if (snapshot(fixture.context.facts) !== before.facts) {
    throw new Error('Module must not mutate the facts fixture');
  }
  if (snapshot(fixture.config) !== before.config) {
    throw new Error('Module must not mutate the config fixture');
  }
}

function assertDecisionConforms(
  moduleType: IncentiveModule<unknown>['type'],
  decision: ModuleDecision,
): void {
  if (decision.programType !== moduleType) {
    throw new Error(
      `Decision program type ${decision.programType} does not match module type ${moduleType}`,
    );
  }

  for (const [index, effect] of decision.effects.entries()) {
    if (!EffectSchema.safeParse(effect).success) {
      throw new Error(`Decision effect at index ${index} is not canonical`);
    }
  }

  if (decision.reasonCodes.some((code) => !REASON_CODE.test(code))) {
    throw new Error('Every reason code must use stable non-empty uppercase snake case');
  }

  if (
    decision.eligible !== undefined
    && decision.eligible !== (decision.outcome === 'qualified')
  ) {
    throw new Error('Decision eligible value must match its authoritative outcome');
  }

  if (!Number.isInteger(decision.priority)) {
    throw new Error('Decision priority must be an integer');
  }
  if (typeof decision.stackable !== 'boolean') {
    throw new Error('Decision stackable metadata must be a boolean');
  }
  if (decision.stackingGroup !== undefined && decision.stackingGroup.length === 0) {
    throw new Error('Decision stacking group must not be empty');
  }

  const {
    priority: _priority,
    stackable: _stackable,
    stackingGroup: _stackingGroup,
    ...canonicalDecision
  } = decision;
  const parsed = IncentiveDecisionSchema.safeParse(canonicalDecision);
  if (!parsed.success) {
    throw new Error(`Decision does not satisfy the canonical schema: ${parsed.error.message}`);
  }
}

export async function runModuleConformanceSuite<TConfig>(
  module: IncentiveModule<TConfig>,
  fixture: ModuleConformanceFixture<TConfig>,
): Promise<ModuleConformanceResult> {
  const before = {
    request: snapshot(fixture.context.request),
    facts: snapshot(fixture.context.facts),
    config: snapshot(fixture.config),
  };

  const first = await module.evaluate(fixture.context, fixture.config);
  assertFixtureUnchanged(fixture, before);
  first.forEach((decision) => assertDecisionConforms(module.type, decision));

  const second = await module.evaluate(fixture.context, fixture.config);
  assertFixtureUnchanged(fixture, before);
  second.forEach((decision) => assertDecisionConforms(module.type, decision));

  if (snapshot(first) !== snapshot(second)) {
    throw new Error('Module output must be deterministic for identical input');
  }

  return { passed: true };
}
