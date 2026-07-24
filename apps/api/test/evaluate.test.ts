import {
  ApiErrorSchema,
  EvaluationResponseSchema,
  normalizePromoCode,
  type CommerceReward,
  type EvaluationRequest,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { PromoModule } from '@incentives/promo';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { SEEDED_MERCHANT_ID } from './test-credentials.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import {
  createEvaluationService,
  formatMinorUnits,
  projectedDiscountMinorUnits,
  signDecisionSnapshot,
  verifyDecisionIntegrity,
} from '../src/services/evaluation-service.js';
import { signRedemptionReceipt } from '../src/services/redemption-receipt.js';

const publishedAt = '2026-07-18T12:00:00.000Z';
const signingSecret = 'decision-signing-test-secret';

const definitions = [
  {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'enum',
    required: false,
    enumValues: ['gold', 'silver'],
    defaultErrorMessage: 'This offer is only for gold members.',
  },
  {
    key: 'context.channel',
    label: 'Sales channel',
    source: 'context',
    type: 'string',
    required: false,
  },
] as const satisfies readonly VariableDefinition[];

const baseRequest = {
  customerRef: 'customer-1',
  cart: { currency: 'GBP', subtotal: 6_500, items: [] },
  context: { channel: 'web' },
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
    eligibility: {
      match: 'ALL',
      conditions: [{
        id: `${id}-tier`,
        variable: 'customer.tier',
        operator: 'eq',
        value: 'gold',
      }],
    },
    rewardRules: [conditionalRule(reward ?? {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    })],
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
  return promo(id, {
    ...overrides,
    autoApply: false,
    code,
    stackable: overrides.stackable ?? true,
  });
}

async function seedPublishedSchema(
  merchantId = SEEDED_MERCHANT_ID,
  schemaDefinitions: readonly VariableDefinition[] = definitions,
  version = 1,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO schema_versions (
      merchant_id, version, state, published_at, definitions_json
    ) VALUES (?1, ?2, 'published', ?3, ?4)
  `).bind(merchantId, version, publishedAt, JSON.stringify(schemaDefinitions)).run();
}

async function seedCustomer(
  externalRef = 'customer-1',
  attributes: Record<string, unknown> = { tier: 'gold' },
  merchantId = SEEDED_MERCHANT_ID,
): Promise<void> {
  await createRepositories({ DB: env.DB }).customers.create(merchantId, {
    externalRef,
    attributes,
  });
}

async function seedProgram(
  program: PromoProgram,
  merchantId = SEEDED_MERCHANT_ID,
): Promise<void> {
  const repositories = createRepositories({ DB: env.DB });
  const stored = await repositories.programs.create({
    merchantId,
    program,
    schema: await repositories.schemas.getLatestVersion(merchantId, 'published'),
    createdAt: publishedAt,
  });
  if (!program.autoApply && program.status !== 'draft' && program.status !== 'ended') {
    const code = normalizePromoCode(program.code);
    await env.DB.prepare(`
      INSERT INTO promo_code_claims (
        id, merchant_id, program_id, program_ref, active_revision,
        display_code, normalized_code, starts_at, ends_at, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(
      crypto.randomUUID(),
      merchantId,
      stored.id,
      stored.externalRef,
      stored.revision,
      code.display,
      code.normalized,
      program.startDate ?? null,
      program.endDate ?? null,
      publishedAt,
    ).run();
  }
}

function evaluateRaw(
  body: unknown,
  token = 'pk_test_publishable_credential_material_00000001',
  correlationId?: string,
): Promise<Response> {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  });
  if (correlationId !== undefined) headers.set('x-correlation-id', correlationId);
  return SELF.fetch('https://example.test/v1/evaluate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function evaluate(
  body: unknown = baseRequest,
  token = 'pk_test_publishable_credential_material_00000001',
) {
  const response = await evaluateRaw(body, token);
  expect(response.status).toBe(200);
  return EvaluationResponseSchema.parse(await response.json());
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

async function resetEvaluationData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemption_operations'),
    env.DB.prepare('DELETE FROM redemption_entries'),
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM variable_definitions'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare("DELETE FROM merchants WHERE id <> 'phase-0-merchant'"),
  ]);
  await seedPublishedSchema();
}

type DecisionRow = {
  id: string;
  merchant_id: string;
  mode: string;
  submitted_codes_json: string;
  code_results_json: string;
  request_digest: string;
  correlation_id: string;
  customer_ref: string | null;
  customer_version: number | null;
  schema_version: number;
  request_json: string;
  facts_json: string;
  decisions_json: string;
  integrity_hash: string;
  expires_at: string;
  created_at: string;
};

async function storedDecision(evaluationId: string): Promise<DecisionRow> {
  const row = await env.DB.prepare(`
    SELECT id, merchant_id, mode, submitted_codes_json, code_results_json,
      request_digest, correlation_id, customer_ref, customer_version, schema_version,
      request_json, facts_json, decisions_json, integrity_hash, expires_at, created_at
    FROM evaluation_decisions WHERE merchant_id = ?1 AND id = ?2
  `).bind(SEEDED_MERCHANT_ID, evaluationId).first<DecisionRow>();
  expect(row).not.toBeNull();
  return row!;
}

async function commitDecision(
  evaluationId: string,
  programRef: string,
  effects: CommerceReward[],
  suffix = '1',
): Promise<void> {
  const redemptionId = `redemption-${suffix}`;
  const externalOrderRef = `order-${suffix}`;
  const idempotencyKey = `attempt-${suffix}`;
  const entries = [{
    position: 0,
    programRef,
    programRevision: 1,
    rewardRuleRef: 'default-reward',
    effects,
    discountMinorUnits: 1_000,
    currency: 'GBP',
  }];
  const unsigned = {
    redemptionId,
    merchantId: SEEDED_MERCHANT_ID,
    externalOrderRef,
    idempotencyKey,
    evaluationId,
    requestDigest: 'a'.repeat(64),
    result: {
      redemptionId,
      evaluationId,
      externalOrderRef,
      status: 'committed',
      entries: entries.map(({
        position: _position,
        discountMinorUnits: _discountMinorUnits,
        currency: _currency,
        ...entry
      }) => entry),
      idempotencyKey,
    },
    entries,
    createdAt: publishedAt,
  };
  await createRepositories({ DB: env.DB }).redemptions.create({
    ...unsigned,
    receiptIntegrityHash: await signRedemptionReceipt(unsigned, signingSecret),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

async function hmac(value: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(canonicalJson(value)));
  return [...new Uint8Array(signature)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(bytes)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('POST /v1/evaluate', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetEvaluationData();
  });

  test.each([
    ['GBP', 'GBP 90,071,992,547,409.91'],
    ['JPY', 'JPY 9,007,199,254,740,991'],
    ['KWD', 'KWD 9,007,199,254,740.991'],
  ])('formats max-safe %s minor units without floating-point loss', (
    currency,
    message,
  ) => {
    expect(formatMinorUnits(currency, Number.MAX_SAFE_INTEGER)).toBe(message);
  });

  test('projects max-safe line totals with BigInt and caps the aggregate at cart subtotal', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(projectedDiscountMinorUnits([
      {
        type: 'line_item_discount',
        productRef: 'maximum-product',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: maximum },
      },
      {
        type: 'line_item_discount',
        productRef: 'maximum-product',
        calculation: 'percent',
        basisPoints: 10_000,
      },
    ], {
      currency: 'GBP',
      subtotal: maximum,
      items: [{
        productRef: 'maximum-product',
        quantity: maximum,
        unitPrice: maximum,
      }],
    })).toBe(maximum);
  });

  test.each(['pk_test_publishable_credential_material_00000001', 'sk_test_secret_credential_material_000000000001'])(
    'accepts a %s credential',
    async (token) => {
      await seedProgram(promo('automatic'));
      await seedCustomer();
      expect((await evaluate(baseRequest, token)).decisions[0]?.outcome).toBe('qualified');
    },
  );

  test.each([
    ['omitted codes', baseRequest],
    ['empty codes', { ...baseRequest, codes: [] }],
  ])(
    'selects the first ranked qualified effective automatic Promo for %s and short-circuits',
    async (_label, request) => {
      await seedCustomer();
      await seedProgram(codedPromo('private-coded-inventory', 'PRIVATE', { priority: 1_000 }));
      await seedProgram(promo('paused-automatic', { status: 'paused', priority: 900 }));
      await seedProgram(promo('future-automatic', {
        status: 'active',
        startDate: '2999-01-01',
        priority: 800,
      }));
      await seedProgram(promo('higher-rejected', {
        priority: 100,
        eligibility: {
          match: 'ALL',
          conditions: [{
            id: 'impossible-subtotal',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 100_000,
          }],
        },
      }));
      await seedProgram(promo('A-binary-winner', { priority: 50 }));
      await seedProgram(promo('a-binary-later', { priority: 50 }));

      await env.DB.prepare(`
        INSERT INTO merchants (id, name, created_at)
        VALUES ('other-merchant', 'Other merchant', ?1)
      `).bind(publishedAt).run();
      await seedPublishedSchema('other-merchant');
      await seedProgram(promo('other-tenant-private', { priority: 2_000 }), 'other-merchant');

      const evaluator = vi.spyOn(PromoModule, 'evaluate');
      const result = await evaluate(request);

      expect(result.decisions).toEqual([
        expect.objectContaining({
          programRef: 'A-binary-winner',
          outcome: 'qualified',
        }),
      ]);
      expect(result).not.toHaveProperty('codeResults');
      expect(evaluator.mock.calls.map(([, program]) => program.id)).toEqual([
        'higher-rejected',
        'A-binary-winner',
      ]);
    },
  );

  test('returns no automatic diagnostics when every effective automatic candidate is rejected', async () => {
    await seedCustomer();
    await seedProgram(promo('ineligible-private', {
      priority: 30,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'large-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 100_000,
        }],
      },
    }));
    await seedProgram(promo('currency-private', {
      priority: 20,
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'USD', minorUnits: 1_000 },
      },
    }));
    await seedProgram(promo('exhausted-private', {
      priority: 10,
      usageCap: 1,
    }));
    await env.DB.prepare(`
      UPDATE programs SET usage_count = 1
      WHERE merchant_id = ?1 AND external_ref = 'exhausted-private'
    `).bind(SEEDED_MERCHANT_ID).run();

    const result = await evaluate();

    expect(result.decisions).toEqual([]);
    expect(result).not.toHaveProperty('codeResults');
    expect(JSON.stringify(result)).not.toContain('ineligible-private');
    expect(JSON.stringify(result)).not.toContain('currency-private');
    expect(JSON.stringify(result)).not.toContain('exhausted-private');
  });

  test.each([
    [{ ...baseRequest, customer: { tier: 'gold' } }, 'customer'],
    [{ ...baseRequest, unexpected: true }, 'unexpected'],
    [{ ...baseRequest, cart: { ...baseRequest.cart, subtotal: 65.5 } }, 'cart.subtotal'],
    [{ ...baseRequest, cart: { ...baseRequest.cart, currency: 'gbp' } }, 'cart.currency'],
  ])('rejects non-canonical input without evaluating it', async (body, field) => {
    const error = await expectError(
      await evaluateRaw(body),
      400,
      'CONTEXT_VALIDATION_FAILED',
    );
    expect(error.error.fields?.some(issue => issue.path.includes(field))).toBe(true);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
      .first<{ count: number }>()).toEqual({ count: 0 });
  });

  test('validates required and unknown custom context fields against the published schema', async () => {
    await env.DB.prepare('DELETE FROM schema_versions').run();
    await seedPublishedSchema(SEEDED_MERCHANT_ID, [
      { ...definitions[1], required: true },
    ]);

    const missing = await expectError(await evaluateRaw({
      cart: baseRequest.cart,
    }), 400, 'CONTEXT_VALIDATION_FAILED');
    expect(missing.error.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'context.channel' }),
    ]));

    const unknown = await expectError(await evaluateRaw({
      cart: baseRequest.cart,
      context: { channel: 'web', customerTier: 'gold' },
    }), 400, 'CONTEXT_VALIDATION_FAILED');
    expect(unknown.error.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'context.customerTier' }),
    ]));
  });

  test('loads only stored customer attributes and captures customer/schema versions', async () => {
    await seedProgram(promo('gold-offer'));
    const repositories = createRepositories({ DB: env.DB });
    await repositories.customers.upsert({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: 'customer-1',
      attributes: { tier: 'silver' },
      updatedAt: publishedAt,
    });
    await repositories.customers.upsert({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: 'customer-1',
      attributes: { tier: 'gold' },
      expectedVersion: 1,
      updatedAt: '2026-07-18T12:01:00.000Z',
    });

    const result = await evaluate();
    expect(result).toMatchObject({
      customerRef: 'customer-1',
      customerVersion: 2,
      schemaVersion: 1,
      decisions: [{
        programRef: 'gold-offer',
        outcome: 'qualified',
        message: 'You received GBP 10.00 off.',
      }],
    });
    expect(result.evaluationId).not.toContain('customer-1');
    expect(JSON.stringify(result)).not.toContain('tier');

    const stored = await storedDecision(result.evaluationId);
    expect(JSON.parse(stored.request_json)).toEqual(baseRequest);
    expect(JSON.parse(stored.facts_json)).toMatchObject({
      scalar: {
        'customer.tier': 'gold',
        'context.channel': 'web',
        'cart.currency': 'GBP',
        'cart.subtotal': 6_500,
      },
      lineItems: [],
    });
    expect(stored).toMatchObject({
      customer_ref: 'customer-1',
      customer_version: 2,
      schema_version: 1,
    });
  });

  test('selects tiered rewards, exposes only the winner, and snapshots exact configuration', async () => {
    await seedCustomer();
    const lowerReward = {
      type: 'order_discount' as const,
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 1_000 },
    };
    const higherReward = {
      type: 'order_discount' as const,
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 2_000 },
    };
    const program = promo('tiered', {
      rewardRules: [
        {
          ...conditionalRule(higherReward, 'over-100'),
          conditions: {
            match: 'ALL',
            conditions: [{
              id: 'over-100-cart',
              variable: 'cart.subtotal',
              operator: 'gte',
              value: 10_000,
            }],
          },
        },
        {
          ...conditionalRule(lowerReward, 'under-100'),
          conditions: {
            match: 'ALL',
            conditions: [{
              id: 'under-100-cart',
              variable: 'cart.subtotal',
              operator: 'lt',
              value: 10_000,
            }],
          },
        },
      ],
    });
    await seedProgram(program);

    const lower = await evaluate();
    expect(lower.decisions[0]).toMatchObject({
      outcome: 'qualified',
      rewardRuleRef: 'under-100',
      effects: [lowerReward],
    });
    expect(JSON.stringify(lower.decisions[0])).not.toContain('2000');

    const higher = await evaluate({
      ...baseRequest,
      cart: { ...baseRequest.cart, subtotal: 12_000 },
    });
    expect(higher.decisions[0]).toMatchObject({
      outcome: 'qualified',
      rewardRuleRef: 'over-100',
      effects: [higherReward],
    });

    const snapshot = JSON.parse((await storedDecision(lower.evaluationId)).facts_json);
    expect(snapshot.programs[0]).toEqual(expect.objectContaining({
      programRef: 'tiered',
      config: program,
    }));
    expect(JSON.parse((await storedDecision(lower.evaluationId)).decisions_json)[0])
      .toMatchObject({ rewardRuleRef: 'under-100', effects: [lowerReward] });
    expect(JSON.parse((await storedDecision(lower.evaluationId)).decisions_json))
      .not.toContainEqual(expect.objectContaining({ effects: [higherReward] }));
  });

  test('returns the selected automatic fallback without leaking a lower no-match candidate', async () => {
    await seedCustomer();
    const impossibleRule = {
      ...conditionalRule({ type: 'free_shipping' }, 'impossible'),
      conditions: {
        match: 'ALL' as const,
        conditions: [{
          id: 'impossible-cart',
          variable: 'cart.subtotal',
          operator: 'gte' as const,
          value: 100_000,
        }],
      },
    };
    await seedProgram(promo('fallback-http', {
      priority: 20,
      rewardRules: [impossibleRule],
      fallbackReward: {
        id: 'fallback',
        name: 'Fallback',
        reward: { type: 'free_shipping' },
      },
    }));
    await seedProgram(promo('no-match-http', {
      priority: 10,
      rewardRules: [impossibleRule],
    }));

    const result = await evaluate();
    expect(result.decisions).toEqual([
      expect.objectContaining({
        programRef: 'fallback-http',
        outcome: 'qualified',
        rewardRuleRef: 'fallback',
        effects: [{ type: 'free_shipping' }],
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('no-match-http');
  });

  test('uses only the selected rule cost for multi-rule budget exhaustion', async () => {
    await seedCustomer();
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
    await seedProgram(codedPromo('selected-budget', 'SELECTED-BUDGET', {
      rewardRules: [expensive, selected],
      budget: { currency: 'GBP', minorUnits: 500 },
    }));

    const request = { ...baseRequest, codes: ['selected-budget'] };
    expect((await evaluate(request)).decisions[0]).toMatchObject({
      outcome: 'qualified',
      rewardRuleRef: 'selected-cheap',
      effects: [selected.reward],
    });
    await env.DB.prepare(`
      UPDATE programs SET budget_remaining = 499
      WHERE merchant_id = ?1 AND external_ref = 'selected-budget'
    `).bind(SEEDED_MERCHANT_ID).run();
    const exhausted = await evaluate(request);
    expect(exhausted.decisions).toEqual([]);
    expect(exhausted.codeResults?.[0]).toMatchObject({
      outcome: 'exhausted',
      reasonCodes: ['BUDGET_EXHAUSTED'],
    });
  });

  test('rejects any caller path that tries to override stored customer attributes', async () => {
    await seedCustomer('customer-1', { tier: 'silver' });
    await seedProgram(promo('gold-only'));

    await expectError(await evaluateRaw({
      ...baseRequest,
      context: {
        ...baseRequest.context,
        'customer.tier': 'gold',
      },
    }), 400, 'CONTEXT_VALIDATION_FAILED');

    const result = await evaluate(baseRequest);
    expect(result.decisions).toEqual([]);
  });

  test('supports anonymous evaluation only when customerRef is omitted', async () => {
    await seedProgram(promo('anonymous-check'));
    const result = await evaluate({
      cart: baseRequest.cart,
      context: baseRequest.context,
    });

    expect(result).not.toHaveProperty('customerRef');
    expect(result).not.toHaveProperty('customerVersion');
    expect(result.decisions).toEqual([]);
    const stored = await storedDecision(result.evaluationId);
    expect(stored.customer_ref).toBeNull();
    expect(stored.customer_version).toBeNull();
  });

  test('returns CUSTOMER_NOT_FOUND for a supplied unknown customer', async () => {
    const error = await expectError(await evaluateRaw(baseRequest), 404, 'CUSTOMER_NOT_FOUND');
    expect(error.error.retryable).toBe(false);
  });

  test.each([
    ['type change', {
      original: [{
        key: 'customer.value', label: 'Value', source: 'customer', type: 'number', required: false,
      }],
      attributes: { value: 7 },
      changed: [{
        key: 'customer.value', label: 'Value', source: 'customer', type: 'string', required: false,
      }],
    }],
    ['enum narrowing', {
      original: [{
        key: 'customer.value', label: 'Value', source: 'customer', type: 'enum', required: false,
        enumValues: ['gold', 'silver'],
      }],
      attributes: { value: 'gold' },
      changed: [{
        key: 'customer.value', label: 'Value', source: 'customer', type: 'enum', required: false,
        enumValues: ['silver'],
      }],
    }],
    ['field removal', {
      original: [{
        key: 'customer.value', label: 'Value', source: 'customer', type: 'string', required: false,
      }],
      attributes: { value: 'legacy' },
      changed: [],
    }],
  ] as const)(
    'fails closed when a stored customer profile is stale after a published %s',
    async (_name, fixture) => {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM customers'),
        env.DB.prepare('DELETE FROM schema_versions'),
      ]);
      await seedPublishedSchema(SEEDED_MERCHANT_ID, fixture.original);
      await seedCustomer('customer-1', fixture.attributes);
      await env.DB.prepare(`
        UPDATE schema_versions SET definitions_json = ?1
        WHERE merchant_id = ?2 AND version = 1 AND state = 'published'
      `).bind(JSON.stringify(fixture.changed), SEEDED_MERCHANT_ID).run();

      const error = await expectError(
        await evaluateRaw({
          customerRef: 'customer-1',
          cart: { currency: 'GBP', subtotal: 6_500, items: [] },
        }),
        503,
        'EVALUATION_UNAVAILABLE',
      );
      expect(error.error.retryable).toBe(true);
      expect(JSON.stringify(error)).not.toContain('not_qualified');
      expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
        .first<{ count: number }>()).toEqual({ count: 0 });
    },
  );

  test('evaluates only distinct submitted normalized codes and keeps diagnostics in input order', async () => {
    await seedCustomer();
    await seedProgram(promo('suppressed-automatic', { priority: 1_000 }));
    await seedProgram(codedPromo('unrelated-coded', 'PRIVATE', { priority: 900 }));
    await seedProgram(codedPromo('promo-b', 'VIP20', { priority: 20 }));
    await seedProgram(codedPromo('promo-a', 'SAVE10', { priority: 20 }));

    const evaluator = vi.spyOn(PromoModule, 'evaluate');
    const result = await evaluate({
      ...baseRequest,
      codes: ['vip20', 'unknown', ' VIP20 ', 'save10'],
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({
        programRef: 'promo-a',
        outcome: 'qualified',
      }),
      expect.objectContaining({
        programRef: 'promo-b',
        outcome: 'qualified',
      }),
    ]);
    expect(result.codeResults).toEqual([
      {
        code: 'vip20',
        normalizedCode: 'VIP20',
        outcome: 'selected',
        programRef: 'promo-b',
        reasonCodes: [],
      },
      {
        code: 'unknown',
        normalizedCode: 'UNKNOWN',
        outcome: 'invalid_code',
        reasonCodes: ['INVALID_PROMO_CODE'],
      },
      {
        code: 'save10',
        normalizedCode: 'SAVE10',
        outcome: 'selected',
        programRef: 'promo-a',
        reasonCodes: [],
      },
    ]);
    expect(evaluator.mock.calls.map(([, program]) => program.id)).toEqual([
      'promo-b',
      'promo-a',
    ]);
    expect(JSON.stringify(result)).not.toContain('suppressed-automatic');
    expect(JSON.stringify(result)).not.toContain('unrelated-coded');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  test('keeps resolved failures diagnostic without blocking a valid stackable code', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('selected-code', 'SELECTED', { priority: 10 }));
    await seedProgram(codedPromo('ineligible-code', 'INELIGIBLE', {
      priority: 50,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'minimum-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 100_000,
        }],
      },
    }));
    await seedProgram(codedPromo('paused-code', 'PAUSED', {
      status: 'paused',
      priority: 40,
    }));
    await seedProgram(codedPromo('scheduled-code', 'SCHEDULED', {
      status: 'active',
      startDate: '2999-01-01',
      priority: 30,
    }));
    await seedProgram(codedPromo('exhausted-code', 'EXHAUSTED', {
      priority: 20,
      usageCap: 1,
    }));
    await env.DB.prepare(`
      UPDATE programs SET usage_count = 1
      WHERE merchant_id = ?1 AND external_ref = 'exhausted-code'
    `).bind(SEEDED_MERCHANT_ID).run();

    const result = await evaluate({
      ...baseRequest,
      codes: ['missing', 'INELIGIBLE', 'PAUSED', 'SCHEDULED', 'EXHAUSTED', 'SELECTED'],
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({
        programRef: 'selected-code',
        outcome: 'qualified',
      }),
    ]);
    expect(result.codeResults).toEqual([
      {
        code: 'missing',
        normalizedCode: 'MISSING',
        outcome: 'invalid_code',
        reasonCodes: ['INVALID_PROMO_CODE'],
      },
      expect.objectContaining({
        code: 'INELIGIBLE',
        outcome: 'not_qualified',
        programRef: 'ineligible-code',
      }),
      expect.objectContaining({
        code: 'PAUSED',
        outcome: 'unavailable',
        programRef: 'paused-code',
      }),
      expect.objectContaining({
        code: 'SCHEDULED',
        outcome: 'unavailable',
        programRef: 'scheduled-code',
      }),
      expect.objectContaining({
        code: 'EXHAUSTED',
        outcome: 'exhausted',
        programRef: 'exhausted-code',
      }),
      expect.objectContaining({
        code: 'SELECTED',
        outcome: 'selected',
        programRef: 'selected-code',
      }),
    ]);
  });

  test('selects one qualified non-stackable submitted code', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('solo', 'SOLO', { stackable: false }));

    const result = await evaluate({ ...baseRequest, codes: ['solo'] });
    expect(result.decisions).toEqual([
      expect.objectContaining({
        programRef: 'solo',
        outcome: 'qualified',
      }),
    ]);
    expect(result.codeResults).toEqual([
      expect.objectContaining({
        code: 'solo',
        outcome: 'selected',
        programRef: 'solo',
      }),
    ]);
  });

  test('rejects a mixed qualified combination and rewrites only qualified diagnostics', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('stackable-qualified', 'STACK', {
      priority: 30,
      stackable: true,
    }));
    await seedProgram(codedPromo('exclusive-qualified', 'EXCLUSIVE', {
      priority: 20,
      stackable: false,
    }));
    await seedProgram(codedPromo('ineligible-preserved', 'NOPE', {
      priority: 10,
      stackable: true,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'minimum-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 100_000,
        }],
      },
    }));

    const result = await evaluate({
      ...baseRequest,
      codes: ['NOPE', 'STACK', 'missing', 'EXCLUSIVE'],
    });

    expect(result.decisions).toEqual([]);
    expect(result.codeResults).toEqual([
      expect.objectContaining({
        code: 'NOPE',
        outcome: 'not_qualified',
        programRef: 'ineligible-preserved',
      }),
      {
        code: 'STACK',
        normalizedCode: 'STACK',
        outcome: 'combination_rejected',
        programRef: 'stackable-qualified',
        reasonCodes: ['CODE_COMBINATION_NOT_ALLOWED'],
      },
      {
        code: 'missing',
        normalizedCode: 'MISSING',
        outcome: 'invalid_code',
        reasonCodes: ['INVALID_PROMO_CODE'],
      },
      {
        code: 'EXCLUSIVE',
        normalizedCode: 'EXCLUSIVE',
        outcome: 'combination_rejected',
        programRef: 'exclusive-qualified',
        reasonCodes: ['CODE_COMBINATION_NOT_ALLOWED'],
      },
    ]);
  });

  test('cancels every prepared reservation after combination rejection and stays rejected on cleanup failure', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('cleanup-stackable', 'CLEANUP-STACK', {
      priority: 20,
      stackable: true,
    }));
    await seedProgram(codedPromo('cleanup-exclusive', 'CLEANUP-EXCLUSIVE', {
      priority: 10,
      stackable: false,
    }));
    const cancelled: unknown[] = [];
    const cleanupFailure = vi.fn();
    const service = createEvaluationService(
      createRepositories({ DB: env.DB }),
      env,
      {
        reservations: {
          prepare: async ({ decision }) => ({ programRef: decision.programRef }),
          cancel: async (handle) => {
            cancelled.push(handle);
            if ((handle as { programRef: string }).programRef === 'cleanup-stackable') {
              throw new Error('simulated cancellation uncertainty');
            }
          },
          onCleanupFailure: cleanupFailure,
        },
      },
    );

    const result = await service.evaluate(
      SEEDED_MERCHANT_ID,
      {
        ...baseRequest,
        codes: ['cleanup-stack', 'cleanup-exclusive'],
      },
      'reservation-cleanup-correlation',
    );

    expect(result.decisions).toEqual([]);
    expect(result.codeResults?.map(({ outcome }) => outcome)).toEqual([
      'combination_rejected',
      'combination_rejected',
    ]);
    expect(cancelled).toEqual([
      { programRef: 'cleanup-stackable' },
      { programRef: 'cleanup-exclusive' },
    ]);
    expect(cleanupFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'reservation-cleanup-correlation',
        programRef: 'cleanup-stackable',
      }),
      expect.any(Error),
    );
  });

  test('cancels an earlier prepared reservation when a later preparation fails', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('prepare-first', 'PREPARE-FIRST', {
      priority: 20,
      stackable: true,
    }));
    await seedProgram(codedPromo('prepare-fails', 'PREPARE-FAILS', {
      priority: 10,
      stackable: true,
    }));
    const prepareFailure = new Error('simulated later preparation failure');
    const cancel = vi.fn(async () => {});
    const service = createEvaluationService(
      createRepositories({ DB: env.DB }),
      env,
      {
        reservations: {
          prepare: async ({ decision }) => {
            if (decision.programRef === 'prepare-fails') throw prepareFailure;
            return { programRef: decision.programRef };
          },
          cancel,
        },
      },
    );

    await expect(service.evaluate(
      SEEDED_MERCHANT_ID,
      {
        ...baseRequest,
        codes: ['prepare-first', 'prepare-fails'],
      },
      'later-prepare-failure',
    )).rejects.toMatchObject({
      message: 'Evaluation pipeline failed',
      cause: prepareFailure,
    });
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ programRef: 'prepare-first' });
  });

  test('cancels an automatic winner when signed snapshot persistence fails', async () => {
    await seedCustomer();
    await seedProgram(promo('automatic-persistence-failure'));
    const persistenceFailure = new Error('simulated decision snapshot failure');
    const repositories = createRepositories({ DB: env.DB });
    const cancel = vi.fn(async () => {});
    const service = createEvaluationService({
      ...repositories,
      decisions: {
        ...repositories.decisions,
        create: async () => {
          throw persistenceFailure;
        },
      },
    }, env, {
      reservations: {
        prepare: async ({ decision }) => ({ programRef: decision.programRef }),
        cancel,
      },
    });

    await expect(service.evaluate(
      SEEDED_MERCHANT_ID,
      baseRequest,
      'automatic-persistence-failure',
    )).rejects.toMatchObject({
      message: 'Evaluation pipeline failed',
      cause: persistenceFailure,
    });
    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      programRef: 'automatic-persistence-failure',
    });
  });

  test('keeps the original persistence failure and attempts later cleanup after cancellation fails', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('cancel-first', 'CANCEL-FIRST', {
      priority: 20,
      stackable: true,
    }));
    await seedProgram(codedPromo('cancel-later', 'CANCEL-LATER', {
      priority: 10,
      stackable: true,
    }));
    const persistenceFailure = new Error('authoritative persistence failure');
    const cancellationFailure = new Error('simulated cancellation uncertainty');
    const repositories = createRepositories({ DB: env.DB });
    const cleanupAttempts: unknown[] = [];
    const cleanupFailure = vi.fn();
    const service = createEvaluationService({
      ...repositories,
      decisions: {
        ...repositories.decisions,
        create: async () => {
          throw persistenceFailure;
        },
      },
    }, env, {
      reservations: {
        prepare: async ({ decision }) => ({ programRef: decision.programRef }),
        cancel: async (handle) => {
          cleanupAttempts.push(handle);
          if ((handle as { programRef: string }).programRef === 'cancel-first') {
            throw cancellationFailure;
          }
        },
        onCleanupFailure: cleanupFailure,
      },
    });

    await expect(service.evaluate(
      SEEDED_MERCHANT_ID,
      {
        ...baseRequest,
        codes: ['cancel-first', 'cancel-later'],
      },
      'cleanup-continuation',
    )).rejects.toMatchObject({
      message: 'Evaluation pipeline failed',
      cause: persistenceFailure,
    });
    expect(cleanupAttempts).toEqual([
      { programRef: 'cancel-first' },
      { programRef: 'cancel-later' },
    ]);
    expect(cleanupFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        correlationId: 'cleanup-continuation',
        programRef: 'cancel-first',
      }),
      cancellationFailure,
    );
  });

  test('does not cancel rejected-combination reservations twice when persistence later fails', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('reject-once-stackable', 'REJECT-ONCE-STACK', {
      priority: 20,
      stackable: true,
    }));
    await seedProgram(codedPromo('reject-once-exclusive', 'REJECT-ONCE-EXCLUSIVE', {
      priority: 10,
      stackable: false,
    }));
    const persistenceFailure = new Error('post-rejection persistence failure');
    const repositories = createRepositories({ DB: env.DB });
    const cancel = vi.fn(async () => {});
    const service = createEvaluationService({
      ...repositories,
      decisions: {
        ...repositories.decisions,
        create: async () => {
          throw persistenceFailure;
        },
      },
    }, env, {
      reservations: {
        prepare: async ({ decision }) => ({ programRef: decision.programRef }),
        cancel,
      },
    });

    await expect(service.evaluate(
      SEEDED_MERCHANT_ID,
      {
        ...baseRequest,
        codes: ['reject-once-stack', 'reject-once-exclusive'],
      },
      'reject-once-correlation',
    )).rejects.toMatchObject({
      message: 'Evaluation pipeline failed',
      cause: persistenceFailure,
    });
    expect(cancel.mock.calls.map(([handle]) => handle)).toEqual([
      { programRef: 'reject-once-stackable' },
      { programRef: 'reject-once-exclusive' },
    ]);
  });

  test('retains a prepared automatic winner after successful snapshot persistence', async () => {
    await seedCustomer();
    await seedProgram(promo('automatic-persistence-success'));
    const cancel = vi.fn(async () => {});
    const service = createEvaluationService(
      createRepositories({ DB: env.DB }),
      env,
      {
        reservations: {
          prepare: async ({ decision }) => ({ programRef: decision.programRef }),
          cancel,
        },
      },
    );

    await expect(service.evaluate(
      SEEDED_MERCHANT_ID,
      baseRequest,
      'automatic-persistence-success',
    )).resolves.toMatchObject({
      decisions: [{
        programRef: 'automatic-persistence-success',
        outcome: 'qualified',
      }],
    });
    expect(cancel).not.toHaveBeenCalled();
  });

  test.each([
    ['total usage', { usageCap: 2 }, 'USAGE_CAP_EXHAUSTED'],
    ['budget', { budget: { currency: 'GBP', minorUnits: 999 } }, 'BUDGET_EXHAUSTED'],
  ] as const)('returns exhausted when authoritative %s is insufficient', async (
    _name,
    overrides,
    reasonCode,
  ) => {
    await seedCustomer();
    await seedProgram(codedPromo('limited', 'LIMITED', overrides));
    if ('usageCap' in overrides) {
      await env.DB.prepare(`
        UPDATE programs SET usage_count = ?1
        WHERE merchant_id = ?2 AND external_ref = 'limited'
      `).bind(overrides.usageCap, SEEDED_MERCHANT_ID).run();
    }

    const result = await evaluate({ ...baseRequest, codes: ['limited'] });
    expect(result.decisions).toEqual([]);
    expect(result.codeResults?.[0]).toEqual(expect.objectContaining({
      programRef: 'limited',
      outcome: 'exhausted',
      reasonCodes: [reasonCode],
    }));
  });

  test('enforces per-customer caps from committed tenant-scoped redemptions', async () => {
    await seedCustomer();
    const program = codedPromo('once-per-customer', 'ONCE', { perCustomerCap: 1 });
    await seedProgram(program);
    const request = { ...baseRequest, codes: ['once'] };
    const first = await evaluate(request);
    await commitDecision(
      first.evaluationId,
      program.id,
      [program.rewardRules[0]!.reward],
      'per-customer',
    );

    const second = await evaluate(request);
    expect(second.decisions).toEqual([]);
    expect(second.codeResults?.[0]).toEqual(expect.objectContaining({
      outcome: 'exhausted',
      reasonCodes: ['PER_CUSTOMER_CAP_EXHAUSTED'],
    }));
    const stored = await storedDecision(second.evaluationId);
    expect(JSON.parse(stored.facts_json)).toMatchObject({
      programs: [{
        programRef: program.id,
        system: { customer_uses_count: 1 },
      }],
    });
  });

  test('returns retryable 503 for coordinated history tampering without a valid HMAC', async () => {
    await seedCustomer();
    const program = codedPromo('corrupt-customer-count', 'CORRUPT', { perCustomerCap: 2 });
    await seedProgram(program);
    const request = { ...baseRequest, codes: ['corrupt'] };
    const first = await evaluate(request);
    await commitDecision(
      first.evaluationId,
      program.id,
      [program.rewardRules[0]!.reward],
      'corrupt-count',
    );
    const tamperedEffects = [{
      type: 'order_discount' as const,
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 999 },
    }];
    const corruptedDecision = {
      ...first.decisions[0]!,
      effects: tamperedEffects,
    };
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions
        SET result_json = json_set(result_json, '$.result.effects', json(?1))
        WHERE merchant_id = ?2 AND evaluation_id = ?3
      `).bind(JSON.stringify(tamperedEffects), SEEDED_MERCHANT_ID, first.evaluationId),
      env.DB.prepare(`
        UPDATE evaluation_decisions SET decisions_json = ?1
        WHERE merchant_id = ?2 AND id = ?3
      `).bind(JSON.stringify([corruptedDecision]), SEEDED_MERCHANT_ID, first.evaluationId),
    ]);

    const error = await expectError(
      await evaluateRaw(request),
      503,
      'EVALUATION_UNAVAILABLE',
    );
    expect(error.error.retryable).toBe(true);
  });

  test('fails an anonymous per-customer-capped program closed before qualification', async () => {
    await seedProgram(codedPromo('customer-required', 'CUSTOMER', {
      eligibility: { match: 'ALL', conditions: [] },
      perCustomerCap: 1,
    }));

    const result = await evaluate({
      codes: ['customer'],
      cart: baseRequest.cart,
      context: baseRequest.context,
    });
    expect(result.decisions).toEqual([]);
    expect(result.codeResults?.[0]).toEqual(expect.objectContaining({
      programRef: 'customer-required',
      outcome: 'not_qualified',
      reasonCodes: ['CUSTOMER_REQUIRED'],
    }));
  });

  test.each([
    [
      'paused availability',
      'PAUSED',
      {
        status: 'paused',
        eligibility: { match: 'ALL', conditions: [] },
        perCustomerCap: 1,
      },
      'unavailable',
      'PROGRAM_UNAVAILABLE',
    ],
    [
      'independent condition failure',
      'CONDITION',
      {
        eligibility: {
          match: 'ALL',
          conditions: [{
            id: 'mobile-only',
            variable: 'context.channel',
            operator: 'eq',
            value: 'mobile',
          }],
        },
        perCustomerCap: 1,
      },
      'not_qualified',
      'CONDITION_NOT_MET',
    ],
  ] as const)(
    'preserves %s before applying anonymous per-customer requirements',
    async (_name, code, overrides, outcome, reasonCode) => {
      await seedProgram(codedPromo(
        `anonymous-${outcome}`,
        code,
        overrides as Partial<PromoProgram>,
      ));

      const result = await evaluate({
        codes: [code],
        cart: baseRequest.cart,
        context: baseRequest.context,
      });
      expect(result.decisions).toEqual([]);
      expect(result.codeResults?.[0]).toEqual(expect.objectContaining({
        outcome,
        reasonCodes: [reasonCode],
      }));
    },
  );

  test.each([
    [
      'fixed order',
      { type: 'order_discount', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 1_000 } },
      1_000,
    ],
    [
      'percent order rounded down',
      { type: 'order_discount', calculation: 'percent', basisPoints: 1_250 },
      812,
    ],
    [
      'fixed matching line quantities',
      {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 100 },
      },
      300,
    ],
    [
      'percent matching line total rounded down',
      {
        type: 'line_item_discount',
        productRef: 'product-a',
        calculation: 'percent',
        basisPoints: 1_250,
      },
      124,
    ],
  ] as const)('uses exact projected discount cost for %s budget checks', async (
    _name,
    reward,
    projectedCost,
  ) => {
    await seedCustomer();
    const request = {
      ...baseRequest,
      codes: ['projected'],
      cart: {
        currency: 'GBP',
        subtotal: 6_500,
        items: [
          { productRef: 'product-a', quantity: 3, unitPrice: 333 },
          { productRef: 'product-b', quantity: 1, unitPrice: 1_000 },
        ],
      },
    } satisfies EvaluationRequest;
    await seedProgram(codedPromo('projected', 'PROJECTED', {
      reward: reward as CommerceReward,
      budget: { currency: 'GBP', minorUnits: projectedCost },
    }));

    expect((await evaluate(request)).decisions[0]?.outcome).toBe('qualified');
    await env.DB.prepare(`
      UPDATE programs SET budget_remaining = ?1
      WHERE merchant_id = ?2 AND external_ref = 'projected'
    `).bind(projectedCost - 1, SEEDED_MERCHANT_ID).run();
    const exhausted = await evaluate(request);
    expect(exhausted.decisions).toEqual([]);
    expect(exhausted.codeResults?.[0]).toMatchObject({
      outcome: 'exhausted',
      reasonCodes: ['BUDGET_EXHAUSTED'],
    });
  });

  test('evaluates max-safe unit price and quantity without an intermediate overflow 503', async () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    await seedCustomer();
    await seedProgram(promo('max-safe-projection', {
      reward: {
        type: 'line_item_discount',
        productRef: 'maximum-product',
        calculation: 'percent',
        basisPoints: 10_000,
      },
      budget: { currency: 'GBP', minorUnits: maximum },
    }));

    const result = await evaluate({
      ...baseRequest,
      cart: {
        currency: 'GBP',
        subtotal: maximum,
        items: [{
          productRef: 'maximum-product',
          quantity: maximum,
          unitPrice: maximum,
        }],
      },
    });
    expect(result.decisions[0]?.outcome).toBe('qualified');
  });

  test.each([
    {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    },
    {
      type: 'line_item_discount',
      productRef: 'product-a',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    },
  ] as const)(
    'returns a deterministic unavailable decision when $type reward currency differs from cart',
    async (reward) => {
      await seedCustomer();
      await seedProgram(codedPromo('wrong-currency', 'WRONG-CURRENCY', {
        reward,
      }));
      const result = await evaluate({
        ...baseRequest,
        codes: ['wrong-currency'],
        cart: { ...baseRequest.cart, currency: 'USD' },
      });
      expect(result.decisions).toEqual([]);
      expect(result.codeResults?.[0]).toEqual(expect.objectContaining({
        outcome: 'unavailable',
        reasonCodes: ['CURRENCY_MISMATCH'],
      }));
    },
  );

  test('preserves global eligibility failure before selected-reward currency checks', async () => {
    await seedCustomer('customer-1', { tier: 'silver' });
    await seedProgram(codedPromo('percent-budget-currency', 'PERCENT-BUDGET', {
      reward: {
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 1_000,
      },
      budget: { currency: 'GBP', minorUnits: 10_000 },
    }));

    const result = await evaluate({
      ...baseRequest,
      codes: ['percent-budget'],
      cart: { ...baseRequest.cart, currency: 'USD' },
    });
    expect(result.decisions).toEqual([]);
    expect(result.codeResults?.[0]).toEqual(expect.objectContaining({
      outcome: 'not_qualified',
      reasonCodes: ['CONDITION_NOT_MET'],
    }));
  });

  test('does not let a matching budget mask a fixed reward currency mismatch', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('masked-reward-currency', 'MASKED', {
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'USD', minorUnits: 1_000 },
      },
      budget: { currency: 'GBP', minorUnits: 10_000 },
    }));

    const result = await evaluate({ ...baseRequest, codes: ['masked'] });
    expect(result.decisions).toEqual([]);
    expect(result.codeResults?.[0]).toEqual(expect.objectContaining({
      outcome: 'unavailable',
      reasonCodes: ['CURRENCY_MISMATCH'],
    }));
  });

  test('keeps free shipping without a monetary budget at zero projected cost', async () => {
    await seedCustomer();
    await seedProgram(promo('free-shipping', {
      reward: { type: 'free_shipping' },
      budget: undefined,
    }));

    const result = await evaluate();
    expect(result.decisions[0]).toEqual(expect.objectContaining({
      outcome: 'qualified',
      effects: [{ type: 'free_shipping' }],
      message: 'You received free shipping.',
    }));
  });

  test.each([
    ['JPY', 1_000, 'You received JPY 1,000 off.'],
    ['KWD', 1_234, 'You received KWD 1.234 off.'],
  ])('formats %s using its ISO currency fraction digits', async (
    currency,
    minorUnits,
    message,
  ) => {
    await seedCustomer();
    await seedProgram(promo(`currency-${currency}`, {
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency, minorUnits },
      },
    }));
    const result = await evaluate({
      ...baseRequest,
      cart: { ...baseRequest.cart, currency },
    });
    expect(result.decisions[0]?.message).toBe(message);
  });

  test('returns an exact max-safe fixed-money message through the evaluation route', async () => {
    await seedCustomer();
    await seedProgram(promo('maximum-message', {
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: Number.MAX_SAFE_INTEGER },
      },
    }));

    const result = await evaluate({
      ...baseRequest,
      cart: { ...baseRequest.cart, subtotal: Number.MAX_SAFE_INTEGER },
    });
    expect(result.decisions[0]?.message)
      .toBe('You received GBP 90,071,992,547,409.91 off.');
  });

  test.each([
    [
      'missing cart attribute',
      { currency: 'GBP', subtotal: 100, items: [] },
      'cart.delivery_country',
    ],
    [
      'typed cart attribute',
      { currency: 'GBP', subtotal: 100, items: [], attributes: { delivery_country: 42 } },
      'cart.delivery_country',
    ],
    [
      'unknown cart attribute',
      {
        currency: 'GBP',
        subtotal: 100,
        items: [],
        attributes: { delivery_country: 'GB', unexpected: true },
      },
      'cart.unexpected',
    ],
    [
      'missing line-item attribute',
      {
        currency: 'GBP',
        subtotal: 100,
        attributes: { delivery_country: 'GB' },
        items: [{ productRef: 'p-1', quantity: 1, unitPrice: 100 }],
      },
      'line_item[0].category',
    ],
    [
      'typed line-item attribute',
      {
        currency: 'GBP',
        subtotal: 100,
        attributes: { delivery_country: 'GB' },
        items: [{
          productRef: 'p-1',
          quantity: 1,
          unitPrice: 100,
          attributes: { category: 42 },
        }],
      },
      'line_item[0].category',
    ],
    [
      'unknown line-item attribute',
      {
        currency: 'GBP',
        subtotal: 100,
        attributes: { delivery_country: 'GB' },
        items: [{
          productRef: 'p-1',
          quantity: 1,
          unitPrice: 100,
          attributes: { category: 'shoes', unexpected: true },
        }],
      },
      'line_item[0].unexpected',
    ],
  ] as const)('reports the exact custom field path for %s', async (
    _name,
    cart,
    path,
  ) => {
    await env.DB.prepare('DELETE FROM schema_versions').run();
    await seedPublishedSchema(SEEDED_MERCHANT_ID, [
      {
        key: 'cart.delivery_country',
        label: 'Delivery country',
        source: 'cart',
        type: 'string',
        required: true,
      },
      {
        key: 'line_item.category',
        label: 'Category',
        source: 'line_item',
        type: 'string',
        required: true,
      },
    ]);
    const error = await expectError(await evaluateRaw({ cart }), 400, 'CONTEXT_VALIDATION_FAILED');
    expect(error.error.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ path }),
    ]));
  });

  test('uses a configurable TTL with a five-minute default', async () => {
    await seedCustomer();
    await seedProgram(promo('ttl'));
    const defaultResult = await evaluate();
    const defaultStored = await storedDecision(defaultResult.evaluationId);
    expect(Date.parse(defaultStored.expires_at) - Date.parse(defaultStored.created_at)).toBe(300_000);

    const app = createApp();
    const customResponse = await app.request('https://example.test/v1/evaluate', {
      method: 'POST',
      headers: {
        authorization: 'Bearer pk_test_publishable_credential_material_00000001',
        'content-type': 'application/json',
      },
      body: JSON.stringify(baseRequest),
    }, {
      DB: env.DB,
      DECISION_SIGNING_SECRET: signingSecret,
      EVALUATION_TTL_SECONDS: '42',
    });
    expect(customResponse.status).toBe(200);
    const custom = EvaluationResponseSchema.parse(await customResponse.json());
    const customStored = await storedDecision(custom.evaluationId);
    expect(Date.parse(customStored.expires_at) - Date.parse(customStored.created_at)).toBe(42_000);
  });

  test.each([
    ['missing signing secret', undefined, undefined, 'decision_integrity'],
    ['weak signing secret', 'weak', undefined, 'decision_integrity'],
    ['zero TTL', signingSecret, '0', undefined],
    ['fractional TTL', signingSecret, '1.5', undefined],
    ['oversized TTL', signingSecret, '86401', undefined],
    ['non-numeric TTL', signingSecret, 'not-a-number', undefined],
  ])('fails closed for %s without leaking configuration', async (
    _name,
    secret,
    ttl,
    expectedDependency,
  ) => {
    await seedCustomer();
    await seedProgram(promo('config-failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await createApp().request('https://example.test/v1/evaluate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer pk_test_publishable_credential_material_00000001',
          'content-type': 'application/json',
        },
        body: JSON.stringify(baseRequest),
      }, {
        DB: env.DB,
        ...(secret === undefined ? {} : { DECISION_SIGNING_SECRET: secret }),
        ...(ttl === undefined ? {} : { EVALUATION_TTL_SECONDS: ttl }),
      });
      const error = await expectError(response, 503, 'EVALUATION_UNAVAILABLE');
      expect(error.error.retryable).toBe(true);
      expect(JSON.stringify(error)).not.toContain(secret ?? 'missing-secret');
      if (ttl !== undefined && ttl.length > 1) {
        expect(JSON.stringify(error)).not.toContain(ttl);
      }
      expect(errorLog).toHaveBeenCalledTimes(1);
      const log = JSON.parse(String(errorLog.mock.calls[0]?.[0])) as {
        dependency?: string;
      };
      expect(log.dependency).toBe(expectedDependency);
    } finally {
      errorLog.mockRestore();
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
      .first<{ count: number }>()).toEqual({ count: 0 });
  });

  test('persists an immutable tenant-scoped snapshot signed over all canonical fields', async () => {
    await seedCustomer();
    await seedProgram(codedPromo('signed', 'SIGNED'));
    const request = {
      ...baseRequest,
      codes: [' signed ', 'missing', 'SIGNED'],
    };
    const response = await evaluateRaw(
      request,
      'pk_test_publishable_credential_material_00000001',
      'task-5-correlation',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe('task-5-correlation');
    const result = EvaluationResponseSchema.parse(await response.json());
    const row = await storedDecision(result.evaluationId);
    const submittedCodes = JSON.parse(row.submitted_codes_json);
    const codeResults = JSON.parse(row.code_results_json);
    expect(row).toMatchObject({
      mode: 'coded',
      correlation_id: 'task-5-correlation',
    });
    expect(submittedCodes).toEqual(['signed', 'missing']);
    expect(codeResults).toEqual(result.codeResults);
    expect(row.request_digest).toBe(await sha256({
      mode: 'coded',
      request: {
        ...baseRequest,
        codes: ['SIGNED', 'MISSING'],
      },
    }));
    const snapshot = {
      mode: row.mode,
      submittedCodes,
      codeResults,
      requestDigest: row.request_digest,
      correlationId: row.correlation_id,
      customerRef: row.customer_ref ?? undefined,
      customerVersion: row.customer_version ?? undefined,
      schemaVersion: row.schema_version,
      request: JSON.parse(row.request_json),
      facts: JSON.parse(row.facts_json),
      decisions: JSON.parse(row.decisions_json),
    };
    const signedPayload = {
      merchantId: row.merchant_id,
      evaluationId: row.id,
      snapshot,
      expiresAt: row.expires_at,
    };
    expect(row.integrity_hash).toBe(await hmac(signedPayload));

    const tamperedPayload = {
      ...signedPayload,
      snapshot: {
        ...snapshot,
        codeResults: [...snapshot.codeResults].reverse(),
        facts: {
          ...snapshot.facts,
          scalar: { ...snapshot.facts.scalar, 'customer.tier': 'silver' },
        },
      },
    };
    expect(await hmac(tamperedPayload)).not.toBe(row.integrity_hash);

    const persisted = await createRepositories({ DB: env.DB }).decisions.get(
      SEEDED_MERCHANT_ID,
      result.evaluationId,
    );
    expect(persisted).not.toBeNull();
    expect(await verifyDecisionIntegrity(persisted!, signingSecret)).toBe(true);
    const tamperedRecord = structuredClone(persisted!);
    tamperedRecord.facts.scalar['customer.tier'] = 'silver';
    expect(await verifyDecisionIntegrity(tamperedRecord, signingSecret)).toBe(false);
    const tamperedConfig = structuredClone(persisted!);
    tamperedConfig.facts.programs[0]!.config.rewardRules[0]!.name = 'Tampered reward';
    expect(await verifyDecisionIntegrity(tamperedConfig, signingSecret)).toBe(false);
    const tamperedOrder = structuredClone(persisted!);
    tamperedOrder.codeResults.reverse();
    expect(await verifyDecisionIntegrity(tamperedOrder, signingSecret)).toBe(false);

    await env.DB.prepare(
      "INSERT INTO merchants (id, name, created_at) VALUES ('merchant-b', 'Merchant B', ?1)",
    ).bind(publishedAt).run();
    const repositories = createRepositories({ DB: env.DB });
    expect(await repositories.decisions.get('merchant-b', result.evaluationId)).toBeNull();

    const before = await storedDecision(result.evaluationId);
    await repositories.customers.upsert({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: 'customer-1',
      attributes: { tier: 'silver' },
      expectedVersion: 1,
    });
    const after = await storedDecision(result.evaluationId);
    expect(after).toEqual(before);
  });

  test('canonical signing is key-order independent and rejects lossy JSON collisions', async () => {
    await seedCustomer();
    await seedProgram(promo('canonical-json'));
    const result = await evaluate();
    const persisted = await createRepositories({ DB: env.DB }).decisions.get(
      SEEDED_MERCHANT_ID,
      result.evaluationId,
    );
    expect(persisted).not.toBeNull();
    const left = structuredClone(persisted!);
    left.facts.scalar = { alpha: 1, beta: 2 };
    const right = structuredClone(persisted!);
    right.facts.scalar = { beta: 2, alpha: 1 };
    expect(await signDecisionSnapshot(left, signingSecret))
      .toBe(await signDecisionSnapshot(right, signingSecret));

    const sparse: unknown[] = [null];
    delete sparse[0];
    const unsafeValues: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      [undefined],
      sparse,
      1n,
      () => 'not-json',
      Symbol('not-json'),
      new Date(),
    ];
    for (const value of unsafeValues) {
      const unsafe = structuredClone(persisted!);
      unsafe.facts.scalar = { unsafe: value };
      await expect(signDecisionSnapshot(unsafe, signingSecret)).rejects.toThrow(/JSON/i);
    }

    const nanRecord = structuredClone(persisted!);
    nanRecord.facts.scalar = { collision: Number.NaN };
    const nullRecord = structuredClone(persisted!);
    nullRecord.facts.scalar = { collision: null };
    await expect(signDecisionSnapshot(nanRecord, signingSecret)).rejects.toThrow(/JSON/i);
    await expect(signDecisionSnapshot(nullRecord, signingSecret)).resolves.toMatch(/^[0-9a-f]{64}$/);

    const undefinedArray = structuredClone(persisted!);
    undefinedArray.facts.scalar = { collision: [undefined] };
    const emptyArray = structuredClone(persisted!);
    emptyArray.facts.scalar = { collision: [] };
    await expect(signDecisionSnapshot(undefinedArray, signingSecret)).rejects.toThrow(/JSON/i);
    await expect(signDecisionSnapshot(emptyArray, signingSecret)).resolves.toMatch(/^[0-9a-f]{64}$/);

    const cyclic = structuredClone(persisted!);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    cyclic.facts.scalar = cycle;
    await expect(signDecisionSnapshot(cyclic, signingSecret)).rejects.toThrow(/JSON/i);
  });

  test('returns retryable 503 rather than ineligibility when stored evaluation state is corrupt', async () => {
    await seedCustomer();
    await seedProgram(promo('corrupt'));
    await env.DB.prepare(`
      UPDATE program_revisions SET config_json = '{"invalid":true}'
      WHERE merchant_id = ?1 AND revision = (
        SELECT active_revision FROM programs
        WHERE merchant_id = ?1 AND external_ref = 'corrupt'
      ) AND program_id = (
        SELECT id FROM programs
        WHERE merchant_id = ?1 AND external_ref = 'corrupt'
      )
    `).bind(SEEDED_MERCHANT_ID).run();

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await evaluateRaw(
        baseRequest,
        'pk_test_publishable_credential_material_00000001',
        'correlation-123',
      );
      const error = await expectError(
        response,
        503,
        'EVALUATION_UNAVAILABLE',
      );
      expect(error.error.retryable).toBe(true);
      expect(error.error.correlationId).toBe('correlation-123');
      expect(response.headers.get('x-correlation-id')).toBe('correlation-123');
      expect(JSON.stringify(error)).not.toContain('not_qualified');
      expect(errorLog).toHaveBeenCalledTimes(1);

      const serialized = String(errorLog.mock.calls[0]?.[0]);
      expect(JSON.parse(serialized)).toMatchObject({
        event: 'api_request_failed',
        correlationId: 'correlation-123',
        route: '/v1/evaluate',
        method: 'POST',
        code: 'EVALUATION_UNAVAILABLE',
        status: 503,
        retryable: true,
        merchantId: SEEDED_MERCHANT_ID,
        credentialId: expect.any(String),
        dependency: 'd1',
      });
      expect(serialized).not.toContain('Authorization');
      expect(serialized).not.toContain('00000001');
      expect(serialized).not.toContain('customer-1');
      expect(serialized).not.toContain('6500');
      expect(serialized).not.toContain('"cart"');
      expect(serialized).not.toContain('"context"');
      expect(serialized).not.toContain('invalid');
    } finally {
      errorLog.mockRestore();
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
      .first<{ count: number }>()).toEqual({ count: 0 });
  });
});
