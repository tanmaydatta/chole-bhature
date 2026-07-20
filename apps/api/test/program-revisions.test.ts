import {
  EvaluationResponseSchema,
  ProgramPublicationResultSchema,
  type OperatorCallContext,
  type PermissionKey,
  type ProgramLifecycle,
  type ProgramPublicationResult,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { createExecutionContext, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../src/env.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import { CoreOperatorService } from '../src/worker.js';
import { PUBLISHABLE_TEST_TOKEN, SEEDED_MERCHANT_ID } from './test-credentials.js';

interface ProgramLifecycleOperatorService extends CoreOperatorService {
  createSchemaDefinition(context: OperatorCallContext, input: unknown): Promise<unknown>;
  publishSchema(context: OperatorCallContext): Promise<unknown>;
  createProgramDraft(context: OperatorCallContext, input: unknown): Promise<PromoProgram>;
  updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: unknown,
  ): Promise<PromoProgram>;
  publishProgram(
    context: OperatorCallContext,
    externalRef: string,
  ): Promise<ProgramPublicationResult>;
  pauseProgram(context: OperatorCallContext, externalRef: string): Promise<ProgramLifecycle>;
  resumeProgram(context: OperatorCallContext, externalRef: string): Promise<ProgramLifecycle>;
  endProgram(context: OperatorCallContext, externalRef: string): Promise<ProgramLifecycle>;
  getProgram(context: OperatorCallContext, externalRef: string): Promise<PromoProgram>;
  listPrograms(context: OperatorCallContext): Promise<{ programs: PromoProgram[] }>;
}

const contextChannelDefinition = {
  key: 'context.channel',
  label: 'Sales channel',
  source: 'context',
  type: 'string',
  required: false,
} as const satisfies VariableDefinition;

function operatorContext(permission: PermissionKey): OperatorCallContext {
  return {
    correlationId: `program-revision-${permission}`,
    actorUserId: 'program-operator',
    actorKind: 'member',
    merchantId: SEEDED_MERCHANT_ID,
    permission,
  };
}

function operatorService(): ProgramLifecycleOperatorService {
  return new CoreOperatorService(
    createExecutionContext(),
    env as Env,
  ) as ProgramLifecycleOperatorService;
}

function fixedReward(minorUnits: number) {
  return {
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits },
  } as const;
}

function draftProgram(
  id: string,
  overrides: Partial<PromoProgram> = {},
): PromoProgram {
  return {
    id,
    type: 'promo',
    name: 'Revisioned offer',
    status: 'draft',
    eligibility: {
      match: 'ALL',
      conditions: [{
        id: 'web-channel',
        variable: 'context.channel',
        operator: 'eq',
        value: 'web',
      }],
    },
    rewardRules: [{
      id: 'first-match',
      name: 'First match',
      conditions: {
        match: 'ALL',
        conditions: [{
          id: 'positive-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 0,
        }],
      },
      reward: fixedReward(500),
    }],
    budget: { currency: 'GBP', minorUnits: 10_000 },
    usageCap: 10,
    stackable: false,
    priority: 1,
    autoApply: true,
    ...overrides,
  } as PromoProgram;
}

async function evaluate(programRef: string) {
  const response = await SELF.fetch('https://runtime.test/v1/evaluate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${PUBLISHABLE_TEST_TOKEN}`,
      origin: 'https://shop.example',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      cart: { currency: 'GBP', subtotal: 5_000, items: [] },
      context: { channel: 'web' },
    }),
  });
  expect(response.status).toBe(200);
  const evaluation = EvaluationResponseSchema.parse(await response.json());
  return evaluation.decisions.find(decision => decision.programRef === programRef);
}

async function resetLifecycleData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DROP TRIGGER IF EXISTS fail_program_revision_swap'),
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM program_counters'),
    env.DB.prepare('DELETE FROM program_revisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare('DELETE FROM variable_definitions'),
  ]);
  const service = operatorService();
  await service.createSchemaDefinition(
    operatorContext('schemas:manage'),
    contextChannelDefinition,
  );
  await service.publishSchema(operatorContext('schemas:publish'));
}

describe('immutable Promo revisions and lifecycle', () => {
  beforeEach(resetLifecycleData);
  afterEach(async () => {
    vi.useRealTimers();
    await env.DB.prepare('DROP TRIGGER IF EXISTS fail_program_revision_swap').run();
  });

  test('atomically swaps immutable revisions, preserves counters, and keeps first-match order', async () => {
    const service = operatorService();
    const first = draftProgram('atomic-swap');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      first.id,
    )).resolves.toMatchObject({
      programRef: first.id,
      status: 'active',
      activeRevision: 1,
    });
    await env.DB.prepare(`
      UPDATE programs SET usage_count = 2, budget_remaining = 9_000
      WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).run();

    const replacement = draftProgram(first.id, {
      name: 'Replacement revision',
      budget: { currency: 'GBP', minorUnits: 12_000 },
      usageCap: 12,
      rewardRules: [
        {
          ...first.rewardRules[0]!,
          id: 'replacement-first',
          name: 'Replacement first',
          reward: fixedReward(700),
        },
        {
          ...first.rewardRules[0]!,
          id: 'overlapping-second',
          name: 'Overlapping second',
          reward: fixedReward(900),
        },
      ],
    });
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      replacement,
    );

    await env.DB.prepare(`
      CREATE TRIGGER fail_program_revision_swap
      BEFORE UPDATE OF active_revision ON programs
      WHEN NEW.external_ref = 'atomic-swap' AND NEW.active_revision = 2
      BEGIN
        SELECT RAISE(ABORT, 'forced revision swap failure');
      END
    `).run();
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      first.id,
    )).rejects.toThrow(/forced revision swap failure/u);
    expect(await env.DB.prepare(`
      SELECT active_revision AS activeRevision, draft_revision AS draftRevision
      FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).first()).toEqual({
      activeRevision: 1,
      draftRevision: 2,
    });
    expect(await env.DB.prepare(`
      SELECT published_at AS publishedAt FROM program_revisions
      WHERE merchant_id = ?1 AND revision = 2
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({ publishedAt: null });

    await env.DB.prepare('DROP TRIGGER fail_program_revision_swap').run();
    const publication = ProgramPublicationResultSchema.parse(await service.publishProgram(
      operatorContext('programs:publish'),
      first.id,
    ));
    expect(publication).toMatchObject({
      programRef: first.id,
      status: 'active',
      activeRevision: 2,
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: 'OVERLAPPING_REWARD_RULES' }),
      ]),
    });
    expect(publication).not.toHaveProperty('draftRevision');

    const rows = await env.DB.prepare(`
      SELECT revision, config_json AS configJson, published_at AS publishedAt
      FROM program_revisions WHERE merchant_id = ?1 ORDER BY revision
    `).bind(SEEDED_MERCHANT_ID).all<{
      revision: number;
      configJson: string;
      publishedAt: string | null;
    }>();
    expect(rows.results).toHaveLength(2);
    expect(JSON.parse(rows.results[0]!.configJson)).toEqual(first);
    expect(JSON.parse(rows.results[1]!.configJson)).toEqual(replacement);
    expect(rows.results.every(({ publishedAt }) => publishedAt !== null)).toBe(true);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 2,
      budgetRemaining: 11_000,
    });

    await expect(evaluate(first.id)).resolves.toMatchObject({
      programRevision: 2,
      rewardRuleRef: 'replacement-first',
      effects: [fixedReward(700)],
    });
  });

  test('leaves a draft unpublished when an ordinary counter CAS updates zero rows', async () => {
    const service = operatorService();
    const first = draftProgram('ordinary-cas-miss');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      draftProgram(first.id, { name: 'CAS replacement' }),
    );

    let injectRace = true;
    const racingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            if (injectRace) {
              injectRace = false;
              await target.prepare(`
                UPDATE program_counters SET usage_count = usage_count + 1
                WHERE merchant_id = ?1
              `).bind(SEEDED_MERCHANT_ID).run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const repositories = createRepositories({ DB: racingDb });

    await expect(repositories.programs.publishDraft({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: first.id,
      expectedDraftRevision: 2,
      status: 'active',
      publishedAt: '2026-07-20T12:00:00.000Z',
      publishedBy: 'program-operator',
    })).rejects.toMatchObject({ name: 'ProgramConflictError' });

    expect(await env.DB.prepare(`
      SELECT active_revision AS activeRevision, draft_revision AS draftRevision
      FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).first()).toEqual({
      activeRevision: 1,
      draftRevision: 2,
    });
    expect(await env.DB.prepare(`
      SELECT published_at AS publishedAt, published_by AS publishedBy
      FROM program_revisions WHERE merchant_id = ?1 AND revision = 2
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      publishedAt: null,
      publishedBy: null,
    });
  });

  test('rolls back revision JSON when lifecycle CAS misses during an existing-draft save', async () => {
    const service = operatorService();
    const first = draftProgram('draft-save-lifecycle-cas');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const originalDraft = draftProgram(first.id, { name: 'Original replacement draft' });
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      originalDraft,
    );
    const existing = await createRepositories(env).programs.get(
      SEEDED_MERCHANT_ID,
      first.id,
    );
    expect(existing).not.toBeNull();
    const nextDraft = draftProgram(first.id, { name: 'Racing replacement draft' });

    let injectLifecycleRace = true;
    const racingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            if (injectLifecycleRace) {
              injectLifecycleRace = false;
              await target.prepare(`
                UPDATE programs SET status = 'paused', updated_at = ?1
                WHERE merchant_id = ?2 AND external_ref = ?3
              `).bind(
                '2099-01-01T00:00:00.000Z',
                SEEDED_MERCHANT_ID,
                first.id,
              ).run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const repositories = createRepositories({ DB: racingDb });
    await expect(repositories.programs.updateDraft({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: first.id,
      program: nextDraft,
      expectedProgram: existing!.program,
      expectedUpdatedAt: existing!.updatedAt,
      schema: await repositories.schemas.getLatestVersion(SEEDED_MERCHANT_ID, 'published'),
    })).rejects.toMatchObject({ name: 'ProgramConflictError' });

    const stored = await env.DB.prepare(`
      SELECT logical.status, logical.config_json AS shadowConfigJson,
        revision.config_json AS revisionConfigJson
      FROM programs AS logical
      INNER JOIN program_revisions AS revision
        ON revision.merchant_id = logical.merchant_id
        AND revision.program_id = logical.id
        AND revision.revision = logical.draft_revision
      WHERE logical.merchant_id = ?1 AND logical.external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).first<{
      status: string;
      shadowConfigJson: string;
      revisionConfigJson: string;
    }>();
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe('paused');
    expect(JSON.parse(stored!.shadowConfigJson)).toEqual(originalDraft);
    expect(JSON.parse(stored!.revisionConfigJson)).toEqual(originalDraft);
  });

  test('enforces scheduled start/end boundaries as time advances without weakening pause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const scheduled = draftProgram('scheduled-offer', {
      startDate: '2026-08-02',
      endDate: '2026-08-03',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), scheduled);

    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      scheduled.id,
    )).resolves.toMatchObject({ status: 'scheduled', activeRevision: 1 });
    await expect(evaluate(scheduled.id)).resolves.toMatchObject({
      programRevision: 1,
      outcome: 'unavailable',
      reasonCodes: ['PROGRAM_UNAVAILABLE'],
    });

    const paused = draftProgram('paused-scheduled-offer', {
      startDate: '2026-08-02',
      endDate: '2026-08-03',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), paused);
    await service.publishProgram(operatorContext('programs:publish'), paused.id);
    await expect(service.pauseProgram(
      operatorContext('programs:manage'),
      paused.id,
    )).resolves.toMatchObject({ status: 'paused' });

    vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'));
    await expect(evaluate(scheduled.id)).resolves.toMatchObject({ outcome: 'qualified' });
    await expect(evaluate(paused.id)).resolves.toMatchObject({ outcome: 'unavailable' });

    vi.setSystemTime(new Date('2026-08-03T23:59:59.000Z'));
    await expect(evaluate(scheduled.id)).resolves.toMatchObject({ outcome: 'qualified' });

    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    await expect(evaluate(scheduled.id)).resolves.toMatchObject({ outcome: 'unavailable' });
    await expect(evaluate(paused.id)).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  test('keeps natural end irreversible when a replacement revision is published later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const ending = draftProgram('naturally-ended-offer', { endDate: '2026-08-02' });
    await service.createProgramDraft(operatorContext('programs:manage'), ending);
    await service.publishProgram(operatorContext('programs:publish'), ending.id);
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      ending.id,
      draftProgram(ending.id, {
        name: 'Replacement after natural end',
        endDate: '2026-08-10',
      }),
    );

    vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      ending.id,
    )).resolves.toMatchObject({ status: 'ended', activeRevision: 2 });
    await expect(evaluate(ending.id)).resolves.toMatchObject({ outcome: 'unavailable' });
    await expect(service.resumeProgram(
      operatorContext('programs:manage'),
      ending.id,
    )).rejects.toMatchObject({ name: 'ProgramConflictError' });
  });

  test('rejects pause after the active revision has effectively ended', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const ending = draftProgram('pause-after-natural-end', { endDate: '2026-08-02' });
    await service.createProgramDraft(operatorContext('programs:manage'), ending);
    await service.publishProgram(operatorContext('programs:publish'), ending.id);

    vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
    await expect(service.pauseProgram(
      operatorContext('programs:manage'),
      ending.id,
    )).rejects.toMatchObject({ name: 'ProgramConflictError' });
    await expect(evaluate(ending.id)).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  test('keeps prior natural end irreversible after pause and a longer replacement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const ending = draftProgram('paused-before-natural-end', { endDate: '2026-08-02' });
    await service.createProgramDraft(operatorContext('programs:manage'), ending);
    await service.publishProgram(operatorContext('programs:publish'), ending.id);
    await service.pauseProgram(operatorContext('programs:manage'), ending.id);
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      ending.id,
      draftProgram(ending.id, {
        name: 'Longer replacement after paused expiry',
        endDate: '2026-08-10',
      }),
    );

    vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      ending.id,
    )).resolves.toMatchObject({ status: 'ended', activeRevision: 2 });
    await expect(service.resumeProgram(
      operatorContext('programs:manage'),
      ending.id,
    )).rejects.toMatchObject({ name: 'ProgramConflictError' });
    await expect(evaluate(ending.id)).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  test('pauses and resumes an active Promo, then makes end irreversible', async () => {
    const service = operatorService();
    const active = draftProgram('lifecycle-offer');
    await service.createProgramDraft(operatorContext('programs:manage'), active);
    await service.publishProgram(operatorContext('programs:publish'), active.id);

    await expect(service.pauseProgram(
      operatorContext('programs:manage'),
      active.id,
    )).resolves.toMatchObject({ status: 'paused', activeRevision: 1 });
    await expect(evaluate(active.id)).resolves.toMatchObject({ outcome: 'unavailable' });
    await expect(service.resumeProgram(
      operatorContext('programs:manage'),
      active.id,
    )).resolves.toMatchObject({ status: 'active', activeRevision: 1 });
    await expect(evaluate(active.id)).resolves.toMatchObject({
      outcome: 'qualified',
      programRevision: 1,
    });

    await expect(service.endProgram(
      operatorContext('programs:manage'),
      active.id,
    )).resolves.toMatchObject({ status: 'ended', activeRevision: 1 });
    await expect(service.resumeProgram(
      operatorContext('programs:manage'),
      active.id,
    )).rejects.toMatchObject({ name: 'ProgramConflictError' });
    await expect(service.pauseProgram(
      operatorContext('programs:manage'),
      active.id,
    )).rejects.toMatchObject({ name: 'ProgramConflictError' });
    await expect(evaluate(active.id)).resolves.toMatchObject({ outcome: 'unavailable' });
  });

  test('does not let publishing a replacement silently resume a paused or ended Promo', async () => {
    const service = operatorService();
    for (const state of ['paused', 'ended'] as const) {
      const externalRef = `${state}-replacement`;
      const first = draftProgram(externalRef);
      await service.createProgramDraft(operatorContext('programs:manage'), first);
      await service.publishProgram(operatorContext('programs:publish'), externalRef);
      if (state === 'paused') {
        await service.pauseProgram(operatorContext('programs:manage'), externalRef);
      } else {
        await service.endProgram(operatorContext('programs:manage'), externalRef);
      }
      await service.updateProgramDraft(
        operatorContext('programs:manage'),
        externalRef,
        draftProgram(externalRef, { name: `${state} replacement revision` }),
      );

      await expect(service.publishProgram(
        operatorContext('programs:publish'),
        externalRef,
      )).resolves.toMatchObject({
        status: state,
        activeRevision: 2,
      });
      await expect(evaluate(externalRef)).resolves.toMatchObject({
        programRevision: 2,
        outcome: 'unavailable',
      });
    }
  });

  test('requires publish permission for revision swaps and manage permission for lifecycle changes', async () => {
    const service = operatorService();
    const program = draftProgram('permission-boundary');
    await service.createProgramDraft(operatorContext('programs:manage'), program);

    await expect(service.getProgram(
      operatorContext('programs:read'),
      program.id,
    )).resolves.toEqual(program);
    await expect(service.listPrograms(
      operatorContext('programs:read'),
    )).resolves.toEqual({ programs: [program] });
    await expect(service.getProgram(
      operatorContext('programs:manage'),
      program.id,
    )).rejects.toMatchObject({ name: 'ForbiddenError' });

    await expect(service.publishProgram(
      operatorContext('programs:manage'),
      program.id,
    )).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(service.pauseProgram(
      operatorContext('programs:publish'),
      program.id,
    )).rejects.toMatchObject({ name: 'ForbiddenError' });
  });
});
