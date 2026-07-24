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

import { SEEDED_MERCHANT_ID } from './test-credentials.js';
import { createApp } from '../src/app.js';
import type {
  AtomicRedemptionCoordinator,
  CommitRedemptionBundleInput,
  CommitRedemptionBundleResult,
  TerminalRedemptionErrorCode,
} from '../src/redemption/atomic-redemption-coordinator.js';
import { createD1AtomicRedemptionCoordinator } from '../src/redemption/d1-atomic-redemption-coordinator.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import type {
  EvaluationDecisionRecord,
  RedemptionBundleCreate,
} from '../src/repositories/types.js';
import { signDecisionSnapshot } from '../src/services/evaluation-service.js';

const createdAt = '2026-07-24T12:00:00.000Z';
const signingSecret = 'decision-signing-test-secret';
const secretToken = 'sk_test_secret_credential_material_000000000001';
const publishableToken = 'pk_test_publishable_credential_material_00000001';
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

function automaticPromo(id: string, overrides: PromoOverrides = {}): PromoProgram {
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

function codedPromo(
  id: string,
  code: string,
  overrides: PromoOverrides = {},
): PromoProgram {
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
      amount: { currency: 'GBP', minorUnits: 500 },
    })],
    budget: { currency: 'GBP', minorUnits: 10_000 },
    usageCap: 10,
    stackable: true,
    priority: 10,
    autoApply: false,
    code,
    ...canonicalOverrides,
  } as PromoProgram;
}

async function resetData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemption_commit_guards'),
    env.DB.prepare('DELETE FROM redemption_entries'),
    env.DB.prepare('DELETE FROM redemption_operations'),
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM promo_code_claims'),
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
  const stored = await repositories.programs.create({
    merchantId: SEEDED_MERCHANT_ID,
    program,
    schema: await repositories.schemas.getLatestVersion(SEEDED_MERCHANT_ID, 'published'),
    createdAt,
  });
  if (!program.autoApply) {
    await env.DB.prepare(`
      INSERT INTO promo_code_claims (
        id, merchant_id, program_id, program_ref, active_revision,
        display_code, normalized_code, starts_at, ends_at, released_at, created_at
      ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, NULL, NULL, NULL, ?7)
    `).bind(
      `claim-${program.id}`,
      SEEDED_MERCHANT_ID,
      stored.id,
      program.id,
      program.code,
      program.code.trim().toUpperCase(),
      createdAt,
    ).run();
  }
}

function evaluateRaw(request: EvaluationRequest = baseRequest): Promise<Response> {
  return SELF.fetch('https://example.test/v1/evaluate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${publishableToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  });
}

async function evaluate(
  request: EvaluationRequest = baseRequest,
): Promise<ReturnType<typeof EvaluationResponseSchema.parse>> {
  const response = await evaluateRaw(request);
  expect(response.status).toBe(200);
  return EvaluationResponseSchema.parse(await response.json());
}

function redeemRaw(
  body: unknown,
  correlationId = 'redemption-test-correlation',
): Promise<Response> {
  return SELF.fetch('https://example.test/v1/redemptions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretToken}`,
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(body),
  });
}

async function redeem(body: RedemptionRequest) {
  const response = await redeemRaw(body);
  expect(response.status).toBe(200);
  return RedemptionResponseSchema.parse(await response.json());
}

async function expectError(
  response: Response,
  status: number,
  code: string,
) {
  expect(response.status).toBe(status);
  const body = ApiErrorSchema.parse(await response.json());
  expect(body.error).toMatchObject({
    code,
    correlationId: response.headers.get('x-correlation-id'),
  });
  return body;
}

async function storedDecision(
  evaluationId: string,
): Promise<EvaluationDecisionRecord> {
  const decision = await createRepositories({ DB: env.DB }).decisions.get(
    SEEDED_MERCHANT_ID,
    evaluationId,
  );
  expect(decision).not.toBeNull();
  return decision!;
}

async function resign(
  evaluationId: string,
  mutate: (record: EvaluationDecisionRecord) => void,
): Promise<void> {
  const record = await storedDecision(evaluationId);
  mutate(record);
  record.integrityHash = await signDecisionSnapshot(record, signingSecret);
  await env.DB.prepare(`
    UPDATE evaluation_decisions
    SET request_json = ?1, facts_json = ?2, decisions_json = ?3,
      integrity_hash = ?4, expires_at = ?5
    WHERE merchant_id = ?6 AND id = ?7
  `).bind(
    JSON.stringify(record.request),
    JSON.stringify(record.facts),
    JSON.stringify(record.decisions),
    record.integrityHash,
    record.expiresAt,
    SEEDED_MERCHANT_ID,
    evaluationId,
  ).run();
}

function commitInput(
  evaluation: EvaluationDecisionRecord,
  suffix = 'contract',
): CommitRedemptionBundleInput {
  return {
    merchantId: evaluation.merchantId,
    evaluation,
    externalOrderRef: `${suffix}-order`,
    idempotencyKey: `${suffix}-key`,
    requestDigest: 'a'.repeat(64),
    correlationId: `${suffix}-correlation`,
    committedAt: createdAt,
  };
}

class InMemoryAtomicRedemptionCoordinator implements AtomicRedemptionCoordinator {
  readonly #operations = new Map<string, {
    digest: string;
    externalOrderRef: string;
    result: CommitRedemptionBundleResult;
  }>();

  async commitBundle(
    input: CommitRedemptionBundleInput,
  ): Promise<CommitRedemptionBundleResult> {
    const operationKey = `${input.merchantId}:${input.idempotencyKey}`;
    const existing = this.#operations.get(operationKey);
    if (existing !== undefined) {
      if (
        existing.digest !== input.requestDigest
        || existing.externalOrderRef !== input.externalOrderRef
      ) return { kind: 'conflict' };
      if (existing.result.kind === 'committed') {
        return { kind: 'exact_retry', bundle: existing.result.bundle };
      }
      if (existing.result.kind === 'terminal_retry') return existing.result;
      return existing.result;
    }
    const selected = input.evaluation.decisions.filter(
      decision => decision.outcome === 'qualified' && decision.commitRequired,
    );
    if (selected.length === 0) {
      const result = {
        kind: 'terminal_retry',
        code: 'NOTHING_TO_COMMIT',
        retryable: false,
      } as const;
      this.#operations.set(operationKey, {
        digest: input.requestDigest,
        externalOrderRef: input.externalOrderRef,
        result,
      });
      return result;
    }
    const result = {
      redemptionId: `memory-${input.idempotencyKey}`,
      evaluationId: input.evaluation.evaluationId,
      externalOrderRef: input.externalOrderRef,
      idempotencyKey: input.idempotencyKey,
      status: 'committed',
      entries: selected.map(decision => ({
        programRef: decision.programRef,
        programRevision: decision.programRevision,
        ...(decision.rewardRuleRef === undefined
          ? {}
          : { rewardRuleRef: decision.rewardRuleRef }),
        effects: decision.effects,
      })),
    } as const;
    const bundle: RedemptionBundleCreate = {
      redemptionId: result.redemptionId,
      merchantId: input.merchantId,
      evaluationId: input.evaluation.evaluationId,
      externalOrderRef: input.externalOrderRef,
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      result,
      entries: result.entries.map((entry, position) => ({
        position,
        ...entry,
        discountMinorUnits: 0,
        currency: input.evaluation.request.cart.currency,
      })),
      createdAt: input.committedAt,
      receiptIntegrityHash: '0'.repeat(64),
    };
    const committed = { kind: 'committed', bundle } as const;
    this.#operations.set(operationKey, {
      digest: input.requestDigest,
      externalOrderRef: input.externalOrderRef,
      result: committed,
    });
    return committed;
  }

  async getBundle(input: {
    merchantId: string;
    idempotencyKey: string;
  }): Promise<RedemptionBundleCreate | null> {
    const operation = this.#operations.get(
      `${input.merchantId}:${input.idempotencyKey}`,
    );
    if (operation?.result.kind === 'committed') return operation.result.bundle;
    return null;
  }
}

interface CoordinatorFixture {
  coordinator: AtomicRedemptionCoordinator;
  input: CommitRedemptionBundleInput;
}

function atomicCoordinatorContract(
  name: string,
  fixture: () => Promise<CoordinatorFixture>,
) {
  describe(`${name} AtomicRedemptionCoordinator contract`, () => {
    test('commits once, returns the exact bundle on retry, and supports lookup', async () => {
      const { coordinator, input } = await fixture();
      const committed = await coordinator.commitBundle(input);
      expect(committed.kind).toBe('committed');
      if (committed.kind !== 'committed') throw new Error('Expected a committed bundle');

      await expect(coordinator.commitBundle(input)).resolves.toEqual({
        kind: 'exact_retry',
        bundle: committed.bundle,
      });
      await expect(coordinator.getBundle({
        merchantId: input.merchantId,
        idempotencyKey: input.idempotencyKey,
      })).resolves.toEqual(committed.bundle);
    });

    test('conflicts when an idempotency key is reused with another digest', async () => {
      const { coordinator, input } = await fixture();
      await coordinator.commitBundle(input);
      await expect(coordinator.commitBundle({
        ...input,
        requestDigest: 'b'.repeat(64),
      })).resolves.toEqual({ kind: 'conflict' });
    });
  });
}

atomicCoordinatorContract('in-memory', async () => {
  await resetData();
  await seedProgram(automaticPromo('memory-contract'));
  const evaluation = await evaluate();
  return {
    coordinator: new InMemoryAtomicRedemptionCoordinator(),
    input: commitInput(await storedDecision(evaluation.evaluationId), 'memory-contract'),
  };
});

atomicCoordinatorContract('D1', async () => {
  await resetData();
  await seedProgram(automaticPromo('d1-contract'));
  const evaluation = await evaluate();
  return {
    coordinator: createD1AtomicRedemptionCoordinator({
      DB: env.DB,
      DECISION_SIGNING_SECRET: signingSecret,
    }),
    input: commitInput(await storedDecision(evaluation.evaluationId), 'd1-contract'),
  };
});

describe('POST /v1/redemptions', () => {
  beforeEach(resetData);

  test('maps invalid signing configuration to a retryable coordinator failure', async () => {
    const response = await createApp().request('https://example.test/v1/redemptions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secretToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        evaluationId: 'evaluation-1',
        externalOrderRef: 'order-1',
        idempotencyKey: 'key-1',
      }),
    }, {
      DB: env.DB,
      DECISION_SIGNING_SECRET: 'weak',
    });
    const error = await expectError(response, 503, 'REDEMPTION_UNAVAILABLE');
    expect(error.error.retryable).toBe(true);
    expect(JSON.stringify(error)).not.toContain('weak');
  });

  test('rejects the removed child program selector', async () => {
    const response = await redeemRaw({
      evaluationId: 'evaluation-1',
      programRef: 'promo-a',
      externalOrderRef: 'order-1',
      idempotencyKey: 'key-1',
    });
    await expectError(response, 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('returns a stable NOTHING_TO_COMMIT terminal result', async () => {
    const evaluation = await evaluate();
    const request = {
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'empty-order',
      idempotencyKey: 'empty-key',
    };
    const first = await expectError(
      await redeemRaw(request, 'empty-correlation'),
      409,
      'NOTHING_TO_COMMIT',
    );
    const retry = await expectError(
      await redeemRaw(request, 'empty-correlation'),
      409,
      'NOTHING_TO_COMMIT',
    );
    expect(retry).toEqual(first);
    expect(await env.DB.prepare(`
      SELECT state, terminal_error_code AS terminalErrorCode, retryable
      FROM redemption_operations
      WHERE merchant_id = ?1 AND idempotency_key = 'empty-key'
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      state: 'rejected',
      terminalErrorCode: 'NOTHING_TO_COMMIT',
      retryable: 0,
    });
  });

  test('commits one selected decision as one immutable child', async () => {
    await seedProgram(automaticPromo('welcome'));
    const evaluation = await evaluate();
    const result = await redeem({
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'welcome-order',
      idempotencyKey: 'welcome-key',
    });

    expect(result).toEqual({
      redemptionId: expect.any(String),
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'welcome-order',
      idempotencyKey: 'welcome-key',
      status: 'committed',
      entries: [{
        programRef: 'welcome',
        programRevision: 1,
        rewardRuleRef: 'default-reward',
        effects: automaticPromo('welcome').rewardRules[0]!.reward === undefined
          ? []
          : [automaticPromo('welcome').rewardRules[0]!.reward],
      }],
    });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM redemption_entries WHERE redemption_id = ?1
    `).bind(result.redemptionId).first()).toEqual({ count: 1 });
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining
      FROM program_counters
      WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 1,
      budgetRemaining: 9_000,
    });
  });

  test('commits several coded decisions in authoritative selected order', async () => {
    await seedProgram(codedPromo('promo-low', 'LOW', { priority: 10 }));
    await seedProgram(codedPromo('promo-high', 'HIGH', {
      priority: 30,
      reward: { type: 'free_shipping' },
    }));
    const evaluation = await evaluate({ ...baseRequest, codes: ['LOW', 'HIGH'] });
    expect(evaluation.decisions.map(decision => decision.programRef)).toEqual([
      'promo-high',
      'promo-low',
    ]);

    const result = await redeem({
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'stack-order',
      idempotencyKey: 'stack-key',
    });
    expect(result.entries.map(entry => entry.programRef)).toEqual([
      'promo-high',
      'promo-low',
    ]);
    expect((await env.DB.prepare(`
      SELECT position, program_ref AS programRef
      FROM redemption_entries WHERE redemption_id = ?1 ORDER BY position
    `).bind(result.redemptionId).all()).results).toEqual([
      { position: 0, programRef: 'promo-high' },
      { position: 1, programRef: 'promo-low' },
    ]);
  });

  test('rolls back every child, header, entry, and counter when the final child fails', async () => {
    await seedProgram(codedPromo('first-child', 'FIRST', { priority: 20 }));
    await seedProgram(codedPromo('final-child', 'FINAL', {
      priority: 10,
      budget: { currency: 'GBP', minorUnits: 500 },
    }));
    const evaluation = await evaluate({ ...baseRequest, codes: ['FIRST', 'FINAL'] });
    await env.DB.prepare(`
      UPDATE program_counters SET budget_remaining = 0
      WHERE merchant_id = ?1 AND program_id = (
        SELECT id FROM programs WHERE merchant_id = ?1 AND external_ref = 'final-child'
      )
    `).bind(SEEDED_MERCHANT_ID).run();
    await env.DB.prepare(`
      UPDATE programs SET budget_remaining = 0
      WHERE merchant_id = ?1 AND external_ref = 'final-child'
    `).bind(SEEDED_MERCHANT_ID).run();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'rollback-order',
      idempotencyKey: 'rollback-key',
    }), 409, 'EXHAUSTED');
    expect((await env.DB.prepare(`
      SELECT external_ref AS programRef, usage_count AS usageCount
      FROM programs WHERE merchant_id = ?1 ORDER BY external_ref
    `).bind(SEEDED_MERCHANT_ID).all()).results).toEqual([
      { programRef: 'final-child', usageCount: 0 },
      { programRef: 'first-child', usageCount: 0 },
    ]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemption_entries').first())
      .toEqual({ count: 0 });
  });

  test('revalidates every selected active revision and reward rule before committing', async () => {
    await seedProgram(codedPromo('unchanged-child', 'UNCHANGED', { priority: 20 }));
    await seedProgram(codedPromo('changed-child', 'CHANGED', { priority: 10 }));
    const evaluation = await evaluate({ ...baseRequest, codes: ['UNCHANGED', 'CHANGED'] });
    await env.DB.prepare(`
      UPDATE program_revisions
      SET config_json = json_set(config_json, '$.rewardRules[0].id', 'renamed-rule')
      WHERE merchant_id = ?1 AND program_id = (
        SELECT id FROM programs WHERE merchant_id = ?1 AND external_ref = 'changed-child'
      ) AND revision = 1
    `).bind(SEEDED_MERCHANT_ID).run();

    await expectError(await redeemRaw({
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'changed-rule-order',
      idempotencyKey: 'changed-rule-key',
    }), 409, 'VERSION_CONFLICT');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 0 });
    expect((await env.DB.prepare(`
      SELECT usage_count AS usageCount FROM program_counters ORDER BY program_id
    `).all()).results).toEqual([{ usageCount: 0 }, { usageCount: 0 }]);
  });

  test('returns the original bundle and ordered entries on an exact retry', async () => {
    await seedProgram(automaticPromo('stable-retry'));
    const evaluation = await evaluate();
    const request = {
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'stable-order',
      idempotencyKey: 'stable-key',
    };
    const original = await redeem(request);
    await expect(redeem(request)).resolves.toEqual(original);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 1 });
  });

  test('conflicts when the same key is reused with a different bundle digest', async () => {
    await seedProgram(automaticPromo('digest-conflict'));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    await redeem({
      evaluationId: first.evaluationId,
      externalOrderRef: 'digest-order',
      idempotencyKey: 'digest-key',
    });
    await expectError(await redeemRaw({
      evaluationId: second.evaluationId,
      externalOrderRef: 'different-order',
      idempotencyKey: 'digest-key',
    }), 409, 'VERSION_CONFLICT');
  });

  test('conflicts when the same external order is reused for another evaluation', async () => {
    await seedProgram(automaticPromo('order-conflict'));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    await redeem({
      evaluationId: first.evaluationId,
      externalOrderRef: 'shared-order',
      idempotencyKey: 'first-key',
    });
    await expectError(await redeemRaw({
      evaluationId: second.evaluationId,
      externalOrderRef: 'shared-order',
      idempotencyKey: 'second-key',
    }), 409, 'VERSION_CONFLICT');
  });

  test('concurrent exact requests converge on one bundle', async () => {
    await seedProgram(automaticPromo('convergent'));
    const evaluation = await evaluate();
    const request = {
      evaluationId: evaluation.evaluationId,
      externalOrderRef: 'convergent-order',
      idempotencyKey: 'convergent-key',
    };
    const responses = await Promise.all([redeemRaw(request), redeemRaw(request)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const results = await Promise.all(
      responses.map(async response => RedemptionResponseSchema.parse(await response.json())),
    );
    expect(results[1]).toEqual(results[0]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 1 });
  });

  test('concurrent different requests cannot exceed a usage cap or budget', async () => {
    await seedProgram(automaticPromo('last-use', {
      usageCap: 1,
      budget: { currency: 'GBP', minorUnits: 1_000 },
    }));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    const responses = await Promise.all([
      redeemRaw({
        evaluationId: first.evaluationId,
        externalOrderRef: 'last-use-order-1',
        idempotencyKey: 'last-use-key-1',
      }),
      redeemRaw({
        evaluationId: second.evaluationId,
        externalOrderRef: 'last-use-order-2',
        idempotencyKey: 'last-use-key-2',
      }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount, budget_remaining AS budgetRemaining
      FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({
      usageCount: 1,
      budgetRemaining: 0,
    });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 1 });
  });

  test('concurrent different requests cannot exceed a per-customer cap', async () => {
    await seedProgram(automaticPromo('customer-last-use', { perCustomerCap: 1 }));
    const [first, second] = await Promise.all([evaluate(), evaluate()]);
    const responses = await Promise.all([
      redeemRaw({
        evaluationId: first.evaluationId,
        externalOrderRef: 'customer-order-1',
        idempotencyKey: 'customer-key-1',
      }),
      redeemRaw({
        evaluationId: second.evaluationId,
        externalOrderRef: 'customer-order-2',
        idempotencyKey: 'customer-key-2',
      }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({ usageCount: 1 });
  });

  test('expired and tampered evaluations cannot commit', async () => {
    await seedProgram(automaticPromo('integrity'));
    const expired = await evaluate();
    await resign(expired.evaluationId, record => {
      record.expiresAt = '2020-01-01T00:00:00.000Z';
    });
    await expectError(await redeemRaw({
      evaluationId: expired.evaluationId,
      externalOrderRef: 'expired-order',
      idempotencyKey: 'expired-key',
    }), 410, 'DECISION_EXPIRED');

    const tampered = await evaluate();
    await env.DB.prepare(`
      UPDATE evaluation_decisions SET decisions_json = '[]'
      WHERE merchant_id = ?1 AND id = ?2
    `).bind(SEEDED_MERCHANT_ID, tampered.evaluationId).run();
    await expectError(await redeemRaw({
      evaluationId: tampered.evaluationId,
      externalOrderRef: 'tampered-order',
      idempotencyKey: 'tampered-key',
    }), 409, 'VERSION_CONFLICT');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 0 });
  });

  test('does not expose a committed response when the complete D1 batch fails', async () => {
    await seedProgram(automaticPromo('batch-failure'));
    const evaluation = await evaluate();
    await env.DB.prepare(`
      CREATE TRIGGER force_redemption_entry_failure
      BEFORE INSERT ON redemption_entries
      BEGIN
        SELECT RAISE(ABORT, 'forced redemption entry failure');
      END
    `).run();
    try {
      await expectError(await redeemRaw({
        evaluationId: evaluation.evaluationId,
        externalOrderRef: 'batch-failure-order',
        idempotencyKey: 'batch-failure-key',
      }), 503, 'REDEMPTION_UNAVAILABLE');
    } finally {
      await env.DB.prepare('DROP TRIGGER force_redemption_entry_failure').run();
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemptions').first())
      .toEqual({ count: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM redemption_entries').first())
      .toEqual({ count: 0 });
    expect(await env.DB.prepare(`
      SELECT usage_count AS usageCount FROM program_counters WHERE merchant_id = ?1
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({ usageCount: 0 });
  });
});

describe('terminal coordinator contract', () => {
  beforeEach(resetData);

  test.each([
    'NOTHING_TO_COMMIT',
    'DECISION_EXPIRED',
    'INVALID_DECISION',
    'PROGRAM_UNAVAILABLE',
    'PER_CUSTOMER_CAP_EXHAUSTED',
    'BUDGET_EXHAUSTED',
  ] satisfies TerminalRedemptionErrorCode[])(
    'keeps %s in the provider-neutral terminal result union',
    (code) => {
      const result: CommitRedemptionBundleResult = {
        kind: 'terminal_retry',
        code,
        retryable: false,
      };
      expect(result).toEqual({ kind: 'terminal_retry', code, retryable: false });
    },
  );
});
