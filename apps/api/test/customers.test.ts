import { ApiErrorSchema, type VariableDefinition } from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { SEEDED_MERCHANT_ID } from '../src/auth/static-token.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import type { CustomerRecord } from '../src/repositories/types.js';

const publishedAt = '2026-07-18T12:00:00.000Z';

const customerDefinitions = [
  {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'enum',
    required: true,
    enumValues: ['gold', 'silver'],
  },
  {
    key: 'customer.name',
    label: 'Customer name',
    source: 'customer',
    type: 'string',
    required: true,
  },
  {
    key: 'customer.lifetime_orders',
    label: 'Lifetime orders',
    source: 'customer',
    type: 'number',
    required: true,
  },
  {
    key: 'customer.first_purchase',
    label: 'First purchase',
    source: 'customer',
    type: 'boolean',
    required: true,
  },
  {
    key: 'customer.joined_on',
    label: 'Joined on',
    source: 'customer',
    type: 'date',
    required: true,
  },
  {
    key: 'customer.note',
    label: 'Customer note',
    source: 'customer',
    type: 'string',
    required: false,
  },
  {
    key: 'context.channel',
    label: 'Sales channel',
    source: 'context',
    type: 'string',
    required: true,
  },
] as const satisfies readonly VariableDefinition[];

const validAttributes = {
  tier: 'gold',
  name: 'Ada',
  lifetime_orders: 8,
  first_purchase: false,
  joined_on: '2026-07-18',
  note: 'priority',
};

function customerRequest(
  method: 'GET' | 'PATCH',
  customerRef: string,
  token = 'secret-test',
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`https://example.test/v1/customers/${customerRef}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function patchCustomer(
  customerRef: string,
  body: unknown,
): Promise<CustomerRecord> {
  const response = await customerRequest('PATCH', customerRef, 'secret-test', body);
  expect(response.status).toBe(200);
  return await response.json() as CustomerRecord;
}

async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<ReturnType<typeof ApiErrorSchema.parse>> {
  expect(response.status).toBe(status);
  const body = ApiErrorSchema.parse(await response.json());
  expect(body.error.code).toBe(code);
  expect(response.headers.get('x-correlation-id')).toBe(body.error.correlationId);
  return body;
}

async function seedPublishedSchema(
  merchantId = SEEDED_MERCHANT_ID,
  definitions: readonly VariableDefinition[] = customerDefinitions,
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO schema_versions (
      merchant_id, version, state, published_at, definitions_json
    ) VALUES (?1, 1, 'published', ?2, ?3)
  `).bind(merchantId, publishedAt, JSON.stringify(definitions)).run();
}

async function resetCustomerData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare('DELETE FROM variable_definitions'),
    env.DB.prepare("DELETE FROM merchants WHERE id <> 'phase-0-merchant'"),
  ]);
  await seedPublishedSchema();
}

describe('customer profile API', () => {
  beforeEach(resetCustomerData);

  test('updates against every published customer type and increments version', async () => {
    const first = await patchCustomer('c-1', { attributes: validAttributes });
    expect(first).toMatchObject({
      externalRef: 'c-1',
      attributes: validAttributes,
      version: 1,
    });
    expect(first.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const secondAttributes = { ...validAttributes, tier: 'silver' };
    const second = await patchCustomer('c-1', {
      attributes: secondAttributes,
      expectedVersion: first.version,
    });

    expect(second).toMatchObject({ attributes: secondAttributes, version: 2 });
    expect(await (await customerRequest('GET', 'c-1')).json()).toEqual(second);
  });

  test('rejects fields not published as customer definitions', async () => {
    await expectError(await customerRequest('PATCH', 'unknown-field', 'secret-test', {
      attributes: { ...validAttributes, channel: 'web' },
    }), 400, 'CONTEXT_VALIDATION_FAILED');

    await expectError(await customerRequest('PATCH', 'unknown-envelope', 'secret-test', {
      attributes: validAttributes,
      ignored: true,
    }), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test.each([
    ['string', { name: 10 }],
    ['number', { lifetime_orders: '8' }],
    ['boolean', { first_purchase: 'false' }],
    ['enum', { tier: 'bronze' }],
    ['ISO date', { joined_on: '18/07/2026' }],
    ['ISO calendar date', { joined_on: '2026-02-30' }],
  ])('rejects an invalid %s customer value', async (_type, invalid) => {
    await expectError(await customerRequest('PATCH', `invalid-${_type}`, 'secret-test', {
      attributes: { ...validAttributes, ...invalid },
    }), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('requires every required published customer field', async () => {
    const { tier: _tier, ...missingTier } = validAttributes;
    await expectError(await customerRequest('PATCH', 'missing-required', 'secret-test', {
      attributes: missingTier,
    }), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('replaces the whole validated attribute object instead of deep merging', async () => {
    const first = await patchCustomer('replacement', { attributes: validAttributes });
    const { note: _note, ...replacement } = validAttributes;

    const second = await patchCustomer('replacement', {
      attributes: replacement,
      expectedVersion: first.version,
    });

    expect(second.attributes).toEqual(replacement);
    expect(second.attributes).not.toHaveProperty('note');
  });

  test('requires an exact expectedVersion after the first write', async () => {
    const first = await patchCustomer('versioned', { attributes: validAttributes });

    await expectError(await customerRequest('PATCH', 'versioned', 'secret-test', {
      attributes: { ...validAttributes, tier: 'silver' },
    }), 409, 'VERSION_CONFLICT');
    await expectError(await customerRequest('PATCH', 'versioned', 'secret-test', {
      attributes: { ...validAttributes, tier: 'silver' },
      expectedVersion: first.version + 1,
    }), 409, 'VERSION_CONFLICT');
  });

  test('allows exactly one of two concurrent writes with the same expected version', async () => {
    const first = await patchCustomer('concurrent', { attributes: validAttributes });
    const writes = await Promise.all([
      customerRequest('PATCH', 'concurrent', 'secret-test', {
        attributes: { ...validAttributes, tier: 'silver', note: 'first' },
        expectedVersion: first.version,
      }),
      customerRequest('PATCH', 'concurrent', 'secret-test', {
        attributes: { ...validAttributes, tier: 'silver', note: 'second' },
        expectedVersion: first.version,
      }),
    ]);

    expect(writes.map(response => response.status).sort()).toEqual([200, 409]);
    await expectError(writes.find(response => response.status === 409)!, 409, 'VERSION_CONFLICT');
    expect((await customerRequest('GET', 'concurrent')).status).toBe(200);
  });

  test('allows exactly one concurrent initial write and persists the returned winner', async () => {
    const candidates = [
      { ...validAttributes, note: 'first initial writer' },
      { ...validAttributes, note: 'second initial writer' },
    ];
    const writes = await Promise.all(candidates.map(attributes => (
      customerRequest('PATCH', 'initial-race', 'secret-test', { attributes })
    )));
    expect(writes.map(response => response.status).sort()).toEqual([200, 409]);
    const success = writes.find(response => response.status === 200)!;
    const winner = await success.json() as CustomerRecord;
    await expectError(writes.find(response => response.status === 409)!, 409, 'VERSION_CONFLICT');

    expect(winner.version).toBe(1);
    expect(candidates).toContainEqual(winner.attributes);
    expect(await (await customerRequest('GET', 'initial-race')).json()).toEqual(winner);
  });

  test('validates customer writes against published definitions when a newer draft exists', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const draft = await repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID);
    const draftDefinitions = await repositories.schemas.listDefinitions(
      SEEDED_MERCHANT_ID,
      draft.version,
    );
    const tier = draftDefinitions.find(record => record.definition.key === 'customer.tier')!;
    const { enumValues: _enumValues, ...tierWithoutEnum } = tier.definition;
    await repositories.schemas.updateDraftDefinition(
      SEEDED_MERCHANT_ID,
      tier.id,
      draft.version,
      { ...tierWithoutEnum, type: 'string' },
      draft.definitions,
    );

    const stored = await patchCustomer('published-over-draft', { attributes: validAttributes });
    expect(stored.attributes).toEqual(validAttributes);
  });

  test('round-trips an encoded opaque customer reference', async () => {
    const externalRef = 'customer/one #1?';
    const encoded = encodeURIComponent(externalRef);
    const stored = await patchCustomer(encoded, { attributes: validAttributes });

    expect(stored.externalRef).toBe(externalRef);
    expect(await (await customerRequest('GET', encoded)).json()).toEqual(stored);
  });

  test.each([
    ['malformed JSON', '{"private-customer-marker":'],
    ['schema-invalid JSON', '[]'],
  ])('maps persisted customer attributes with %s to a generic retryable 503', async (
    _name,
    attributesJson,
  ) => {
    await patchCustomer('corrupt-profile', { attributes: validAttributes });
    await env.DB.prepare(`
      UPDATE customers SET attributes_json = ?1
      WHERE merchant_id = ?2 AND external_ref = 'corrupt-profile'
    `).bind(attributesJson, SEEDED_MERCHANT_ID).run();

    const error = await expectError(
      await customerRequest('GET', 'corrupt-profile'),
      503,
      'EVALUATION_UNAVAILABLE',
    );
    expect(error.error.retryable).toBe(true);
    expect(JSON.stringify(error)).not.toContain(attributesJson);
  });

  test('keeps malformed inbound customer JSON as canonical non-retryable 400', async () => {
    const response = await SELF.fetch('https://example.test/v1/customers/inbound-malformed', {
      method: 'PATCH',
      headers: {
        authorization: 'Bearer secret-test',
        'content-type': 'application/json',
      },
      body: '{',
    });
    const error = await expectError(response, 400, 'CONTEXT_VALIDATION_FAILED');
    expect(error.error.retryable).toBe(false);
  });

  test('does not expose a customer from another merchant', async () => {
    const otherMerchant = 'other-customer-merchant';
    await env.DB.prepare(
      'INSERT INTO merchants (id, name, created_at) VALUES (?1, ?2, ?3)',
    ).bind(otherMerchant, otherMerchant, publishedAt).run();
    await seedPublishedSchema(otherMerchant);
    await createRepositories({ DB: env.DB }).customers.create(otherMerchant, {
      externalRef: 'cross-merchant',
      attributes: validAttributes,
    });

    await expectError(
      await customerRequest('GET', 'cross-merchant'),
      404,
      'CUSTOMER_NOT_FOUND',
    );
  });

  test.each(['GET', 'PATCH'] as const)('requires a secret credential for %s', async (method) => {
    const body = method === 'PATCH' ? { attributes: validAttributes } : undefined;
    await expectError(
      await customerRequest(method, 'secret-only', 'publishable-test', body),
      403,
      'FORBIDDEN',
    );
  });
});
