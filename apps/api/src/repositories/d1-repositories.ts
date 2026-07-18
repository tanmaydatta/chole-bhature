import {
  CustomerSnapshotSchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
  PromoProgramSchema,
  RedemptionResponseSchema,
  VariableDefinitionSchema,
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
    definitions: DefinitionsSchema.parse(input.definitions),
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
      async createDefinition(input) {
        const parsed = parseDefinitionCreate(input);
        await db.insert(variableDefinitions).values({
          id: parsed.id,
          merchantId: parsed.merchantId,
          schemaVersion: parsed.schemaVersion,
          key: parsed.definition.key,
          label: parsed.definition.label,
          source: parsed.definition.source,
          type: parsed.definition.type,
          required: parsed.definition.required,
          enumValuesJson: parsed.definition.enumValues === undefined
            ? null
            : JSON.stringify(parsed.definition.enumValues),
          description: parsed.definition.description ?? null,
          defaultErrorMessage: parsed.definition.defaultErrorMessage ?? null,
          state: parsed.state,
          createdAt: parsed.createdAt,
        }).run();
        return parsed;
      },

      async listDefinitions(merchantId, schemaVersion) {
        const rows = await db.select().from(variableDefinitions).where(and(
          eq(variableDefinitions.merchantId, merchantId),
          eq(variableDefinitions.schemaVersion, schemaVersion),
        )).orderBy(variableDefinitions.key).all();
        return rows.map(definitionFromRow);
      },

      async getDefinition(merchantId, id) {
        const row = await db.select().from(variableDefinitions).where(and(
          eq(variableDefinitions.merchantId, merchantId),
          eq(variableDefinitions.id, id),
        )).get();
        return row === undefined ? null : definitionFromRow(row);
      },

      async updateDefinition(merchantId, id, definition) {
        const parsed = VariableDefinitionSchema.parse(definition);
        const row = await db.update(variableDefinitions).set({
          key: parsed.key,
          label: parsed.label,
          source: parsed.source,
          type: parsed.type,
          required: parsed.required,
          enumValuesJson: parsed.enumValues === undefined
            ? null
            : JSON.stringify(parsed.enumValues),
          description: parsed.description ?? null,
          defaultErrorMessage: parsed.defaultErrorMessage ?? null,
        }).where(and(
          eq(variableDefinitions.merchantId, merchantId),
          eq(variableDefinitions.id, id),
          eq(variableDefinitions.state, 'draft'),
        )).returning().get();
        return row === undefined ? null : definitionFromRow(row);
      },

      async deleteDefinition(merchantId, id) {
        const row = await db.delete(variableDefinitions).where(and(
          eq(variableDefinitions.merchantId, merchantId),
          eq(variableDefinitions.id, id),
          eq(variableDefinitions.state, 'draft'),
        )).returning({ id: variableDefinitions.id }).get();
        return row !== undefined;
      },

      async createVersion(input) {
        const parsed = parseSchemaVersionCreate(input);
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
        const row = await db.select().from(schemaVersions).where(and(
          eq(schemaVersions.merchantId, merchantId),
          eq(schemaVersions.state, state),
        )).orderBy(desc(schemaVersions.version)).get();
        return row === undefined ? null : schemaVersionFromRow(row);
      },

      async publishDraft(merchantId, version, definitions, publishedAt) {
        const parsed = parseSchemaVersionCreate({
          merchantId,
          version,
          state: 'published',
          publishedAt,
          definitions,
        });
        await db.batch([
          db.update(schemaVersions).set({
            state: 'published',
            publishedAt: parsed.publishedAt,
            definitionsJson: JSON.stringify(parsed.definitions),
          }).where(and(
            eq(schemaVersions.merchantId, parsed.merchantId),
            eq(schemaVersions.version, parsed.version),
            eq(schemaVersions.state, 'draft'),
          )),
          db.update(variableDefinitions).set({ state: 'published' }).where(and(
            eq(variableDefinitions.merchantId, parsed.merchantId),
            eq(variableDefinitions.schemaVersion, parsed.version),
            eq(variableDefinitions.state, 'draft'),
          )),
        ]);
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
