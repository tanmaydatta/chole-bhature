import {
  CustomerSnapshotSchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
  PromoProgramSchema,
  RedemptionResponseSchema,
  VariableDefinitionSchema,
  type VariableDefinition,
} from '@incentives/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { createDatabase } from '../db/client.js';
import {
  customers,
  evaluationDecisions,
  programs,
  redemptions,
  schemaVersions,
  variableDefinitions,
} from '../db/schema.js';
import type { Env } from '../env.js';
import {
  OptimisticVersionConflictError,
  SchemaRevisionConflictError,
  type CustomerRecord,
  type CustomerUpsert,
  type EvaluationDecisionRecord,
  type ProgramRecord,
  type RedemptionCreate,
  type Repositories,
  type SchemaVersionCreate,
  type SchemaVersionRecord,
  type VariableDefinitionCreate,
  type VariableDefinitionRecord,
} from './types.js';

const AttributesSchema = z.record(z.string(), z.unknown());
const DefinitionsSchema = z.array(VariableDefinitionSchema);
const DecisionsSchema = z.array(IncentiveDecisionSchema);
const DateTimeSchema = z.iso.datetime({ offset: true });
const SchemaStateSchema = z.enum(['draft', 'published']);
const PositiveIntegerSchema = z.number().int().positive();
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

function normalizedDefinitions(definitions: readonly VariableDefinition[]): VariableDefinition[] {
  return DefinitionsSchema.parse(definitions).sort((left, right) => left.key.localeCompare(right.key));
}

function definitionsJson(definitions: readonly VariableDefinition[]): string {
  return JSON.stringify(normalizedDefinitions(definitions));
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  return schema.parse(JSON.parse(value) as unknown);
}

function optional<T, K extends string>(key: K, value: T | null | undefined): { [P in K]?: T } {
  return value === null || value === undefined
    ? {}
    : { [key]: value } as { [P in K]: T };
}

function parseDefinitionCreate(input: VariableDefinitionCreate): VariableDefinitionRecord {
  return {
    id: z.string().min(1).parse(input.id),
    merchantId: z.string().min(1).parse(input.merchantId),
    schemaVersion: PositiveIntegerSchema.parse(input.schemaVersion),
    state: SchemaStateSchema.parse(input.state),
    definition: VariableDefinitionSchema.parse(input.definition),
    createdAt: DateTimeSchema.parse(input.createdAt ?? now()),
  };
}

function definitionFromRow(row: typeof variableDefinitions.$inferSelect): VariableDefinitionRecord {
  const enumValues = row.enumValuesJson === null
    ? undefined
    : parseJson(row.enumValuesJson, z.array(z.string().min(1)).min(1));
  const definition = VariableDefinitionSchema.parse({
    key: row.key,
    label: row.label,
    source: row.source,
    type: row.type,
    required: row.required,
    ...optional('enumValues', enumValues),
    ...optional('description', row.description),
    ...optional('defaultErrorMessage', row.defaultErrorMessage),
  });

  return {
    id: row.id,
    merchantId: row.merchantId,
    schemaVersion: PositiveIntegerSchema.parse(row.schemaVersion),
    state: SchemaStateSchema.parse(row.state),
    definition,
    createdAt: DateTimeSchema.parse(row.createdAt),
  };
}

function parseSchemaVersionCreate(input: SchemaVersionCreate): SchemaVersionRecord {
  const publishedAt = input.publishedAt === undefined
    ? undefined
    : DateTimeSchema.parse(input.publishedAt);

  return {
    merchantId: z.string().min(1).parse(input.merchantId),
    version: PositiveIntegerSchema.parse(input.version),
    state: SchemaStateSchema.parse(input.state),
    ...optional('publishedAt', publishedAt),
    definitions: normalizedDefinitions(input.definitions),
  };
}

function schemaVersionFromRow(row: typeof schemaVersions.$inferSelect): SchemaVersionRecord {
  return {
    merchantId: row.merchantId,
    version: PositiveIntegerSchema.parse(row.version),
    state: SchemaStateSchema.parse(row.state),
    ...optional(
      'publishedAt',
      row.publishedAt === null ? undefined : DateTimeSchema.parse(row.publishedAt),
    ),
    definitions: parseJson(row.definitionsJson, DefinitionsSchema),
  };
}

function customerFromRow(row: typeof customers.$inferSelect): CustomerRecord {
  const snapshot = CustomerSnapshotSchema.parse({
    externalRef: row.externalRef,
    attributes: parseJson(row.attributesJson, AttributesSchema),
  });

  return {
    ...snapshot,
    version: PositiveIntegerSchema.parse(row.version),
    updatedAt: DateTimeSchema.parse(row.updatedAt),
  };
}

function programFromRow(row: typeof programs.$inferSelect): ProgramRecord {
  const program = parseJson(row.configJson, PromoProgramSchema);
  if (
    program.id !== row.externalRef
    || program.type !== row.type
    || program.name !== row.name
    || program.status !== row.status
    || program.priority !== row.priority
  ) {
    throw new Error('Program JSON does not match its relational columns');
  }

  return {
    id: row.id,
    merchantId: row.merchantId,
    externalRef: row.externalRef,
    program,
    usageCount: z.number().int().nonnegative().parse(row.usageCount),
    ...optional('budgetRemaining', row.budgetRemaining),
    createdAt: DateTimeSchema.parse(row.createdAt),
    updatedAt: DateTimeSchema.parse(row.updatedAt),
  };
}

function parseDecision(input: EvaluationDecisionRecord): EvaluationDecisionRecord {
  const customerRef = input.customerRef === undefined
    ? undefined
    : z.string().min(1).parse(input.customerRef);
  const customerVersion = input.customerVersion === undefined
    ? undefined
    : PositiveIntegerSchema.parse(input.customerVersion);

  if ((customerRef === undefined) !== (customerVersion === undefined)) {
    throw new Error('Customer ref and customer version must be recorded together');
  }

  return {
    evaluationId: z.string().min(1).parse(input.evaluationId),
    merchantId: z.string().min(1).parse(input.merchantId),
    ...optional('customerRef', customerRef),
    ...optional('customerVersion', customerVersion),
    schemaVersion: PositiveIntegerSchema.parse(input.schemaVersion),
    request: EvaluationRequestSchema.parse(input.request),
    decisions: DecisionsSchema.parse(input.decisions),
    integrityHash: z.string().min(1).parse(input.integrityHash),
    expiresAt: DateTimeSchema.parse(input.expiresAt),
    createdAt: DateTimeSchema.parse(input.createdAt),
  };
}

function decisionFromRow(row: typeof evaluationDecisions.$inferSelect): EvaluationDecisionRecord {
  return parseDecision({
    evaluationId: row.id,
    merchantId: row.merchantId,
    ...optional('customerRef', row.customerRef),
    ...optional('customerVersion', row.customerVersion),
    schemaVersion: row.schemaVersion,
    request: parseJson(row.requestJson, EvaluationRequestSchema),
    decisions: parseJson(row.decisionsJson, DecisionsSchema),
    integrityHash: row.integrityHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  });
}

function parseRedemption(input: RedemptionCreate): RedemptionCreate {
  const externalOrderRef = input.externalOrderRef === undefined
    ? undefined
    : z.string().min(1).parse(input.externalOrderRef);
  const idempotencyKey = input.idempotencyKey === undefined
    ? undefined
    : z.string().min(1).parse(input.idempotencyKey);

  if (externalOrderRef === undefined && idempotencyKey === undefined) {
    throw new Error('At least one redemption identifier is required');
  }

  const result = RedemptionResponseSchema.parse(input.result);
  if (
    result.redemptionId !== input.redemptionId
    || result.evaluationId !== input.evaluationId
    || result.externalOrderRef !== externalOrderRef
    || result.idempotencyKey !== idempotencyKey
  ) {
    throw new Error('Redemption result does not match its relational identifiers');
  }

  return {
    redemptionId: z.string().min(1).parse(input.redemptionId),
    merchantId: z.string().min(1).parse(input.merchantId),
    ...optional('externalOrderRef', externalOrderRef),
    ...optional('idempotencyKey', idempotencyKey),
    evaluationId: z.string().min(1).parse(input.evaluationId),
    result,
    discountMinorUnits: z.number().int().nonnegative().parse(input.discountMinorUnits),
    currency: CurrencySchema.parse(input.currency),
    createdAt: DateTimeSchema.parse(input.createdAt),
  };
}

function redemptionFromRow(row: typeof redemptions.$inferSelect): RedemptionCreate {
  return parseRedemption({
    redemptionId: row.id,
    merchantId: row.merchantId,
    ...optional('externalOrderRef', row.externalOrderRef),
    ...optional('idempotencyKey', row.idempotencyKey),
    evaluationId: row.evaluationId,
    result: parseJson(row.resultJson, RedemptionResponseSchema),
    discountMinorUnits: row.discountMinorUnits,
    currency: row.currency,
    createdAt: row.createdAt,
  });
}

export function createRepositories(env: Env): Repositories {
  const db = createDatabase(env);

  async function getLatestSchemaVersion(
    merchantId: string,
    state: 'draft' | 'published',
  ): Promise<SchemaVersionRecord | null> {
    const row = await db.select().from(schemaVersions).where(and(
      eq(schemaVersions.merchantId, merchantId),
      eq(schemaVersions.state, state),
    )).orderBy(desc(schemaVersions.version)).get();
    return row === undefined ? null : schemaVersionFromRow(row);
  }

  async function getSchemaDefinition(
    merchantId: string,
    id: string,
  ): Promise<VariableDefinitionRecord | null> {
    const row = await db.select().from(variableDefinitions).where(and(
      eq(variableDefinitions.merchantId, merchantId),
      eq(variableDefinitions.id, id),
    )).get();
    return row === undefined ? null : definitionFromRow(row);
  }

  function conditionalDefinitionInsert(
    input: VariableDefinitionRecord,
    expectedJson: string,
  ): D1PreparedStatement {
    return env.DB.prepare(`
      INSERT INTO variable_definitions (
        id, merchant_id, schema_version, key, label, source, type, required,
        enum_values_json, description, default_error_message, state, created_at
      )
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'draft', ?12
      WHERE EXISTS (
        SELECT 1 FROM schema_versions
        WHERE merchant_id = ?2 AND version = ?3
          AND state = 'draft' AND definitions_json = ?13
      )
    `).bind(
      input.id,
      input.merchantId,
      input.schemaVersion,
      input.definition.key,
      input.definition.label,
      input.definition.source,
      input.definition.type,
      input.definition.required,
      input.definition.enumValues === undefined ? null : JSON.stringify(input.definition.enumValues),
      input.definition.description ?? null,
      input.definition.defaultErrorMessage ?? null,
      input.createdAt,
      expectedJson,
    );
  }

  async function getCustomer(
    merchantId: string,
    externalRef: string,
  ): Promise<CustomerRecord | null> {
    const row = await db.select().from(customers).where(and(
      eq(customers.merchantId, merchantId),
      eq(customers.externalRef, externalRef),
    )).get();
    return row === undefined ? null : customerFromRow(row);
  }

  async function insertCustomer(
    merchantId: string,
    snapshot: z.infer<typeof CustomerSnapshotSchema>,
    updatedAt: string,
  ): Promise<CustomerRecord> {
    const row = await db.insert(customers).values({
      id: crypto.randomUUID(),
      merchantId,
      externalRef: snapshot.externalRef,
      attributesJson: JSON.stringify(snapshot.attributes),
      version: 1,
      updatedAt,
    }).returning().get();
    return customerFromRow(row);
  }

  return {
    schemas: {
      async listDefinitions(merchantId, schemaVersion) {
        const rows = await db.select().from(variableDefinitions).where(and(
          eq(variableDefinitions.merchantId, merchantId),
          eq(variableDefinitions.schemaVersion, schemaVersion),
        )).orderBy(variableDefinitions.key).all();
        return rows.map(definitionFromRow);
      },

      async getDefinition(merchantId, id) {
        return getSchemaDefinition(merchantId, id);
      },

      async createNextDraft(merchantId) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const existing = await getLatestSchemaVersion(merchantId, 'draft');
          if (existing !== null) return existing;

          const published = await getLatestSchemaVersion(merchantId, 'published');
          const version = (published?.version ?? 0) + 1;
          const definitions = normalizedDefinitions(published?.definitions ?? []);
          const createdAt = now();
          const statements = [
            env.DB.prepare(`
              INSERT INTO schema_versions (
                merchant_id, version, state, published_at, definitions_json
              ) VALUES (?1, ?2, 'draft', NULL, ?3)
            `).bind(merchantId, version, definitionsJson(definitions)),
            ...definitions.map(definition => conditionalDefinitionInsert(
              parseDefinitionCreate({
                id: crypto.randomUUID(),
                merchantId,
                schemaVersion: version,
                state: 'draft',
                definition,
                createdAt,
              }),
              definitionsJson(definitions),
            )),
          ];

          try {
            await env.DB.batch(statements);
            return {
              merchantId,
              version,
              state: 'draft',
              definitions,
            };
          } catch (error) {
            const winner = await getLatestSchemaVersion(merchantId, 'draft');
            if (winner !== null) return winner;
            if (!isConstraintError(error) || attempt === 2) throw error;
          }
        }
        throw new SchemaRevisionConflictError();
      },

      async createDraftDefinition(input, expectedDefinitions, nextDefinitions) {
        const parsed = parseDefinitionCreate({ ...input, state: 'draft' });
        const expectedJson = definitionsJson(expectedDefinitions);
        const nextJson = definitionsJson(nextDefinitions);
        try {
          const [insertResult, versionResult] = await env.DB.batch([
            conditionalDefinitionInsert(parsed, expectedJson),
            env.DB.prepare(`
              UPDATE schema_versions SET definitions_json = ?1
              WHERE merchant_id = ?2 AND version = ?3
                AND state = 'draft' AND definitions_json = ?4
                AND EXISTS (
                  SELECT 1 FROM variable_definitions
                  WHERE merchant_id = ?2 AND schema_version = ?3
                    AND id = ?5 AND state = 'draft'
                )
            `).bind(nextJson, parsed.merchantId, parsed.schemaVersion, expectedJson, parsed.id),
          ]);
          if (insertResult?.meta.changes !== 1 || versionResult?.meta.changes !== 1) {
            throw new SchemaRevisionConflictError();
          }
          return parsed;
        } catch (error) {
          if (error instanceof SchemaRevisionConflictError) throw error;
          if (isConstraintError(error)) throw new SchemaRevisionConflictError();
          throw error;
        }
      },

      async updateDraftDefinition(
        merchantId,
        id,
        schemaVersion,
        definition,
        expectedDefinitions,
        nextDefinitions,
      ) {
        const parsed = VariableDefinitionSchema.parse(definition);
        const expectedJson = definitionsJson(expectedDefinitions);
        const nextJson = definitionsJson(nextDefinitions);
        try {
          const [definitionResult, versionResult] = await env.DB.batch([
            env.DB.prepare(`
              UPDATE variable_definitions SET
                key = ?1, label = ?2, source = ?3, type = ?4, required = ?5,
                enum_values_json = ?6, description = ?7, default_error_message = ?8
              WHERE merchant_id = ?9 AND id = ?10 AND schema_version = ?11
                AND state = 'draft' AND EXISTS (
                  SELECT 1 FROM schema_versions
                  WHERE merchant_id = ?9 AND version = ?11
                    AND state = 'draft' AND definitions_json = ?12
                )
            `).bind(
              parsed.key,
              parsed.label,
              parsed.source,
              parsed.type,
              parsed.required,
              parsed.enumValues === undefined ? null : JSON.stringify(parsed.enumValues),
              parsed.description ?? null,
              parsed.defaultErrorMessage ?? null,
              merchantId,
              id,
              schemaVersion,
              expectedJson,
            ),
            env.DB.prepare(`
              UPDATE schema_versions SET definitions_json = ?1
              WHERE merchant_id = ?2 AND version = ?3
                AND state = 'draft' AND definitions_json = ?4
                AND EXISTS (
                  SELECT 1 FROM variable_definitions
                  WHERE merchant_id = ?2 AND schema_version = ?3
                    AND id = ?5 AND state = 'draft'
                )
            `).bind(nextJson, merchantId, schemaVersion, expectedJson, id),
          ]);
          if (definitionResult?.meta.changes !== 1 || versionResult?.meta.changes !== 1) {
            throw new SchemaRevisionConflictError();
          }
        } catch (error) {
          if (error instanceof SchemaRevisionConflictError) throw error;
          if (isConstraintError(error)) throw new SchemaRevisionConflictError();
          throw error;
        }
        const updated = await getSchemaDefinition(merchantId, id);
        if (updated === null) throw new SchemaRevisionConflictError();
        return updated;
      },

      async deleteDraftDefinition(
        merchantId,
        id,
        schemaVersion,
        expectedDefinitions,
        nextDefinitions,
      ) {
        const expectedJson = definitionsJson(expectedDefinitions);
        const nextJson = definitionsJson(nextDefinitions);
        const [definitionResult, versionResult] = await env.DB.batch([
          env.DB.prepare(`
            DELETE FROM variable_definitions
            WHERE merchant_id = ?1 AND id = ?2 AND schema_version = ?3
              AND state = 'draft' AND EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?1 AND version = ?3
                  AND state = 'draft' AND definitions_json = ?4
              )
          `).bind(merchantId, id, schemaVersion, expectedJson),
          env.DB.prepare(`
            UPDATE schema_versions SET definitions_json = ?1
            WHERE merchant_id = ?2 AND version = ?3
              AND state = 'draft' AND definitions_json = ?4
          `).bind(nextJson, merchantId, schemaVersion, expectedJson),
        ]);
        if (definitionResult?.meta.changes !== 1 || versionResult?.meta.changes !== 1) {
          throw new SchemaRevisionConflictError();
        }
      },

      async createVersion(input) {
        const parsed = parseSchemaVersionCreate(input);
        if (parsed.state !== 'published' || parsed.publishedAt === undefined) {
          throw new Error('Draft versions must be created atomically with createNextDraft');
        }
        await db.insert(schemaVersions).values({
          merchantId: parsed.merchantId,
          version: parsed.version,
          state: parsed.state,
          publishedAt: parsed.publishedAt ?? null,
          definitionsJson: JSON.stringify(parsed.definitions),
        }).run();
        return parsed;
      },

      async getVersion(merchantId, version) {
        const row = await db.select().from(schemaVersions).where(and(
          eq(schemaVersions.merchantId, merchantId),
          eq(schemaVersions.version, version),
        )).get();
        return row === undefined ? null : schemaVersionFromRow(row);
      },

      async getLatestVersion(merchantId, state) {
        return getLatestSchemaVersion(merchantId, state);
      },

      async publishDraft(merchantId, version, expectedDefinitions, publishedAt) {
        const parsed = parseSchemaVersionCreate({
          merchantId,
          version,
          state: 'published',
          publishedAt,
          definitions: expectedDefinitions,
        });
        const expectedJson = definitionsJson(parsed.definitions);
        const [versionResult, definitionsResult] = await env.DB.batch([
          env.DB.prepare(`
            UPDATE schema_versions
            SET state = 'published', published_at = ?1
            WHERE merchant_id = ?2 AND version = ?3
              AND state = 'draft' AND definitions_json = ?4
              AND (
                SELECT COUNT(*) FROM variable_definitions
                WHERE merchant_id = ?2 AND schema_version = ?3 AND state = 'draft'
              ) = ?5
          `).bind(
            parsed.publishedAt,
            parsed.merchantId,
            parsed.version,
            expectedJson,
            parsed.definitions.length,
          ),
          env.DB.prepare(`
            UPDATE variable_definitions SET state = 'published'
            WHERE merchant_id = ?1 AND schema_version = ?2 AND state = 'draft'
              AND EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?1 AND version = ?2
                  AND state = 'published' AND published_at = ?3
                  AND definitions_json = ?4
              )
          `).bind(parsed.merchantId, parsed.version, parsed.publishedAt, expectedJson),
        ]);
        if (
          versionResult?.meta.changes !== 1
          || definitionsResult?.meta.changes !== parsed.definitions.length
        ) {
          throw new SchemaRevisionConflictError();
        }
        return parsed;
      },
    },

    customers: {
      async create(merchantId, customer) {
        const snapshot = CustomerSnapshotSchema.parse(customer);
        return insertCustomer(merchantId, snapshot, now());
      },

      get: getCustomer,

      async upsert(input: CustomerUpsert) {
        const snapshot = CustomerSnapshotSchema.parse({
          externalRef: input.externalRef,
          attributes: input.attributes,
        });
        const updatedAt = DateTimeSchema.parse(input.updatedAt ?? now());

        if (input.expectedVersion === undefined) {
          try {
            return await insertCustomer(input.merchantId, snapshot, updatedAt);
          } catch (error) {
            if (await getCustomer(input.merchantId, input.externalRef) !== null) {
              throw new OptimisticVersionConflictError();
            }
            throw error;
          }
        }

        const expectedVersion = PositiveIntegerSchema.parse(input.expectedVersion);
        const row = await db.update(customers).set({
          attributesJson: JSON.stringify(snapshot.attributes),
          version: expectedVersion + 1,
          updatedAt,
        }).where(and(
          eq(customers.merchantId, input.merchantId),
          eq(customers.externalRef, input.externalRef),
          eq(customers.version, expectedVersion),
        )).returning().get();

        if (row === undefined) throw new OptimisticVersionConflictError();
        return customerFromRow(row);
      },
    },

    programs: {
      async create(input) {
        const merchantId = z.string().min(1).parse(input.merchantId);
        const parsedProgram = PromoProgramSchema.parse(input.program);
        const createdAt = DateTimeSchema.parse(input.createdAt ?? now());
        const row = await db.insert(programs).values({
          id: crypto.randomUUID(),
          merchantId,
          externalRef: parsedProgram.id,
          type: parsedProgram.type,
          name: parsedProgram.name,
          status: parsedProgram.status,
          configJson: JSON.stringify(parsedProgram),
          priority: parsedProgram.priority,
          maxUses: parsedProgram.usageCap ?? null,
          usageCount: 0,
          budgetRemaining: parsedProgram.budget?.minorUnits ?? null,
          createdAt,
          updatedAt: createdAt,
        }).returning().get();
        return programFromRow(row);
      },

      async get(merchantId, externalRef) {
        const row = await db.select().from(programs).where(and(
          eq(programs.merchantId, merchantId),
          eq(programs.externalRef, externalRef),
        )).get();
        return row === undefined ? null : programFromRow(row);
      },

      async listReferencedVariableKeys(merchantId) {
        const rows = await db.select().from(programs).where(and(
          eq(programs.merchantId, merchantId),
          inArray(programs.status, ['draft', 'active']),
        )).all();
        const keys = new Set<string>();
        for (const row of rows) {
          const program = programFromRow(row).program;
          for (const condition of program.eligibility.conditions) keys.add(condition.variable);
          for (const group of program.eligibility.groups ?? []) {
            for (const condition of group.conditions) keys.add(condition.variable);
          }
        }
        return keys;
      },
    },

    decisions: {
      async create(input) {
        const parsed = parseDecision(input);
        await db.insert(evaluationDecisions).values({
          id: parsed.evaluationId,
          merchantId: parsed.merchantId,
          customerRef: parsed.customerRef ?? null,
          customerVersion: parsed.customerVersion ?? null,
          schemaVersion: parsed.schemaVersion,
          requestJson: JSON.stringify(parsed.request),
          decisionsJson: JSON.stringify(parsed.decisions),
          integrityHash: parsed.integrityHash,
          expiresAt: parsed.expiresAt,
          createdAt: parsed.createdAt,
        }).run();
      },

      async get(merchantId, evaluationId) {
        const row = await db.select().from(evaluationDecisions).where(and(
          eq(evaluationDecisions.merchantId, merchantId),
          eq(evaluationDecisions.id, evaluationId),
        )).get();
        return row === undefined ? null : decisionFromRow(row);
      },
    },

    redemptions: {
      async create(input) {
        const parsed = parseRedemption(input);
        await db.insert(redemptions).values({
          id: parsed.redemptionId,
          merchantId: parsed.merchantId,
          externalOrderRef: parsed.externalOrderRef ?? null,
          idempotencyKey: parsed.idempotencyKey ?? null,
          evaluationId: parsed.evaluationId,
          resultJson: JSON.stringify(parsed.result),
          discountMinorUnits: parsed.discountMinorUnits,
          currency: parsed.currency,
          createdAt: parsed.createdAt,
        }).run();
      },

      async getByExternalOrderRef(merchantId, externalOrderRef) {
        const row = await db.select().from(redemptions).where(and(
          eq(redemptions.merchantId, merchantId),
          eq(redemptions.externalOrderRef, externalOrderRef),
        )).get();
        return row === undefined ? null : redemptionFromRow(row);
      },

      async getByIdempotencyKey(merchantId, idempotencyKey) {
        const row = await db.select().from(redemptions).where(and(
          eq(redemptions.merchantId, merchantId),
          eq(redemptions.idempotencyKey, idempotencyKey),
        )).get();
        return row === undefined ? null : redemptionFromRow(row);
      },
    },
  };
}
