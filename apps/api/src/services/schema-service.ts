import {
  buildPublishedEvaluationJsonSchema,
  VariableDefinitionSchema,
  type VariableDefinition,
} from '@incentives/contracts';

import { NotFoundError, SchemaConflictError } from '../errors.js';
import {
  SchemaRevisionConflictError,
  type Repositories,
  type SchemaVersionRecord,
  type VariableDefinitionRecord,
} from '../repositories/types.js';

export interface SchemaDefinitionView {
  id: string;
  definition: VariableDefinition;
  readOnly: boolean;
  referenced: boolean;
}

export interface PublishedSchema {
  version: number;
  publishedAt: string;
  definitions: VariableDefinition[];
  jsonSchema: Record<string, unknown>;
  sample: Record<string, unknown>;
}

export const BUILTIN_VARIABLE_DEFINITIONS = [
  { key: 'cart.currency', label: 'Cart currency', source: 'cart', type: 'string', required: true },
  { key: 'cart.subtotal', label: 'Cart subtotal', source: 'cart', type: 'number', required: true },
  { key: 'line_item.product_ref', label: 'Product reference', source: 'line_item', type: 'string', required: true },
  { key: 'line_item.variant_ref', label: 'Variant reference', source: 'line_item', type: 'string', required: false },
  { key: 'line_item.quantity', label: 'Quantity', source: 'line_item', type: 'number', required: true },
  { key: 'line_item.unit_price', label: 'Unit price', source: 'line_item', type: 'number', required: true },
  { key: 'system.budget_remaining', label: 'Budget remaining', source: 'system', type: 'number', required: false },
  { key: 'system.redemptions_total', label: 'Redemptions total', source: 'system', type: 'number', required: false },
  { key: 'system.customer_uses_count', label: 'Customer uses count', source: 'system', type: 'number', required: false },
  { key: 'system.today', label: 'Today', source: 'system', type: 'date', required: true },
] as const satisfies readonly VariableDefinition[];

const builtinByKey = new Map<string, VariableDefinition>(
  BUILTIN_VARIABLE_DEFINITIONS.map(definition => [definition.key, definition]),
);

function sampleValue(definition: VariableDefinition): string | number | boolean {
  switch (definition.type) {
    case 'enum':
      return definition.enumValues![0]!;
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return 'example';
    case 'date':
      return '2026-01-01';
  }
}

export function buildPublishedSample(
  definitions: readonly VariableDefinition[],
): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  const cartAttributes: Record<string, unknown> = {};
  for (const definition of definitions) {
    const field = definition.key.slice(definition.source.length + 1);
    if (definition.source === 'context') context[field] = sampleValue(definition);
    if (definition.source === 'cart') cartAttributes[field] = sampleValue(definition);
  }

  const cart: Record<string, unknown> = {
    currency: 'GBP',
    subtotal: 0,
    items: [],
  };
  if (Object.keys(cartAttributes).length > 0) cart.attributes = cartAttributes;

  return {
    cart,
    ...(Object.keys(context).length === 0 ? {} : { context }),
  };
}

function publishedPayload(version: SchemaVersionRecord): PublishedSchema {
  if (version.state !== 'published' || version.publishedAt === undefined) {
    throw new Error('Published schema record is incomplete');
  }
  return {
    version: version.version,
    publishedAt: version.publishedAt,
    definitions: version.definitions,
    jsonSchema: buildPublishedEvaluationJsonSchema(version.definitions),
    sample: buildPublishedSample(version.definitions),
  };
}

function canonicalDefinitions(definitions: readonly VariableDefinition[]): VariableDefinition[] {
  return definitions
    .map(definition => VariableDefinitionSchema.parse(definition))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function assertDraftSnapshot(
  draft: SchemaVersionRecord,
  records: readonly VariableDefinitionRecord[],
): VariableDefinition[] {
  const stored = canonicalDefinitions(draft.definitions);
  const rows = canonicalDefinitions(records.map(record => record.definition));
  if (JSON.stringify(stored) !== JSON.stringify(rows)) {
    throw new SchemaConflictError('Draft definitions do not match the draft revision');
  }
  return rows;
}

export function createSchemaService(repositories: Repositories) {
  async function latestPublished(merchantId: string): Promise<SchemaVersionRecord | null> {
    return repositories.schemas.getLatestVersion(merchantId, 'published');
  }

  async function ensureDraft(merchantId: string): Promise<SchemaVersionRecord> {
    return repositories.schemas.createNextDraft(merchantId);
  }

  function assertMerchantDefinition(definition: VariableDefinition): void {
    if (definition.source === 'system') {
      throw new SchemaConflictError('System definitions are read-only');
    }
    if (builtinByKey.has(definition.key)) {
      throw new SchemaConflictError('Canonical definitions are read-only');
    }
  }

  async function assertRequiredCompatibility(
    merchantId: string,
    definition: VariableDefinition,
  ): Promise<void> {
    if (!definition.required) return;
    const published = await latestPublished(merchantId);
    if (published === null) return;
    const previous = published.definitions.find(candidate => candidate.key === definition.key);
    if (previous?.required !== true) {
      throw new SchemaConflictError('Published integrations cannot gain a required field');
    }
  }

  async function workingDefinitions(merchantId: string): Promise<VariableDefinitionRecord[]> {
    const version = await repositories.schemas.getLatestVersion(merchantId, 'draft')
      ?? await latestPublished(merchantId);
    if (version === null) return [];
    return repositories.schemas.listDefinitions(merchantId, version.version);
  }

  async function view(
    merchantId: string,
    record: VariableDefinitionRecord,
    referencedKeys?: Set<string>,
  ): Promise<SchemaDefinitionView> {
    const referenced = referencedKeys ?? await repositories.programs.listReferencedVariableKeys(merchantId);
    return {
      id: record.id,
      definition: record.definition,
      readOnly: false,
      referenced: referenced.has(record.definition.key),
    };
  }

  return {
    async list(merchantId: string) {
      const [records, references, draft, published] = await Promise.all([
        workingDefinitions(merchantId),
        repositories.programs.listReferencedVariableKeys(merchantId),
        repositories.schemas.getLatestVersion(merchantId, 'draft'),
        latestPublished(merchantId),
      ]);
      const builtins: SchemaDefinitionView[] = BUILTIN_VARIABLE_DEFINITIONS.map(definition => ({
        id: `${definition.source === 'system' ? 'system' : 'canonical'}:${definition.key}`,
        definition,
        readOnly: true,
        referenced: references.has(definition.key),
      }));
      return {
        definitions: [
          ...builtins,
          ...records.map(record => ({
            id: record.id,
            definition: record.definition,
            readOnly: false,
            referenced: references.has(record.definition.key),
          })),
        ],
        ...(draft === null ? {} : { draftVersion: draft.version }),
        ...(published === null ? {} : { publishedVersion: published.version }),
      };
    },

    async create(merchantId: string, input: unknown): Promise<SchemaDefinitionView> {
      const definition = VariableDefinitionSchema.parse(input);
      assertMerchantDefinition(definition);
      await assertRequiredCompatibility(merchantId, definition);
      const draft = await ensureDraft(merchantId);
      const records = await repositories.schemas.listDefinitions(merchantId, draft.version);
      const expectedDefinitions = assertDraftSnapshot(draft, records);
      if (records.some(record => record.definition.key === definition.key)) {
        throw new SchemaConflictError(`Definition already exists: ${definition.key}`);
      }
      const record = await repositories.schemas.createDraftDefinition({
        id: crypto.randomUUID(),
        merchantId,
        schemaVersion: draft.version,
        state: 'draft',
        definition,
      }, expectedDefinitions, canonicalDefinitions([...expectedDefinitions, definition]));
      return view(merchantId, record);
    },

    async update(
      merchantId: string,
      id: string,
      input: unknown,
    ): Promise<SchemaDefinitionView> {
      if (id.startsWith('canonical:') || id.startsWith('system:')) {
        throw new SchemaConflictError('Canonical and system definitions are read-only');
      }
      const definition = VariableDefinitionSchema.parse(input);
      assertMerchantDefinition(definition);
      await assertRequiredCompatibility(merchantId, definition);

      const original = await repositories.schemas.getDefinition(merchantId, id);
      if (original === null) throw new NotFoundError('Definition not found', 'SCHEMA_DEFINITION_NOT_FOUND');
      const references = await repositories.programs.listReferencedVariableKeys(merchantId);
      if (
        references.has(original.definition.key)
        && (
          definition.key !== original.definition.key
          || definition.source !== original.definition.source
          || definition.type !== original.definition.type
        )
      ) {
        throw new SchemaConflictError('Referenced definition key, source, and type are immutable');
      }

      const draft = await ensureDraft(merchantId);
      const records = await repositories.schemas.listDefinitions(merchantId, draft.version);
      const expectedDefinitions = assertDraftSnapshot(draft, records);
      const target = original.state === 'draft'
        ? original
        : records.find(record => record.definition.key === original.definition.key);
      if (target === undefined) {
        throw new SchemaConflictError('Definition is not present in the current draft');
      }
      if (records.some(record => record.id !== target.id && record.definition.key === definition.key)) {
        throw new SchemaConflictError(`Definition already exists: ${definition.key}`);
      }
      const updated = await repositories.schemas.updateDraftDefinition(
        merchantId,
        target.id,
        draft.version,
        definition,
        expectedDefinitions,
      );
      return view(merchantId, updated, references);
    },

    async delete(merchantId: string, id: string): Promise<void> {
      if (id.startsWith('canonical:') || id.startsWith('system:')) {
        throw new SchemaConflictError('Canonical and system definitions are read-only');
      }
      const original = await repositories.schemas.getDefinition(merchantId, id);
      if (original === null) throw new NotFoundError('Definition not found', 'SCHEMA_DEFINITION_NOT_FOUND');
      const references = await repositories.programs.listReferencedVariableKeys(merchantId);
      if (references.has(original.definition.key)) {
        throw new SchemaConflictError('Referenced definitions cannot be deleted');
      }
      const draft = await ensureDraft(merchantId);
      const records = await repositories.schemas.listDefinitions(merchantId, draft.version);
      const expectedDefinitions = assertDraftSnapshot(draft, records);
      const target = original.state === 'draft'
        ? original
        : records.find(record => record.definition.key === original.definition.key);
      if (target === undefined) {
        throw new SchemaConflictError('Definition is not present in the current draft');
      }
      await repositories.schemas.deleteDraftDefinition(
        merchantId,
        target.id,
        draft.version,
        expectedDefinitions,
      );
    },

    async publish(merchantId: string): Promise<PublishedSchema> {
      const draft = await repositories.schemas.getLatestVersion(merchantId, 'draft');
      if (draft === null) {
        if (await latestPublished(merchantId) !== null) throw new SchemaRevisionConflictError();
        throw new SchemaConflictError('There is no draft schema to publish');
      }
      const records = await repositories.schemas.listDefinitions(merchantId, draft.version);
      const definitions = assertDraftSnapshot(draft, records);
      for (const definition of definitions) {
        assertMerchantDefinition(definition);
        await assertRequiredCompatibility(merchantId, definition);
      }
      buildPublishedEvaluationJsonSchema(definitions);
      const publishedAt = new Date().toISOString();
      const published = await repositories.schemas.publishDraft(
        merchantId,
        draft.version,
        definitions,
        publishedAt,
      );
      return publishedPayload(published);
    },

    async published(merchantId: string): Promise<PublishedSchema> {
      const published = await latestPublished(merchantId);
      if (published === null) {
        throw new NotFoundError('No schema has been published', 'SCHEMA_NOT_PUBLISHED');
      }
      return publishedPayload(published);
    },
  };
}
