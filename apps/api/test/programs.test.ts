import {
  ApiErrorSchema,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { SEEDED_MERCHANT_ID } from '../src/auth/static-token.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';

const publishedAt = '2026-07-18T12:00:00.000Z';

const merchantDefinitions = [
  {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'enum',
    required: false,
    enumValues: ['gold', 'silver'],
  },
  {
    key: 'context.channel',
    label: 'Sales channel',
    source: 'context',
    type: 'string',
    required: false,
  },
] as const satisfies readonly VariableDefinition[];

function promo(
  id: string,
  overrides: Partial<PromoProgram> = {},
): PromoProgram {
  return {
    id,
    type: 'promo',
    name: 'Gold welcome offer',
    status: 'draft',
    eligibility: {
      match: 'ALL',
      conditions: [{
        id: 'tier',
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
    budget: { currency: 'GBP', minorUnits: 10_000 },
    usageCap: 100,
    perCustomerCap: 1,
    stackable: false,
    priority: 10,
    autoApply: false,
    code: 'WELCOME10',
    ...overrides,
  } as PromoProgram;
}

function programRequest(
  method: 'GET' | 'POST' | 'PATCH',
  path = '',
  token = 'secret-test',
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`https://example.test/v1/programs${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  const body = ApiErrorSchema.parse(await response.json());
  expect(body.error.code).toBe(code);
  expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
}

async function createProgram(program: PromoProgram): Promise<PromoProgram> {
  const response = await programRequest('POST', '', 'secret-test', program);
  expect(response.status).toBe(201);
  return await response.json() as PromoProgram;
}

async function seedPublishedSchema(
  merchantId = SEEDED_MERCHANT_ID,
  definitions: readonly VariableDefinition[] = merchantDefinitions,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO schema_versions (
      merchant_id, version, state, published_at, definitions_json
    ) VALUES (?1, 1, 'published', ?2, ?3)
  `).bind(merchantId, publishedAt, JSON.stringify(definitions)).run();

  for (const [index, definition] of definitions.entries()) {
    await env.DB.prepare(`
      INSERT INTO variable_definitions (
        id, merchant_id, schema_version, key, label, source, type, required,
        enum_values_json, description, default_error_message, state, created_at
      ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, 'published', ?9)
    `).bind(
      `${merchantId}-definition-${index}`,
      merchantId,
      definition.key,
      definition.label,
      definition.source,
      definition.type,
      definition.required,
      definition.enumValues === undefined ? null : JSON.stringify(definition.enumValues),
      publishedAt,
    ).run();
  }
}

async function resetProgramData(): Promise<void> {
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

describe('Promo program API', () => {
  beforeEach(resetProgramData);

  test('creates, reads, lists, and updates a draft Promo through workerd and D1', async () => {
    const created = await createProgram(promo('welcome-10'));
    expect(created).toEqual(promo('welcome-10'));

    const read = await programRequest('GET', '/welcome-10');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(created);

    const list = await programRequest('GET');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ programs: [created] });

    const updatedResponse = await programRequest('PATCH', '/welcome-10', 'secret-test', {
      name: 'Updated gold offer',
      priority: 20,
      status: 'scheduled',
    });
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json() as PromoProgram;
    expect(updated).toEqual({
      ...created,
      name: 'Updated gold offer',
      priority: 20,
      status: 'scheduled',
    });

    const stored = await env.DB.prepare(`
      SELECT external_ref, type, name, status, priority, config_json
      FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
    `).bind(SEEDED_MERCHANT_ID, 'welcome-10').first<Record<string, unknown>>();
    expect(stored).toMatchObject({
      external_ref: 'welcome-10',
      type: 'promo',
      name: 'Updated gold offer',
      status: 'scheduled',
      priority: 20,
    });
    expect(JSON.parse(stored?.config_json as string)).toEqual(updated);
  });

  test.each([
    ['unknown reward', { reward: { type: 'wallet_credit', amount: { currency: 'GBP', minorUnits: 100 } } }],
    ['negative fixed reward', { reward: { type: 'order_discount', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: -1 } } }],
    ['excess percent reward', { reward: { type: 'order_discount', calculation: 'percent', basisPoints: 10_001 } }],
    ['lowercase currency', { reward: { type: 'order_discount', calculation: 'fixed', amount: { currency: 'gbp', minorUnits: 100 } } }],
    ['reward and budget currency mismatch', { budget: { currency: 'USD', minorUnits: 10_000 } }],
    ['zero usage cap', { usageCap: 0 }],
    ['negative customer cap', { perCustomerCap: -1 }],
    ['customer cap above total cap', { usageCap: 2, perCustomerCap: 3 }],
  ])('rejects invalid reward/currency/cap configuration: %s', async (_name, override) => {
    await expectError(
      await programRequest('POST', '', 'secret-test', { ...promo(`invalid-${_name}`), ...override }),
      400,
      'CONTEXT_VALIDATION_FAILED',
    );
  });

  test.each([
    ['root', {
      match: 'ALL',
      conditions: [{ id: 'missing', variable: 'customer.undefined', operator: 'eq', value: 'x' }],
    }],
    ['nested', {
      match: 'ALL',
      conditions: [],
      groups: [{
        match: 'ANY',
        conditions: [{ id: 'missing', variable: 'context.undefined', operator: 'eq', value: 'x' }],
      }],
    }],
  ])('rejects an undefined %s condition variable', async (_location, eligibility) => {
    await expectError(
      await programRequest('POST', '', 'secret-test', {
        ...promo(`undefined-${_location}`),
        eligibility,
      }),
      400,
      'CONTEXT_VALIDATION_FAILED',
    );
  });

  test('accepts canonical and system variables in nested conditions', async () => {
    const input = promo('builtins', {
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'today',
          variable: 'system.today',
          operator: 'gte',
          value: '2026-01-01',
        }],
        groups: [{
          match: 'ANY',
          conditions: [{
            id: 'subtotal',
            variable: 'cart.subtotal',
            operator: 'gte',
            value: 5_000,
          }],
        }],
      },
    });

    await expect(createProgram(input)).resolves.toEqual(input);
  });

  test.each([
    ['string', 'context.channel', 'gt', 2],
    ['boolean', 'customer.first_purchase', 'eq', false],
    ['number', 'cart.subtotal', 'is', true],
  ])('rejects an operator invalid for a %s variable', async (_type, variable, operator, value) => {
    const definitions = _type === 'boolean'
      ? [...merchantDefinitions, {
        key: 'customer.first_purchase',
        label: 'First purchase',
        source: 'customer',
        type: 'boolean',
        required: false,
      } as const]
      : merchantDefinitions;
    if (_type === 'boolean') {
      await env.DB.prepare('DELETE FROM variable_definitions').run();
      await env.DB.prepare('DELETE FROM schema_versions').run();
      await seedPublishedSchema(SEEDED_MERCHANT_ID, definitions);
    }

    await expectError(await programRequest('POST', '', 'secret-test', {
      ...promo(`bad-operator-${_type}`),
      eligibility: {
        match: 'ALL',
        conditions: [{ id: 'invalid', variable, operator, value }],
      },
    }), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test.each(['affiliate', 'referral', 'loyalty'])('rejects a %s program', async (type) => {
    await expectError(await programRequest('POST', '', 'secret-test', {
      ...promo(`not-${type}`),
      type,
    }), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('does not expose a program owned by another merchant', async () => {
    const otherMerchant = 'other-program-merchant';
    await env.DB.prepare(
      'INSERT INTO merchants (id, name, created_at) VALUES (?1, ?2, ?3)',
    ).bind(otherMerchant, 'Other merchant', publishedAt).run();
    await createRepositories({ DB: env.DB }).programs.create({
      merchantId: otherMerchant,
      program: promo('cross-tenant'),
    });

    await expectError(
      await programRequest('GET', '/cross-tenant'),
      404,
      'PROGRAM_NOT_FOUND',
    );
    expect(await (await programRequest('GET')).json()).toEqual({ programs: [] });
  });

  test('a merchant field referenced by a draft program is protected by schema edits', async () => {
    const definitionResponse = await SELF.fetch('https://example.test/v1/schema/definitions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        key: 'context.segment',
        label: 'Segment',
        source: 'context',
        type: 'string',
        required: false,
      }),
    });
    expect(definitionResponse.status).toBe(201);
    const definition = await definitionResponse.json() as { id: string; definition: VariableDefinition };

    await createProgram(promo('schema-lock', {
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'segment',
          variable: 'context.segment',
          operator: 'eq',
          value: 'vip',
        }],
      },
    }));

    const edit = await SELF.fetch(
      `https://example.test/v1/schema/definitions/${definition.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: 'Bearer secret-test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...definition.definition, type: 'number' }),
      },
    );
    await expectError(edit, 409, 'SCHEMA_CONFLICT');
  });

  test('keeps the external reference immutable and rejects edits after leaving draft', async () => {
    await createProgram(promo('immutable'));

    await expectError(await programRequest('PATCH', '/immutable', 'secret-test', {
      id: 'renamed',
    }), 409, 'PROGRAM_CONFLICT');

    const activation = await programRequest('PATCH', '/immutable', 'secret-test', {
      status: 'active',
    });
    expect(activation.status).toBe(200);

    await expectError(await programRequest('PATCH', '/immutable', 'secret-test', {
      name: 'Cannot change active program',
    }), 409, 'PROGRAM_CONFLICT');
  });

  test.each(['draft', 'scheduled', 'active', 'paused', 'ended'] as const)(
    'accepts the %s lifecycle status',
    async (status) => {
      expect((await programRequest('POST', '', 'secret-test', promo(`status-${status}`, { status }))).status)
        .toBe(201);
    },
  );

  test('rejects statuses outside the first-build lifecycle', async () => {
    await expectError(await programRequest('POST', '', 'secret-test', {
      ...promo('retired'),
      status: 'retired',
    }), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test.each(['GET', 'POST', 'PATCH'] as const)('requires a secret credential for %s', async (method) => {
    const path = method === 'GET' ? '' : method === 'PATCH' ? '/secret-only' : '';
    const body = method === 'GET' ? undefined : method === 'POST'
      ? promo('secret-only')
      : { name: 'No access' };
    await expectError(
      await programRequest(method, path, 'publishable-test', body),
      403,
      'FORBIDDEN',
    );
  });
});
