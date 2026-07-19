import {
  ApiErrorSchema,
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  type CommerceReward,
  type EvaluationRequest,
  type PromoProgram,
  type RedemptionRequest,
} from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { SEEDED_MERCHANT_ID } from '../src/auth/static-token.js';
import { createApp } from '../src/app.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import { signDecisionSnapshot } from '../src/services/evaluation-service.js';

const createdAt = '2026-07-18T12:00:00.000Z';
const signingSecret = 'decision-signing-test-secret';
const baseRequest = {
  customerRef: 'customer-1',
  cart: { currency: 'GBP', subtotal: 6_500, items: [] },
} as const satisfies EvaluationRequest;

type PromoOverrides = Partial<PromoProgram> & { reward?: CommerceReward };

function conditionalRule(reward: CommerceReward, id = 'default-reward') {
  return {
    id,
    name: id === 'default-reward' ? 'Default reward' : id,
    conditions: {
      match: 'ALL' as const,
      conditions: [{
        id: `${id}-positive-cart`,
        variable: 'cart.subtotal',
        operator: 'gte' as const,
        value: 0,
      }],
    },
    reward,
  };
}

function promo(id: string, overrides: PromoOverrides = {}): PromoProgram {
  const { reward, ...canonicalOverrides } = overrides;
  return {
    id,
    type: 'promo',
    name: `Promo ${id}`,
    status: 'active',
    eligibility: { match: 'ALL', conditions: [] },
    rewardRules: [conditionalRule(reward ?? {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    })],
    budget: { currency: 'GBP', minorUnits: 10_000 },
    usageCap: 10,
    stackable: false,
    priority: 10,
    autoApply: true,
    ...canonicalOverrides,
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
    env.DB.prepare("DELETE FROM merchants WHERE id <> 'phase-0-merchant'"),
    env.DB.prepare(`
      INSERT INTO schema_versions (
        merchant_id, version, state, published_at, definitions_json
      ) VALUES (?1, 1, 'published', ?2, '[]')
    `).bind(SEEDED_MERCHANT_ID, createdAt),
  ]);
  await createRepositories({ DB: env.DB }).customers.create(SEEDED_MERCHANT_ID, {
    externalRef: 'customer-1',
    attributes: {},
  });
}

async function seedProgram(program: PromoProgram): Promise<void> {
  const repositories = createRepositories({ DB: env.DB });
  await repositories.programs.create({
    merchantId: SEEDED_MERCHANT_ID,
    program,
    schema: await repositories.schemas.getLatestVersion(SEEDED_MERCHANT_ID, 'published'),
    createdAt,
  });
}

async function evaluate(
  request: EvaluationRequest = baseRequest,
): Promise<ReturnType<typeof EvaluationResponseSchema.parse>> {
  const response = await SELF.fetch('https://example.test/v1/evaluate', {
    method: 'POST',
    headers: {
      authorization: 'Bearer publishable-test',
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(200);
  return EvaluationResponseSchema.parse(await response.json());
}

function redeemRaw(body: unknown, token = 'secret-test'): Promise<Response> {
  return SELF.fetch('https://example.test/v1/redemptions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function redeem(body: RedemptionRequest) {
  const response = await redeemRaw(body);
  expect(response.status).toBe(200);
  return RedemptionResponseSchema.parse(await response.json());
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = ApiErrorSchema.parse(await response.json());
  expect(body.error).toMatchObject({
    code,
    correlationId: response.headers.get('x-correlation-id'),
  });
  return body;
}

async function resign(evaluationId: string, mutate: (record: Awaited<ReturnType<
  ReturnType<typeof createRepositories>['decisions']['get']
>>) => void): Promise<void> {
  const repositories = createRepositories({ DB: env.DB });
  const record = await repositories.decisions.get(SEEDED_MERCHANT_ID, evaluationId);
  expect(record).not.toBeNull();
  mutate(record);
  record!.integrityHash = await signDecisionSnapshot(record!, signingSecret);
  await env.DB.prepare(`
    UPDATE evaluation_decisions
    SET request_json = ?1, facts_json = ?2, decisions_json = ?3,
      integrity_hash = ?4, expires_at = ?5
    WHERE merchant_id = ?6 AND id = ?7
  `).bind(
    JSON.stringify(record!.request),
    JSON.stringify(record!.facts),
    JSON.stringify(record!.decisions),
    record!.integrityHash,
    record!.expiresAt,
    SEEDED_MERCHANT_ID,
    evaluationId,
  ).run();
}

describe('POST /v1/redemptions', () => {
  beforeEach(resetData);

  test('keeps request validation at 400 before entering the internal redemption boundary', async () => {
    const response = await createApp().request('https://example.test/v1/redemptions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ evaluationId: 'missing-program-and-identifier' }),
    }, {
      DB: env.DB,
      PUBLISHABLE_TOKEN: 'publishable-test',
      SECRET_TOKEN: 'secret-test',
      DECISION_SIGNING_SECRET: 'weak',
    });
    await expectError(response, 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('maps weak signing configuration to a generic retryable 503', async () => {
    const response = await createApp().request('https://example.test/v1/redemptions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        evaluationId: 'evaluation-1',
        programRef: 'welcome',
        externalOrderRef: 'order-1',
      }),
    }, {
      DB: env.DB,
      PUBLISHABLE_TOKEN: 'publishable-test',
      SECRET_TOKEN: 'secret-test',
      DECISION_SIGNING_SECRET: 'weak',
    });
    const error = await expectError(response, 503, 'EVALUATION_UNAVAILABLE');
    expect(error.error.retryable).toBe(true);
    expect(JSON.stringify(error)).not.toContain('weak');
  });

  test.each([
    ['stored decision', 'evaluation_decisions', "decisions_json = '[{\"programRef\":\"welcome\"}]'"],
    ['stored redemption retry', 'redemptions', "result_json = '{\"programRef\":\"welcome\"}'"],
    ['stored program', 'programs', "config_json = '{\"id\":\"welcome\"}'"],
  ])('maps a schema-invalid %s row to a generic retryable 503', async (
    _name,
    table,
    mutation,
  ) => {
    await seedProgram(promo('welcome'));
    const evaluation = await evaluate();
    if (table === 'redemptions') {
      await redeem({
        evaluationId: evaluation.evaluationId,
        programRef: 'welcome',
        externalOrderRef: 'corrupt-retry',
      });
    }
    await env.DB.prepare(`UPDATE ${table} SET ${mutation} WHERE merchant_id = ?1`)
      .bind(SEEDED_MERCHANT_ID).run();

    const response = await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      externalOrderRef: table === 'redemptions' ? 'corrupt-retry' : `corrupt-${table}`,
    });
    const error = await expectError(response, 503, 'EVALUATION_UNAVAILABLE');
    expect(error.error.retryable).toBe(true);
    expect(JSON.stringify(error)).not.toMatch(/Zod|config_json|decisions_json|result_json/u);
  });

  test.each([
    ['external order only', { externalOrderRef: 'order-1' }],
    ['idempotency key only', { idempotencyKey: 'key-1' }],
    ['both identifiers', { externalOrderRef: 'order-1', idempotencyKey: 'key-1' }],
  ])('commits a canonical redemption with %s', async (_name, identifiers) => {
    await seedProgram(promo('welcome'));
    const evaluation = await evaluate();

    const result = await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      ...identifiers,
    });

    expect(result).toEqual({
      redemptionId: expect.any(String),
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      rewardRuleRef: 'default-reward',
      ...identifiers,
      status: 'committed',
      effects: [promo('welcome').rewardRules[0]!.reward],
    });
    const stored = await env.DB.prepare(`
      SELECT discount_minor_units, currency FROM redemptions WHERE id = ?1
    `).bind(result.redemptionId).first();
    expect(stored).toEqual({ discount_minor_units: 1_000, currency: 'GBP' });
  });

  test('decrements budget by only the selected rule cost', async () => {
    const expensive = {
      ...conditionalRule({
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 2_000 },
      }, 'expensive'),
      conditions: {
        match: 'ALL' as const,
        conditions: [{
          id: 'expensive-cart',
          variable: 'cart.subtotal',
          operator: 'gte' as const,
          value: 10_000,
        }],
      },
    };
    const selected = conditionalRule({
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    }, 'selected-cheap');
    await seedProgram(promo('selected-cost-commit', {
      rewardRules: [expensive, selected],
      budget: { currency: 'GBP', minorUnits: 1_000 },
    }));
    const evaluation = await evaluate();
    expect(evaluation.decisions[0]).toMatchObject({
      rewardRuleRef: 'selected-cheap',
      effects: [selected.reward],
    });

    await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'selected-cost-commit',
      externalOrderRef: 'selected-cost-order',
    });
    expect(await env.DB.prepare(`
      SELECT usage_count, budget_remaining FROM programs
      WHERE merchant_id = ?1 AND external_ref = 'selected-cost-commit'
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usage_count: 1,
      budget_remaining: 500,
    });
  });

  test('stable retries by either identifier return the original response without mutation', async () => {
    await seedProgram(promo('welcome'));
    const evaluation = await evaluate();
    const original = await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-1',
      idempotencyKey: 'key-1',
    });

    expect(await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-1',
    })).toEqual(original);
    expect(await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      idempotencyKey: 'key-1',
    })).toEqual(original);
    expect(await env.DB.prepare('SELECT usage_count, budget_remaining FROM programs')
      .first()).toEqual({ usage_count: 1, budget_remaining: 9_000 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions')
      .first()).toEqual({ count: 1 });
  });

  test('concurrent identical requests converge on one stable idempotent response', async () => {
    await seedProgram(promo('welcome'));
    const evaluation = await evaluate();
    const request = {
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'same-order',
      idempotencyKey: 'same-key',
    } as const satisfies RedemptionRequest;
    const responses = await Promise.all([redeemRaw(request), redeemRaw(request)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(async response => (
      RedemptionResponseSchema.parse(await response.json())
    )));
    expect(results[1]).toEqual(results[0]);
    expect(await env.DB.prepare('SELECT usage_count, budget_remaining FROM programs')
      .first()).toEqual({ usage_count: 1, budget_remaining: 9_000 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions')
      .first()).toEqual({ count: 1 });
  });

  test('rejects a missing identifier and publishable credentials', async () => {
    await expectError(await redeemRaw({ evaluationId: 'e', programRef: 'p' }), 400,
      'CONTEXT_VALIDATION_FAILED');
    await expectError(await redeemRaw({
      evaluationId: 'e', programRef: 'p', externalOrderRef: 'o',
    }, 'publishable-test'), 403, 'FORBIDDEN');
  });

  test('conflicting identifier reuse returns VERSION_CONFLICT', async () => {
    await seedProgram(promo('welcome'));
    const first = await evaluate();
    const second = await evaluate();
    await redeem({
      evaluationId: first.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-1',
      idempotencyKey: 'key-1',
    });

    await expectError(await redeemRaw({
      evaluationId: second.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-1',
    }), 409, 'VERSION_CONFLICT');
    await expectError(await redeemRaw({
      evaluationId: first.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-1',
      idempotencyKey: 'different-key',
    }), 409, 'VERSION_CONFLICT');
  });

  test('idempotency reuse with a different external order, evaluation, or program conflicts', async () => {
    await seedProgram(promo('welcome'));
    await seedProgram(promo('second-program', { priority: 9 }));
    const first = await evaluate();
    const second = await evaluate();
    await redeem({
      evaluationId: first.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-1',
      idempotencyKey: 'shared-key',
    });

    for (const request of [
      {
        evaluationId: first.evaluationId, programRef: 'welcome',
        externalOrderRef: 'different-order', idempotencyKey: 'shared-key',
      },
      {
        evaluationId: second.evaluationId, programRef: 'welcome',
        idempotencyKey: 'shared-key',
      },
      {
        evaluationId: first.evaluationId, programRef: 'second-program',
        idempotencyKey: 'shared-key',
      },
    ]) {
      await expectError(await redeemRaw(request), 409, 'VERSION_CONFLICT');
    }
  });

  test('supplying identifiers that resolve to different redemptions conflicts', async () => {
    await seedProgram(promo('welcome'));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    await redeem({
      evaluationId: first.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-from-first',
    });
    await redeem({
      evaluationId: second.evaluationId,
      programRef: 'welcome',
      idempotencyKey: 'key-from-second',
    });

    await expectError(await redeemRaw({
      evaluationId: first.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'order-from-first',
      idempotencyKey: 'key-from-second',
    }), 409, 'VERSION_CONFLICT');
  });

  test.each([
    ['usage cap changed to NULL', 'max_uses = NULL'],
    ['usage cap changed to a different value', 'max_uses = 11'],
    ['usage count becomes negative', 'usage_count = -1'],
    ['usage count exceeds its configured cap', 'usage_count = 11'],
    ['budget changed to NULL', 'budget_remaining = NULL'],
    ['budget exceeds its configured bound', 'budget_remaining = 10001'],
    ['budget becomes negative', 'budget_remaining = -1'],
  ])('fails closed without mutation when program relational %s', async (_name, mutation) => {
    await seedProgram(promo('relational-corruption'));
    const evaluation = await evaluate();
    await env.DB.prepare(`
      UPDATE programs SET ${mutation} WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, 'relational-corruption').run();
    const counterBefore = await env.DB.prepare(`
      SELECT usage_count, budget_remaining FROM programs
    `).first();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'relational-corruption',
      externalOrderRef: `corrupt-${_name}`,
    }), 503, 'EVALUATION_UNAVAILABLE');
    expect(await env.DB.prepare('SELECT usage_count, budget_remaining FROM programs').first())
      .toEqual(counterBefore);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 0 });
  });

  test.each([
    ['result program', "result_json = json_set(result_json, '$.programRef', 'other-program')"],
    ['effects', `result_json = json_set(result_json,
      '$.effects[0].amount.minorUnits', 500)`],
    ['reward rule reference', "result_json = json_set(result_json, '$.rewardRuleRef', 'other-rule')"],
    ['currency', "currency = 'USD'"],
    ['discount amount', 'discount_minor_units = 999'],
    ['decision HMAC', "integrity_hash = 'tampered'"],
  ])('schema-valid committed retry corruption in %s fails closed', async (
    _name,
    mutation,
  ) => {
    await seedProgram(promo('retry-integrity'));
    const evaluation = await evaluate();
    await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'retry-integrity',
      externalOrderRef: 'retry-corruption',
    });
    const table = _name === 'decision HMAC' ? 'evaluation_decisions' : 'redemptions';
    await env.DB.prepare(`UPDATE ${table} SET ${mutation} WHERE merchant_id = ?1`)
      .bind(SEEDED_MERCHANT_ID).run();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'retry-integrity',
      externalOrderRef: 'retry-corruption',
    }), 503, 'EVALUATION_UNAVAILABLE');
    expect(await env.DB.prepare('SELECT usage_count, budget_remaining FROM programs').first())
      .toEqual({ usage_count: 1, budget_remaining: 9_000 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 1 });
  });

  test('a valid retry stays stable after expiry and mutable program exhaustion', async () => {
    await seedProgram(promo('stable-old-commit'));
    const evaluation = await evaluate();
    const original = await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'stable-old-commit',
      idempotencyKey: 'stable-old-key',
    });
    await resign(evaluation.evaluationId, record => {
      record!.expiresAt = '2020-01-01T00:00:00.000Z';
    });
    await env.DB.prepare(`
      UPDATE programs SET status = 'paused',
        config_json = json_set(config_json, '$.status', 'paused'),
        usage_count = max_uses, budget_remaining = 0
      WHERE merchant_id = ?1 AND external_ref = 'stable-old-commit'
    `).bind(SEEDED_MERCHANT_ID).run();

    expect(await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'stable-old-commit',
      idempotencyKey: 'stable-old-key',
    })).toEqual(original);
  });

  test('rejects expired, tampered, cross-merchant, and non-qualified decisions', async () => {
    await seedProgram(promo('welcome'));
    const expired = await evaluate();
    await resign(expired.evaluationId, record => {
      record!.expiresAt = '2020-01-01T00:00:00.000Z';
    });
    await expectError(await redeemRaw({
      evaluationId: expired.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'expired',
    }), 410, 'DECISION_EXPIRED');

    const tampered = await evaluate();
    await env.DB.prepare(`
      UPDATE evaluation_decisions SET decisions_json = '[]' WHERE id = ?1
    `).bind(tampered.evaluationId).run();
    await expectError(await redeemRaw({
      evaluationId: tampered.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'tampered',
    }), 503, 'EVALUATION_UNAVAILABLE');

    await env.DB.prepare(`
      INSERT INTO merchants (id, name, created_at) VALUES ('merchant-b', 'B', ?1)
    `).bind(createdAt).run();
    await env.DB.prepare(`
      INSERT INTO schema_versions (
        merchant_id, version, state, published_at, definitions_json
      ) VALUES ('merchant-b', 1, 'published', ?1, '[]')
    `).bind(createdAt).run();
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-b', {
      externalRef: 'customer-1', attributes: {},
    });
    const crossTenantSource = await evaluate();
    const sourceRecord = await repositories.decisions.get(
      SEEDED_MERCHANT_ID,
      crossTenantSource.evaluationId,
    );
    expect(sourceRecord).not.toBeNull();
    const crossTenantRecord = {
      ...sourceRecord!,
      evaluationId: 'merchant-b-decision',
      merchantId: 'merchant-b',
      integrityHash: '',
    };
    crossTenantRecord.integrityHash = await signDecisionSnapshot(crossTenantRecord, signingSecret);
    await repositories.decisions.create(crossTenantRecord);
    await expectError(await redeemRaw({
      evaluationId: 'merchant-b-decision',
      programRef: 'welcome',
      externalOrderRef: 'cross-merchant',
    }), 404, 'NOT_FOUND');

    const nonQualified = await evaluate();
    await resign(nonQualified.evaluationId, record => {
      record!.decisions[0] = {
        ...record!.decisions[0]!, outcome: 'not_qualified', effects: [], commitRequired: false,
        eligible: false,
      };
    });
    await expectError(await redeemRaw({
      evaluationId: nonQualified.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'not-qualified',
    }), 409, 'VERSION_CONFLICT');
  });

  test('fails closed when decision effects no longer match the program reward', async () => {
    await seedProgram(promo('welcome'));
    const evaluation = await evaluate();
    const changed = promo('welcome', {
      reward: {
        type: 'order_discount', calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 500 },
      },
    });
    await env.DB.prepare(`
      UPDATE programs SET config_json = ?1 WHERE merchant_id = ?2 AND external_ref = 'welcome'
    `).bind(JSON.stringify(changed), SEEDED_MERCHANT_ID).run();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      externalOrderRef: 'mismatch',
    }), 409, 'VERSION_CONFLICT');
  });

  test('fails closed when signed selected effects differ from signed snapshot config', async () => {
    await seedProgram(promo('signed-effect-mismatch'));
    const evaluation = await evaluate();
    await resign(evaluation.evaluationId, record => {
      record!.facts.programs[0]!.config.rewardRules[0]!.reward = {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 500 },
      };
    });

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'signed-effect-mismatch',
      externalOrderRef: 'signed-effect-mismatch-order',
    }), 409, 'VERSION_CONFLICT');
  });

  test('commits a selected fallback by stable rule reference', async () => {
    await seedProgram(promo('fallback-offer', {
      rewardRules: [{
        ...conditionalRule({ type: 'free_shipping' }, 'never-matches'),
        conditions: {
          match: 'ALL',
          conditions: [{
            id: 'impossible-cart',
            variable: 'cart.subtotal',
            operator: 'gt',
            value: 100_000,
          }],
        },
      }],
      fallbackReward: {
        id: 'fallback',
        name: 'Fallback',
        reward: {
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'GBP', minorUnits: 500 },
        },
      },
    }));
    const evaluation = await evaluate();

    expect(await redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'fallback-offer',
      externalOrderRef: 'fallback-order',
    })).toMatchObject({
      rewardRuleRef: 'fallback',
      effects: [{
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 500 },
      }],
    });
  });

  test.each([
    ['missing', undefined],
    ['unknown', 'unknown-rule'],
  ])('fails closed for a %s signed reward rule reference', async (_name, rewardRuleRef) => {
    await seedProgram(promo('rule-reference'));
    const evaluation = await evaluate();
    await resign(evaluation.evaluationId, record => {
      if (rewardRuleRef === undefined) {
        delete record!.decisions[0]!.rewardRuleRef;
      } else {
        record!.decisions[0]!.rewardRuleRef = rewardRuleRef;
      }
    });

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'rule-reference',
      externalOrderRef: `bad-rule-${_name}`,
    }), 409, 'VERSION_CONFLICT');
  });

  test('fails closed for duplicate reward ids in the signed program snapshot', async () => {
    await seedProgram(promo('duplicate-snapshot'));
    const evaluation = await evaluate();
    await resign(evaluation.evaluationId, record => {
      record!.facts.programs[0]!.config.fallbackReward = {
        id: 'default-reward',
        name: 'Duplicate',
        reward: { type: 'free_shipping' },
      };
    });

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'duplicate-snapshot',
      externalOrderRef: 'duplicate-snapshot-order',
    }), 503, 'EVALUATION_UNAVAILABLE');
  });

  test('fails closed when the selected rule id changes in the current program', async () => {
    await seedProgram(promo('changed-rule-id'));
    const evaluation = await evaluate();
    await env.DB.prepare(`
      UPDATE programs
      SET config_json = json_set(config_json, '$.rewardRules[0].id', 'renamed-rule')
      WHERE merchant_id = ?1 AND external_ref = 'changed-rule-id'
    `).bind(SEEDED_MERCHANT_ID).run();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'changed-rule-id',
      externalOrderRef: 'changed-rule-order',
    }), 409, 'VERSION_CONFLICT');
  });

  test('does not re-evaluate rule conditions against changed current configuration', async () => {
    await seedProgram(promo('no-reevaluation'));
    const evaluation = await evaluate();
    await env.DB.prepare(`
      UPDATE programs
      SET config_json = json_set(
        config_json,
        '$.rewardRules[0].conditions.conditions[0].value',
        100000
      )
      WHERE merchant_id = ?1 AND external_ref = 'no-reevaluation'
    `).bind(SEEDED_MERCHANT_ID).run();

    await expect(redeem({
      evaluationId: evaluation.evaluationId,
      programRef: 'no-reevaluation',
      externalOrderRef: 'no-reevaluation-order',
    })).resolves.toMatchObject({
      rewardRuleRef: 'default-reward',
      status: 'committed',
    });
  });

  test('fails closed on corrupt committed history used for a per-customer cap', async () => {
    await seedProgram(promo('customer-history', { perCustomerCap: 2 }));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    await redeem({
      evaluationId: first.evaluationId,
      programRef: 'customer-history',
      externalOrderRef: 'history-1',
    });
    await env.DB.prepare(`
      UPDATE evaluation_decisions SET integrity_hash = 'tampered'
      WHERE merchant_id = ?1 AND id = ?2
    `).bind(SEEDED_MERCHANT_ID, first.evaluationId).run();

    await expectError(await redeemRaw({
      evaluationId: second.evaluationId,
      programRef: 'customer-history',
      externalOrderRef: 'history-2',
    }), 503, 'EVALUATION_UNAVAILABLE');
    expect(await env.DB.prepare('SELECT usage_count FROM programs').first())
      .toEqual({ usage_count: 1 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 1 });
  });

  test.each([
    ['paused program', "status = 'paused', config_json = json_set(config_json, '$.status', 'paused')"],
    ['usage cap', 'usage_count = max_uses'],
    ['budget', 'budget_remaining = 999'],
  ])('returns EXHAUSTED when mutable %s changes after evaluation', async (_name, mutation) => {
    await seedProgram(promo('welcome'));
    const evaluation = await evaluate();
    await env.DB.prepare(`UPDATE programs SET ${mutation} WHERE external_ref = 'welcome'`).run();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      programRef: 'welcome',
      externalOrderRef: `exhausted-${_name}`,
    }), 409, 'EXHAUSTED');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions')
      .first()).toEqual({ count: 0 });
  });

  test('concurrent final-cap commits allow exactly one redemption', async () => {
    await seedProgram(promo('one-use', { usageCap: 1 }));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    const responses = await Promise.all([
      redeemRaw({
        evaluationId: first.evaluationId,
        programRef: 'one-use', externalOrderRef: 'o-1', idempotencyKey: 'k-1',
      }),
      redeemRaw({
        evaluationId: second.evaluationId,
        programRef: 'one-use', externalOrderRef: 'o-2', idempotencyKey: 'k-2',
      }),
    ]);
    const results = await Promise.all(responses.map(async response => ({
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    })));

    expect(results.filter(({ status, body }) =>
      status === 200 && body.status === 'committed')).toHaveLength(1);
    expect(results.filter(({ status, body }) =>
      status === 409 && (body.error as { code?: string } | undefined)?.code === 'EXHAUSTED'))
      .toHaveLength(1);
    expect(await env.DB.prepare('SELECT usage_count, budget_remaining FROM programs')
      .first()).toEqual({ usage_count: 1, budget_remaining: 9_000 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions')
      .first()).toEqual({ count: 1 });
  });

  test('concurrent per-customer final-cap commits allow exactly one redemption', async () => {
    await seedProgram(promo('customer-one', { perCustomerCap: 1 }));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    const responses = await Promise.all([
      redeemRaw({
        evaluationId: first.evaluationId,
        programRef: 'customer-one', externalOrderRef: 'customer-o-1',
      }),
      redeemRaw({
        evaluationId: second.evaluationId,
        programRef: 'customer-one', externalOrderRef: 'customer-o-2',
      }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare('SELECT usage_count FROM programs').first())
      .toEqual({ usage_count: 1 });
  });

  test('concurrent final-budget commits allow exactly one redemption', async () => {
    await seedProgram(promo('last-budget', {
      budget: { currency: 'GBP', minorUnits: 1_000 },
    }));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    const responses = await Promise.all([
      redeemRaw({
        evaluationId: first.evaluationId,
        programRef: 'last-budget', idempotencyKey: 'budget-1',
      }),
      redeemRaw({
        evaluationId: second.evaluationId,
        programRef: 'last-budget', idempotencyKey: 'budget-2',
      }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare('SELECT usage_count, budget_remaining FROM programs')
      .first()).toEqual({ usage_count: 1, budget_remaining: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions')
      .first()).toEqual({ count: 1 });
  });
});
