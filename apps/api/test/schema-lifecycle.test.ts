import {
  SchemaDefinitionImpactPreviewSchema,
  SchemaPublicationResultSchema,
  type OperatorCallContext,
  type PermissionKey,
  type PromoProgram,
  type SchemaDefinitionImpactPreview,
  type SchemaDefinitionView,
  type SchemaPublicationResult,
  type VariableDefinition,
} from '@incentives/contracts';
import { createExecutionContext, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Env } from '../src/env.js';
import { CoreOperatorService } from '../src/worker.js';
import { SEEDED_MERCHANT_ID, SECRET_TEST_TOKEN } from './test-credentials.js';

interface SchemaLifecycleOperatorService extends CoreOperatorService {
  listSchemaDefinitions(context: OperatorCallContext): Promise<{
    definitions: SchemaDefinitionView[];
    draftVersion?: number;
    publishedVersion?: number;
  }>;
  createSchemaDefinition(
    context: OperatorCallContext,
    input: unknown,
  ): Promise<SchemaDefinitionView>;
  updateSchemaDefinition(
    context: OperatorCallContext,
    definitionId: string,
    input: unknown,
  ): Promise<SchemaDefinitionView>;
  deleteSchemaDefinition(
    context: OperatorCallContext,
    definitionId: string,
  ): Promise<void>;
  previewSchemaDefinitionImpact(
    context: OperatorCallContext,
    definitionId: string,
  ): Promise<SchemaDefinitionImpactPreview>;
  deprecateSchemaDefinition(
    context: OperatorCallContext,
    definitionId: string,
  ): Promise<void>;
  publishSchema(context: OperatorCallContext): Promise<SchemaPublicationResult>;
  createProgramDraft(
    context: OperatorCallContext,
    input: unknown,
  ): Promise<PromoProgram>;
  publishProgram(context: OperatorCallContext, externalRef: string): Promise<unknown>;
}

const customerTierDefinition = {
  key: 'customer.tier',
  label: 'Customer tier',
  source: 'customer',
  type: 'enum',
  required: false,
  enumValues: ['gold', 'silver'],
} as const satisfies VariableDefinition;

const contextChannelDefinition = {
  key: 'context.channel',
  label: 'Sales channel',
  source: 'context',
  type: 'string',
  required: false,
} as const satisfies VariableDefinition;

function operatorContext(permission: PermissionKey): OperatorCallContext {
  return {
    correlationId: `schema-lifecycle-${permission}`,
    actorUserId: 'schema-operator',
    actorKind: 'member',
    merchantId: SEEDED_MERCHANT_ID,
    permission,
  };
}

function operatorService(): SchemaLifecycleOperatorService {
  return new CoreOperatorService(
    createExecutionContext(),
    env as Env,
  ) as SchemaLifecycleOperatorService;
}

async function customerUpsert(
  customerRef: string,
  attributes: Record<string, unknown>,
  expectedVersion?: number,
) {
  return SELF.fetch(`https://runtime.test/v1/customers/${customerRef}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${SECRET_TEST_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      attributes,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  });
}

function draftProgram(id: string, variable = 'customer.tier'): PromoProgram {
  return {
    id,
    type: 'promo',
    name: 'Schema lifecycle offer',
    status: 'draft',
    eligibility: {
      match: 'ALL',
      conditions: [{
        id: 'schema-condition',
        variable,
        operator: 'eq',
        value: variable === 'customer.tier' ? 'gold' : 'yes',
      }],
    },
    rewardRules: [{
      id: 'reward',
      name: 'Reward',
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
        amount: { currency: 'GBP', minorUnits: 100 },
      },
    }],
    stackable: false,
    priority: 1,
    autoApply: true,
  };
}

async function resetLifecycleData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM program_counters'),
    env.DB.prepare('DELETE FROM program_revisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare('DELETE FROM variable_definitions'),
  ]);
}

describe('private schema lifecycle service', () => {
  beforeEach(resetLifecycleData);

  test('keeps published key, source, and type immutable while allowing presentation edits', async () => {
    const service = operatorService();
    const created = await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));

    for (const replacement of [
      { ...contextChannelDefinition, key: 'context.sales_channel' },
      { ...contextChannelDefinition, key: 'customer.channel', source: 'customer' as const },
      { ...contextChannelDefinition, type: 'number' as const },
    ]) {
      await expect(service.updateSchemaDefinition(
        operatorContext('schemas:manage'),
        created.id,
        replacement,
      )).rejects.toMatchObject({ name: 'SchemaConflictError' });
    }

    const presentationEdit = await service.updateSchemaDefinition(
      operatorContext('schemas:manage'),
      created.id,
      { ...contextChannelDefinition, label: 'Checkout sales channel' },
    );
    expect(presentationEdit.definition).toMatchObject({
      key: contextChannelDefinition.key,
      source: contextChannelDefinition.source,
      type: contextChannelDefinition.type,
      label: 'Checkout sales channel',
    });
  });

  test('blocks required customer publication on exact-field coverage but only warns for live context', async () => {
    const service = operatorService();
    const tier = await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      customerTierDefinition,
    );
    const channel = await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));

    expect((await customerUpsert('covered-customer', { tier: 'gold' })).status).toBe(200);
    expect((await customerUpsert('missing-tier-customer', {})).status).toBe(200);

    const requiredTier = await service.updateSchemaDefinition(
      operatorContext('schemas:manage'),
      tier.id,
      { ...customerTierDefinition, required: true },
    );
    const requiredChannel = await service.updateSchemaDefinition(
      operatorContext('schemas:manage'),
      channel.id,
      { ...contextChannelDefinition, required: true },
    );

    const tierImpact = SchemaDefinitionImpactPreviewSchema.parse(
      await service.previewSchemaDefinitionImpact(
      operatorContext('schemas:read'),
      requiredTier.id,
      ),
    );
    expect(tierImpact).toMatchObject({
      publishedVersions: [1],
      storedCustomerCount: 1,
      incompatibleCustomerCount: 1,
      warnings: [],
    });
    const channelImpact = SchemaDefinitionImpactPreviewSchema.parse(
      await service.previewSchemaDefinitionImpact(
      operatorContext('schemas:read'),
      requiredChannel.id,
      ),
    );
    expect(channelImpact).toMatchObject({
      publishedVersions: [1],
      storedCustomerCount: 0,
      incompatibleCustomerCount: 0,
      warnings: [expect.objectContaining({ code: 'REQUIRED_LIVE_FIELD' })],
    });

    await expect(service.publishSchema(
      operatorContext('schemas:publish'),
    )).rejects.toMatchObject({ name: 'SchemaConflictError' });

    expect((await customerUpsert(
      'missing-tier-customer',
      { tier: 'silver' },
      1,
    )).status).toBe(200);
    const publication = SchemaPublicationResultSchema.parse(await service.publishSchema(
      operatorContext('schemas:publish'),
    ));
    expect(publication).toMatchObject({
      version: 2,
      warnings: [expect.objectContaining({ code: 'REQUIRED_LIVE_FIELD' })],
    });
  });

  test('blocks program publication until its draft-only schema field is published', async () => {
    const service = operatorService();
    await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      contextChannelDefinition,
    );
    await service.createProgramDraft(
      operatorContext('programs:manage'),
      draftProgram('draft-schema-program', 'context.channel'),
    );

    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      'draft-schema-program',
    )).rejects.toMatchObject({ name: 'ProgramConflictError' });

    await service.publishSchema(operatorContext('schemas:publish'));
    await expect(service.publishProgram(
      operatorContext('programs:publish'),
      'draft-schema-program',
    )).resolves.toMatchObject({
      programRef: 'draft-schema-program',
      status: 'active',
      activeRevision: 1,
    });
  });

  test('previews references and deprecates a published field without breaking old revisions', async () => {
    const service = operatorService();
    const tier = await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      customerTierDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    await service.createProgramDraft(
      operatorContext('programs:manage'),
      draftProgram('published-reference'),
    );
    await service.publishProgram(
      operatorContext('programs:publish'),
      'published-reference',
    );

    await expect(service.deleteSchemaDefinition(
      operatorContext('schemas:manage'),
      tier.id,
    )).rejects.toMatchObject({ name: 'SchemaConflictError' });
    await expect(service.previewSchemaDefinitionImpact(
      operatorContext('schemas:read'),
      tier.id,
    )).resolves.toMatchObject({
      publishedVersions: [1],
      referencedProgramRefs: ['published-reference'],
      storedCustomerCount: 0,
    });

    await service.deprecateSchemaDefinition(
      operatorContext('schemas:manage'),
      tier.id,
    );
    const listed = await service.listSchemaDefinitions(operatorContext('schemas:read'));
    expect(listed.definitions.some(({ definition }) => (
      definition.key === customerTierDefinition.key
    ))).toBe(false);
    await expect(service.createProgramDraft(
      operatorContext('programs:manage'),
      draftProgram('new-deprecated-reference'),
    )).rejects.toMatchObject({ name: 'ContextValidationError' });

    expect(await env.DB.prepare(`
      SELECT state, deprecated_by AS deprecatedBy
      FROM variable_definitions WHERE id = ?1
    `).bind(tier.id).first()).toEqual({
      state: 'deprecated',
      deprecatedBy: 'schema-operator',
    });
    expect(await env.DB.prepare(`
      SELECT published_at AS publishedAt FROM program_revisions
      WHERE merchant_id = ?1 AND revision = 1
    `).bind(SEEDED_MERCHANT_ID).first()).toMatchObject({
      publishedAt: expect.any(String),
    });
  });

  test('warns for enum additions and blocks removals that break existing programs', async () => {
    const service = operatorService();
    const channel = await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      {
        key: 'context.channel',
        label: 'Sales channel',
        source: 'context',
        type: 'enum',
        required: false,
        enumValues: ['web', 'mobile'],
      },
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    const mobileProgram = draftProgram('mobile-program', 'context.channel');
    mobileProgram.eligibility.conditions[0]!.value = 'mobile';
    await service.createProgramDraft(operatorContext('programs:manage'), mobileProgram);
    await service.publishProgram(operatorContext('programs:publish'), mobileProgram.id);

    const added = await service.updateSchemaDefinition(
      operatorContext('schemas:manage'),
      channel.id,
      {
        key: 'context.channel',
        label: 'Sales channel',
        source: 'context',
        type: 'enum',
        required: false,
        enumValues: ['web', 'mobile', 'store'],
      },
    );
    const additivePublication = SchemaPublicationResultSchema.parse(
      await service.publishSchema(operatorContext('schemas:publish')),
    );
    expect(additivePublication).toMatchObject({
      version: 2,
      warnings: [expect.objectContaining({ code: 'ENUM_VALUE_ADDED' })],
    });

    await service.updateSchemaDefinition(
      operatorContext('schemas:manage'),
      added.id,
      {
        key: 'context.channel',
        label: 'Sales channel',
        source: 'context',
        type: 'enum',
        required: false,
        enumValues: ['web', 'store'],
      },
    );
    await expect(service.publishSchema(
      operatorContext('schemas:publish'),
    )).rejects.toMatchObject({ name: 'SchemaConflictError' });
    expect(await env.DB.prepare(`
      SELECT MAX(version) AS version FROM schema_versions
      WHERE merchant_id = ?1 AND state = 'published'
    `).bind(SEEDED_MERCHANT_ID).first()).toEqual({ version: 2 });
  });

  test('keeps deprecated fields hidden through draft cloning and later publication', async () => {
    const service = operatorService();
    const tier = await service.createSchemaDefinition(
      operatorContext('schemas:manage'),
      customerTierDefinition,
    );
    await service.publishSchema(operatorContext('schemas:publish'));
    await service.createSchemaDefinition(operatorContext('schemas:manage'), {
      key: 'context.note',
      label: 'Note',
      source: 'context',
      type: 'string',
      required: false,
    });
    await service.deprecateSchemaDefinition(
      operatorContext('schemas:manage'),
      tier.id,
    );
    let listed = await service.listSchemaDefinitions(operatorContext('schemas:read'));
    expect(listed.definitions.some(({ definition }) => (
      definition.key === customerTierDefinition.key
    ))).toBe(false);

    await service.publishSchema(operatorContext('schemas:publish'));
    await service.createSchemaDefinition(operatorContext('schemas:manage'), {
      key: 'context.flag',
      label: 'Flag',
      source: 'context',
      type: 'boolean',
      required: false,
    });
    listed = await service.listSchemaDefinitions(operatorContext('schemas:read'));
    expect(listed.definitions.some(({ definition }) => (
      definition.key === customerTierDefinition.key
    ))).toBe(false);
  });

  test('lets a fresh operator deprecate a post-clone definition by its visible draft id', async () => {
    const firstOperator = operatorService();
    await firstOperator.createSchemaDefinition(
      operatorContext('schemas:manage'),
      customerTierDefinition,
    );
    await firstOperator.publishSchema(operatorContext('schemas:publish'));
    await firstOperator.createSchemaDefinition(operatorContext('schemas:manage'), {
      key: 'context.note',
      label: 'Note',
      source: 'context',
      type: 'string',
      required: false,
    });

    const freshOperator = operatorService();
    const listed = await freshOperator.listSchemaDefinitions(
      operatorContext('schemas:read'),
    );
    const visibleTier = listed.definitions.find(({ definition }) => (
      definition.key === customerTierDefinition.key
    ));
    expect(visibleTier).toBeDefined();
    await expect(freshOperator.deprecateSchemaDefinition(
      operatorContext('schemas:manage'),
      visibleTier!.id,
    )).resolves.toBeUndefined();

    const after = await freshOperator.listSchemaDefinitions(
      operatorContext('schemas:read'),
    );
    expect(after.definitions.some(({ definition }) => (
      definition.key === customerTierDefinition.key
    ))).toBe(false);
  });

  test('requires canonical operator permissions and exposes no merchant authoring routes', async () => {
    const service = operatorService();
    await expect(service.createSchemaDefinition(
      operatorContext('schemas:read'),
      contextChannelDefinition,
    )).rejects.toMatchObject({ name: 'ForbiddenError' });
    await expect(service.publishSchema(
      operatorContext('schemas:manage'),
    )).rejects.toMatchObject({ name: 'ForbiddenError' });

    for (const path of [
      '/v1/schema/definitions',
      '/v1/schema/publish',
      '/v1/programs',
    ]) {
      const response = await SELF.fetch(`https://runtime.test${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SECRET_TEST_TOKEN}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(response.status, path).toBe(404);
    }
  });
});
