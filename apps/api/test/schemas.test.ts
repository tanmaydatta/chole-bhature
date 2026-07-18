import { ApiErrorSchema, type PromoProgram, type VariableDefinition } from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { SEEDED_MERCHANT_ID } from '../src/auth/static-token.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import type { SchemaVersionRecord } from '../src/repositories/types.js';
import { createSchemaService } from '../src/services/schema-service.js';

type DefinitionView = {
  id: string;
  definition: VariableDefinition;
  readOnly: boolean;
  referenced: boolean;
};

const channelDefinition = {
  key: 'context.channel',
  label: 'Sales channel',
  source: 'context',
  type: 'enum',
  required: true,
  enumValues: ['web', 'mobile'],
} as const satisfies VariableDefinition;

function schemaRequest(
  method: string,
  path: string,
  token = 'secret-test',
  body?: unknown,
): Promise<Response> {
  return SELF.fetch(`https://example.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createDefinition(
  definition: VariableDefinition,
): Promise<DefinitionView> {
  const response = await schemaRequest('POST', '/v1/schema/definitions', 'secret-test', definition);
  expect(response.status).toBe(201);
  return await response.json() as DefinitionView;
}

async function expectError(response: Response, status: number, code?: string): Promise<void> {
  expect(response.status).toBe(status);
  const body = ApiErrorSchema.parse(await response.json());
  if (code !== undefined) expect(body.error.code).toBe(code);
}

async function resetSchemaData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare('DELETE FROM variable_definitions'),
  ]);
}

describe('schema registry API', () => {
  beforeEach(resetSchemaData);

  test('creates, publishes, edits an additive draft, and publishes an immutable next version', async () => {
    await createDefinition(channelDefinition);

    const firstResponse = await schemaRequest('POST', '/v1/schema/publish');
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json() as Record<string, unknown>;
    expect(first).toMatchObject({
      version: 1,
      definitions: [channelDefinition],
      jsonSchema: { type: 'object', additionalProperties: false },
      sample: {
        cart: { currency: 'GBP', subtotal: 0, items: [] },
        context: { channel: 'web' },
      },
    });

    await createDefinition({
      key: 'context.first_purchase',
      label: 'First purchase',
      source: 'context',
      type: 'boolean',
      required: false,
    });

    const secondResponse = await schemaRequest('POST', '/v1/schema/publish');
    expect(secondResponse.status).toBe(201);
    const second = await secondResponse.json() as Record<string, unknown>;
    expect(second).toMatchObject({
      version: 2,
      sample: { context: { channel: 'web', first_purchase: false } },
    });

    const published = await schemaRequest('GET', '/v1/schema/published', 'publishable-test');
    expect(published.status).toBe(200);
    expect(await published.json()).toEqual(second);

    const repositories = createRepositories({ DB: env.DB });
    await expect(repositories.schemas.getVersion(SEEDED_MERCHANT_ID, 1)).resolves.toMatchObject({
      version: 1,
      definitions: [channelDefinition],
    });
    await expect(repositories.schemas.getVersion(SEEDED_MERCHANT_ID, 2)).resolves.toMatchObject({
      version: 2,
    });
  });

  test('generates deterministic values for every supported type and strict nested schemas', async () => {
    for (const definition of [
      channelDefinition,
      { key: 'context.flag', label: 'Flag', source: 'context', type: 'boolean', required: false },
      { key: 'context.count', label: 'Count', source: 'context', type: 'number', required: false },
      { key: 'context.note', label: 'Note', source: 'context', type: 'string', required: false },
      { key: 'context.day', label: 'Day', source: 'context', type: 'date', required: false },
      { key: 'cart.delivery_country', label: 'Country', source: 'cart', type: 'string', required: false },
    ] as VariableDefinition[]) {
      await createDefinition(definition);
    }

    const response = await schemaRequest('POST', '/v1/schema/publish');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      jsonSchema: {
        additionalProperties: false,
        properties: {
          cart: {
            additionalProperties: false,
            properties: { attributes: { additionalProperties: false } },
          },
          context: { additionalProperties: false },
        },
      },
      sample: {
        cart: {
          currency: 'GBP',
          subtotal: 0,
          items: [],
          attributes: { delivery_country: 'example' },
        },
        context: {
          channel: 'web',
          flag: false,
          count: 0,
          note: 'example',
          day: '2026-01-01',
        },
      },
    });
  });

  test('rejects invalid definitions, system fields, and reserved canonical facts', async () => {
    await expectError(await schemaRequest('POST', '/v1/schema/definitions', 'secret-test', {
      ...channelDefinition,
      key: 'customer.channel',
    }), 400, 'CONTEXT_VALIDATION_FAILED');
    await expectError(await schemaRequest('POST', '/v1/schema/definitions', 'secret-test', {
      ...channelDefinition,
      source: 'unknown',
    }), 400, 'CONTEXT_VALIDATION_FAILED');
    await expectError(await schemaRequest('POST', '/v1/schema/definitions', 'secret-test', {
      key: 'system.budget_remaining',
      label: 'Budget remaining',
      source: 'system',
      type: 'number',
      required: false,
    }), 409, 'SCHEMA_CONFLICT');
    await expectError(await schemaRequest('POST', '/v1/schema/definitions', 'secret-test', {
      key: 'cart.subtotal',
      label: 'Subtotal override',
      source: 'cart',
      type: 'number',
      required: false,
    }), 409, 'SCHEMA_CONFLICT');
    await expectError(await schemaRequest(
      'PATCH',
      '/v1/schema/definitions/canonical%3Acart.subtotal',
      'secret-test',
      { key: 'cart.subtotal', label: 'Changed', source: 'cart', type: 'number', required: true },
    ), 409, 'SCHEMA_CONFLICT');
  });

  test('rejects required additions after publication and leaves the published snapshot unchanged', async () => {
    await createDefinition(channelDefinition);
    expect((await schemaRequest('POST', '/v1/schema/publish')).status).toBe(201);

    await expectError(await schemaRequest('POST', '/v1/schema/definitions', 'secret-test', {
      key: 'context.locale',
      label: 'Locale',
      source: 'context',
      type: 'string',
      required: true,
    }), 409, 'SCHEMA_CONFLICT');

    const published = await schemaRequest('GET', '/v1/schema/published', 'publishable-test');
    expect(await published.json()).toMatchObject({ version: 1, definitions: [channelDefinition] });
  });

  test('lists, updates, and deletes an unreferenced draft definition', async () => {
    const created = await createDefinition({
      key: 'customer.tier',
      label: 'Tier',
      source: 'customer',
      type: 'string',
      required: false,
    });
    const update = await schemaRequest(
      'PATCH',
      `/v1/schema/definitions/${created.id}`,
      'secret-test',
      { ...created.definition, label: 'Customer tier' },
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({
      id: created.id,
      definition: { key: 'customer.tier', label: 'Customer tier' },
      readOnly: false,
      referenced: false,
    });

    const list = await schemaRequest('GET', '/v1/schema/definitions');
    expect(list.status).toBe(200);
    const listed = await list.json() as { draftVersion: number; definitions: DefinitionView[] };
    expect(listed.draftVersion).toBe(1);
    expect(listed.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'canonical:cart.subtotal', readOnly: true }),
      expect.objectContaining({
        id: created.id,
        definition: expect.objectContaining({ label: 'Customer tier' }),
      }),
    ]));

    expect((await schemaRequest('DELETE', `/v1/schema/definitions/${created.id}`)).status).toBe(204);
    const afterDelete = await schemaRequest('GET', '/v1/schema/definitions');
    const body = await afterDelete.json() as { definitions: DefinitionView[] };
    expect(body.definitions.some(definition => definition.id === created.id)).toBe(false);
  });

  test('refuses to publish a draft containing invalid persisted definition data', async () => {
    const created = await createDefinition(channelDefinition);
    await env.DB.prepare(
      'UPDATE variable_definitions SET source = ?1 WHERE id = ?2',
    ).bind('unknown', created.id).run();

    await expectError(
      await schemaRequest('POST', '/v1/schema/publish'),
      400,
      'CONTEXT_VALIDATION_FAILED',
    );
    await expect(createRepositories({ DB: env.DB }).schemas.getLatestVersion(
      SEEDED_MERCHANT_ID,
      'published',
    )).resolves.toBeNull();
  });

  test('does not expose or mutate another merchant schema by definition id', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const service = createSchemaService(repositories);
    const otherMerchant = 'schema-other-merchant';
    await env.DB.prepare(
      'INSERT INTO merchants (id, name, created_at) VALUES (?1, ?2, ?3)',
    ).bind(otherMerchant, 'Other merchant', '2026-07-18T12:00:00.000Z').run();
    const created = await service.create(SEEDED_MERCHANT_ID, channelDefinition);

    const otherList = await service.list(otherMerchant);
    expect(otherList.definitions.some(definition => definition.id === created.id)).toBe(false);
    await expect(service.update(otherMerchant, created.id, {
      ...channelDefinition,
      label: 'Cross-tenant edit',
    })).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  test.each(['draft', 'active'] as const)(
    'prevents changing or deleting a field referenced by a %s program',
    async (status) => {
      const created = await createDefinition({
        key: 'customer.tier',
        label: 'Customer tier',
        source: 'customer',
        type: 'enum',
        required: false,
        enumValues: ['gold', 'silver'],
      });
      const program: PromoProgram = {
        id: `program-${status}`,
        type: 'promo',
        name: 'Tier offer',
        status,
        eligibility: {
          match: 'ALL',
          conditions: [{
            id: 'tier',
            variable: 'customer.tier',
            operator: 'eq',
            value: 'gold',
          }],
        },
        reward: { type: 'free_shipping' },
        stackable: false,
        priority: 1,
        autoApply: true,
      };
      await createRepositories({ DB: env.DB }).programs.create({
        merchantId: SEEDED_MERCHANT_ID,
        program,
      });

      await expectError(await schemaRequest(
        'PATCH',
        `/v1/schema/definitions/${created.id}`,
        'secret-test',
        { ...created.definition, key: 'customer.segment', type: 'string', enumValues: undefined },
      ), 409, 'SCHEMA_CONFLICT');
      await expectError(await schemaRequest(
        'DELETE',
        `/v1/schema/definitions/${created.id}`,
      ), 409, 'SCHEMA_CONFLICT');
    },
  );

  test('secret credentials gate definition CRUD and publication while published reads accept either key', async () => {
    await expectError(await schemaRequest(
      'POST',
      '/v1/schema/definitions',
      'publishable-test',
      channelDefinition,
    ), 403, 'FORBIDDEN');
    await expectError(await schemaRequest('POST', '/v1/schema/publish', 'publishable-test'), 403, 'FORBIDDEN');
    await expectError(await schemaRequest('GET', '/v1/schema/published', 'publishable-test'), 404, 'SCHEMA_NOT_PUBLISHED');
    await expectError(await schemaRequest('GET', '/v1/schema/published', 'secret-test'), 404, 'SCHEMA_NOT_PUBLISHED');
  });

  test('malformed JSON returns a stable canonical client error', async () => {
    const response = await SELF.fetch('https://example.test/v1/schema/definitions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret-test',
        'content-type': 'application/json',
      },
      body: '{"key":',
    });
    await expectError(response, 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('simultaneous duplicate creates return one success and one canonical conflict', async () => {
    const responses = await Promise.all([
      schemaRequest('POST', '/v1/schema/definitions', 'secret-test', channelDefinition),
      schemaRequest('POST', '/v1/schema/definitions', 'secret-test', channelDefinition),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const conflict = responses.find(response => response.status === 409)!;
    expect(ApiErrorSchema.parse(await conflict.json()).error.code).toMatch(
      /^(SCHEMA_CONFLICT|VERSION_CONFLICT)$/,
    );
  });

  test('duplicate concurrent publication has one stored winner and one canonical conflict', async () => {
    await createDefinition(channelDefinition);
    const responses = await Promise.all([
      schemaRequest('POST', '/v1/schema/publish'),
      schemaRequest('POST', '/v1/schema/publish'),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    const success = responses.find(response => response.status === 201)!;
    const conflict = responses.find(response => response.status === 409)!;
    const published = await success.json() as { publishedAt: string; version: number };
    await expectError(conflict, 409, 'VERSION_CONFLICT');
    await expect(createRepositories({ DB: env.DB }).schemas.getVersion(
      SEEDED_MERCHANT_ID,
      published.version,
    )).resolves.toMatchObject({ publishedAt: published.publishedAt });
  });

  test('PATCHing a published id removed from the current draft returns a canonical conflict', async () => {
    const original = await createDefinition(channelDefinition);
    expect((await schemaRequest('POST', '/v1/schema/publish')).status).toBe(201);
    await createDefinition({
      key: 'context.note',
      label: 'Note',
      source: 'context',
      type: 'string',
      required: false,
    });
    expect((await schemaRequest('DELETE', `/v1/schema/definitions/${original.id}`)).status).toBe(204);

    await expectError(await schemaRequest(
      'PATCH',
      `/v1/schema/definitions/${original.id}`,
      'secret-test',
      { ...channelDefinition, label: 'Restored' },
    ), 409, 'SCHEMA_CONFLICT');
  });

  test.each([
    'canonical:cart.subtotal',
    'system:system.budget_remaining',
  ])('rejects edit and delete permutations for read-only definition %s', async (id) => {
    await expectError(await schemaRequest(
      'PATCH',
      `/v1/schema/definitions/${encodeURIComponent(id)}`,
      'secret-test',
      channelDefinition,
    ), 409, 'SCHEMA_CONFLICT');
    await expectError(await schemaRequest(
      'DELETE',
      `/v1/schema/definitions/${encodeURIComponent(id)}`,
    ), 409, 'SCHEMA_CONFLICT');
  });

  test('a source-only mutation of a referenced field is rejected canonically', async () => {
    const created = await createDefinition({
      key: 'customer.tier',
      label: 'Customer tier',
      source: 'customer',
      type: 'string',
      required: false,
    });
    await createRepositories({ DB: env.DB }).programs.create({
      merchantId: SEEDED_MERCHANT_ID,
      program: programReferencing('source-lock', 'draft', 'customer.tier'),
    });
    await expectError(await schemaRequest(
      'PATCH',
      `/v1/schema/definitions/${created.id}`,
      'secret-test',
      { ...created.definition, source: 'context' },
    ), 400, 'CONTEXT_VALIDATION_FAILED');
  });

  test('nested draft program condition references lock deletion', async () => {
    const created = await createDefinition({
      key: 'customer.tier',
      label: 'Customer tier',
      source: 'customer',
      type: 'string',
      required: false,
    });
    const program = programReferencing('nested-lock', 'draft', 'cart.subtotal');
    program.eligibility.conditions = [];
    program.eligibility.groups = [{
      match: 'ALL',
      conditions: [{ id: 'nested', variable: 'customer.tier', operator: 'eq', value: 'gold' }],
    }];
    await createRepositories({ DB: env.DB }).programs.create({
      merchantId: SEEDED_MERCHANT_ID,
      program,
    });
    await expectError(
      await schemaRequest('DELETE', `/v1/schema/definitions/${created.id}`),
      409,
      'SCHEMA_CONFLICT',
    );
  });

  test('another merchant program reference does not lock this merchant definition', async () => {
    const otherMerchant = 'program-ref-other-merchant';
    await env.DB.prepare(
      'INSERT INTO merchants (id, name, created_at) VALUES (?1, ?2, ?3)',
    ).bind(otherMerchant, 'Other', '2026-07-18T12:00:00.000Z').run();
    const created = await createDefinition({
      key: 'customer.tier',
      label: 'Tier',
      source: 'customer',
      type: 'string',
      required: false,
    });
    await createRepositories({ DB: env.DB }).programs.create({
      merchantId: otherMerchant,
      program: programReferencing('other-ref', 'active', 'customer.tier'),
    });
    const response = await schemaRequest(
      'PATCH',
      `/v1/schema/definitions/${created.id}`,
      'secret-test',
      { ...created.definition, key: 'customer.segment' },
    );
    expect(response.status).toBe(200);
  });

  test('delete and published reads remain tenant-isolated', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const service = createSchemaService(repositories);
    const otherMerchant = 'published-other-merchant';
    await env.DB.prepare(
      'INSERT INTO merchants (id, name, created_at) VALUES (?1, ?2, ?3)',
    ).bind(otherMerchant, 'Other', '2026-07-18T12:00:00.000Z').run();
    const created = await service.create(SEEDED_MERCHANT_ID, channelDefinition);
    await service.create(otherMerchant, {
      key: 'context.locale',
      label: 'Locale',
      source: 'context',
      type: 'string',
      required: false,
    });
    await service.publish(SEEDED_MERCHANT_ID);

    await expect(service.delete(otherMerchant, created.id)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await expect(service.published(otherMerchant)).rejects.toMatchObject({
      name: 'NotFoundError',
    });
    await expect(repositories.schemas.getLatestVersion(otherMerchant, 'draft')).resolves.toMatchObject({
      version: 1,
      state: 'draft',
    });
  });
});

function programReferencing(
  id: string,
  status: 'draft' | 'active',
  variable: string,
): PromoProgram {
  return {
    id,
    type: 'promo',
    name: id,
    status,
    eligibility: {
      match: 'ALL',
      conditions: [{ id: 'condition', variable, operator: 'eq', value: 'gold' }],
    },
    reward: { type: 'free_shipping' },
    stackable: false,
    priority: 1,
    autoApply: true,
  };
}

describe('atomic schema repository', () => {
  beforeEach(resetSchemaData);

  test('simultaneous next-draft creation returns one complete cloned draft', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const note = {
      key: 'context.note',
      label: 'Note',
      source: 'context',
      type: 'string',
      required: false,
    } as const satisfies VariableDefinition;
    const publishedDefinitions = [channelDefinition, note];
    await repositories.schemas.createVersion({
      merchantId: SEEDED_MERCHANT_ID,
      version: 1,
      state: 'published',
      publishedAt: '2026-07-18T12:00:00.000Z',
      definitions: publishedDefinitions,
    });
    const drafts = await Promise.all([
      repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID),
      repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID),
    ]);
    expect(drafts).toEqual([
      expect.objectContaining({ version: 2, definitions: publishedDefinitions }),
      expect.objectContaining({ version: 2, definitions: publishedDefinitions }),
    ]);
    await expect(repositories.schemas.listDefinitions(SEEDED_MERCHANT_ID, 2)).resolves.toMatchObject([
      { state: 'draft', definition: channelDefinition },
      { state: 'draft', definition: note },
    ]);
  });

  test('CRUD racing publication has exactly one CAS winner and a consistent snapshot', async () => {
    const repositories = createRepositories({ DB: env.DB });
    await repositories.schemas.createVersion({
      merchantId: SEEDED_MERCHANT_ID,
      version: 1,
      state: 'published',
      publishedAt: '2026-07-18T12:00:00.000Z',
      definitions: [channelDefinition],
    });
    const draft = await repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID);
    const note = {
      key: 'context.note',
      label: 'Note',
      source: 'context',
      type: 'string',
      required: false,
    } as const satisfies VariableDefinition;
    const outcomes = await Promise.allSettled([
      repositories.schemas.createDraftDefinition({
        id: 'racing-note',
        merchantId: SEEDED_MERCHANT_ID,
        schemaVersion: draft.version,
        state: 'draft',
        definition: note,
      }, draft.definitions, [channelDefinition, note]),
      repositories.schemas.publishDraft(
        SEEDED_MERCHANT_ID,
        draft.version,
        draft.definitions,
        '2026-07-18T12:01:00.000Z',
      ),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);

    const stored = await repositories.schemas.getVersion(SEEDED_MERCHANT_ID, draft.version);
    const rows = await repositories.schemas.listDefinitions(SEEDED_MERCHANT_ID, draft.version);
    expect(rows.map(row => row.definition)).toEqual(stored?.definitions);
    expect(new Set(rows.map(row => row.state))).toEqual(new Set([stored?.state]));
  });

  test('update racing publication has exactly one CAS winner and a consistent snapshot', async () => {
    const repositories = createRepositories({ DB: env.DB });
    await repositories.schemas.createVersion({
      merchantId: SEEDED_MERCHANT_ID,
      version: 1,
      state: 'published',
      publishedAt: '2026-07-18T12:00:00.000Z',
      definitions: [channelDefinition],
    });
    const draft = await repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID);
    const [draftChannel] = await repositories.schemas.listDefinitions(
      SEEDED_MERCHANT_ID,
      draft.version,
    );
    const updated = { ...channelDefinition, label: 'Updated channel' };
    const outcomes = await Promise.allSettled([
      repositories.schemas.updateDraftDefinition(
        SEEDED_MERCHANT_ID,
        draftChannel!.id,
        draft.version,
        updated,
        draft.definitions,
        [updated],
      ),
      repositories.schemas.publishDraft(
        SEEDED_MERCHANT_ID,
        draft.version,
        draft.definitions,
        '2026-07-18T12:01:00.000Z',
      ),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    const stored = await repositories.schemas.getVersion(SEEDED_MERCHANT_ID, draft.version);
    const rows = await repositories.schemas.listDefinitions(SEEDED_MERCHANT_ID, draft.version);
    expect(rows.map(row => row.definition)).toEqual(stored?.definitions);
    expect(new Set(rows.map(row => row.state))).toEqual(new Set([stored?.state]));
  });

  test('delete racing publication has exactly one CAS winner and a consistent snapshot', async () => {
    const repositories = createRepositories({ DB: env.DB });
    await repositories.schemas.createVersion({
      merchantId: SEEDED_MERCHANT_ID,
      version: 1,
      state: 'published',
      publishedAt: '2026-07-18T12:00:00.000Z',
      definitions: [channelDefinition],
    });
    const draft = await repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID);
    const [draftChannel] = await repositories.schemas.listDefinitions(
      SEEDED_MERCHANT_ID,
      draft.version,
    );
    const outcomes = await Promise.allSettled([
      repositories.schemas.deleteDraftDefinition(
        SEEDED_MERCHANT_ID,
        draftChannel!.id,
        draft.version,
        draft.definitions,
        [],
      ),
      repositories.schemas.publishDraft(
        SEEDED_MERCHANT_ID,
        draft.version,
        draft.definitions,
        '2026-07-18T12:01:00.000Z',
      ),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    const stored = await repositories.schemas.getVersion(SEEDED_MERCHANT_ID, draft.version);
    const rows = await repositories.schemas.listDefinitions(SEEDED_MERCHANT_ID, draft.version);
    expect(rows.map(row => row.definition)).toEqual(stored?.definitions);
    expect(new Set(rows.map(row => row.state))).toEqual(
      rows.length === 0 ? new Set() : new Set([stored?.state]),
    );
  });

  test('duplicate publish CAS stores and returns only one published timestamp', async () => {
    const repositories = createRepositories({ DB: env.DB });
    const draft = await repositories.schemas.createNextDraft(SEEDED_MERCHANT_ID);
    const outcomes = await Promise.allSettled([
      repositories.schemas.publishDraft(
        SEEDED_MERCHANT_ID,
        draft.version,
        draft.definitions,
        '2026-07-18T12:01:00.000Z',
      ),
      repositories.schemas.publishDraft(
        SEEDED_MERCHANT_ID,
        draft.version,
        draft.definitions,
        '2026-07-18T12:02:00.000Z',
      ),
    ]);
    const winners = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<SchemaVersionRecord> => outcome.status === 'fulfilled',
    );
    expect(winners).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    await expect(repositories.schemas.getVersion(
      SEEDED_MERCHANT_ID,
      draft.version,
    )).resolves.toMatchObject({ publishedAt: winners[0]!.value.publishedAt });
  });
});
