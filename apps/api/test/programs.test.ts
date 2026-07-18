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
import { createProgramService } from '../src/services/program-service.js';

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

async function draftFixture() {
  const repositories = createRepositories({ DB: env.DB });
  const draft = await repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID);
  const records = await repositories.schemas.listDefinitions(SEEDED_MERCHANT_ID, draft.version);
  const tier = records.find(record => record.definition.key === 'customer.tier')!;
  return { repositories, draft, records, tier };
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

    const replacement = {
      ...created,
      name: 'Updated gold offer',
      priority: 20,
      status: 'scheduled',
    } as const satisfies PromoProgram;
    const updatedResponse = await programRequest(
      'PATCH',
      '/welcome-10',
      'secret-test',
      replacement,
    );
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json() as PromoProgram;
    expect(updated).toEqual(replacement);

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

  test('PATCH is a full canonical replacement that removes omitted optional fields', async () => {
    const created = await createProgram(promo('replace-all', {
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      stackingGroup: 'welcome',
    }));
    const replacement: PromoProgram = {
      id: created.id,
      type: 'promo',
      name: 'Replacement without limits',
      status: 'draft',
      eligibility: created.eligibility,
      reward: { type: 'free_shipping' },
      stackable: false,
      priority: 2,
      autoApply: true,
    };

    const response = await programRequest('PATCH', '/replace-all', 'secret-test', replacement);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(replacement);
    expect((await createRepositories({ DB: env.DB }).programs.get(
      SEEDED_MERCHANT_ID,
      'replace-all',
    ))?.program).toEqual(replacement);
  });

  test('rejects adding a monetary budget to a free-shipping program on update', async () => {
    const created = await createProgram(promo('shipping-budget-update'));
    const replacement: PromoProgram = {
      ...created,
      reward: { type: 'free_shipping' },
    };

    await expectError(
      await programRequest('PATCH', '/shipping-budget-update', 'secret-test', replacement),
      400,
      'CONTEXT_VALIDATION_FAILED',
    );
    expect((await createRepositories({ DB: env.DB }).programs.get(
      SEEDED_MERCHANT_ID,
      'shipping-budget-update',
    ))?.program).toEqual(created);
  });

  test.each(['.', '..'])('rejects the unaddressable external reference %s', async (externalRef) => {
    await expectError(
      await programRequest('POST', '', 'secret-test', promo(externalRef)),
      400,
      'CONTEXT_VALIDATION_FAILED',
    );
  });

  test.each(['.', '..'])(
    'rejects the unaddressable update external reference %s before lookup',
    async (externalRef) => {
      const service = createProgramService(createRepositories({ DB: env.DB }));
      await expect(service.update(
        SEEDED_MERCHANT_ID,
        externalRef,
        promo(externalRef),
      )).rejects.toMatchObject({ name: 'ContextValidationError' });
    },
  );

  test('round-trips an encoded non-dot external reference', async () => {
    const externalRef = 'offer/one #1?';
    const created = await createProgram(promo(externalRef));
    const path = `/${encodeURIComponent(externalRef)}`;

    expect(await (await programRequest('GET', path)).json()).toEqual(created);
    const replacement = { ...created, name: 'Encoded ref updated' };
    const update = await programRequest('PATCH', path, 'secret-test', replacement);
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual(replacement);
  });

  test.each([
    ['unknown reward', { reward: { type: 'wallet_credit', amount: { currency: 'GBP', minorUnits: 100 } } }],
    ['negative fixed reward', { reward: { type: 'order_discount', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: -1 } } }],
    ['excess percent reward', { reward: { type: 'order_discount', calculation: 'percent', basisPoints: 10_001 } }],
    ['lowercase currency', { reward: { type: 'order_discount', calculation: 'fixed', amount: { currency: 'gbp', minorUnits: 100 } } }],
    ['reward and budget currency mismatch', { budget: { currency: 'USD', minorUnits: 10_000 } }],
    ['free shipping with monetary budget', { reward: { type: 'free_shipping' } }],
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
      schema: null,
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
      ...promo('renamed'),
    }), 409, 'PROGRAM_CONFLICT');

    const activation = await programRequest('PATCH', '/immutable', 'secret-test', {
      ...promo('immutable'),
      status: 'active',
    });
    expect(activation.status).toBe(200);

    await expectError(await programRequest('PATCH', '/immutable', 'secret-test', {
      ...promo('immutable'),
      name: 'Cannot change active program',
      status: 'active',
    }), 409, 'PROGRAM_CONFLICT');
  });

  test('concurrent full replacements from one revision have one CAS winner and no lost update', async () => {
    const created = await createProgram(promo('concurrent-replacement'));
    const repositories = createRepositories({ DB: env.DB });
    const existing = await repositories.programs.get(
      SEEDED_MERCHANT_ID,
      created.id,
    );
    const schema = await repositories.schemas.getLatestVersion(SEEDED_MERCHANT_ID, 'draft')
      ?? await repositories.schemas.getLatestVersion(SEEDED_MERCHANT_ID, 'published');
    const replacements = [
      { ...created, name: 'First replacement', priority: 21 },
      { ...created, name: 'Second replacement', priority: 22 },
    ] as const;

    const outcomes = await Promise.allSettled(replacements.map(program => (
      repositories.programs.updateDraft({
        merchantId: SEEDED_MERCHANT_ID,
        externalRef: created.id,
        program,
        expectedProgram: existing!.program,
        expectedUpdatedAt: existing!.updatedAt,
        schema,
      })
    )));
    const winners = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<
        typeof repositories.programs.updateDraft
      >>> => outcome.status === 'fulfilled',
    );
    const losers = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reason).toMatchObject({ name: 'ProgramConflictError' });
    const winner = winners[0]!.value.program;
    expect(replacements).toContainEqual(winner);
    expect(await (await programRequest('GET', '/concurrent-replacement')).json()).toEqual(winner);
  });

  test('a schema delete winning after program validation rejects the stale create', async () => {
    const { repositories, draft, tier } = await draftFixture();
    const expectedDefinitions = draft.definitions;
    const staleCreate = {
      merchantId: SEEDED_MERCHANT_ID,
      program: promo('stale-create'),
      schema: draft,
    };

    await repositories.schemas.deleteDraftDefinition(
      SEEDED_MERCHANT_ID,
      tier.id,
      draft.version,
      expectedDefinitions,
    );

    await expect(repositories.programs.create(staleCreate)).rejects.toMatchObject({
      name: 'ProgramConflictError',
    });
    await expect(repositories.programs.get(SEEDED_MERCHANT_ID, 'stale-create')).resolves.toBeNull();
  });

  test('a program create winning first atomically blocks a referenced type mutation', async () => {
    const { repositories, draft, tier } = await draftFixture();
    const { enumValues: _enumValues, ...tierFields } = tier.definition;
    const changed: VariableDefinition = { ...tierFields, type: 'string' };
    const create = {
      merchantId: SEEDED_MERCHANT_ID,
      program: promo('create-wins'),
      schema: draft,
    };
    await repositories.programs.create(create);

    await expect(repositories.schemas.updateDraftDefinition(
      SEEDED_MERCHANT_ID,
      tier.id,
      draft.version,
      changed,
      draft.definitions,
    )).rejects.toMatchObject({ name: 'SchemaRevisionConflictError' });

    await expect(repositories.schemas.getDefinition(SEEDED_MERCHANT_ID, tier.id))
      .resolves.toMatchObject({ definition: tier.definition });
    await expect(repositories.schemas.getVersion(SEEDED_MERCHANT_ID, draft.version))
      .resolves.toMatchObject({ definitions: draft.definitions });
  });

  test('a schema delete winning after replacement validation rejects the stale update', async () => {
    const { repositories, draft, tier } = await draftFixture();
    const existing = await repositories.programs.create({
      merchantId: SEEDED_MERCHANT_ID,
      program: promo('stale-update', {
        eligibility: {
          match: 'ALL',
          conditions: [{ id: 'subtotal', variable: 'cart.subtotal', operator: 'gte', value: 1 }],
        },
      }),
      schema: draft,
    });
    const replacement = promo('stale-update');
    const staleUpdate = {
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: existing.externalRef,
      program: replacement,
      expectedProgram: existing.program,
      expectedUpdatedAt: existing.updatedAt,
      schema: draft,
    };

    await repositories.schemas.deleteDraftDefinition(
      SEEDED_MERCHANT_ID,
      tier.id,
      draft.version,
      draft.definitions,
    );

    await expect(repositories.programs.updateDraft(staleUpdate)).rejects.toMatchObject({
      name: 'ProgramConflictError',
    });
    await expect(repositories.programs.get(SEEDED_MERCHANT_ID, existing.externalRef))
      .resolves.toMatchObject({ program: existing.program });
  });

  test('a replacement winning first atomically blocks referenced deletion', async () => {
    const { repositories, draft, tier } = await draftFixture();
    const existing = await repositories.programs.create({
      merchantId: SEEDED_MERCHANT_ID,
      program: promo('update-wins', {
        eligibility: {
          match: 'ALL',
          conditions: [{ id: 'subtotal', variable: 'cart.subtotal', operator: 'gte', value: 1 }],
        },
      }),
      schema: draft,
    });
    const replacement = promo('update-wins');
    await repositories.programs.updateDraft({
      merchantId: SEEDED_MERCHANT_ID,
      externalRef: existing.externalRef,
      program: replacement,
      expectedProgram: existing.program,
      expectedUpdatedAt: existing.updatedAt,
      schema: draft,
    });

    await expect(repositories.schemas.deleteDraftDefinition(
      SEEDED_MERCHANT_ID,
      tier.id,
      draft.version,
      draft.definitions,
    )).rejects.toMatchObject({ name: 'SchemaRevisionConflictError' });

    await expect(repositories.schemas.getDefinition(SEEDED_MERCHANT_ID, tier.id))
      .resolves.toMatchObject({ definition: tier.definition });
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
