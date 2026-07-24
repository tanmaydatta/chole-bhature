import {
  EvaluationResponseSchema,
  OperatorProgramListResponseSchema,
  OperatorProgramViewSchema,
  PromoProgramSchema,
  ProgramPublicationResultSchema,
  normalizePromoCode,
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
import type { Repositories } from '../src/repositories/types.js';
import { createProgramService } from '../src/services/program-service.js';
import { CoreOperatorService } from '../src/worker.js';
import { PUBLISHABLE_TEST_TOKEN, SEEDED_MERCHANT_ID } from './test-credentials.js';

interface ProgramLifecycleOperatorService extends CoreOperatorService {
  createSchemaDefinition(context: OperatorCallContext, input: unknown): Promise<unknown>;
  publishSchema(context: OperatorCallContext): Promise<unknown>;
  createProgramDraft(context: OperatorCallContext, input: unknown): Promise<unknown>;
  updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: unknown,
  ): Promise<unknown>;
  publishProgram(
    context: OperatorCallContext,
    externalRef: string,
  ): Promise<ProgramPublicationResult>;
  pauseProgram(context: OperatorCallContext, externalRef: string): Promise<ProgramLifecycle>;
  resumeProgram(context: OperatorCallContext, externalRef: string): Promise<ProgramLifecycle>;
  endProgram(context: OperatorCallContext, externalRef: string): Promise<ProgramLifecycle>;
  getProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
  listPrograms(context: OperatorCallContext): Promise<unknown>;
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

function codedDraftProgram(
  id: string,
  code: string,
  overrides: Partial<PromoProgram> = {},
): PromoProgram {
  return draftProgram(id, {
    autoApply: false,
    code,
    stackable: false,
    ...overrides,
  } as Partial<PromoProgram>);
}

interface PlanTwoProgramRow {
  id: string;
  merchantId: string;
  externalRef: string;
  type: string;
  name: string;
  status: string;
  configJson: string;
  priority: number;
  maxUses: number | null;
  usageCount: number;
  budgetRemaining: number | null;
  createdAt: string;
  updatedAt: string;
}

async function readWithExactPlanTwoProgramReader(externalRef: string): Promise<PromoProgram> {
  const row = await env.DB.prepare(`
    SELECT id, merchant_id AS merchantId, external_ref AS externalRef,
      type, name, status, config_json AS configJson, priority,
      max_uses AS maxUses, usage_count AS usageCount,
      budget_remaining AS budgetRemaining, created_at AS createdAt,
      updated_at AS updatedAt
    FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
  `).bind(SEEDED_MERCHANT_ID, externalRef).first<PlanTwoProgramRow>();
  if (row === null) throw new Error('Plan 2 reader could not find program');
  const program = PromoProgramSchema.parse(JSON.parse(row.configJson));
  if (!Number.isSafeInteger(row.usageCount) || row.usageCount < 0) {
    throw new Error('Program usage counter is invalid');
  }
  if (
    program.id !== row.externalRef
    || program.type !== row.type
    || program.name !== row.name
    || program.status !== row.status
    || program.priority !== row.priority
  ) {
    throw new Error('Program JSON does not match its relational columns');
  }
  if (
    (program.usageCap === undefined && row.maxUses !== null)
    || (program.usageCap !== undefined && row.maxUses !== program.usageCap)
    || (program.usageCap !== undefined && row.usageCount > program.usageCap)
  ) {
    throw new Error('Program usage cap does not match its relational counter columns');
  }
  if (
    (program.budget === undefined && row.budgetRemaining !== null)
    || (program.budget !== undefined && row.budgetRemaining === null)
    || (
      program.budget !== undefined
      && row.budgetRemaining !== null
      && (
        !Number.isSafeInteger(row.budgetRemaining)
        || row.budgetRemaining < 0
        || row.budgetRemaining > program.budget.minorUnits
      )
    )
  ) {
    throw new Error('Program budget does not match its relational counter columns');
  }
  expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  expect(row.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  return program;
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

  test('accepts and publishes the complete Dashboard example under real Core semantics', async () => {
    const service = operatorService();
    await service.createSchemaDefinition(operatorContext('schemas:manage'), {
      key: 'customer.tier', label: 'Customer tier', source: 'customer', type: 'enum',
      required: false, enumValues: ['gold', 'silver'],
    });
    await service.publishSchema(operatorContext('schemas:publish'));
    const example = draftProgram('dashboard-complete-example', {
      name: 'Dashboard complete example',
      eligibility: { match: 'ALL', conditions: [] },
      rewardRules: [{
        id: 'rule-large-basket', name: 'Large basket',
        conditions: { match: 'ALL', conditions: [{
          id: 'large-basket', variable: 'cart.subtotal', operator: 'gte', value: 10_000,
        }] },
        reward: { type: 'order_discount', calculation: 'percent', basisPoints: 2_000 },
      }, {
        id: 'rule-gold-customer', name: 'Gold customer',
        conditions: { match: 'ANY', conditions: [], groups: [{
          match: 'ALL', conditions: [{
            id: 'gold-tier', variable: 'customer.tier', operator: 'eq', value: 'gold',
          }],
        }] },
        reward: {
          type: 'line_item_discount', productRef: 'product-a', calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 500 },
        },
      }],
      fallbackReward: {
        id: 'fallback-discount', name: 'Fallback discount',
        reward: {
          type: 'order_discount', calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 250 },
        },
      },
      budget: { currency: 'GBP', minorUnits: 50_000 },
      usageCap: 100,
      perCustomerCap: 2,
      priority: 10,
    });

    expect(OperatorProgramViewSchema.parse(await service.createProgramDraft(
      operatorContext('programs:manage'), example,
    ))).toMatchObject({ configuration: example, lifecycle: { draftRevision: 1 } });
    expect(ProgramPublicationResultSchema.parse(await service.publishProgram(
      operatorContext('programs:publish'), example.id,
    ))).toMatchObject({ programRef: example.id, activeRevision: 1, status: 'active' });
  });

  test('rejects the same normalized code across overlapping active intervals', async () => {
    const service = operatorService();
    const first = codedDraftProgram('normalized-code-owner', '  gatec15  ');
    const second = codedDraftProgram('normalized-code-conflict', 'GATEC15');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.createProgramDraft(operatorContext('programs:manage'), second);
    await service.publishProgram(operatorContext('programs:publish'), first.id);

    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      second.id,
    )).rejects.toMatchObject({
      name: 'PromoCodeConflictError',
      conflictingProgramRef: first.id,
    });
    await expect(service.getProgram(
      operatorContext('programs:read'),
      second.id,
    )).resolves.toMatchObject({
      configuration: second,
      lifecycle: { draftRevision: 1 },
    });
    expect(await service.getProgram(
      operatorContext('programs:read'),
      second.id,
    )).not.toHaveProperty('lifecycle.activeRevision');
  });

  test('keeps paused and future scheduled code claims reserved', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const paused = codedDraftProgram('paused-code-owner', 'reserved', {
      startDate: '2026-08-02',
      endDate: '2026-08-10',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), paused);
    await service.publishProgram(operatorContext('programs:publish'), paused.id);
    await service.pauseProgram(operatorContext('programs:manage'), paused.id);

    const overlap = codedDraftProgram('paused-code-conflict', 'RESERVED', {
      startDate: '2026-08-10',
      endDate: '2026-08-12',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), overlap);
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      overlap.id,
    )).rejects.toMatchObject({
      name: 'PromoCodeConflictError',
      conflictingProgramRef: paused.id,
    });

    const claim = await env.DB.prepare(`
      SELECT released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND program_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, paused.id).first<{ releasedAt: string | null }>();
    expect(claim).toEqual({ releasedAt: null });
  });

  test('allows the same code for non-overlapping scheduled intervals', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const first = codedDraftProgram('scheduled-code-first', 'seasonal', {
      startDate: '2026-08-02',
      endDate: '2026-08-10',
    });
    const second = codedDraftProgram('scheduled-code-second', 'SEASONAL', {
      startDate: '2026-08-11',
      endDate: '2026-08-20',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.createProgramDraft(operatorContext('programs:manage'), second);

    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      first.id,
    )).resolves.toMatchObject({ status: 'scheduled' });
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      second.id,
    )).resolves.toMatchObject({ status: 'scheduled' });

    const claims = await env.DB.prepare(`
      SELECT normalized_code AS normalizedCode, released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1
      ORDER BY starts_at
    `).bind(SEEDED_MERCHANT_ID).all<{
      normalizedCode: string;
      releasedAt: string | null;
    }>();
    expect(claims.results).toEqual([
      { normalizedCode: normalizePromoCode(first.code).normalized, releasedAt: null },
      { normalizedCode: normalizePromoCode(second.code).normalized, releasedAt: null },
    ]);
  });

  test('ending releases a code claim while pausing does not', async () => {
    const service = operatorService();
    const first = codedDraftProgram('ended-code-owner', 'reusable');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    await service.pauseProgram(operatorContext('programs:manage'), first.id);

    const blocked = codedDraftProgram('paused-code-blocked', 'REUSABLE');
    await service.createProgramDraft(operatorContext('programs:manage'), blocked);
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      blocked.id,
    )).rejects.toMatchObject({ name: 'PromoCodeConflictError' });

    await service.endProgram(operatorContext('programs:manage'), first.id);
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      blocked.id,
    )).resolves.toMatchObject({ activeRevision: 1 });

    const oldClaim = await env.DB.prepare(`
      SELECT released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND program_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).first<{ releasedAt: string | null }>();
    expect(oldClaim?.releasedAt).not.toBeNull();
  });

  test('automatic publication owns no code claim while coded publication does', async () => {
    const service = operatorService();
    const automatic = draftProgram('automatic-without-claim');
    const coded = codedDraftProgram('coded-with-claim', 'claimed-code');
    await service.createProgramDraft(operatorContext('programs:manage'), automatic);
    await service.createProgramDraft(operatorContext('programs:manage'), coded);
    await service.publishProgram(operatorContext('programs:publish'), automatic.id);
    await service.publishProgram(operatorContext('programs:publish'), coded.id);

    const claims = await env.DB.prepare(`
      SELECT program_ref AS programRef
      FROM promo_code_claims
      WHERE merchant_id = ?1
      ORDER BY program_ref
    `).bind(SEEDED_MERCHANT_ID).all<{ programRef: string }>();
    expect(claims.results).toEqual([{ programRef: coded.id }]);
  });

  test('saves a conflicting draft but refuses to publish it', async () => {
    const service = operatorService();
    const owner = codedDraftProgram('draft-conflict-owner', 'draftable');
    const conflict = codedDraftProgram('draft-conflict-candidate', 'DRAFTABLE');
    await service.createProgramDraft(operatorContext('programs:manage'), owner);
    await service.publishProgram(operatorContext('programs:publish'), owner.id);

    await expect(service.createProgramDraft(
      operatorContext('programs:manage'),
      conflict,
    )).resolves.toMatchObject({ configuration: conflict });
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      conflict.id,
    )).rejects.toMatchObject({
      name: 'PromoCodeConflictError',
      conflictingProgramRef: owner.id,
    });
  });

  test('reports the guarded conflicting owner when that claim is released after the batch', async () => {
    const service = operatorService();
    const owner = codedDraftProgram('released-conflict-owner', 'release-race');
    const conflict = codedDraftProgram('released-conflict-candidate', 'RELEASE-RACE');
    await service.createProgramDraft(operatorContext('programs:manage'), owner);
    await service.publishProgram(operatorContext('programs:publish'), owner.id);
    await service.createProgramDraft(operatorContext('programs:manage'), conflict);

    const stored = await createRepositories(env).programs.get(
      SEEDED_MERCHANT_ID,
      conflict.id,
    );
    expect(stored).not.toBeNull();
    const code = normalizePromoCode(conflict.code);
    let releasedAfterConflict = false;
    async function releaseOwnerClaim() {
      releasedAfterConflict = true;
      await env.DB.prepare(`
        UPDATE promo_code_claims SET released_at = ?1
        WHERE merchant_id = ?2 AND program_ref = ?3 AND released_at IS NULL
      `).bind(
        '2026-07-20T12:00:01.000Z',
        SEEDED_MERCHANT_ID,
        owner.id,
      ).run();
    }
    const racingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            try {
              const results = await target.batch(statements);
              if (results[0]?.meta.changes === 0) await releaseOwnerClaim();
              return results;
            } catch (error) {
              await releaseOwnerClaim();
              throw error;
            }
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const repositories = createRepositories({ DB: racingDb });
    const publishedAt = '2026-07-20T12:00:00.000Z';

    await expect(repositories.programs.publishDraftWithCodeClaim({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: conflict.id,
      expectedDraftRevision: 1,
      publishedAt,
      publishedBy: 'program-operator',
      codeClaim: {
        merchantId: SEEDED_MERCHANT_ID,
        programId: stored!.id,
        programRef: conflict.id,
        activeRevision: 1,
        displayCode: code.display,
        normalizedCode: code.normalized,
        claimedAt: publishedAt,
      },
    })).rejects.toMatchObject({
      name: 'PromoCodeConflictError',
      conflictingProgramRef: owner.id,
    });
    expect(releasedAfterConflict).toBe(true);
  });

  test('serializes concurrent overlapping publications to one winner', async () => {
    const service = operatorService();
    const first = codedDraftProgram('concurrent-code-first', 'race-safe');
    const second = codedDraftProgram('concurrent-code-second', 'RACE-SAFE');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.createProgramDraft(operatorContext('programs:manage'), second);

    const publications = await Promise.allSettled([
      service.publishProgram(operatorContext('programs:publish'), first.id),
      service.publishProgram(operatorContext('programs:publish'), second.id),
    ]);
    expect(publications.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = publications.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ name: 'PromoCodeConflictError' });

    const claims = await env.DB.prepare(`
      SELECT program_ref AS programRef
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND normalized_code = ?2 AND released_at IS NULL
    `).bind(
      SEEDED_MERCHANT_ID,
      normalizePromoCode(first.code).normalized,
    ).all<{ programRef: string }>();
    expect(claims.results).toHaveLength(1);
  });

  test('claims an edited interval before releasing the published revision claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const service = operatorService();
    const edited = codedDraftProgram('edited-code-owner', 'moving-window', {
      startDate: '2026-08-02',
      endDate: '2026-08-10',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), edited);
    await service.publishProgram(operatorContext('programs:publish'), edited.id);

    const blocker = codedDraftProgram('edited-code-blocker', 'MOVING-WINDOW', {
      startDate: '2026-08-11',
      endDate: '2026-08-20',
    });
    await service.createProgramDraft(operatorContext('programs:manage'), blocker);
    await service.publishProgram(operatorContext('programs:publish'), blocker.id);

    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      edited.id,
      codedDraftProgram(edited.id, ' moving-window ', {
        startDate: '2026-08-11',
        endDate: '2026-08-20',
      }),
    );
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      edited.id,
    )).rejects.toMatchObject({
      name: 'PromoCodeConflictError',
      conflictingProgramRef: blocker.id,
    });

    const claims = await env.DB.prepare(`
      SELECT active_revision AS activeRevision, released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND program_ref = ?2
      ORDER BY active_revision
    `).bind(SEEDED_MERCHANT_ID, edited.id).all<{
      activeRevision: number;
      releasedAt: string | null;
    }>();
    expect(claims.results).toEqual([{ activeRevision: 1, releasedAt: null }]);

    await service.endProgram(operatorContext('programs:manage'), blocker.id);
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      edited.id,
    )).resolves.toMatchObject({ activeRevision: 2 });
    const swappedClaims = await env.DB.prepare(`
      SELECT active_revision AS activeRevision, released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND program_ref = ?2
      ORDER BY active_revision
    `).bind(SEEDED_MERCHANT_ID, edited.id).all<{
      activeRevision: number;
      releasedAt: string | null;
    }>();
    expect(swappedClaims.results).toEqual([
      { activeRevision: 1, releasedAt: expect.any(String) as string },
      { activeRevision: 2, releasedAt: null },
    ]);
  });

  test('releases a coded claim only after an automatic replacement is durable', async () => {
    const service = operatorService();
    const coded = codedDraftProgram('automatic-replacement', 'retired-code');
    await service.createProgramDraft(operatorContext('programs:manage'), coded);
    await service.publishProgram(operatorContext('programs:publish'), coded.id);
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      coded.id,
      draftProgram(coded.id, { name: 'Automatic replacement' }),
    );

    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      coded.id,
    )).resolves.toMatchObject({ activeRevision: 2 });
    const claims = await env.DB.prepare(`
      SELECT active_revision AS activeRevision, released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND program_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, coded.id).all<{
      activeRevision: number;
      releasedAt: string | null;
    }>();
    expect(claims.results).toEqual([{
      activeRevision: 1,
      releasedAt: expect.any(String) as string,
    }]);
  });

  test('keeps the legacy programs row readable by the exact Plan-2 reader across new Worker lifecycle writes', async () => {
    const service = operatorService();
    const initial = draftProgram('plan-two-rollback-reader', {
      name: 'Initial draft',
      priority: 10,
      usageCap: 10,
      budget: { currency: 'GBP', minorUnits: 10_000 },
    });
    await service.createProgramDraft(operatorContext('programs:manage'), initial);
    expect(await readWithExactPlanTwoProgramReader(initial.id)).toEqual(initial);

    const editedInitial = draftProgram(initial.id, {
      name: 'Edited before first publication',
      priority: 20,
      usageCap: 20,
      budget: { currency: 'GBP', minorUnits: 20_000 },
    });
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      initial.id,
      editedInitial,
    );
    expect(await readWithExactPlanTwoProgramReader(initial.id)).toEqual(editedInitial);

    await service.publishProgram(operatorContext('programs:publish'), initial.id);
    expect(await readWithExactPlanTwoProgramReader(initial.id)).toEqual({
      ...editedInitial,
      status: 'active',
    });

    const replacement = draftProgram(initial.id, {
      name: 'Replacement draft hidden from rollback Worker',
      priority: 30,
      usageCap: 30,
      budget: { currency: 'GBP', minorUnits: 30_000 },
    });
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      initial.id,
      replacement,
    );
    expect(await readWithExactPlanTwoProgramReader(initial.id)).toEqual({
      ...editedInitial,
      status: 'active',
    });
    await expect(service.getProgram(
      operatorContext('programs:read'),
      initial.id,
    )).resolves.toMatchObject({
      configuration: replacement,
      lifecycle: {
        programRef: initial.id,
        status: 'active',
        activeRevision: 1,
        draftRevision: 2,
      },
    });

    await service.publishProgram(operatorContext('programs:publish'), initial.id);
    expect(await readWithExactPlanTwoProgramReader(initial.id)).toEqual({
      ...replacement,
      status: 'active',
    });

    await service.pauseProgram(operatorContext('programs:manage'), initial.id);
    expect(await readWithExactPlanTwoProgramReader(initial.id)).toEqual({
      ...replacement,
      status: 'paused',
    });
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

    const refreshedDraft = OperatorProgramViewSchema.parse(await service.getProgram(
      operatorContext('programs:read'),
      first.id,
    ));
    expect(refreshedDraft).toEqual({
      configuration: replacement,
      lifecycle: expect.objectContaining({
        programRef: first.id,
        status: 'active',
        activeRevision: 1,
        draftRevision: 2,
      }),
    });
    expect(refreshedDraft).not.toHaveProperty('usageCount');
    expect(OperatorProgramListResponseSchema.parse(await service.listPrograms(
      operatorContext('programs:read'),
    )).programs).toContainEqual(refreshedDraft);

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

    await expect(repositories.programs.publishDraftWithCodeClaim({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: first.id,
      expectedDraftRevision: 2,
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

  test('rolls back a replacement code claim when publication loses its counter CAS', async () => {
    const service = operatorService();
    const first = codedDraftProgram('coded-cas-miss', 'original-code');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const replacement = codedDraftProgram(first.id, 'replacement-code', {
      name: 'Coded CAS replacement',
    });
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      replacement,
    );
    const stored = await createRepositories(env).programs.get(
      SEEDED_MERCHANT_ID,
      first.id,
    );
    expect(stored).not.toBeNull();

    let injectedRace = false;
    const racingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            injectedRace = true;
            await target.prepare(`
              UPDATE program_counters SET usage_count = usage_count + 1
              WHERE merchant_id = ?1 AND program_id = ?2
            `).bind(SEEDED_MERCHANT_ID, stored!.id).run();
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;
    const repositories = createRepositories({ DB: racingDb });
    const code = normalizePromoCode(replacement.code);
    const publishedAt = '2026-07-20T12:00:00.000Z';

    await expect(repositories.programs.publishDraftWithCodeClaim({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: first.id,
      expectedDraftRevision: 2,
      publishedAt,
      publishedBy: 'program-operator',
      codeClaim: {
        merchantId: SEEDED_MERCHANT_ID,
        programId: stored!.id,
        programRef: first.id,
        activeRevision: 2,
        displayCode: code.display,
        normalizedCode: code.normalized,
        claimedAt: publishedAt,
      },
    })).rejects.toMatchObject({ name: 'ProgramConflictError' });
    expect(injectedRace).toBe(true);
    expect(await env.DB.prepare(`
      SELECT active_revision AS activeRevision, normalized_code AS normalizedCode,
        released_at AS releasedAt
      FROM promo_code_claims
      WHERE merchant_id = ?1 AND program_ref = ?2
      ORDER BY active_revision
    `).bind(SEEDED_MERCHANT_ID, first.id).all()).toMatchObject({
      results: [{
        activeRevision: 1,
        normalizedCode: normalizePromoCode(first.code).normalized,
        releasedAt: null,
      }],
    });
    expect(await env.DB.prepare(`
      SELECT active_revision AS activeRevision, draft_revision AS draftRevision
      FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).first()).toEqual({
      activeRevision: 1,
      draftRevision: 2,
    });
    expect(await env.DB.prepare(`
      SELECT published_at AS publishedAt
      FROM program_revisions
      WHERE merchant_id = ?1 AND program_id = ?2 AND revision = 2
    `).bind(SEEDED_MERCHANT_ID, stored!.id).first()).toEqual({
      publishedAt: null,
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
                UPDATE programs SET status = 'paused',
                  config_json = json_set(config_json, '$.status', 'paused'),
                  updated_at = ?1
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
    expect(JSON.parse(stored!.shadowConfigJson)).toEqual({ ...first, status: 'paused' });
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
    await expect(evaluate(scheduled.id)).resolves.toBeUndefined();

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
    await expect(evaluate(paused.id)).resolves.toBeUndefined();

    vi.setSystemTime(new Date('2026-08-03T23:59:59.000Z'));
    await expect(evaluate(scheduled.id)).resolves.toMatchObject({ outcome: 'qualified' });

    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    await expect(evaluate(scheduled.id)).resolves.toBeUndefined();
    await expect(evaluate(paused.id)).resolves.toBeUndefined();
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
    await expect(evaluate(ending.id)).resolves.toBeUndefined();
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
    await expect(evaluate(ending.id)).resolves.toBeUndefined();
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
    await expect(evaluate(ending.id)).resolves.toBeUndefined();
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
    await expect(evaluate(active.id)).resolves.toBeUndefined();
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
    await expect(evaluate(active.id)).resolves.toBeUndefined();
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
      await expect(evaluate(externalRef)).resolves.toBeUndefined();
    }
  });

  test.each([
    { operation: 'pause', status: 'paused' },
    { operation: 'end', status: 'ended' },
  ] as const)(
    'preserves a $operation injected before publication preflight',
    async ({ status }) => {
      const setupService = operatorService();
      const externalRef = `${status}-publication-race`;
      const first = codedDraftProgram(externalRef, `${status}-original-code`);
      await setupService.createProgramDraft(operatorContext('programs:manage'), first);
      await setupService.publishProgram(operatorContext('programs:publish'), externalRef);
      const replacement = codedDraftProgram(externalRef, `${status}-replacement-code`, {
        name: `${status} publication race replacement`,
      });
      await setupService.updateProgramDraft(
        operatorContext('programs:manage'),
        externalRef,
        replacement,
      );

      const baseRepositories = createRepositories(env);
      let injectedLifecycle = false;
      async function injectLifecycle(programRef: string) {
        if (injectedLifecycle) return;
        injectedLifecycle = true;
        await baseRepositories.programs.updateLifecycle({
          merchantId: SEEDED_MERCHANT_ID,
          externalRef: programRef,
          expectedStatus: 'active',
          status,
          updatedAt: new Date().toISOString(),
        });
      }
      const racingRepositories: Repositories = {
        ...baseRepositories,
        programs: {
          ...baseRepositories.programs,
          async getActive(merchantId, programRef) {
            const stale = await baseRepositories.programs.getActive(merchantId, programRef);
            await injectLifecycle(programRef);
            return stale;
          },
          async publishDraftWithCodeClaim(input) {
            await injectLifecycle(input.externalRef);
            return baseRepositories.programs.publishDraftWithCodeClaim(input);
          },
        },
      };
      const service = createProgramService(racingRepositories);

      await expect(service.publish(
        SEEDED_MERCHANT_ID,
        externalRef,
        'program-operator',
      )).resolves.toMatchObject({
        programRef: externalRef,
        status,
        activeRevision: 2,
      });
      expect(injectedLifecycle).toBe(true);
      await expect(baseRepositories.programs.getActive(
        SEEDED_MERCHANT_ID,
        externalRef,
      )).resolves.toMatchObject({
        program: { status },
        activeRevision: 2,
      });

      const claims = await env.DB.prepare(`
        SELECT active_revision AS activeRevision,
          normalized_code AS normalizedCode, released_at AS releasedAt
        FROM promo_code_claims
        WHERE merchant_id = ?1 AND program_ref = ?2
        ORDER BY active_revision
      `).bind(SEEDED_MERCHANT_ID, externalRef).all<{
        activeRevision: number;
        normalizedCode: string;
        releasedAt: string | null;
      }>();
      if (status === 'paused') {
        expect(claims.results).toEqual([
          {
            activeRevision: 1,
            normalizedCode: normalizePromoCode(first.code).normalized,
            releasedAt: expect.any(String) as string,
          },
          {
            activeRevision: 2,
            normalizedCode: normalizePromoCode(replacement.code).normalized,
            releasedAt: null,
          },
        ]);
      } else {
        expect(claims.results).toEqual([{
          activeRevision: 1,
          normalizedCode: normalizePromoCode(first.code).normalized,
          releasedAt: expect.any(String) as string,
        }]);
      }
    },
  );

  test('requires publish permission for revision swaps and manage permission for lifecycle changes', async () => {
    const service = operatorService();
    const program = draftProgram('permission-boundary');
    await expect(service.createProgramDraft(
      operatorContext('programs:manage'),
      program,
    )).resolves.toMatchObject({
      configuration: program,
      lifecycle: { programRef: program.id, status: 'draft', draftRevision: 1 },
    });

    await expect(service.getProgram(
      operatorContext('programs:read'),
      program.id,
    )).resolves.toMatchObject({
      configuration: program,
      lifecycle: { programRef: program.id, status: 'draft', draftRevision: 1 },
    });
    await expect(service.listPrograms(
      operatorContext('programs:read'),
    )).resolves.toMatchObject({ programs: [{
      configuration: program,
      lifecycle: { programRef: program.id, status: 'draft', draftRevision: 1 },
    }] });
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
