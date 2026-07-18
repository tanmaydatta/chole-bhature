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
import { verifyDecisionIntegrity } from '../src/services/evaluation-service.js';

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
