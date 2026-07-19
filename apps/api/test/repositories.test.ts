import type {
  CustomerSnapshot,
  EvaluationRequest,
  IncentiveDecision,
  PromoProgram,
  RedemptionResponse,
  VariableDefinition,
} from '@incentives/contracts';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createRepositories } from '../src/repositories/d1-repositories.js';
import type {
  EvaluationDecisionRecord,
  RedemptionCreate,
} from '../src/repositories/types.js';
import {
  signDecisionSnapshot,
  verifyDecisionIntegrity,
} from '../src/services/evaluation-service.js';

const createdAt = '2026-07-18T12:00:00.000Z';
const expiresAt = '2026-07-18T12:05:00.000Z';
const signingSecret = 'repository-history-signing-secret';

const definition: VariableDefinition = {
  key: 'customer.tier',
  label: 'Customer tier',
  source: 'customer',
  type: 'enum',
  required: false,
  enumValues: ['gold', 'silver'],
};

const request: EvaluationRequest = {
  customerRef: 'shared',
  cart: { currency: 'GBP', subtotal: 5_000, items: [] },
};

const incentiveDecision: IncentiveDecision = {
  programRef: 'welcome-10',
  programType: 'promo',
  outcome: 'qualified',
  rewardRuleRef: 'default-reward',
  effects: [{
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 500 },
  }],
  reasonCodes: ['QUALIFIED'],
  commitRequired: true,
};

const program: PromoProgram = {
  id: 'welcome-10',
  type: 'promo',
  name: 'Welcome discount',
  status: 'active',
  eligibility: { match: 'ALL', conditions: [] },
  rewardRules: [{
    id: 'default-reward',
    name: 'Default reward',
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
  }, {
    id: 'higher-cart',
    name: 'Higher cart',
    conditions: {
      match: 'ALL',
      conditions: [{
        id: 'higher-cart-condition',
        variable: 'cart.subtotal',
        operator: 'gte',
        value: 10_000,
      }],
    },
    reward: {
      type: 'order_discount',
      calculation: 'percent',
      basisPoints: 1_000,
    },
  }],
  fallbackReward: {
    id: 'fallback',
    name: 'Fallback',
    reward: { type: 'order_discount', calculation: 'percent', basisPoints: 500 },
  },
  budget: { currency: 'GBP', minorUnits: 10_000 },
  usageCap: 20,
  stackable: false,
  priority: 10,
  autoApply: true,
};

function customer(externalRef: string, attributes: Record<string, unknown>): CustomerSnapshot {
  return { externalRef, attributes };
}

function decision(
  merchantId: string,
  evaluationId = `${merchantId}-evaluation`,
): EvaluationDecisionRecord {
  return {
    evaluationId,
    merchantId,
    customerRef: 'shared',
    customerVersion: 1,
    schemaVersion: 1,
    request,
    facts: {
      scalar: { 'customer.tier': 'gold', 'cart.subtotal': 5_000 },
      lineItems: [],
      programs: [],
    },
    decisions: [incentiveDecision],
    integrityHash: `${merchantId}-integrity`,
    expiresAt,
    createdAt,
  };
}

function redemptionResult(
  redemptionId: string,
  evaluationId: string,
  identifiers: { externalOrderRef?: string; idempotencyKey?: string },
): RedemptionResponse {
  return {
    redemptionId,
    evaluationId,
    programRef: 'welcome-10',
    rewardRuleRef: 'default-reward',
    status: 'committed',
    effects: incentiveDecision.effects,
    ...identifiers,
  } as RedemptionResponse;
}

function redemption(
  merchantId: string,
  evaluationId: string,
  identifiers: { externalOrderRef?: string; idempotencyKey?: string },
): RedemptionCreate {
  const redemptionId = `${evaluationId}-${identifiers.externalOrderRef ?? identifiers.idempotencyKey}`;
  return {
    redemptionId,
    merchantId,
    evaluationId,
    ...identifiers,
    result: redemptionResult(redemptionId, evaluationId, identifiers),
    discountMinorUnits: 500,
    currency: 'GBP',
    createdAt,
  };
}

async function seedMerchant(merchantId: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO merchants (id, name, created_at) VALUES (?1, ?2, ?3)',
  ).bind(merchantId, merchantId, createdAt).run();
}

async function seedPublishedSchema(merchantId: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO schema_versions (
      merchant_id, version, state, published_at, definitions_json
    ) VALUES (?1, 1, 'published', ?2, ?3)
  `).bind(merchantId, createdAt, JSON.stringify([definition])).run();
}

async function seedDecision(merchantId: string, evaluationId?: string): Promise<string> {
  const repositories = createRepositories({ DB: env.DB });
  const id = evaluationId ?? `${merchantId}-evaluation`;

  await seedPublishedSchema(merchantId);
  await repositories.customers.create(merchantId, customer('shared', { tier: 'gold' }));
  const snapshot = decision(merchantId, id);
  snapshot.integrityHash = await signDecisionSnapshot(snapshot, signingSecret);
  await repositories.decisions.create(snapshot);
  return id;
}

function verifyHistoricalDecision(snapshot: EvaluationDecisionRecord): Promise<boolean> {
  return verifyDecisionIntegrity(snapshot, signingSecret);
}

async function seedCommittedRedemption() {
  await seedMerchant('merchant-a');
  const repositories = createRepositories({ DB: env.DB });
  const evaluationId = await seedDecision('merchant-a');
  await repositories.redemptions.create(redemption('merchant-a', evaluationId, {
    externalOrderRef: 'counted-order',
  }));
  return { evaluationId, repositories };
}

describe('D1 repositories', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM redemptions'),
      env.DB.prepare('DELETE FROM evaluation_decisions'),
      env.DB.prepare('DELETE FROM programs'),
      env.DB.prepare('DELETE FROM customers'),
      env.DB.prepare('DELETE FROM schema_versions'),
      env.DB.prepare('DELETE FROM variable_definitions'),
      env.DB.prepare('DELETE FROM merchants'),
    ]);
  });

  test('schema definitions and versions round-trip within merchant scope', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });

    const draft = await repositories.schemas.createNextDraft('merchant-a');
    await repositories.schemas.createDraftDefinition({
      id: 'definition-a',
      merchantId: 'merchant-a',
      schemaVersion: draft.version,
      state: 'draft',
      definition,
      createdAt,
    }, [], [definition]);
    await repositories.schemas.publishDraft('merchant-a', draft.version, [definition], createdAt);

    expect(await repositories.schemas.listDefinitions('merchant-a', 1)).toMatchObject([
      { id: 'definition-a', definition },
    ]);
    expect(await repositories.schemas.listDefinitions('merchant-b', 1)).toEqual([]);
    expect(await repositories.schemas.getVersion('merchant-a', 1)).toMatchObject({
      merchantId: 'merchant-a',
      version: 1,
      definitions: [definition],
    });
    expect(await repositories.schemas.getVersion('merchant-b', 1)).toBeNull();
  });

  test('customer refs are isolated by merchant', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });

    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
    await repositories.customers.create('merchant-b', customer('shared', { tier: 'silver' }));

    expect((await repositories.customers.get('merchant-a', 'shared'))?.attributes.tier).toBe('gold');
    expect((await repositories.customers.get('merchant-b', 'shared'))?.attributes.tier).toBe('silver');
  });

  test('customer writes reject every raw value that cannot round-trip through strict JSON', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const sparse: unknown[] = [null];
    delete sparse[0];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const unsafeValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => 'not-json',
      Symbol('not-json'),
      new Date(),
      [undefined],
      sparse,
      cyclic,
    ];

    const outcomes = await Promise.allSettled(unsafeValues.map((value, index) => (
      repositories.customers.create('merchant-a', {
        externalRef: `unsafe-${index}`,
        attributes: { value },
      })
    )));
    expect(outcomes.every(outcome => outcome.status === 'rejected')).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM customers').first())
      .toEqual({ count: 0 });
  });

  test('composite decision foreign keys reject customer ownership from another merchant', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-b', customer('shared', { tier: 'gold' }));

    await expect(repositories.decisions.create(decision('merchant-a'))).rejects.toThrow();
    expect(await repositories.decisions.get('merchant-a', 'merchant-a-evaluation')).toBeNull();
  });

  test('customer updates require the current optimistic version', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });

    const first = await repositories.customers.upsert({
      merchantId: 'merchant-a',
      externalRef: 'versioned',
      attributes: { tier: 'gold' },
      updatedAt: createdAt,
    });
    const second = await repositories.customers.upsert({
      merchantId: 'merchant-a',
      externalRef: 'versioned',
      attributes: { tier: 'silver' },
      expectedVersion: first.version,
      updatedAt: '2026-07-18T12:01:00.000Z',
    });

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    await expect(repositories.customers.upsert({
      merchantId: 'merchant-a',
      externalRef: 'versioned',
      attributes: { tier: 'gold' },
      expectedVersion: first.version,
      updatedAt: '2026-07-18T12:02:00.000Z',
    })).rejects.toMatchObject({ name: 'OptimisticVersionConflictError' });
  });

  test('programs and decisions round-trip without crossing merchant scope', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });

    await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
    await repositories.decisions.create(decision('merchant-a'));

    expect(await repositories.programs.get('merchant-a', 'welcome-10')).toMatchObject({
      merchantId: 'merchant-a',
      program,
      usageCount: 0,
    });
    expect(await repositories.programs.get('merchant-b', 'welcome-10')).toBeNull();
    expect((await repositories.programs.get('merchant-a', 'welcome-10'))
      ?.program.rewardRules.map(rule => rule.id))
      .toEqual(['default-reward', 'higher-cart']);
    expect(await repositories.decisions.get('merchant-a', 'merchant-a-evaluation')).toMatchObject({
      merchantId: 'merchant-a',
      request,
      decisions: [incentiveDecision],
    });
    expect(await repositories.decisions.get('merchant-b', 'merchant-a-evaluation')).toBeNull();
  });

  test.each([
    ['missing configured usage cap', 'max_uses = NULL'],
    ['mismatched configured usage cap', 'max_uses = 21'],
    ['negative usage count', 'usage_count = -1'],
    ['usage count above its configured cap', 'usage_count = 21'],
    ['missing configured budget', 'budget_remaining = NULL'],
    ['budget above its configured bound', 'budget_remaining = 10001'],
    ['negative remaining budget', 'budget_remaining = -1'],
  ])('program reads fail closed on %s', async (_name, mutation) => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    await env.DB.prepare(`UPDATE programs SET ${mutation} WHERE merchant_id = 'merchant-a'`)
      .run();

    await expect(repositories.programs.get('merchant-a', program.id))
      .rejects.toThrow('Stored program is not canonical');
  });

  test.each([
    ['unexpected relational usage cap', 'max_uses = 1'],
    ['unexpected relational budget', 'budget_remaining = 1'],
  ])('program reads fail closed on %s', async (_name, mutation) => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const unlimited = { ...program, usageCap: undefined, budget: undefined } as PromoProgram;
    await repositories.programs.create({
      merchantId: 'merchant-a',
      program: unlimited,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    await env.DB.prepare(`UPDATE programs SET ${mutation} WHERE merchant_id = 'merchant-a'`)
      .run();

    await expect(repositories.programs.get('merchant-a', program.id))
      .rejects.toThrow('Stored program is not canonical');
  });

  test('decision persistence includes the evaluated facts migration column', async () => {
    const columns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('evaluation_decisions') ORDER BY cid",
    ).all<{ name: string }>();
    expect(columns.results.map(column => column.name)).toEqual([
      'id',
      'merchant_id',
      'customer_ref',
      'customer_version',
      'schema_version',
      'request_json',
      'facts_json',
      'decisions_json',
      'integrity_hash',
      'expires_at',
      'created_at',
    ]);
  });

  test('decision snapshots round-trip canonical program config and reject corrupt config', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
    const snapshot = decision('merchant-a', 'config-snapshot');
    snapshot.facts.programs = [{
      programRef: program.id,
      system: { redemptions_total: 0 },
      config: program,
    }];
    snapshot.integrityHash = await signDecisionSnapshot(snapshot, signingSecret);
    await repositories.decisions.create(snapshot);

    await expect(repositories.decisions.get('merchant-a', 'config-snapshot'))
      .resolves.toMatchObject({
        facts: { programs: [{ programRef: program.id, config: program }] },
      });
    await env.DB.prepare(`
      UPDATE evaluation_decisions
      SET facts_json = json_set(facts_json, '$.programs[0].config.rewardRules[0].id', '')
      WHERE merchant_id = 'merchant-a' AND id = 'config-snapshot'
    `).run();
    await expect(repositories.decisions.get('merchant-a', 'config-snapshot'))
      .rejects.toThrow('Stored evaluation decision is not canonical');
  });

  test('decision writes reject outer customer identity that differs from the request snapshot', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));

    await expect(repositories.decisions.create({
      ...decision('merchant-a'),
      request: { ...request, customerRef: 'different-customer' },
    })).rejects.toThrow(/customer.*request/i);
  });

  test('decision facts reject every value that cannot round-trip through strict JSON', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
    const sparse: unknown[] = [null];
    delete sparse[0];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKeyed: Record<PropertyKey, unknown> = { safe: true };
    symbolKeyed[Symbol('hidden')] = 'not-json';
    const nonEnumerable: Record<string, unknown> = { safe: true };
    Object.defineProperty(nonEnumerable, 'hidden', { value: 'not-json' });
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: () => 'not-json',
    });
    const unsafeValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => 'not-json',
      Symbol('not-json'),
      new Date(),
      [undefined],
      sparse,
      cyclic,
    ];

    const unsafeFacts = [
      ...unsafeValues.map(value => ({ unsafe: value })),
      symbolKeyed,
      nonEnumerable,
      accessor,
    ];

    const results = await Promise.allSettled(unsafeFacts.map((scalar, index) => (
      repositories.decisions.create({
        ...decision('merchant-a', `unsafe-${index}`),
        facts: {
          scalar,
          lineItems: [],
          programs: [],
        },
      })
    )));
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
      .first<{ count: number }>()).toEqual({ count: 0 });
  });

  test('counts committed customer/program uses through tenant-scoped decision snapshots', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');
    await repositories.redemptions.create(redemption('merchant-a', evaluationId, {
      externalOrderRef: 'counted-order',
    }));
    const counter = repositories.redemptions;

    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).resolves.toBe(1);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'other-customer',
      'welcome-10',
      verifyHistoricalDecision,
    )).resolves.toBe(0);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-b',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).resolves.toBe(0);

    const otherProgramResult = {
      ...redemptionResult(
        `${evaluationId}-counted-order`,
        evaluationId,
        { externalOrderRef: 'counted-order' },
      ),
      programRef: 'other-program',
    };
    const otherProgramDecision = {
      ...incentiveDecision,
      programRef: 'other-program',
    };
    const storedSnapshot = await repositories.decisions.get('merchant-a', evaluationId);
    expect(storedSnapshot).not.toBeNull();
    const otherProgramSnapshot = {
      ...storedSnapshot!,
      decisions: [otherProgramDecision],
    };
    const integrityHash = await signDecisionSnapshot(otherProgramSnapshot, signingSecret);
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions SET result_json = ?1
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
      `).bind(JSON.stringify(otherProgramResult), evaluationId),
      env.DB.prepare(`
        UPDATE evaluation_decisions SET decisions_json = ?1, integrity_hash = ?2
        WHERE merchant_id = 'merchant-a' AND id = ?3
      `).bind(JSON.stringify([otherProgramDecision]), integrityHash, evaluationId),
    ]);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).resolves.toBe(0);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'other-program',
      verifyHistoricalDecision,
    )).resolves.toBe(1);
  });

  test('rejects a committed result whose canonical fields do not match its row', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    const mismatched = redemptionResult(
      `${evaluationId}-counted-order`,
      'different-evaluation',
      { externalOrderRef: 'counted-order' },
    );
    await env.DB.prepare(`
      UPDATE redemptions SET result_json = ?1
      WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
    `).bind(JSON.stringify(mismatched), evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow('Stored redemption is not canonical');
  });

  test('rejects committed candidates with a non-canonical result schema', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.prepare(`
      UPDATE redemptions SET result_json = '{"programRef":"welcome-10"}'
      WHERE merchant_id = 'merchant-a' AND evaluation_id = ?1
    `).bind(evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow();
  });

  test('rejects a committed result whose effects differ from its qualified decision', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    const mismatched = {
      ...redemptionResult(
        `${evaluationId}-counted-order`,
        evaluationId,
        { externalOrderRef: 'counted-order' },
      ),
      effects: [{
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 999 },
      }],
    };
    await env.DB.prepare(`
      UPDATE redemptions SET result_json = ?1
      WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
    `).bind(JSON.stringify(mismatched), evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow(/qualified decision|effects/i);
  });

  test('rejects coordinated result and snapshot tampering without a valid HMAC', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    const tamperedEffects = [{
      type: 'order_discount' as const,
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 999 },
    }];
    const tamperedResult = {
      ...redemptionResult(
        `${evaluationId}-counted-order`,
        evaluationId,
        { externalOrderRef: 'counted-order' },
      ),
      effects: tamperedEffects,
    };
    const tamperedDecision = {
      ...incentiveDecision,
      effects: tamperedEffects,
    };
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions SET result_json = ?1
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
      `).bind(JSON.stringify(tamperedResult), evaluationId),
      env.DB.prepare(`
        UPDATE evaluation_decisions SET decisions_json = ?1
        WHERE merchant_id = 'merchant-a' AND id = ?2
      `).bind(JSON.stringify([tamperedDecision]), evaluationId),
    ]);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow(/integrity|signature/i);
  });

  test('rejects a redemption when its snapshot has no matching qualified decision', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.prepare(`
      UPDATE evaluation_decisions SET decisions_json = '[]'
      WHERE merchant_id = 'merchant-a' AND id = ?1
    `).bind(evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow(/qualified decision|snapshot/i);
  });

  test('rejects committed candidates with a non-canonical decision schema', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.prepare(`
      UPDATE evaluation_decisions SET decisions_json = '[{"programRef":"welcome-10"}]'
      WHERE merchant_id = 'merchant-a' AND id = ?1
    `).bind(evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow();
  });

  test('validates other-program candidates before excluding them from the requested count', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    const malformedOtherProgram = {
      ...redemptionResult(
        `${evaluationId}-counted-order`,
        evaluationId,
        { externalOrderRef: 'counted-order' },
      ),
      programRef: 'different-program',
      effects: [],
    };
    await env.DB.prepare(`
      UPDATE redemptions SET result_json = ?1
      WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
    `).bind(JSON.stringify(malformedOtherProgram), evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalDecision,
    )).rejects.toThrow(/qualified decision|snapshot/i);
  });

  test('repository writes reject JSON outside canonical contracts', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });

    await expect(repositories.programs.create({
      merchantId: 'merchant-a',
      program: { ...program, type: 'unknown' } as unknown as PromoProgram,
      schema: null,
      createdAt,
    })).rejects.toThrow();
  });

  test.each([
    ['external order ref only', { externalOrderRef: 'order-1' }],
    ['idempotency key only', { idempotencyKey: 'key-1' }],
    ['both identifiers', { externalOrderRef: 'order-1', idempotencyKey: 'key-1' }],
  ])('redemptions support %s', async (_name, identifiers) => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');
    const input = redemption('merchant-a', evaluationId, identifiers);

    await repositories.redemptions.create(input);

    if (identifiers.externalOrderRef) {
      expect(await repositories.redemptions.getByExternalOrderRef(
        'merchant-a',
        identifiers.externalOrderRef,
      )).toMatchObject(input);
    }
    if (identifiers.idempotencyKey) {
      expect(await repositories.redemptions.getByIdempotencyKey(
        'merchant-a',
        identifiers.idempotencyKey,
      )).toMatchObject(input);
    }
  });

  test('redemptions reject missing identifiers', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');

    await expect(repositories.redemptions.create({
      ...redemption('merchant-a', evaluationId, { externalOrderRef: 'temporary' }),
      externalOrderRef: undefined,
      idempotencyKey: undefined,
    } as unknown as RedemptionCreate)).rejects.toThrow(/identifier/i);
  });

  test.each([
    ['external order refs', { externalOrderRef: 'duplicate-order' }],
    ['idempotency keys', { idempotencyKey: 'duplicate-key' }],
  ])('redemptions enforce merchant-scoped unique %s', async (_name, identifiers) => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationA = await seedDecision('merchant-a');
    const evaluationB = await seedDecision('merchant-b');

    await repositories.redemptions.create(redemption('merchant-a', evaluationA, identifiers));
    const duplicate = redemption('merchant-a', evaluationA, identifiers);
    await expect(repositories.redemptions.create({
      ...duplicate,
      redemptionId: 'second-redemption',
      result: { ...duplicate.result, redemptionId: 'second-redemption' },
    })).rejects.toThrow();
    await expect(repositories.redemptions.create(
      redemption('merchant-b', evaluationB, identifiers),
    )).resolves.toBeUndefined();
  });

  test('redemption lookups cannot cross merchant scope', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');

    await repositories.redemptions.create(redemption('merchant-a', evaluationId, {
      externalOrderRef: 'isolated-order',
      idempotencyKey: 'isolated-key',
    }));

    expect(await repositories.redemptions.getByExternalOrderRef(
      'merchant-b',
      'isolated-order',
    )).toBeNull();
    expect(await repositories.redemptions.getByIdempotencyKey(
      'merchant-b',
      'isolated-key',
    )).toBeNull();
  });

  test('identical redemption keys resolve independently across merchants', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationA = await seedDecision('merchant-a');
    const evaluationB = await seedDecision('merchant-b');
    await repositories.redemptions.create(redemption('merchant-a', evaluationA, {
      externalOrderRef: 'shared-order', idempotencyKey: 'shared-key',
    }));
    await repositories.redemptions.create(redemption('merchant-b', evaluationB, {
      externalOrderRef: 'shared-order', idempotencyKey: 'shared-key',
    }));

    expect((await repositories.redemptions.getByExternalOrderRef(
      'merchant-a', 'shared-order',
    ))?.merchantId).toBe('merchant-a');
    expect((await repositories.redemptions.getByIdempotencyKey(
      'merchant-b', 'shared-key',
    ))?.merchantId).toBe('merchant-b');
  });
});
