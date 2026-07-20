import {
  ApiErrorSchema,
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  buildOpenApiDocument,
  type OperatorCallContext,
  type PermissionKey,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { createExecutionContext, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Env } from '../src/env.js';
import { CoreOperatorService } from '../src/worker.js';
import { operatorAuthoringRequest } from './operator-authoring-app.js';
import { SEEDED_MERCHANT_ID } from './test-credentials.js';

interface LifecycleOperatorService extends CoreOperatorService {
  createSchemaDefinition(context: OperatorCallContext, input: unknown): Promise<unknown>;
  publishSchema(context: OperatorCallContext): Promise<unknown>;
  createProgramDraft(context: OperatorCallContext, input: unknown): Promise<PromoProgram>;
  updateProgramDraft(
    context: OperatorCallContext,
    externalRef: string,
    input: unknown,
  ): Promise<PromoProgram>;
  publishProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
}

const secretHeaders = {
  authorization: 'Bearer sk_test_secret_credential_material_000000000001',
  'content-type': 'application/json',
};

const customerTierDefinition = {
  key: 'customer.tier',
  label: 'Customer tier',
  source: 'customer',
  type: 'enum',
  required: true,
  enumValues: ['gold', 'silver'],
} as const satisfies VariableDefinition;

const contextChannelDefinition = {
  key: 'context.channel',
  label: 'Sales channel',
  source: 'context',
  type: 'enum',
  required: true,
  enumValues: ['web', 'mobile'],
} as const satisfies VariableDefinition;

const underHundredReward = {
  type: 'order_discount',
  calculation: 'fixed',
  amount: { currency: 'GBP', minorUnits: 1_000 },
} as const;

const overHundredReward = {
  type: 'order_discount',
  calculation: 'fixed',
  amount: { currency: 'GBP', minorUnits: 2_000 },
} as const;

const tieredGoldWebPromo = {
  id: 'gold-web-tiered',
  type: 'promo',
  name: 'Gold web tiered offer',
  status: 'active',
  eligibility: {
    match: 'ALL',
    conditions: [
      {
        id: 'gold-tier',
        variable: 'customer.tier',
        operator: 'eq',
        value: 'gold',
      },
      {
        id: 'web-channel',
        variable: 'context.channel',
        operator: 'eq',
        value: 'web',
      },
    ],
  },
  rewardRules: [
    {
      id: 'over-100',
      name: 'Twenty pounds off orders of one hundred pounds or more',
      conditions: {
        match: 'ALL',
        conditions: [{
          id: 'cart-at-least-100',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 10_000,
        }],
      },
      reward: overHundredReward,
    },
    {
      id: 'under-100',
      name: 'Ten pounds off orders below one hundred pounds',
      conditions: {
        match: 'ALL',
        conditions: [{
          id: 'cart-under-100',
          variable: 'cart.subtotal',
          operator: 'lt',
          value: 10_000,
        }],
      },
      reward: underHundredReward,
    },
  ],
  fallbackReward: {
    id: 'tiered-fallback',
    name: 'Fallback five pounds off',
    reward: {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    },
  },
  budget: { currency: 'GBP', minorUnits: 2_000 },
  usageCap: 1,
  perCustomerCap: 1,
  stackable: false,
  priority: 10,
  autoApply: true,
} as const satisfies PromoProgram;

const noFallbackPromo = {
  ...tieredGoldWebPromo,
  id: 'gold-web-no-fallback',
  name: 'Gold web high-cart offer without fallback',
  rewardRules: [{
    id: 'over-200',
    name: 'Twenty pounds off orders of two hundred pounds or more',
    conditions: {
      match: 'ALL',
      conditions: [{
        id: 'cart-at-least-200',
        variable: 'cart.subtotal',
        operator: 'gte',
        value: 20_000,
      }],
    },
    reward: overHundredReward,
  }],
  fallbackReward: undefined,
  budget: undefined,
  usageCap: undefined,
  perCustomerCap: undefined,
  stackable: true,
  priority: 5,
} as const satisfies PromoProgram;

function lifecyclePromo(
  id: string,
  overrides: Partial<PromoProgram> = {},
): PromoProgram {
  return {
    id,
    type: 'promo',
    name: 'Lifecycle review offer',
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
      id: 'stable-rule',
      name: 'Stable rule',
      conditions: {
        match: 'ALL',
        conditions: [{
          id: 'positive-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 0,
        }],
      },
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 500 },
      },
    }],
    budget: { currency: 'GBP', minorUnits: 1_000 },
    usageCap: 10,
    stackable: false,
    priority: 1,
    autoApply: true,
    ...overrides,
  } as PromoProgram;
}

async function resetData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM variable_definitions'),
    env.DB.prepare('DELETE FROM schema_versions'),
  ]);
}

function operatorContext(permission: PermissionKey): OperatorCallContext {
  return {
    correlationId: `full-flow-${permission}`,
    actorUserId: 'full-flow-operator',
    actorKind: 'member',
    merchantId: SEEDED_MERCHANT_ID,
    permission,
  };
}

function lifecycleOperatorService(): LifecycleOperatorService {
  return new CoreOperatorService(
    createExecutionContext(),
    env as Env,
  ) as LifecycleOperatorService;
}

async function jsonRequest(
  method: string,
  path: string,
  body: unknown,
  token = 'sk_test_secret_credential_material_000000000001',
): Promise<Response> {
  const request = new Request(`https://example.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return path.startsWith('/v1/schema/definitions') || path.startsWith('/v1/programs')
    ? operatorAuthoringRequest(request, env)
    : SELF.fetch(request);
}

describe('integration-ready runtime', () => {
  beforeEach(resetData);
  afterEach(() => vi.useRealTimers());

  test('redeems a signed old revision after atomic replacement and keeps logical counters', async () => {
    const service = lifecycleOperatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    expect((await jsonRequest('PATCH', '/v1/customers/revision-customer', {
      attributes: {},
    })).status).toBe(200);

    const firstRevision = {
      id: 'revision-redemption',
      type: 'promo',
      name: 'Revision redemption offer',
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
        id: 'stable-rule',
        name: 'Stable reward identity',
        conditions: {
          match: 'ALL',
          conditions: [{
            id: 'positive-cart',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 0,
          }],
        },
        reward: {
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 500 },
        },
      }],
      budget: { currency: 'GBP', minorUnits: 1_000 },
      usageCap: 1,
      perCustomerCap: 1,
      stackable: false,
      priority: 20,
      autoApply: true,
    } as const satisfies PromoProgram;
    await service.createProgramDraft(operatorContext('programs:manage'), firstRevision);
    await service.publishProgram(operatorContext('programs:publish'), firstRevision.id);

    const oldEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'revision-customer',
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    expect(oldEvaluationResponse.status).toBe(200);
    const oldEvaluation = EvaluationResponseSchema.parse(await oldEvaluationResponse.json());
    expect(oldEvaluation.decisions).toContainEqual(expect.objectContaining({
      programRef: firstRevision.id,
      programRevision: 1,
      rewardRuleRef: 'stable-rule',
      effects: [firstRevision.rewardRules[0].reward],
      outcome: 'qualified',
    }));
    const secondOldEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'revision-customer',
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const secondOldEvaluation = EvaluationResponseSchema.parse(
      await secondOldEvaluationResponse.json(),
    );

    const firstRedemption = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: oldEvaluation.evaluationId,
      programRef: firstRevision.id,
      externalOrderRef: 'first-old-revision-order',
      idempotencyKey: 'first-old-revision-attempt',
    });
    expect(firstRedemption.status).toBe(200);

    const secondRevision = {
      ...firstRevision,
      name: 'Replacement reward revision',
      budget: { currency: 'GBP', minorUnits: 2_500 },
      usageCap: 3,
      perCustomerCap: 3,
      rewardRules: [{
        ...firstRevision.rewardRules[0],
        reward: {
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 700 },
        },
      }],
    } as const satisfies PromoProgram;
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      firstRevision.id,
      secondRevision,
    );
    await service.publishProgram(operatorContext('programs:publish'), firstRevision.id);

    const redemptionResponse = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: secondOldEvaluation.evaluationId,
      programRef: firstRevision.id,
      externalOrderRef: 'old-revision-order',
      idempotencyKey: 'old-revision-attempt',
    });
    expect(redemptionResponse.status).toBe(200);
    expect(RedemptionResponseSchema.parse(await redemptionResponse.json())).toMatchObject({
      programRef: firstRevision.id,
      rewardRuleRef: 'stable-rule',
      effects: [firstRevision.rewardRules[0].reward],
      status: 'committed',
    });
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 2,
      budgetRemaining: 1_500,
    });

    const currentEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'revision-customer',
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    expect(currentEvaluationResponse.status).toBe(200);
    const currentEvaluation = EvaluationResponseSchema.parse(
      await currentEvaluationResponse.json(),
    );
    expect(currentEvaluation.decisions).toContainEqual(expect.objectContaining({
      programRef: firstRevision.id,
      programRevision: 2,
      rewardRuleRef: 'stable-rule',
      effects: [secondRevision.rewardRules[0].reward],
      outcome: 'qualified',
    }));
    const snapshot = await env.DB.prepare(`
      SELECT facts_json AS factsJson FROM evaluation_decisions WHERE id = ?1
    `).bind(currentEvaluation.evaluationId).first<{ factsJson: string }>();
    expect(JSON.parse(snapshot!.factsJson).programs).toContainEqual(expect.objectContaining({
      programRef: firstRevision.id,
      system: expect.objectContaining({
        redemptions_total: 2,
        customer_uses_count: 2,
        budget_remaining: 1_500,
      }),
    }));
  });

  test('rejects an old-currency decision after a zero-spend logical currency change', async () => {
    const service = lifecycleOperatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    const first = lifecyclePromo('currency-replacement');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const evaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const evaluation = EvaluationResponseSchema.parse(await evaluationResponse.json());

    const usd = lifecyclePromo(first.id, {
      rewardRules: [{
        ...first.rewardRules[0]!,
        reward: {
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'USD', minorUnits: 500 },
        },
      }],
      budget: { currency: 'USD', minorUnits: 1_000 },
    });
    await service.updateProgramDraft(operatorContext('programs:manage'), first.id, usd);
    await service.publishProgram(operatorContext('programs:publish'), first.id);

    const redemption = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: evaluation.evaluationId,
      programRef: first.id,
      externalOrderRef: 'currency-order',
      idempotencyKey: 'currency-attempt',
    });
    expect(redemption.status).toBe(409);
    expect(ApiErrorSchema.parse(await redemption.json()).error.code).toBe('VERSION_CONFLICT');
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 0,
      budgetRemaining: 1_000,
    });
  });

  test('preserves committed spend when a budget is removed and later reintroduced', async () => {
    const service = lifecycleOperatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    const first = lifecyclePromo('budget-reintroduced');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const evaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const evaluation = EvaluationResponseSchema.parse(await evaluationResponse.json());
    expect((await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: evaluation.evaluationId,
      programRef: first.id,
      externalOrderRef: 'budget-order',
      idempotencyKey: 'budget-attempt',
    })).status).toBe(200);

    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      lifecyclePromo(first.id, { budget: undefined }),
    );
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      lifecyclePromo(first.id, { budget: { currency: 'GBP', minorUnits: 1_200 } }),
    );
    await service.publishProgram(operatorContext('programs:publish'), first.id);

    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 1,
      budgetRemaining: 700,
    });
  });

  test('does not count a valid lower replacement budget as newly committed spend', async () => {
    const service = lifecycleOperatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    const first = lifecyclePromo('lower-budget-replacement');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const firstEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const firstEvaluation = EvaluationResponseSchema.parse(
      await firstEvaluationResponse.json(),
    );
    expect((await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: firstEvaluation.evaluationId,
      programRef: first.id,
      externalOrderRef: 'lower-budget-first-order',
      idempotencyKey: 'lower-budget-first-attempt',
    })).status).toBe(200);

    const replacement = lifecyclePromo(first.id, {
      budget: { currency: 'GBP', minorUnits: 800 },
      rewardRules: [{
        ...first.rewardRules[0]!,
        reward: {
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 100 },
        },
      }],
    });
    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      replacement,
    );
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining,
        committed_spend AS committedSpend
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 1,
      budgetRemaining: 300,
      committedSpend: 500,
    });

    const nextEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const nextEvaluation = EvaluationResponseSchema.parse(await nextEvaluationResponse.json());
    expect((await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: nextEvaluation.evaluationId,
      programRef: first.id,
      externalOrderRef: 'lower-budget-second-order',
      idempotencyKey: 'lower-budget-second-attempt',
    })).status).toBe(200);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining,
        committed_spend AS committedSpend
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 2,
      budgetRemaining: 200,
      committedSpend: 600,
    });
  });

  test.each([
    ['higher', 2_000],
    ['lower', 600],
  ] as const)(
    'redeems against the active budget while an unpublished %s-budget draft exists',
    async (label, draftBudget) => {
      const service = lifecycleOperatorService();
      await service.createSchemaDefinition(
        operatorContext('schemas:manage'),
        contextChannelDefinition,
      );
      await service.publishSchema(operatorContext('schemas:publish'));
      const first = lifecyclePromo(`active-budget-${label}-draft`);
      await service.createProgramDraft(operatorContext('programs:manage'), first);
      await service.publishProgram(operatorContext('programs:publish'), first.id);
      await service.updateProgramDraft(
        operatorContext('programs:manage'),
        first.id,
        lifecyclePromo(first.id, {
          name: `${label} budget replacement`,
          budget: { currency: 'GBP', minorUnits: draftBudget },
        }),
      );

      const evaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
        cart: { currency: 'GBP', subtotal: 4_000, items: [] },
        context: { channel: 'web' },
      }, 'pk_test_publishable_credential_material_00000001');
      const evaluation = EvaluationResponseSchema.parse(await evaluationResponse.json());
      expect((await jsonRequest('POST', '/v1/redemptions', {
        evaluationId: evaluation.evaluationId,
        programRef: first.id,
        externalOrderRef: `active-budget-${label}-order`,
        idempotencyKey: `active-budget-${label}-attempt`,
      })).status).toBe(200);

      expect(await env.DB.prepare(`
        SELECT counter.usage_count AS usageCount,
          counter.budget_remaining AS budgetRemaining,
          counter.committed_spend AS committedSpend,
          logical.active_revision AS activeRevision,
          logical.draft_revision AS draftRevision
        FROM program_counters AS counter
        INNER JOIN programs AS logical
          ON logical.merchant_id = counter.merchant_id
          AND logical.id = counter.program_id
        WHERE logical.merchant_id = ?1 AND logical.external_ref = ?2
      `).bind(SEEDED_MERCHANT_ID, first.id).first()).toEqual({
        usageCount: 1,
        budgetRemaining: 500,
        committedSpend: 500,
        activeRevision: 1,
        draftRevision: 2,
      });
    },
  );

  test('reconciles rolled-back Worker spend committed during an unlimited revision', async () => {
    const service = lifecycleOperatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    const first = lifecyclePromo('rollback-unlimited-spend');
    await service.createProgramDraft(operatorContext('programs:manage'), first);
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const firstEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const firstEvaluation = EvaluationResponseSchema.parse(
      await firstEvaluationResponse.json(),
    );
    expect((await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: firstEvaluation.evaluationId,
      programRef: first.id,
      externalOrderRef: 'rollback-unlimited-first-order',
      idempotencyKey: 'rollback-unlimited-first-attempt',
    })).status).toBe(200);

    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      lifecyclePromo(first.id, { budget: undefined }),
    );
    await service.publishProgram(operatorContext('programs:publish'), first.id);
    const rollbackEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const rollbackEvaluation = EvaluationResponseSchema.parse(
      await rollbackEvaluationResponse.json(),
    );

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE program_counters SET usage_count = usage_count + 1
        WHERE merchant_id = ?1
      `).bind(SEEDED_MERCHANT_ID),
      env.DB.prepare(`
        UPDATE programs SET usage_count = usage_count + 1
        WHERE merchant_id = ?1 AND external_ref = ?2
      `).bind(SEEDED_MERCHANT_ID, first.id),
      env.DB.prepare(`
        INSERT INTO redemptions (
          id, merchant_id, external_order_ref, evaluation_id, result_json,
          discount_minor_units, currency, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 500, 'GBP', ?6)
      `).bind(
        crypto.randomUUID(),
        SEEDED_MERCHANT_ID,
        'rollback-unlimited-order',
        rollbackEvaluation.evaluationId,
        JSON.stringify({ result: { programRef: first.id } }),
        new Date().toISOString(),
      ),
    ]);

    await service.updateProgramDraft(
      operatorContext('programs:manage'),
      first.id,
      lifecyclePromo(first.id, { budget: { currency: 'GBP', minorUnits: 2_000 } }),
    );
    const logical = await env.DB.prepare(`
      SELECT id, draft_revision AS draftRevision FROM programs
      WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, first.id).first<{
      id: string;
      draftRevision: number;
    }>();
    expect(logical).not.toBeNull();
    const rollbackPublishedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE program_revisions SET published_at = ?1, published_by = 'rollback-operator'
        WHERE merchant_id = ?2 AND program_id = ?3 AND revision = ?4
      `).bind(
        rollbackPublishedAt,
        SEEDED_MERCHANT_ID,
        logical!.id,
        logical!.draftRevision,
      ),
      env.DB.prepare(`
        UPDATE program_counters SET max_uses = 10, budget_remaining = 2_000
        WHERE merchant_id = ?1 AND program_id = ?2
      `).bind(SEEDED_MERCHANT_ID, logical!.id),
      env.DB.prepare(`
        UPDATE programs SET active_revision = draft_revision, draft_revision = NULL,
          status = 'active', max_uses = 10, budget_remaining = 2_000,
          updated_at = ?1
        WHERE merchant_id = ?2 AND id = ?3
      `).bind(rollbackPublishedAt, SEEDED_MERCHANT_ID, logical!.id),
    ]);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining,
        committed_spend AS committedSpend
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 2,
      budgetRemaining: 1_000,
      committedSpend: 1_000,
    });

    const rollForwardEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const rollForwardEvaluation = EvaluationResponseSchema.parse(
      await rollForwardEvaluationResponse.json(),
    );
    expect((await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: rollForwardEvaluation.evaluationId,
      programRef: first.id,
      externalOrderRef: 'roll-forward-order',
      idempotencyKey: 'roll-forward-attempt',
    })).status).toBe(200);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining,
        committed_spend AS committedSpend
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 3,
      budgetRemaining: 500,
      committedSpend: 1_500,
    });
  });

  test('rejects redemption after the active revision effective end boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T23:58:00.000Z'));
    const service = lifecycleOperatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    const ending = lifecyclePromo('ending-offer', { endDate: '2026-08-03' });
    await service.createProgramDraft(operatorContext('programs:manage'), ending);
    await service.publishProgram(operatorContext('programs:publish'), ending.id);
    vi.setSystemTime(new Date('2026-08-03T23:59:00.000Z'));
    const evaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      cart: { currency: 'GBP', subtotal: 4_000, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    const evaluation = EvaluationResponseSchema.parse(await evaluationResponse.json());
    expect(evaluation.decisions).toContainEqual(expect.objectContaining({
      programRef: ending.id,
      outcome: 'qualified',
    }));

    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    const redemption = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: evaluation.evaluationId,
      programRef: ending.id,
      externalOrderRef: 'ended-order',
      idempotencyKey: 'ended-attempt',
    });
    expect(redemption.status).toBe(409);
    expect(ApiErrorSchema.parse(await redemption.json()).error.code).toBe('EXHAUSTED');
  });

  test('proves tiered rewards, selected-rule integrity, and program-wide exhaustion', async () => {
    for (const definition of [customerTierDefinition, contextChannelDefinition]) {
      const response = await jsonRequest('POST', '/v1/schema/definitions', definition);
      expect(response.status).toBe(201);
    }

    const publication = await operatorAuthoringRequest(new Request(
      'https://operator.test/v1/schema/publish', {
      method: 'POST',
      headers: secretHeaders,
    }), env);
    expect(publication.status).toBe(201);
    expect(await publication.json()).toMatchObject({
      version: 1,
      definitions: expect.arrayContaining([
        customerTierDefinition,
        contextChannelDefinition,
      ]),
    });

    const customer = await jsonRequest('PATCH', '/v1/customers/customer-1', {
      attributes: { tier: 'gold' },
    });
    expect(customer.status).toBe(200);
    expect(await customer.json()).toMatchObject({
      externalRef: 'customer-1',
      attributes: { tier: 'gold' },
      version: 1,
    });

    for (const promo of [tieredGoldWebPromo, noFallbackPromo]) {
      const program = await jsonRequest('POST', '/v1/programs', promo);
      expect(program.status).toBe(201);
    }

    const lowerEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'customer-1',
      cart: { currency: 'GBP', subtotal: 6_500, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    expect(lowerEvaluationResponse.status).toBe(200);
    const lowerEvaluation = EvaluationResponseSchema.parse(
      await lowerEvaluationResponse.json(),
    );
    expect(lowerEvaluation).toMatchObject({
      customerRef: 'customer-1',
      customerVersion: 1,
      schemaVersion: 1,
    });
    expect(lowerEvaluation.decisions).toEqual([
      expect.objectContaining({
        programRef: tieredGoldWebPromo.id,
        outcome: 'qualified',
        rewardRuleRef: 'under-100',
        effects: [underHundredReward],
        eligible: true,
        commitRequired: true,
      }),
      expect.objectContaining({
        programRef: noFallbackPromo.id,
        outcome: 'not_qualified',
        effects: [],
        reasonCodes: ['NO_REWARD_RULE_MATCHED'],
        eligible: false,
        commitRequired: false,
      }),
    ]);
    expect(lowerEvaluation.decisions[1]).not.toHaveProperty('rewardRuleRef');

    const higherEvaluationResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'customer-1',
      cart: { currency: 'GBP', subtotal: 12_500, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    expect(higherEvaluationResponse.status).toBe(200);
    const higherEvaluation = EvaluationResponseSchema.parse(
      await higherEvaluationResponse.json(),
    );
    expect(higherEvaluation).toMatchObject({
      customerRef: 'customer-1',
      customerVersion: 1,
      schemaVersion: 1,
    });
    expect(higherEvaluation.decisions).toEqual([
      expect.objectContaining({
        programRef: tieredGoldWebPromo.id,
        outcome: 'qualified',
        rewardRuleRef: 'over-100',
        effects: [overHundredReward],
        eligible: true,
        commitRequired: true,
      }),
      expect.objectContaining({
        programRef: noFallbackPromo.id,
        outcome: 'not_qualified',
        effects: [],
        reasonCodes: ['NO_REWARD_RULE_MATCHED'],
      }),
    ]);
    expect(higherEvaluation.decisions[1]).not.toHaveProperty('rewardRuleRef');

    const redemptionResponse = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: lowerEvaluation.evaluationId,
      programRef: tieredGoldWebPromo.id,
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-attempt-1',
    });
    expect(redemptionResponse.status).toBe(200);
    const redemption = RedemptionResponseSchema.parse(await redemptionResponse.json());
    expect(redemption).toMatchObject({
      evaluationId: lowerEvaluation.evaluationId,
      programRef: tieredGoldWebPromo.id,
      rewardRuleRef: 'under-100',
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-attempt-1',
      status: 'committed',
      effects: [underHundredReward],
    });

    const retryResponse = await jsonRequest('POST', '/v1/redemptions', {
      evaluationId: lowerEvaluation.evaluationId,
      programRef: tieredGoldWebPromo.id,
      externalOrderRef: 'order-1',
      idempotencyKey: 'checkout-attempt-1',
    });
    expect(retryResponse.status).toBe(200);
    expect(RedemptionResponseSchema.parse(await retryResponse.json())).toEqual(redemption);

    expect(await env.DB.prepare(`
      SELECT usage_count, budget_remaining
      FROM programs WHERE external_ref = ?1
    `).bind(tieredGoldWebPromo.id).first()).toEqual({
      usage_count: 1,
      budget_remaining: 1_000,
    });

    const exhaustedResponse = await jsonRequest('POST', '/v1/evaluate', {
      customerRef: 'customer-1',
      cart: { currency: 'GBP', subtotal: 12_500, items: [] },
      context: { channel: 'web' },
    }, 'pk_test_publishable_credential_material_00000001');
    expect(exhaustedResponse.status).toBe(200);
    const exhausted = EvaluationResponseSchema.parse(await exhaustedResponse.json());
    expect(exhausted).toMatchObject({ customerVersion: 1, schemaVersion: 1 });
    expect(exhausted.decisions[0]).toMatchObject({
      programRef: tieredGoldWebPromo.id,
      outcome: 'exhausted',
      rewardRuleRef: 'over-100',
      effects: [],
      reasonCodes: [
        'USAGE_CAP_EXHAUSTED',
        'PER_CUSTOMER_CAP_EXHAUSTED',
        'BUDGET_EXHAUSTED',
      ],
      eligible: false,
      commitRequired: false,
    });
  });

  test('serves the exact generated OpenAPI document for every runtime route', async () => {
    const response = await SELF.fetch('https://example.test/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.text()).toBe(JSON.stringify(buildOpenApiDocument()));

    const document = buildOpenApiDocument();
    const expected = {
      'GET /v1/health': {
        security: 'public', success: ['200', 'HealthResponse'], errors: [],
      },
      'GET /v1/openapi.json': {
        security: 'public', success: ['200', 'OpenApiDocument'], errors: [],
      },
      'GET /v1/test-publishable': {
        security: 'publishable', success: ['200', 'AccessSummary'], errors: ['401', '503'],
      },
      'GET /v1/test-secret': {
        security: 'secret', success: ['200', 'AccessSummary'], errors: ['401', '403', '503'],
      },
      'GET /v1/schema/published': {
        security: 'publishable', success: ['200', 'PublishedSchemaResponse'],
        errors: ['401', '404', '503'],
      },
      'GET /v1/customers/{customerRef}': {
        security: 'secret', success: ['200', 'CustomerRecord'],
        parameters: ['CustomerRef'], errors: ['401', '403', '404', '503'],
      },
      'PATCH /v1/customers/{customerRef}': {
        security: 'secret', success: ['200', 'CustomerRecord'],
        requestBody: 'CustomerPatchRequest', parameters: ['CustomerRef'],
        errors: ['400', '401', '403', '404', '409', '503'],
      },
      'POST /v1/evaluate': {
        security: 'publishable', success: ['200', 'EvaluationResponse'],
        requestBody: 'EvaluationRequest', errors: ['400', '401', '404', '503'],
      },
      'POST /v1/redemptions': {
        security: 'secret', success: ['200', 'RedemptionResponse'],
        requestBody: 'RedemptionRequest',
        errors: ['400', '401', '403', '404', '409', '410', '503'],
      },
    } as const;

    const methods = [
      'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace',
    ] as const;
    type HttpMethod = typeof methods[number];
    type Operation = {
      security?: Array<Record<string, never[]>>;
      parameters?: Array<{ $ref?: string }>;
      requestBody?: {
        content?: { 'application/json'?: { schema?: { $ref?: string } } };
      };
      responses: Record<string, {
        content?: { 'application/json'?: { schema?: { $ref?: string } } };
        headers?: Record<string, { $ref?: string }>;
      }>;
    };
    const paths = document.paths as Record<string, Partial<Record<HttpMethod, Operation>>>;
    const operationMatrix = (candidatePaths: Record<string, Record<string, unknown>>) => (
      Object.entries(candidatePaths).flatMap(([path, pathItem]) => (
        methods.flatMap(method => pathItem[method] === undefined
          ? []
          : [`${method.toUpperCase()} ${path}`])
      ))
    );
    const actualMatrix = operationMatrix(paths as unknown as Record<string, Record<string, unknown>>);
    expect(actualMatrix.sort()).toEqual(Object.keys(expected).sort());
    expect(operationMatrix({
      '/operation-probe': {
        put: {},
        head: {},
        parameters: [],
        summary: 'ignored Path Item metadata',
        description: 'ignored Path Item metadata',
        servers: [],
        $ref: '#/components/pathItems/Ignored',
      },
    })).toEqual([
      'PUT /operation-probe',
      'HEAD /operation-probe',
    ]);

    expect(document.components?.securitySchemes).toMatchObject({
      publishableBearer: { type: 'http', scheme: 'bearer' },
      secretBearer: { type: 'http', scheme: 'bearer' },
    });
    expect(document.components?.headers).toMatchObject({
      CorrelationId: {
        description: 'Request correlation identifier returned by the runtime',
        schema: { type: 'string', minLength: 1 },
      },
    });
    expect(document.components?.parameters).toMatchObject({
      CustomerRef: {
        name: 'customerRef', in: 'path', required: true,
        schema: { type: 'string', minLength: 1 },
      },
    });

    for (const [key, specification] of Object.entries(expected)) {
      const separator = key.indexOf(' ');
      const method = key.slice(0, separator).toLowerCase() as HttpMethod;
      const path = key.slice(separator + 1);
      const operation = paths[path]?.[method];
      expect(operation, key).toBeDefined();

      const expectedSecurity = specification.security === 'public'
        ? undefined
        : specification.security === 'secret'
          ? [{ secretBearer: [] }]
          : [{ publishableBearer: [] }, { secretBearer: [] }];
      expect(operation?.security, `${key} security`).toEqual(expectedSecurity);

      const expectedParameters = 'parameters' in specification
        ? specification.parameters.map(name => `#/components/parameters/${name}`)
        : [];
      expect(
        (operation?.parameters ?? []).map(parameter => parameter.$ref),
        `${key} parameters`,
      ).toEqual(expectedParameters);

      const expectedRequestBody = 'requestBody' in specification
        ? `#/components/schemas/${specification.requestBody}`
        : undefined;
      expect(
        operation?.requestBody?.content?.['application/json']?.schema?.$ref,
        `${key} request body`,
      ).toBe(expectedRequestBody);

      const [successStatus, successSchema] = specification.success;
      expect(Object.keys(operation?.responses ?? {}).sort(), `${key} response statuses`).toEqual(
        [successStatus, ...specification.errors].sort(),
      );
      expect(
        operation?.responses[successStatus]?.content?.['application/json']?.schema?.$ref,
        `${key} success schema`,
      ).toBe(successSchema === null ? undefined : `#/components/schemas/${successSchema}`);

      for (const status of specification.errors) {
        const error = operation?.responses[status];
        expect(
          error?.content?.['application/json']?.schema?.$ref,
          `${key} ${status} error schema`,
        ).toBe('#/components/schemas/ApiError');
        expect(error?.headers, `${key} ${status} response headers`).toEqual({
          'x-correlation-id': { $ref: '#/components/headers/CorrelationId' },
        });
      }
    }
  });
});
