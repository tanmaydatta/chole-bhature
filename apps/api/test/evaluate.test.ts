import {
  ApiErrorSchema,
  EvaluationResponseSchema,
  type EvaluationRequest,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createApp } from '../src/app.js';
import { SEEDED_MERCHANT_ID } from '../src/auth/static-token.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import {
  formatMinorUnits,
  projectedDiscountMinorUnits,
  signDecisionSnapshot,
  verifyDecisionIntegrity,
} from '../src/services/evaluation-service.js';

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

function promo(id: string, overrides: Partial<PromoProgram> = {}): PromoProgram {
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
    reward: {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 1_000 },
    },
    stackable: false,
    priority: 10,
    autoApply: true,
    ...overrides,
  } as PromoProgram;
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
  await repositories.programs.create({
    merchantId,
    program,
    schema: await repositories.schemas.getLatestVersion(merchantId, 'published'),
    createdAt: publishedAt,
  });
}

function evaluateRaw(
  body: unknown,
  token = 'publishable-test',
): Promise<Response> {
  return SELF.fetch('https://example.test/v1/evaluate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function evaluate(
  body: unknown = baseRequest,
  token = 'publishable-test',
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
    SELECT id, merchant_id, customer_ref, customer_version, schema_version,
      request_json, facts_json, decisions_json, integrity_hash, expires_at, created_at
    FROM evaluation_decisions WHERE merchant_id = ?1 AND id = ?2
  `).bind(SEEDED_MERCHANT_ID, evaluationId).first<DecisionRow>();
  expect(row).not.toBeNull();
  return row!;
}

async function commitDecision(
  evaluationId: string,
  programRef: string,
  effects: PromoProgram['reward'][],
  suffix = '1',
): Promise<void> {
  await createRepositories({ DB: env.DB }).redemptions.create({
    redemptionId: `redemption-${suffix}`,
    merchantId: SEEDED_MERCHANT_ID,
    externalOrderRef: `order-${suffix}`,
    evaluationId,
    result: {
      redemptionId: `redemption-${suffix}`,
      evaluationId,
      programRef,
      externalOrderRef: `order-${suffix}`,
      status: 'committed',
      effects,
    },
    discountMinorUnits: 1_000,
    currency: 'GBP',
    createdAt: publishedAt,
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

describe('POST /v1/evaluate', () => {
  beforeEach(resetEvaluationData);

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

  test.each(['publishable-test', 'secret-test'])(
    'accepts a %s credential',
    async (token) => {
      await seedProgram(promo('automatic'));
      await seedCustomer();
      expect((await evaluate(baseRequest, token)).decisions[0]?.outcome).toBe('qualified');
    },
  );

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
    expect(result.decisions[0]).toMatchObject({
      outcome: 'not_qualified',
      reasonCodes: ['CONDITION_NOT_MET'],
      message: 'This offer is only for gold members.',
    });
  });

  test('supports anonymous evaluation only when customerRef is omitted', async () => {
    await seedProgram(promo('anonymous-check'));
    const result = await evaluate({
      cart: baseRequest.cart,
      context: baseRequest.context,
    });

    expect(result).not.toHaveProperty('customerRef');
    expect(result).not.toHaveProperty('customerVersion');
    expect(result.decisions[0]).toMatchObject({
      outcome: 'not_qualified',
      reasonCodes: ['ATTRIBUTE_MISSING'],
    });
    const stored = await storedDecision(result.evaluationId);
    expect(stored.customer_ref).toBeNull();
    expect(stored.customer_version).toBeNull();
  });

  test('returns CUSTOMER_NOT_FOUND for a supplied unknown customer', async () => {
    const error = await expectError(await evaluateRaw(baseRequest), 404, 'CUSTOMER_NOT_FOUND');
    expect(error.error.retryable).toBe(false);
  });

  test('emits qualified, not-qualified, invalid-code, and unavailable decisions with stable messages', async () => {
    await seedCustomer();
    await seedProgram(promo('qualified', { priority: 40, stackable: true }));
    await seedProgram(promo('not-qualified', {
      priority: 30,
      stackable: true,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'minimum-cart',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 10_000,
          message: 'Spend at least GBP 100.00.',
        }],
      },
    }));
    await seedProgram(promo('invalid-code', {
      priority: 20,
      stackable: true,
      autoApply: false,
      code: 'RIGHTCODE',
    }));
    await seedProgram(promo('unavailable', {
      priority: 10,
      stackable: true,
      status: 'paused',
    }));

    const result = await evaluate({ ...baseRequest, code: 'WRONGCODE' });
    expect(result.decisions).toEqual([
      expect.objectContaining({
        programRef: 'qualified',
        outcome: 'qualified',
        message: 'You received GBP 10.00 off.',
      }),
      expect.objectContaining({
        programRef: 'not-qualified',
        outcome: 'not_qualified',
        message: 'Spend at least GBP 100.00.',
      }),
      expect.objectContaining({
        programRef: 'invalid-code',
        outcome: 'invalid_code',
        message: 'This promotion code is invalid.',
      }),
      expect.objectContaining({
        programRef: 'unavailable',
        outcome: 'unavailable',
        message: 'This promotion is unavailable.',
      }),
    ]);
  });

  test('resolves non-stacking conflicts centrally with deterministic messages', async () => {
    await seedCustomer();
    await seedProgram(promo('lower', { priority: 10 }));
    await seedProgram(promo('higher', { priority: 20 }));

    const result = await evaluate();
    expect(result.decisions).toEqual([
      expect.objectContaining({
        programRef: 'higher',
        outcome: 'qualified',
        message: 'You received GBP 10.00 off.',
      }),
      expect.objectContaining({
        programRef: 'lower',
        outcome: 'conflict',
        reasonCodes: ['STACKING_CONFLICT'],
        message: 'This promotion cannot be combined with another offer.',
      }),
    ]);
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
    await seedProgram(promo('limited', overrides));
    if ('usageCap' in overrides) {
      await env.DB.prepare(`
        UPDATE programs SET usage_count = ?1
        WHERE merchant_id = ?2 AND external_ref = 'limited'
      `).bind(overrides.usageCap, SEEDED_MERCHANT_ID).run();
    }

    const result = await evaluate();
    expect(result.decisions[0]).toEqual(expect.objectContaining({
      programRef: 'limited',
      outcome: 'exhausted',
      effects: [],
      reasonCodes: [reasonCode],
      message: 'This promotion has been exhausted.',
      commitRequired: false,
      eligible: false,
    }));
  });

  test('enforces per-customer caps from committed tenant-scoped redemptions', async () => {
    await seedCustomer();
    const program = promo('once-per-customer', { perCustomerCap: 1 });
    await seedProgram(program);
    const first = await evaluate();
    await commitDecision(
      first.evaluationId,
      program.id,
      [program.reward],
      'per-customer',
    );

    const second = await evaluate();
    expect(second.decisions[0]).toEqual(expect.objectContaining({
      outcome: 'exhausted',
      effects: [],
      reasonCodes: ['PER_CUSTOMER_CAP_EXHAUSTED'],
      commitRequired: false,
      eligible: false,
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
    const program = promo('corrupt-customer-count', { perCustomerCap: 2 });
    await seedProgram(program);
    const first = await evaluate();
    await commitDecision(first.evaluationId, program.id, [program.reward], 'corrupt-count');
    const tamperedEffects = [{
      type: 'order_discount' as const,
      calculation: 'fixed' as const,
      amount: { currency: 'GBP', minorUnits: 999 },
    }];
    const corruptedResult = {
      redemptionId: 'redemption-corrupt-count',
      evaluationId: first.evaluationId,
      programRef: program.id,
      externalOrderRef: 'order-corrupt-count',
      status: 'committed',
      effects: tamperedEffects,
    };
    const corruptedDecision = {
      ...first.decisions[0]!,
      effects: tamperedEffects,
    };
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE redemptions SET result_json = ?1
        WHERE merchant_id = ?2 AND evaluation_id = ?3
      `).bind(JSON.stringify(corruptedResult), SEEDED_MERCHANT_ID, first.evaluationId),
      env.DB.prepare(`
        UPDATE evaluation_decisions SET decisions_json = ?1
        WHERE merchant_id = ?2 AND id = ?3
      `).bind(JSON.stringify([corruptedDecision]), SEEDED_MERCHANT_ID, first.evaluationId),
    ]);

    const error = await expectError(
      await evaluateRaw(baseRequest),
      503,
      'EVALUATION_UNAVAILABLE',
    );
    expect(error.error.retryable).toBe(true);
  });

  test('fails an anonymous per-customer-capped program closed before qualification', async () => {
    await seedProgram(promo('customer-required', {
      eligibility: { match: 'ALL', conditions: [] },
      perCustomerCap: 1,
    }));

    const result = await evaluate({
      cart: baseRequest.cart,
      context: baseRequest.context,
    });
    expect(result.decisions[0]).toEqual(expect.objectContaining({
      programRef: 'customer-required',
      outcome: 'not_qualified',
      effects: [],
      reasonCodes: ['CUSTOMER_REQUIRED'],
      commitRequired: false,
      eligible: false,
    }));
  });

  test.each([
    [
      'paused availability',
      {
        status: 'paused',
        eligibility: { match: 'ALL', conditions: [] },
        perCustomerCap: 1,
      },
      'unavailable',
      'PROGRAM_UNAVAILABLE',
    ],
    [
      'missing manual code',
      {
        eligibility: { match: 'ALL', conditions: [] },
        perCustomerCap: 1,
        autoApply: false,
        code: 'REQUIRED',
      },
      'invalid_code',
      'INVALID_PROMO_CODE',
    ],
    [
      'independent condition failure',
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
    async (_name, overrides, outcome, reasonCode) => {
      await seedProgram(promo(`anonymous-${outcome}`, overrides as Partial<PromoProgram>));

      const result = await evaluate({
        cart: baseRequest.cart,
        context: baseRequest.context,
      });
      expect(result.decisions[0]).toEqual(expect.objectContaining({
        outcome,
        effects: [],
        reasonCodes: [reasonCode],
        commitRequired: false,
        eligible: false,
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
      cart: {
        currency: 'GBP',
        subtotal: 6_500,
        items: [
          { productRef: 'product-a', quantity: 3, unitPrice: 333 },
          { productRef: 'product-b', quantity: 1, unitPrice: 1_000 },
        ],
      },
    } satisfies EvaluationRequest;
    await seedProgram(promo('projected', {
      reward: reward as PromoProgram['reward'],
      budget: { currency: 'GBP', minorUnits: projectedCost },
    }));

    expect((await evaluate(request)).decisions[0]?.outcome).toBe('qualified');
    await env.DB.prepare(`
      UPDATE programs SET budget_remaining = ?1
      WHERE merchant_id = ?2 AND external_ref = 'projected'
    `).bind(projectedCost - 1, SEEDED_MERCHANT_ID).run();
    expect((await evaluate(request)).decisions[0]).toMatchObject({
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
      await seedProgram(promo('wrong-currency', {
        reward,
      }));
      const result = await evaluate({
        ...baseRequest,
        cart: { ...baseRequest.cart, currency: 'USD' },
      });
      expect(result.decisions[0]).toEqual(expect.objectContaining({
        outcome: 'unavailable',
        effects: [],
        reasonCodes: ['CURRENCY_MISMATCH'],
        message: 'This promotion is unavailable for this currency.',
        commitRequired: false,
        eligible: false,
      }));
    },
  );

  test('checks percent-reward budget currency before qualification', async () => {
    await seedCustomer('customer-1', { tier: 'silver' });
    await seedProgram(promo('percent-budget-currency', {
      reward: {
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 1_000,
      },
      budget: { currency: 'GBP', minorUnits: 10_000 },
    }));

    const result = await evaluate({
      ...baseRequest,
      cart: { ...baseRequest.cart, currency: 'USD' },
    });
    expect(result.decisions[0]).toEqual(expect.objectContaining({
      outcome: 'unavailable',
      effects: [],
      reasonCodes: ['CURRENCY_MISMATCH'],
      commitRequired: false,
      eligible: false,
    }));
  });

  test('does not let a matching budget mask a fixed reward currency mismatch', async () => {
    await seedCustomer();
    await seedProgram(promo('masked-reward-currency', {
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'USD', minorUnits: 1_000 },
      },
      budget: { currency: 'GBP', minorUnits: 10_000 },
    }));

    const result = await evaluate();
    expect(result.decisions[0]).toEqual(expect.objectContaining({
      outcome: 'unavailable',
      effects: [],
      reasonCodes: ['CURRENCY_MISMATCH'],
      commitRequired: false,
      eligible: false,
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
        authorization: 'Bearer publishable-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify(baseRequest),
    }, {
      DB: env.DB,
      PUBLISHABLE_TOKEN: 'publishable-test',
      SECRET_TOKEN: 'secret-test',
      DECISION_SIGNING_SECRET: signingSecret,
      EVALUATION_TTL_SECONDS: '42',
    });
    expect(customResponse.status).toBe(200);
    const custom = EvaluationResponseSchema.parse(await customResponse.json());
    const customStored = await storedDecision(custom.evaluationId);
    expect(Date.parse(customStored.expires_at) - Date.parse(customStored.created_at)).toBe(42_000);
  });

  test.each([
    ['missing signing secret', undefined, undefined],
    ['weak signing secret', 'weak', undefined],
    ['zero TTL', signingSecret, '0'],
    ['fractional TTL', signingSecret, '1.5'],
    ['oversized TTL', signingSecret, '86401'],
    ['non-numeric TTL', signingSecret, 'not-a-number'],
  ])('fails closed for %s without leaking configuration', async (
    _name,
    secret,
    ttl,
  ) => {
    await seedCustomer();
    await seedProgram(promo('config-failure'));
    const response = await createApp().request('https://example.test/v1/evaluate', {
      method: 'POST',
      headers: {
        authorization: 'Bearer publishable-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify(baseRequest),
    }, {
      DB: env.DB,
      PUBLISHABLE_TOKEN: 'publishable-test',
      SECRET_TOKEN: 'secret-test',
      ...(secret === undefined ? {} : { DECISION_SIGNING_SECRET: secret }),
      ...(ttl === undefined ? {} : { EVALUATION_TTL_SECONDS: ttl }),
    });
    const error = await expectError(response, 503, 'EVALUATION_UNAVAILABLE');
    expect(error.error.retryable).toBe(true);
    expect(JSON.stringify(error)).not.toContain(secret ?? 'missing-secret');
    if (ttl !== undefined && ttl.length > 1) {
      expect(JSON.stringify(error)).not.toContain(ttl);
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
      .first<{ count: number }>()).toEqual({ count: 0 });
  });

  test('persists an immutable tenant-scoped snapshot signed over all canonical fields', async () => {
    await seedCustomer();
    await seedProgram(promo('signed'));
    const result = await evaluate();
    const row = await storedDecision(result.evaluationId);
    const snapshot = {
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
      UPDATE programs SET config_json = '{"invalid":true}'
      WHERE merchant_id = ?1 AND external_ref = 'corrupt'
    `).bind(SEEDED_MERCHANT_ID).run();

    const error = await expectError(
      await evaluateRaw(baseRequest),
      503,
      'EVALUATION_UNAVAILABLE',
    );
    expect(error.error.retryable).toBe(true);
    expect(JSON.stringify(error)).not.toContain('not_qualified');
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM evaluation_decisions')
      .first<{ count: number }>()).toEqual({ count: 0 });
  });
});
