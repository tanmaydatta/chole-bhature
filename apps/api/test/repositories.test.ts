import type {
  CodeEvaluationResult,
  CustomerSnapshot,
  EvaluationRequest,
  IncentiveDecision,
  PromoProgram,
  RedemptionResponse,
  VariableDefinition,
} from '@incentives/contracts';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { canonicalJson } from '../src/json.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import type {
  EvaluationDecisionRecord,
  RedemptionBundleCreate,
  RedemptionCreate,
} from '../src/repositories/types.js';
import {
  signDecisionSnapshot,
  verifyDecisionIntegrity,
} from '../src/services/evaluation-service.js';
import {
  signRedemptionReceipt,
  verifyRedemptionReceipt,
} from '../src/services/redemption-receipt.js';

const createdAt = '2026-07-18T12:00:00.000Z';
const expiresAt = '2026-07-18T12:05:00.000Z';
const signingSecret = 'repository-history-signing-secret';
const encoder = new TextEncoder();

async function signLegacyReceipt(payload: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(canonicalJson(payload)),
  ))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

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
  programRevision: 1,
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
    mode: 'automatic',
    submittedCodes: [],
    codeResults: [],
    requestDigest: 'a'.repeat(64),
    correlationId: `${merchantId}-correlation`,
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
  identifiers: { externalOrderRef: string; idempotencyKey: string },
): RedemptionResponse {
  return {
    redemptionId,
    evaluationId,
    externalOrderRef: identifiers.externalOrderRef,
    idempotencyKey: identifiers.idempotencyKey,
    status: 'committed',
    entries: [{
      programRef: 'welcome-10',
      programRevision: 1,
      rewardRuleRef: 'default-reward',
      effects: incentiveDecision.effects,
    }],
  };
}

async function redemption(
  merchantId: string,
  evaluationId: string,
  identifiers: { externalOrderRef?: string; idempotencyKey?: string },
): Promise<RedemptionCreate> {
  const resolvedIdentifiers = {
    externalOrderRef: identifiers.externalOrderRef ?? `${evaluationId}-order`,
    idempotencyKey: identifiers.idempotencyKey ?? `${evaluationId}-key`,
  };
  const redemptionId = `${evaluationId}-${resolvedIdentifiers.externalOrderRef}`;
  const result = redemptionResult(redemptionId, evaluationId, resolvedIdentifiers);
  const unsigned = {
    redemptionId,
    merchantId,
    evaluationId,
    ...resolvedIdentifiers,
    requestDigest: 'd'.repeat(64),
    result,
    entries: [{
      position: 0,
      ...result.entries[0]!,
      discountMinorUnits: 500,
      currency: 'GBP',
    }],
    createdAt,
  };
  return {
    ...unsigned,
    receiptIntegrityHash: await signRedemptionReceipt(unsigned, signingSecret),
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

const verifyHistoricalIntegrity = {
  verifyDecision: (snapshot: EvaluationDecisionRecord) => (
    verifyDecisionIntegrity(snapshot, signingSecret)
  ),
  verifyReceipt: (receipt: RedemptionCreate) => (
    verifyRedemptionReceipt(receipt, signingSecret)
  ),
};

async function seedCommittedRedemption() {
  await seedMerchant('merchant-a');
  const repositories = createRepositories({ DB: env.DB });
  const evaluationId = await seedDecision('merchant-a');
  await repositories.redemptions.create(await redemption('merchant-a', evaluationId, {
    externalOrderRef: 'counted-order',
  }));
  return { evaluationId, repositories };
}

describe('D1 repositories', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM product_audit'),
      env.DB.prepare('DELETE FROM api_credentials'),
      env.DB.prepare('DELETE FROM redemption_commit_guards'),
      env.DB.prepare('DELETE FROM redemption_entries'),
      env.DB.prepare('DELETE FROM redemption_operations'),
      env.DB.prepare('DELETE FROM redemptions'),
      env.DB.prepare('DELETE FROM evaluation_decisions'),
      env.DB.prepare('DELETE FROM promo_code_claims'),
      env.DB.prepare('DELETE FROM program_counters'),
      env.DB.prepare('DELETE FROM program_revisions'),
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

  test.each(['draft', 'scheduled', 'active', 'paused', 'ended'] as const)(
    'lists reward-rule-only variable references from %s programs',
    async (status) => {
      await seedMerchant('merchant-a');
      await seedPublishedSchema('merchant-a');
      const repositories = createRepositories({ DB: env.DB });
      await repositories.programs.create({
        merchantId: 'merchant-a',
        program: {
          ...program,
          id: `reference-${status}`,
          name: `Reference ${status}`,
          status,
          eligibility: { match: 'ALL', conditions: [] },
          rewardRules: [{
            ...program.rewardRules[0]!,
            conditions: {
              match: 'ALL',
              conditions: [{
                id: 'reward-tier',
                variable: definition.key,
                operator: 'eq',
                value: 'gold',
              }],
            },
          }],
          fallbackReward: undefined,
        },
        schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
        createdAt,
      });

      await expect(repositories.programs.listReferencedVariableKeys('merchant-a'))
        .resolves.toContain(definition.key);
    },
  );

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
    await env.DB.exec('PRAGMA ignore_check_constraints = ON');
    try {
      await env.DB.prepare(`
        UPDATE program_counters SET ${mutation} WHERE merchant_id = 'merchant-a'
      `).run();
    } finally {
      await env.DB.exec('PRAGMA ignore_check_constraints = OFF');
    }

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
    await env.DB.prepare(`
      UPDATE program_counters SET ${mutation} WHERE merchant_id = 'merchant-a'
    `).run();

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
      'mode',
      'submitted_codes_json',
      'code_results_json',
      'request_digest',
      'correlation_id',
    ]);
  });

  test('decision snapshots retain ordered submitted codes and code results', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
    const codeResults: CodeEvaluationResult[] = [{
      code: 'vip20',
      normalizedCode: 'VIP20',
      outcome: 'selected',
      programRef: 'welcome-10',
      reasonCodes: [],
    }, {
      code: 'missing',
      normalizedCode: 'MISSING',
      outcome: 'invalid_code',
      reasonCodes: ['INVALID_PROMO_CODE'],
    }];
    const snapshot: EvaluationDecisionRecord = {
      ...decision('merchant-a', 'coded-snapshot'),
      request: { ...request, codes: ['vip20', 'missing'] },
      mode: 'coded',
      submittedCodes: ['vip20', 'missing'],
      codeResults,
      requestDigest: 'b'.repeat(64),
      correlationId: 'correlation-coded-evaluation',
    };
    snapshot.integrityHash = await signDecisionSnapshot(snapshot, signingSecret);

    await repositories.decisions.create(snapshot);

    await expect(repositories.decisions.get('merchant-a', 'coded-snapshot'))
      .resolves.toEqual(snapshot);
  });

  test('decision reads reject stored code diagnostics that require canonicalization', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
    const snapshot: EvaluationDecisionRecord = {
      ...decision('merchant-a', 'noncanonical-code-result'),
      request: { ...request, codes: ['vip20'] },
      mode: 'coded',
      submittedCodes: ['vip20'],
      codeResults: [{
        code: 'vip20',
        normalizedCode: 'VIP20',
        outcome: 'selected',
        programRef: 'welcome-10',
        reasonCodes: [],
      }],
      requestDigest: 'e'.repeat(64),
      correlationId: 'correlation-noncanonical-code-result',
    };
    snapshot.integrityHash = await signDecisionSnapshot(snapshot, signingSecret);
    await repositories.decisions.create(snapshot);
    await env.DB.prepare(`
      UPDATE evaluation_decisions
      SET code_results_json = json_set(code_results_json, '$[0].normalizedCode', 'vip20')
      WHERE merchant_id = 'merchant-a' AND id = 'noncanonical-code-result'
    `).run();

    await expect(repositories.decisions.get('merchant-a', 'noncanonical-code-result'))
      .rejects.toThrow('Stored evaluation decision is not canonical');
  });

  test('redemption bundles retain authoritative child order', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a', 'bundle-evaluation');
    const redemptionId = 'bundle-redemption';
    const result: RedemptionResponse = {
      redemptionId,
      evaluationId,
      externalOrderRef: 'bundle-order',
      idempotencyKey: 'bundle-key',
      status: 'committed',
      entries: [{
        programRef: 'welcome-10',
        programRevision: 1,
        rewardRuleRef: 'default-reward',
        effects: incentiveDecision.effects,
      }, {
        programRef: 'shipping',
        programRevision: 7,
        effects: [{ type: 'free_shipping' }],
      }],
    };
    const unsigned: Omit<RedemptionBundleCreate, 'receiptIntegrityHash'> = {
      redemptionId,
      merchantId: 'merchant-a',
      evaluationId,
      externalOrderRef: 'bundle-order',
      idempotencyKey: 'bundle-key',
      requestDigest: 'c'.repeat(64),
      result,
      entries: [{
        position: 0,
        programRef: 'welcome-10',
        programRevision: 1,
        rewardRuleRef: 'default-reward',
        effects: incentiveDecision.effects,
        discountMinorUnits: 500,
        currency: 'GBP',
      }, {
        position: 1,
        programRef: 'shipping',
        programRevision: 7,
        effects: [{ type: 'free_shipping' }],
        discountMinorUnits: 0,
        currency: 'GBP',
      }],
      createdAt,
    };
    const input: RedemptionBundleCreate = {
      ...unsigned,
      receiptIntegrityHash: await signRedemptionReceipt(unsigned, signingSecret),
    };

    await repositories.redemptions.create(input);

    await expect(repositories.redemptions.getByIdempotencyKey(
      'merchant-a',
      'bundle-key',
      verifyHistoricalIntegrity.verifyReceipt,
    )).resolves.toEqual(input);
    expect((await env.DB.prepare(`
      SELECT position, program_ref AS programRef
      FROM redemption_entries
      WHERE merchant_id = 'merchant-a' AND redemption_id = 'bundle-redemption'
      ORDER BY position
    `).all()).results).toEqual([
      { position: 0, programRef: 'welcome-10' },
      { position: 1, programRef: 'shipping' },
    ]);
    expect(await env.DB.prepare(`
      SELECT state, request_digest AS requestDigest, redemption_id AS redemptionId
      FROM redemption_operations
      WHERE merchant_id = 'merchant-a' AND idempotency_key = 'bundle-key'
    `).first()).toEqual({
      state: 'committed',
      requestDigest: 'c'.repeat(64),
      redemptionId: 'bundle-redemption',
    });
  });

  test('atomic redemption persistence writes a complete readable bundle', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a', 'atomic-bundle-evaluation');
    const storedProgram = await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    const bundle = await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'atomic-bundle-order',
      idempotencyKey: 'atomic-bundle-key',
    });

    await expect(repositories.redemptions.commitAtomically({
      ...bundle,
      programId: storedProgram.id,
      programRef: program.id,
      expectedActiveRevision: 1,
      expectedProgram: program,
      customerRef: 'shared',
    })).resolves.toBe(true);

    await expect(repositories.redemptions.getByIdempotencyKey(
      'merchant-a',
      'atomic-bundle-key',
      verifyHistoricalIntegrity.verifyReceipt,
    )).resolves.toMatchObject(bundle);
    expect(await env.DB.prepare(`
      SELECT state, redemption_id AS redemptionId
      FROM redemption_operations
      WHERE merchant_id = 'merchant-a' AND idempotency_key = 'atomic-bundle-key'
    `).first()).toEqual({
      state: 'committed',
      redemptionId: bundle.redemptionId,
    });
  });

  test('atomic redemption rejects a child revision that differs from the active revision', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a', 'atomic-revision-evaluation');
    const storedProgram = await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    const base = await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'atomic-revision-order',
      idempotencyKey: 'atomic-revision-key',
    });
    const mismatched: RedemptionBundleCreate = {
      ...base,
      result: {
        ...base.result,
        entries: base.result.entries.map(entry => ({ ...entry, programRevision: 2 })),
      },
      entries: base.entries.map(entry => ({ ...entry, programRevision: 2 })),
    };
    mismatched.receiptIntegrityHash = await signRedemptionReceipt(mismatched, signingSecret);

    await expect(repositories.redemptions.commitAtomically({
      ...mismatched,
      programId: storedProgram.id,
      programRef: program.id,
      expectedActiveRevision: 1,
      expectedProgram: program,
      customerRef: 'shared',
    })).rejects.toThrow(/revision|identity/i);
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM redemptions
      WHERE merchant_id = 'merchant-a' AND id = ?1
    `).bind(mismatched.redemptionId).first()).toEqual({ count: 0 });
  });

  test('atomic per-customer caps count current bundles and migrated child entries', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a', 'cap-bundle-evaluation');
    const storedProgram = await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    await repositories.redemptions.create(await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'current-cap-order',
      idempotencyKey: 'current-cap-key',
    }));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO redemptions (
          id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
          result_json, discount_minor_units, currency, created_at, request_digest
        ) VALUES (
          'migrated-cap-redemption', 'merchant-a', 'migrated-cap-order',
          'migrated-cap-key', ?1, ?2, 500, 'GBP', ?3,
          'legacy:migrated-cap-redemption'
        )
      `).bind(evaluationId, JSON.stringify({
        version: 1,
        result: {
          redemptionId: 'migrated-cap-redemption',
          evaluationId,
          externalOrderRef: 'migrated-cap-order',
          idempotencyKey: 'migrated-cap-key',
          programRef: 'welcome-10',
          rewardRuleRef: 'default-reward',
          status: 'committed',
          effects: incentiveDecision.effects,
        },
        receiptIntegrityHash: 'a'.repeat(64),
      }), createdAt),
      env.DB.prepare(`
        INSERT INTO redemption_entries (
          merchant_id, redemption_id, position, program_ref, program_revision,
          reward_rule_ref, effects_json, discount_minor_units, currency
        ) VALUES (
          'merchant-a', 'migrated-cap-redemption', 0, 'welcome-10', 1,
          'default-reward', ?1, 500, 'GBP'
        )
      `).bind(JSON.stringify(incentiveDecision.effects)),
    ]);
    const candidate = await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'rejected-cap-order',
      idempotencyKey: 'rejected-cap-key',
    });

    await expect(repositories.redemptions.commitAtomically({
      ...candidate,
      programId: storedProgram.id,
      programRef: program.id,
      expectedActiveRevision: 1,
      expectedProgram: program,
      customerRef: 'shared',
      perCustomerCap: 2,
    })).resolves.toBe(false);
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM redemptions
      WHERE merchant_id = 'merchant-a' AND id = ?1
    `).bind(candidate.redemptionId).first()).toEqual({ count: 0 });
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
    const countedReceipt = await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'counted-order',
    });
    await repositories.redemptions.create(countedReceipt);
    const counter = repositories.redemptions;

    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).resolves.toBe(1);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'other-customer',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).resolves.toBe(0);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-b',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).resolves.toBe(0);

    const otherProgramResult = {
      ...redemptionResult(
        `${evaluationId}-counted-order`,
        evaluationId,
        { externalOrderRef: 'counted-order', idempotencyKey: `${evaluationId}-key` },
      ),
      entries: [{
        programRef: 'other-program',
        programRevision: 1,
        rewardRuleRef: 'default-reward',
        effects: incentiveDecision.effects,
      }],
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
    const otherProgramReceipt = {
      ...countedReceipt,
      result: otherProgramResult,
      entries: countedReceipt.entries.map(entry => ({ ...entry, programRef: 'other-program' })),
    };
    const receiptIntegrityHash = await signRedemptionReceipt(
      otherProgramReceipt,
      signingSecret,
    );
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions SET result_json = ?1
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
      `).bind(JSON.stringify({
        version: 2,
        result: otherProgramResult,
        receiptIntegrityHash,
      }), evaluationId),
      env.DB.prepare(`
        UPDATE redemption_entries SET program_ref = 'other-program'
        WHERE merchant_id = 'merchant-a' AND redemption_id = ?1
      `).bind(countedReceipt.redemptionId),
      env.DB.prepare(`
        UPDATE evaluation_decisions SET decisions_json = ?1, integrity_hash = ?2
        WHERE merchant_id = 'merchant-a' AND id = ?3
      `).bind(JSON.stringify([otherProgramDecision]), integrityHash, evaluationId),
    ]);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).resolves.toBe(0);
    await expect(counter.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'other-program',
      verifyHistoricalIntegrity,
    )).resolves.toBe(1);
  });

  test('counts duplicate matching children once per committed redemption', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a', 'duplicate-entry-evaluation');
    const base = await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'duplicate-entry-order',
      idempotencyKey: 'duplicate-entry-key',
    });
    const duplicateBundle: RedemptionBundleCreate = {
      ...base,
      result: {
        ...base.result,
        entries: [base.result.entries[0]!, { ...base.result.entries[0]! }],
      },
      entries: [
        base.entries[0]!,
        { ...base.entries[0]!, position: 1 },
      ],
    };
    duplicateBundle.receiptIntegrityHash = await signRedemptionReceipt(
      duplicateBundle,
      signingSecret,
    );
    await repositories.redemptions.create(duplicateBundle);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).resolves.toBe(1);
  });

  test('counts strictly parsed migrated singular redemptions without exposing the old response', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a', 'legacy-evaluation');
    const receiptIntegrityHash = await signLegacyReceipt({
      kind: 'redemption_receipt_v1',
      merchantId: 'merchant-a',
      redemptionId: 'legacy-redemption',
      evaluationId,
      programRef: 'welcome-10',
      rewardRuleRef: 'default-reward',
      effects: incentiveDecision.effects,
      idempotencyKey: 'legacy-key',
      discountMinorUnits: 500,
      currency: 'GBP',
      status: 'committed',
      createdAt,
    });
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO redemptions (
          id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
          result_json, discount_minor_units, currency, created_at, request_digest
        ) VALUES (
          'legacy-redemption', 'merchant-a', NULL, 'legacy-key', ?1,
          ?2, 500, 'GBP', ?3, 'legacy:legacy-redemption'
        )
      `).bind(evaluationId, JSON.stringify({
        version: 1,
        result: {
          redemptionId: 'legacy-redemption',
          evaluationId,
          idempotencyKey: 'legacy-key',
          programRef: 'welcome-10',
          rewardRuleRef: 'default-reward',
          status: 'committed',
          effects: incentiveDecision.effects,
        },
        receiptIntegrityHash,
      }), createdAt),
      env.DB.prepare(`
        INSERT INTO redemption_entries (
          merchant_id, redemption_id, position, program_ref, program_revision,
          reward_rule_ref, effects_json, discount_minor_units, currency
        ) VALUES (
          'merchant-a', 'legacy-redemption', 0, 'welcome-10', 1,
          'default-reward', ?1, 500, 'GBP'
        )
      `).bind(JSON.stringify(incentiveDecision.effects)),
    ]);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).resolves.toBe(1);
    await expect(repositories.redemptions.getByIdempotencyKey(
      'merchant-a',
      'legacy-key',
      verifyHistoricalIntegrity.verifyReceipt,
    )).rejects.toThrow(/canonical|legacy.*private/i);
  });

  test('rejects a committed result whose canonical fields do not match its row', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.prepare(`
      UPDATE redemptions
      SET result_json = json_set(result_json, '$.result.evaluationId', 'different-evaluation')
      WHERE merchant_id = 'merchant-a' AND evaluation_id = ?1
    `).bind(evaluationId).run();

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
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
      verifyHistoricalIntegrity,
    )).rejects.toThrow();
  });

  test('rejects a committed result whose effects differ from its qualified decision', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions
        SET result_json = json_set(
          result_json,
          '$.result.entries[0].effects[0].amount.minorUnits',
          999
        )
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?1
      `).bind(evaluationId),
      env.DB.prepare(`
        UPDATE redemption_entries
        SET effects_json = json_set(effects_json, '$[0].amount.minorUnits', 999)
        WHERE merchant_id = 'merchant-a' AND redemption_id = ?1
      `).bind(`${evaluationId}-counted-order`),
    ]);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).rejects.toThrow(/integrity|signature|qualified decision|effects/i);
  });

  test('rejects a committed result whose reward rule reference differs from its decision', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions
        SET result_json = json_set(
          result_json,
          '$.result.entries[0].rewardRuleRef',
          'other-rule'
        )
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?1
      `).bind(evaluationId),
      env.DB.prepare(`
        UPDATE redemption_entries SET reward_rule_ref = 'other-rule'
        WHERE merchant_id = 'merchant-a' AND redemption_id = ?1
      `).bind(`${evaluationId}-counted-order`),
    ]);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).rejects.toThrow(/integrity|signature|qualified decision|rule reference|snapshot/i);
  });

  test('rejects coordinated result and snapshot tampering without a valid HMAC', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    const tamperedEffects = [{
      type: 'order_discount' as const,
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 999 },
    }];
    const tamperedDecision = {
      ...incentiveDecision,
      effects: tamperedEffects,
    };
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions
        SET result_json = json_set(result_json, '$.result.entries[0].effects', json(?1))
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?2
      `).bind(JSON.stringify(tamperedEffects), evaluationId),
      env.DB.prepare(`
        UPDATE redemption_entries SET effects_json = ?1
        WHERE merchant_id = 'merchant-a' AND redemption_id = ?2
      `).bind(JSON.stringify(tamperedEffects), `${evaluationId}-counted-order`),
      env.DB.prepare(`
        UPDATE evaluation_decisions SET decisions_json = ?1
        WHERE merchant_id = 'merchant-a' AND id = ?2
      `).bind(JSON.stringify([tamperedDecision]), evaluationId),
    ]);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
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
      verifyHistoricalIntegrity,
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
      verifyHistoricalIntegrity,
    )).rejects.toThrow();
  });

  test('validates other-program candidates before excluding them from the requested count', async () => {
    const { evaluationId, repositories } = await seedCommittedRedemption();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions SET result_json = json_set(
          result_json,
          '$.result.entries[0].programRef',
          'different-program',
          '$.result.entries[0].effects',
          json('[]')
        )
        WHERE merchant_id = 'merchant-a' AND evaluation_id = ?1
      `).bind(evaluationId),
      env.DB.prepare(`
        UPDATE redemption_entries SET program_ref = 'different-program', effects_json = '[]'
        WHERE merchant_id = 'merchant-a' AND redemption_id = ?1
      `).bind(`${evaluationId}-counted-order`),
    ]);

    await expect(repositories.redemptions.countCommittedForCustomerProgram(
      'merchant-a',
      'shared',
      'welcome-10',
      verifyHistoricalIntegrity,
    )).rejects.toThrow(/integrity|signature|qualified decision|snapshot/i);
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

  test('redemptions require and support both bundle identifiers', async () => {
    const identifiers = { externalOrderRef: 'order-1', idempotencyKey: 'key-1' };
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');
    const input = await redemption('merchant-a', evaluationId, identifiers);

    await repositories.redemptions.create(input);

    expect(await repositories.redemptions.getByExternalOrderRef(
      'merchant-a',
      identifiers.externalOrderRef,
      verifyHistoricalIntegrity.verifyReceipt,
    )).toMatchObject(input);
    expect(await repositories.redemptions.getByIdempotencyKey(
      'merchant-a',
      identifiers.idempotencyKey,
      verifyHistoricalIntegrity.verifyReceipt,
    )).toMatchObject(input);
  });

  test('redemptions reject missing identifiers', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');

    await expect(repositories.redemptions.create({
      ...await redemption('merchant-a', evaluationId, { externalOrderRef: 'temporary' }),
      externalOrderRef: undefined,
      idempotencyKey: undefined,
    } as unknown as RedemptionCreate)).rejects.toThrow(/identifier|string/i);
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

    await repositories.redemptions.create(await redemption('merchant-a', evaluationA, identifiers));
    const duplicate = await redemption('merchant-a', evaluationA, identifiers);
    await expect(repositories.redemptions.create({
      ...duplicate,
      redemptionId: 'second-redemption',
      result: { ...duplicate.result, redemptionId: 'second-redemption' },
    })).rejects.toThrow();
    await expect(repositories.redemptions.create(
      await redemption('merchant-b', evaluationB, identifiers),
    )).resolves.toBeUndefined();
  });

  test('redemption lookups cannot cross merchant scope', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationId = await seedDecision('merchant-a');

    await repositories.redemptions.create(await redemption('merchant-a', evaluationId, {
      externalOrderRef: 'isolated-order',
      idempotencyKey: 'isolated-key',
    }));

    expect(await repositories.redemptions.getByExternalOrderRef(
      'merchant-b',
      'isolated-order',
      verifyHistoricalIntegrity.verifyReceipt,
    )).toBeNull();
    expect(await repositories.redemptions.getByIdempotencyKey(
      'merchant-b',
      'isolated-key',
      verifyHistoricalIntegrity.verifyReceipt,
    )).toBeNull();
  });

  test('identical redemption keys resolve independently across merchants', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const evaluationA = await seedDecision('merchant-a');
    const evaluationB = await seedDecision('merchant-b');
    await repositories.redemptions.create(await redemption('merchant-a', evaluationA, {
      externalOrderRef: 'shared-order', idempotencyKey: 'shared-key',
    }));
    await repositories.redemptions.create(await redemption('merchant-b', evaluationB, {
      externalOrderRef: 'shared-order', idempotencyKey: 'shared-key',
    }));

    expect((await repositories.redemptions.getByExternalOrderRef(
      'merchant-a', 'shared-order',
      verifyHistoricalIntegrity.verifyReceipt,
    ))?.merchantId).toBe('merchant-a');
    expect((await repositories.redemptions.getByIdempotencyKey(
      'merchant-b', 'shared-key',
      verifyHistoricalIntegrity.verifyReceipt,
    ))?.merchantId).toBe('merchant-b');
  });

  test('merchant provisioning is idempotent by stable provisioning identity', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const input = {
      id: 'merchant-provisioned',
      name: 'Provisioned merchant',
      provisioningId: 'provisioning-123',
      createdAt,
    };

    const first = await repositories.merchants.provision(input);
    const retry = await repositories.merchants.provision(input);

    expect(first).toEqual({
      ...input,
      status: 'provisioning',
      updatedAt: createdAt,
    });
    expect(retry).toEqual(first);
    expect(await repositories.merchants.get('merchant-provisioned')).toEqual(first);
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM merchants WHERE provisioning_id = 'provisioning-123'
    `).first()).toEqual({ count: 1 });
  });

  test('concurrent merchant provisioning converges on one stable identity', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const input = {
      id: 'merchant-concurrent',
      name: 'Concurrent merchant',
      provisioningId: 'provisioning-concurrent',
      createdAt,
    };

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => repositories.merchants.provision(input)),
    );

    expect(attempts).toEqual(Array.from({ length: 8 }, () => attempts[0]));
    expect(attempts[0]).toEqual({
      ...input,
      status: 'provisioning',
      updatedAt: createdAt,
    });
    expect(await env.DB.prepare(`
      SELECT COUNT(*) AS count FROM merchants WHERE provisioning_id = 'provisioning-concurrent'
    `).first()).toEqual({ count: 1 });
  });

  test('credential repositories store digests only and keep views merchant scoped', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const digest = 'b'.repeat(64);
    const view = await repositories.credentials.createWithAudit({
      id: 'credential-a',
      merchantId: 'merchant-a',
      name: 'Storefront publishable',
      environment: 'production',
      kind: 'publishable',
      scopes: ['schema:read', 'evaluations:write'],
      allowedOrigins: [],
      requestsPerMinute: 240,
      digest,
      suffix: 'abc123',
      createdAt,
      createdBy: 'user-123',
    }, {
      id: 'credential-a-created-audit',
      occurredAt: createdAt,
      actorKind: 'member',
      actorId: 'user-123',
      merchantId: 'merchant-a',
      action: 'credential.created',
      targetType: 'credential',
      targetId: 'credential-a',
      outcome: 'succeeded',
      correlationId: 'credential-a-created-correlation',
      metadata: { kind: 'publishable', suffix: 'abc123' },
    });

    expect(view).toEqual({
      id: 'credential-a',
      merchantId: 'merchant-a',
      name: 'Storefront publishable',
      environment: 'production',
      kind: 'publishable',
      scopes: ['schema:read', 'evaluations:write'],
      allowedOrigins: [],
      requestsPerMinute: 240,
      suffix: 'abc123',
      createdAt,
      createdBy: 'user-123',
      status: 'active',
    });
    expect(view).not.toHaveProperty('digest');
    expect(view).not.toHaveProperty('token');
    expect(await repositories.credentials.findByDigest(digest)).toEqual(view);
    expect(await repositories.credentials.list('merchant-b')).toEqual([]);

    await env.DB.prepare(`
      UPDATE api_credentials SET expires_at = '2000-01-01T00:00:00.000Z'
      WHERE id = 'credential-a'
    `).run();
    expect(await repositories.credentials.findByDigest(digest)).toMatchObject({
      id: 'credential-a', status: 'expired',
    });
    expect(await repositories.credentials.list('merchant-a')).toEqual([
      expect.objectContaining({ id: 'credential-a', status: 'expired' }),
    ]);

    await env.DB.prepare(`
      UPDATE api_credentials
      SET status = 'revoked', revoked_at = '2026-07-20T00:00:00.000Z', revoked_by = 'user-123'
      WHERE id = 'credential-a'
    `).run();
    expect(await repositories.credentials.findByDigest(digest)).toMatchObject({
      id: 'credential-a', status: 'revoked',
    });

    const columns = await env.DB.prepare(
      "SELECT name FROM pragma_table_info('api_credentials') ORDER BY cid",
    ).all<{ name: string }>();
    expect(columns.results.map(column => column.name)).toContain('digest');
    expect(columns.results.map(column => column.name)).not.toContain('token');
    expect(columns.results.map(column => column.name)).not.toContain('plaintext');
    expect(await env.DB.prepare(`
      SELECT digest FROM api_credentials
      WHERE merchant_id = 'merchant-a' AND id = 'credential-a'
    `).first()).toEqual({ digest });
  });

  test('logical programs own immutable revisions and counters within merchant scope', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });

    const stored = await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });

    expect(await repositories.programs.getRevision('merchant-a', program.id, 1)).toMatchObject({
      programRef: program.id,
      revision: 1,
      configuration: program,
      createdAt,
      createdBy: 'system:legacy-api',
      publishedAt: createdAt,
      publishedBy: 'system:legacy-api',
    });
    expect(await repositories.programs.getCounters('merchant-a', program.id)).toEqual({
      programId: stored.id,
      merchantId: 'merchant-a',
      maxUses: program.usageCap,
      usageCount: 0,
      budgetRemaining: program.budget?.minorUnits,
      committedSpend: 0,
    });
    expect(await repositories.programs.getRevision('merchant-b', program.id, 1)).toBeNull();
    expect(await repositories.programs.getCounters('merchant-b', program.id)).toBeNull();
  });

  test('program reads prefer owned revision and counter rows over legacy shadows', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const stored = await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });
    const ownedConfiguration = {
      ...program,
      name: 'Owned revision wins',
    };

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE programs SET name = ?1
        WHERE merchant_id = 'merchant-a' AND id = ?2
      `).bind(ownedConfiguration.name, stored.id),
      env.DB.prepare(`
        UPDATE program_revisions SET config_json = ?1
        WHERE merchant_id = 'merchant-a' AND program_id = ?2 AND revision = 1
      `).bind(JSON.stringify(ownedConfiguration), stored.id),
      env.DB.prepare(`
        UPDATE program_counters
        SET usage_count = 2, budget_remaining = 8000
        WHERE merchant_id = 'merchant-a' AND program_id = ?1
      `).bind(stored.id),
    ]);

    expect(await repositories.programs.get('merchant-a', program.id)).toMatchObject({
      program: ownedConfiguration,
      usageCount: 2,
      budgetRemaining: 8000,
    });
    expect(await repositories.programs.list('merchant-a')).toEqual([
      expect.objectContaining({
        program: ownedConfiguration,
        usageCount: 2,
        budgetRemaining: 8000,
      }),
    ]);
  });

  test('deployed D1 constraints reject invalid program pointers and credential or audit enums', async () => {
    await seedMerchant('merchant-a');
    await seedPublishedSchema('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    await repositories.programs.create({
      merchantId: 'merchant-a',
      program,
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });

    await expect(env.DB.prepare(`
      UPDATE programs SET active_revision = 0
      WHERE merchant_id = 'merchant-a' AND external_ref = ?1
    `).bind(program.id).run()).rejects.toThrow();
    await expect(env.DB.prepare(`
      UPDATE programs SET draft_revision = -1
      WHERE merchant_id = 'merchant-a' AND external_ref = ?1
    `).bind(program.id).run()).rejects.toThrow();
    await expect(env.DB.prepare(`
      INSERT INTO api_credentials (
        id, merchant_id, name, environment, kind, scopes_json, digest, suffix,
        status, created_at, created_by
      ) VALUES (
        'invalid-credential', 'merchant-a', 'Invalid', 'preview', 'secret', '[]',
        ?1, 'suffix', 'active', ?2, 'user-123'
      )
    `).bind('c'.repeat(64), createdAt).run()).rejects.toThrow();
    await expect(env.DB.prepare(`
      INSERT INTO product_audit (
        id, occurred_at, actor_kind, actor_id, merchant_id, action,
        target_type, target_id, outcome, correlation_id
      ) VALUES (
        'invalid-audit', ?1, 'anonymous', 'unknown', 'merchant-a', 'invalid',
        'merchant', 'merchant-a', 'ignored', 'correlation-invalid'
      )
    `).bind(createdAt).run()).rejects.toThrow();
  });

  test('schema repository exposes merchant-scoped definition impact and deprecation', async () => {
    await seedMerchant('merchant-a');
    const repositories = createRepositories({ DB: env.DB });
    const draft = await repositories.schemas.createNextDraft('merchant-a');
    await repositories.schemas.createDraftDefinition({
      id: 'definition-impact',
      merchantId: 'merchant-a',
      schemaVersion: draft.version,
      state: 'draft',
      definition,
      createdAt,
    }, [], [definition]);
    await repositories.schemas.publishDraft('merchant-a', draft.version, [definition], createdAt);
    await repositories.customers.create('merchant-a', customer('impact-customer', {
      tier: 'gold',
    }));
    await repositories.programs.create({
      merchantId: 'merchant-a',
      program: {
        ...program,
        eligibility: {
          match: 'ALL',
          conditions: [{
            id: 'tier-condition',
            variable: definition.key,
            operator: 'eq',
            value: 'gold',
          }],
        },
      },
      schema: await repositories.schemas.getLatestVersion('merchant-a', 'published'),
      createdAt,
    });

    expect(await repositories.schemas.getDefinitionImpact(
      'merchant-a',
      definition.key,
    )).toEqual({
      publishedVersions: [1],
      referencedProgramRefs: [program.id],
      storedCustomerCount: 1,
    });
    expect(await repositories.schemas.getDefinitionImpact(
      'missing-merchant',
      definition.key,
    )).toEqual({
      publishedVersions: [],
      referencedProgramRefs: [],
      storedCustomerCount: 0,
    });

    await repositories.schemas.deprecateDefinition({
      merchantId: 'merchant-a',
      id: 'definition-impact',
      schemaVersion: 1,
      deprecatedAt: '2026-07-18T13:00:00.000Z',
      deprecatedBy: 'user-123',
    });
    await expect(repositories.schemas.getDefinition('merchant-a', 'definition-impact'))
      .resolves.toMatchObject({
        state: 'deprecated',
        deprecatedAt: '2026-07-18T13:00:00.000Z',
        deprecatedBy: 'user-123',
      });
  });

  test('D1 enforces deprecation state, timestamp, and actor as one invariant', async () => {
    await seedMerchant('merchant-a');
    await env.DB.prepare(`
      INSERT INTO variable_definitions (
        id, merchant_id, schema_version, key, label, source, type, required,
        state, created_at
      ) VALUES (
        'definition-invariant', 'merchant-a', 1, 'customer.tier', 'Customer tier',
        'customer', 'string', 1, 'published', ?1
      )
    `).bind(createdAt).run();

    await expect(env.DB.prepare(`
      UPDATE variable_definitions
      SET deprecated_at = ?1, deprecated_by = 'user-123'
      WHERE id = 'definition-invariant'
    `).bind(createdAt).run()).rejects.toThrow();
    await expect(env.DB.prepare(`
      UPDATE variable_definitions
      SET state = 'deprecated', deprecated_at = ?1, deprecated_by = NULL
      WHERE id = 'definition-invariant'
    `).bind(createdAt).run()).rejects.toThrow();
    await expect(env.DB.prepare(`
      UPDATE variable_definitions
      SET state = 'deprecated', deprecated_at = NULL, deprecated_by = 'user-123'
      WHERE id = 'definition-invariant'
    `).run()).rejects.toThrow();
  });

  test('schema repository rejects stored definitions with partial deprecation provenance', async () => {
    await seedMerchant('merchant-a');
    await env.DB.prepare(`
      INSERT INTO variable_definitions (
        id, merchant_id, schema_version, key, label, source, type, required,
        state, created_at
      ) VALUES (
        'definition-corrupt', 'merchant-a', 1, 'customer.tier', 'Customer tier',
        'customer', 'string', 1, 'published', ?1
      )
    `).bind(createdAt).run();
    await env.DB.prepare('DROP TRIGGER IF EXISTS variable_definitions_validate_deprecation_update')
      .run();
    await env.DB.prepare(`
      UPDATE variable_definitions SET deprecated_at = ?1
      WHERE id = 'definition-corrupt'
    `).bind(createdAt).run();

    const repositories = createRepositories({ DB: env.DB });
    await expect(repositories.schemas.getDefinition('merchant-a', 'definition-corrupt'))
      .rejects.toThrow('Stored schema definition is not canonical');
  });

  test('product audit persists only canonical safe audit records in merchant scope', async () => {
    await seedMerchant('merchant-a');
    await seedMerchant('merchant-b');
    const repositories = createRepositories({ DB: env.DB });
    const entry = {
      id: 'audit-123',
      occurredAt: createdAt,
      actorKind: 'member' as const,
      actorId: 'user-123',
      merchantId: 'merchant-a',
      action: 'program.published',
      targetType: 'program',
      targetId: program.id,
      outcome: 'succeeded' as const,
      correlationId: 'correlation-123',
      metadata: { programRevision: 1, status: 'active' },
    };

    await repositories.audit.append(entry);

    expect(await repositories.audit.list('merchant-a')).toEqual([entry]);
    expect(await repositories.audit.list('merchant-b')).toEqual([]);
    await expect(repositories.audit.append({
      ...entry,
      id: 'unsafe-audit',
      metadata: { token: { plaintext: 'sk_never-store-this' } },
    } as never)).rejects.toThrow();
  });
});
