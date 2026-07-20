import {
  ApiCredentialViewSchema,
  AuditEntrySchema,
  CustomerSnapshotSchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
  PromoProgramSchema,
  ProgramRevisionSchema,
  RedemptionResponseSchema,
  VariableDefinitionSchema,
  type VariableDefinition,
} from '@incentives/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createDatabase } from '../db/client.js';
import {
  apiCredentials,
  customers,
  evaluationDecisions,
  merchants,
  productAudit,
  programCounters,
  programRevisions,
  programs,
  redemptions,
  schemaVersions,
  variableDefinitions,
} from '../db/schema.js';
import type { Env } from '../env.js';
import { canonicalJson } from '../json.js';
import {
  OptimisticVersionConflictError,
  ProgramConflictError,
  SchemaRevisionConflictError,
  type CustomerRecord,
  type CustomerUpsert,
  type AtomicRedemptionCommit,
  type CredentialCreate,
  type EvaluationDecisionRecord,
  type MerchantProvision,
  type MerchantRecord,
  type ProgramCounterRecord,
  type ProgramRecord,
  type ProgramRevisionRecord,
  type RedemptionCreate,
  type RedemptionReceiptIntegrityVerifier,
  type Repositories,
  type SchemaVersionRecord,
  type VariableDefinitionCreate,
  type VariableDefinitionRecord,
} from './types.js';

const AttributesSchema = z.record(z.string(), z.unknown());
const DefinitionsSchema = z.array(VariableDefinitionSchema);
const DecisionsSchema = z.array(IncentiveDecisionSchema);
const FactsSchema = z.object({
  scalar: AttributesSchema,
  lineItems: z.array(AttributesSchema),
  programs: z.array(z.object({
    programRef: z.string().min(1),
    system: AttributesSchema,
    config: PromoProgramSchema,
  }).strict()),
}).strict();
const DateTimeSchema = z.iso.datetime({ offset: true });
const SchemaStateSchema = z.enum(['draft', 'published']);
const DefinitionStateSchema = z.enum(['draft', 'published', 'deprecated']);
const PositiveIntegerSchema = z.number().int().positive();
const NonnegativeIntegerSchema = z.number().int().nonnegative();
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const CredentialDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ExactOriginSchema = z.string().url().refine((origin) => {
  const parsed = new URL(origin);
  return parsed.origin === origin && parsed.username === '' && parsed.password === '';
}, 'Origin must be an exact serialized origin');
const AllowedOriginsSchema = z.array(ExactOriginSchema).max(100).refine(
  origins => new Set(origins).size === origins.length,
  'Origins must be unique',
);
const ReceiptIntegrityHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const StoredRedemptionEnvelopeSchema = z.object({
  version: z.literal(1),
  result: RedemptionResponseSchema,
  receiptIntegrityHash: ReceiptIntegrityHashSchema,
}).strict();

function normalizedDefinitions(definitions: readonly VariableDefinition[]): VariableDefinition[] {
  return DefinitionsSchema.parse(definitions).sort((left, right) => left.key.localeCompare(right.key));
}

function definitionsJson(definitions: readonly VariableDefinition[]): string {
  return JSON.stringify(normalizedDefinitions(definitions));
}

function storedProgramJson(program: z.infer<typeof PromoProgramSchema>): string {
  const serialized = JSON.stringify(program);
  if (serialized === undefined) throw new Error('Program config is not serializable');
  return serialized;
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

function persistedRecord<T>(kind: string, deserialize: () => T): T {
  try {
    return deserialize();
  } catch (cause) {
    throw new Error(`Stored ${kind} is not canonical`, { cause });
  }
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

function parseDefinitionRow(row: typeof variableDefinitions.$inferSelect): VariableDefinitionRecord {
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

  const base = {
    id: row.id,
    merchantId: row.merchantId,
    schemaVersion: PositiveIntegerSchema.parse(row.schemaVersion),
    definition,
    createdAt: DateTimeSchema.parse(row.createdAt),
  };
  const state = DefinitionStateSchema.parse(row.state);
  const deprecatedAt = row.deprecatedAt === null
    ? null
    : DateTimeSchema.parse(row.deprecatedAt);
  const deprecatedBy = row.deprecatedBy === null
    ? null
    : z.string().min(1).parse(row.deprecatedBy);

  if (state === 'deprecated') {
    if (deprecatedAt === null || deprecatedBy === null) {
      throw new Error('Deprecated schema definitions require timestamp and actor provenance');
    }
    return { ...base, state, deprecatedAt, deprecatedBy };
  }
  if (deprecatedAt !== null || deprecatedBy !== null) {
    throw new Error('Non-deprecated schema definitions cannot carry deprecation provenance');
  }
  return { ...base, state };
}

function definitionFromRow(row: typeof variableDefinitions.$inferSelect): VariableDefinitionRecord {
  return persistedRecord('schema definition', () => parseDefinitionRow(row));
}

function parseSchemaVersion(input: SchemaVersionRecord): SchemaVersionRecord {
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

function programSchemaSnapshot(
  merchantId: string,
  input: SchemaVersionRecord | null,
): SchemaVersionRecord | null {
  if (input === null) return null;
  const parsed: SchemaVersionRecord = {
    merchantId: z.string().min(1).parse(input.merchantId),
    version: PositiveIntegerSchema.parse(input.version),
    state: SchemaStateSchema.parse(input.state),
    ...optional(
      'publishedAt',
      input.publishedAt === undefined ? undefined : DateTimeSchema.parse(input.publishedAt),
    ),
    definitions: DefinitionsSchema.parse(input.definitions),
  };
  if (parsed.merchantId !== merchantId) {
    throw new ProgramConflictError('Program schema snapshot belongs to another merchant');
  }
  return parsed;
}

function nextProgramTimestamp(expectedUpdatedAt: string, candidate: string): string {
  const expectedMillis = Date.parse(expectedUpdatedAt);
  const candidateMillis = Date.parse(candidate);
  return new Date(Math.max(candidateMillis, expectedMillis + 1)).toISOString();
}

function parseSchemaVersionRow(row: typeof schemaVersions.$inferSelect): SchemaVersionRecord {
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

function schemaVersionFromRow(row: typeof schemaVersions.$inferSelect): SchemaVersionRecord {
  return persistedRecord('schema version', () => parseSchemaVersionRow(row));
}

function parseCustomerRow(row: typeof customers.$inferSelect): CustomerRecord {
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

function customerFromRow(row: typeof customers.$inferSelect): CustomerRecord {
  return persistedRecord('customer', () => parseCustomerRow(row));
}

const MerchantStatusSchema = z.enum(['provisioning', 'active']);

function parseMerchantRow(row: typeof merchants.$inferSelect): MerchantRecord {
  return {
    id: z.string().min(1).parse(row.id),
    name: z.string().min(1).max(200).parse(row.name),
    status: MerchantStatusSchema.parse(row.status),
    ...optional('provisioningId', row.provisioningId),
    createdAt: DateTimeSchema.parse(row.createdAt),
    updatedAt: DateTimeSchema.parse(row.updatedAt ?? row.createdAt),
  };
}

function merchantFromRow(row: typeof merchants.$inferSelect): MerchantRecord {
  return persistedRecord('merchant', () => parseMerchantRow(row));
}

function credentialFromRow(row: typeof apiCredentials.$inferSelect) {
  return persistedRecord('API credential', () => ApiCredentialViewSchema.parse({
    id: row.id,
    name: row.name,
    merchantId: row.merchantId,
    environment: row.environment,
    kind: row.kind,
    scopes: parseJson(row.scopesJson, z.array(z.string())),
    ...optional('expiresAt', row.expiresAt),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    ...optional('lastUsedAt', row.lastUsedAt),
    status: row.status,
    suffix: row.suffix,
  }));
}

interface StoredProgramRow {
  id: string;
  merchantId: string;
  externalRef: string;
  type: string;
  name: string;
  status: string;
  priority: number;
  activeRevision: number | null;
  draftRevision: number | null;
  revision: number;
  configJson: string;
  maxUses: number | null;
  usageCount: number;
  budgetRemaining: number | null;
  createdAt: string;
  updatedAt: string;
}

function parseProgramRow(row: StoredProgramRow): ProgramRecord {
  let program: ReturnType<typeof PromoProgramSchema.parse>;
  try {
    program = parseJson(row.configJson, PromoProgramSchema);
  } catch (cause) {
    throw new Error('Stored program config is not canonical', { cause });
  }
  if (!Number.isSafeInteger(row.usageCount) || row.usageCount < 0) {
    throw new Error('Program usage counter is invalid');
  }
  const usageCount = row.usageCount;
  if (
    program.id !== row.externalRef
    || program.type !== row.type
    || program.name !== row.name
    || program.status !== row.status
    || program.priority !== row.priority
  ) {
    throw new Error('Program JSON does not match its relational columns');
  }
  if (
    (program.usageCap === undefined && row.maxUses !== null)
    || (program.usageCap !== undefined && row.maxUses !== program.usageCap)
    || (program.usageCap !== undefined && usageCount > program.usageCap)
  ) {
    throw new Error('Program usage cap does not match its relational counter columns');
  }
  if (
    (program.budget === undefined && row.budgetRemaining !== null)
    || (program.budget !== undefined && row.budgetRemaining === null)
    || (
      program.budget !== undefined
      && row.budgetRemaining !== null
      && (
        !Number.isSafeInteger(row.budgetRemaining)
        || row.budgetRemaining < 0
        || row.budgetRemaining > program.budget.minorUnits
      )
    )
  ) {
    throw new Error('Program budget does not match its relational counter columns');
  }

  return {
    id: row.id,
    merchantId: row.merchantId,
    externalRef: row.externalRef,
    program,
    usageCount,
    ...optional('budgetRemaining', row.budgetRemaining),
    createdAt: DateTimeSchema.parse(row.createdAt),
    updatedAt: DateTimeSchema.parse(row.updatedAt),
  };
}

function programFromRow(row: StoredProgramRow): ProgramRecord {
  return persistedRecord('program', () => parseProgramRow(row));
}

function parseProgramRevisionRow(
  row: typeof programRevisions.$inferSelect & { externalRef: string },
): ProgramRevisionRecord {
  const revision = ProgramRevisionSchema.parse({
    programRef: row.externalRef,
    revision: row.revision,
    configuration: parseJson(row.configJson, PromoProgramSchema),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    ...optional('publishedAt', row.publishedAt),
    ...optional('publishedBy', row.publishedBy),
  });
  return {
    merchantId: row.merchantId,
    programId: row.programId,
    ...revision,
  };
}

function programRevisionFromRow(
  row: typeof programRevisions.$inferSelect & { externalRef: string },
): ProgramRevisionRecord {
  return persistedRecord('program revision', () => parseProgramRevisionRow(row));
}

function parseProgramCounterRow(row: typeof programCounters.$inferSelect): ProgramCounterRecord {
  return {
    programId: row.programId,
    merchantId: row.merchantId,
    ...optional('maxUses', row.maxUses),
    usageCount: NonnegativeIntegerSchema.parse(row.usageCount),
    ...optional('budgetRemaining', row.budgetRemaining),
  };
}

function programCounterFromRow(row: typeof programCounters.$inferSelect): ProgramCounterRecord {
  return persistedRecord('program counter', () => parseProgramCounterRow(row));
}

function auditFromRow(row: typeof productAudit.$inferSelect) {
  return persistedRecord('product audit entry', () => AuditEntrySchema.parse({
    id: row.id,
    occurredAt: row.occurredAt,
    actorKind: row.actorKind,
    actorId: row.actorId,
    ...optional('merchantId', row.merchantId),
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    outcome: row.outcome,
    correlationId: row.correlationId,
    ...optional(
      'metadata',
      row.metadataJson === null
        ? undefined
        : parseJson(row.metadataJson, AuditEntrySchema.shape.metadata.unwrap()),
    ),
  }));
}

function parseMerchantProvision(input: MerchantProvision): MerchantRecord {
  const createdAt = DateTimeSchema.parse(input.createdAt ?? now());
  return {
    id: z.string().min(1).parse(input.id),
    name: z.string().min(1).max(200).parse(input.name),
    status: 'provisioning',
    provisioningId: z.string().min(1).parse(input.provisioningId),
    createdAt,
    updatedAt: createdAt,
  };
}

function parseCredentialCreate(input: CredentialCreate) {
  const createdAt = DateTimeSchema.parse(input.createdAt ?? now());
  const view = ApiCredentialViewSchema.parse({
    id: input.id,
    name: input.name,
    merchantId: input.merchantId,
    environment: input.environment,
    kind: input.kind,
    scopes: input.scopes,
    ...optional('expiresAt', input.expiresAt),
    createdAt,
    createdBy: input.createdBy,
    status: 'active',
    suffix: input.suffix,
  });
  return {
    view,
    digest: CredentialDigestSchema.parse(input.digest),
    allowedOrigins: AllowedOriginsSchema.parse(input.allowedOrigins ?? []),
  };
}

function parseDecision(input: EvaluationDecisionRecord): EvaluationDecisionRecord {
  canonicalJson(input.request);
  canonicalJson(input.facts);
  canonicalJson(input.decisions);

  const customerRef = input.customerRef === undefined
    ? undefined
    : z.string().min(1).parse(input.customerRef);
  const customerVersion = input.customerVersion === undefined
    ? undefined
    : PositiveIntegerSchema.parse(input.customerVersion);

  if ((customerRef === undefined) !== (customerVersion === undefined)) {
    throw new Error('Customer ref and customer version must be recorded together');
  }

  const request = EvaluationRequestSchema.parse(input.request);
  if (customerRef !== request.customerRef) {
    throw new Error('Customer ref must match the evaluation request snapshot');
  }
  const facts = FactsSchema.parse(input.facts);
  const decisions = DecisionsSchema.parse(input.decisions);
  canonicalJson(request);
  canonicalJson(facts);
  canonicalJson(decisions);

  return {
    evaluationId: z.string().min(1).parse(input.evaluationId),
    merchantId: z.string().min(1).parse(input.merchantId),
    ...optional('customerRef', customerRef),
    ...optional('customerVersion', customerVersion),
    schemaVersion: PositiveIntegerSchema.parse(input.schemaVersion),
    request,
    facts,
    decisions,
    integrityHash: z.string().min(1).parse(input.integrityHash),
    expiresAt: DateTimeSchema.parse(input.expiresAt),
    createdAt: DateTimeSchema.parse(input.createdAt),
  };
}

function parseDecisionRow(row: typeof evaluationDecisions.$inferSelect): EvaluationDecisionRecord {
  return parseDecision({
    evaluationId: row.id,
    merchantId: row.merchantId,
    ...optional('customerRef', row.customerRef),
    ...optional('customerVersion', row.customerVersion),
    schemaVersion: row.schemaVersion,
    request: parseJson(row.requestJson, EvaluationRequestSchema),
    facts: parseJson(row.factsJson, FactsSchema),
    decisions: parseJson(row.decisionsJson, DecisionsSchema),
    integrityHash: row.integrityHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  });
}

function decisionFromRow(row: typeof evaluationDecisions.$inferSelect): EvaluationDecisionRecord {
  return persistedRecord('evaluation decision', () => parseDecisionRow(row));
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
    receiptIntegrityHash: ReceiptIntegrityHashSchema.parse(input.receiptIntegrityHash),
  };
}

function parseRedemptionRow(row: typeof redemptions.$inferSelect): RedemptionCreate {
  const envelope = parseJson(row.resultJson, StoredRedemptionEnvelopeSchema);
  return parseRedemption({
    redemptionId: row.id,
    merchantId: row.merchantId,
    ...optional('externalOrderRef', row.externalOrderRef),
    ...optional('idempotencyKey', row.idempotencyKey),
    evaluationId: row.evaluationId,
    result: envelope.result,
    discountMinorUnits: row.discountMinorUnits,
    currency: row.currency,
    createdAt: row.createdAt,
    receiptIntegrityHash: envelope.receiptIntegrityHash,
  });
}

function redemptionFromRow(row: typeof redemptions.$inferSelect): RedemptionCreate {
  return persistedRecord('redemption', () => parseRedemptionRow(row));
}

function redemptionEnvelope(redemption: RedemptionCreate): string {
  return JSON.stringify(StoredRedemptionEnvelopeSchema.parse({
    version: 1,
    result: redemption.result,
    receiptIntegrityHash: redemption.receiptIntegrityHash,
  }));
}

async function verifiedRedemptionFromRow(
  row: typeof redemptions.$inferSelect,
  verifyIntegrity: RedemptionReceiptIntegrityVerifier,
): Promise<RedemptionCreate> {
  const redemption = redemptionFromRow(row);
  if (!(await verifyIntegrity(redemption))) {
    throw new Error('Redemption receipt integrity verification failed');
  }
  return redemption;
}

function parseAtomicRedemption(input: AtomicRedemptionCommit): AtomicRedemptionCommit {
  const parsed = parseRedemption(input);
  const programRef = z.string().min(1).parse(input.programRef);
  const expectedProgram = PromoProgramSchema.parse(input.expectedProgram);
  if (expectedProgram.id !== programRef || parsed.result.programRef !== programRef) {
    throw new Error('Atomic redemption program identity does not match');
  }
  const customerRef = input.customerRef === undefined
    ? undefined
    : z.string().min(1).parse(input.customerRef);
  const perCustomerCap = input.perCustomerCap === undefined
    ? undefined
    : PositiveIntegerSchema.parse(input.perCustomerCap);
  if (perCustomerCap !== undefined && customerRef === undefined) {
    throw new Error('A per-customer cap requires a customer reference');
  }
  return {
    ...parsed,
    programId: z.string().min(1).parse(input.programId),
    programRef,
    expectedProgram,
    ...optional('customerRef', customerRef),
    ...optional('perCustomerCap', perCustomerCap),
  };
}

export function createRepositories(env: Env): Repositories {
  const db = createDatabase(env);

  const programProjection = `
    SELECT
      logical.id AS id,
      logical.merchant_id AS merchantId,
      logical.external_ref AS externalRef,
      logical.type AS type,
      logical.name AS name,
      logical.status AS status,
      logical.priority AS priority,
      logical.active_revision AS activeRevision,
      logical.draft_revision AS draftRevision,
      revision.revision AS revision,
      revision.config_json AS configJson,
      counter.max_uses AS maxUses,
      counter.usage_count AS usageCount,
      counter.budget_remaining AS budgetRemaining,
      logical.created_at AS createdAt,
      logical.updated_at AS updatedAt
    FROM programs AS logical
    INNER JOIN program_revisions AS revision
      ON revision.merchant_id = logical.merchant_id
      AND revision.program_id = logical.id
      AND revision.revision = COALESCE(logical.draft_revision, logical.active_revision)
    INNER JOIN program_counters AS counter
      ON counter.merchant_id = logical.merchant_id
      AND counter.program_id = logical.id
  `;

  async function getProgramById(
    merchantId: string,
    id: string,
  ): Promise<ProgramRecord | null> {
    const row = await env.DB.prepare(`${programProjection}
      WHERE logical.merchant_id = ?1 AND logical.id = ?2
    `).bind(merchantId, id).first<StoredProgramRow>();
    return row === null ? null : programFromRow(row);
  }

  async function getProgramByExternalRef(
    merchantId: string,
    externalRef: string,
  ): Promise<ProgramRecord | null> {
    const row = await env.DB.prepare(`${programProjection}
      WHERE logical.merchant_id = ?1 AND logical.external_ref = ?2
    `).bind(merchantId, externalRef).first<StoredProgramRow>();
    return row === null ? null : programFromRow(row);
  }

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

  function mutationSnapshotTarget(
    existing: VariableDefinitionRecord,
    expectedDefinitions: VariableDefinition[],
  ): { definitions: VariableDefinition[]; targetIndex: number } {
    const definitions = DefinitionsSchema.parse(expectedDefinitions);
    const targetIndexes = definitions.flatMap((definition, index) => (
      definition.key === existing.definition.key ? [index] : []
    ));
    if (targetIndexes.length !== 1) throw new SchemaRevisionConflictError();
    const targetIndex = targetIndexes[0]!;
    const target = definitions[targetIndex]!;
    if (
      target.source !== existing.definition.source
      || target.type !== existing.definition.type
      || definitionsJson([target]) !== definitionsJson([existing.definition])
    ) {
      throw new SchemaRevisionConflictError();
    }
    return { definitions, targetIndex };
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
      attributesJson: canonicalJson(snapshot.attributes),
      version: 1,
      updatedAt,
    }).returning().get();
    return customerFromRow(row);
  }

  return {
    merchants: {
      async provision(input) {
        const parsed = parseMerchantProvision(input);
        await env.DB.prepare(`
          INSERT INTO merchants (
            id, name, status, provisioning_id, created_at, updated_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
          ON CONFLICT DO NOTHING
        `).bind(
          parsed.id,
          parsed.name,
          parsed.status,
          parsed.provisioningId,
          parsed.createdAt,
          parsed.updatedAt,
        ).run();
        const existing = await env.DB.prepare(`
          SELECT id, name, status, provisioning_id AS provisioningId,
            created_at AS createdAt, updated_at AS updatedAt
          FROM merchants
          WHERE id = ?1 OR provisioning_id = ?2
        `).bind(parsed.id, parsed.provisioningId).first<{
          id: string;
          name: string;
          status: string;
          provisioningId: string | null;
          createdAt: string;
          updatedAt: string | null;
        }>();
        if (existing === null) {
          throw new Error('Merchant provisioning did not produce a readable merchant');
        }
        const record = merchantFromRow({
          id: existing.id,
          name: existing.name,
          status: existing.status,
          provisioningId: existing.provisioningId,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        });
        if (
          record.id !== parsed.id
          || record.name !== parsed.name
          || record.provisioningId !== parsed.provisioningId
        ) {
          throw new Error('Merchant provisioning identity conflicts with an existing merchant');
        }
        return record;
      },

      async get(id) {
        const row = await db.select().from(merchants).where(eq(merchants.id, id)).get();
        return row === undefined ? null : merchantFromRow(row);
      },

      async activate(id, updatedAt) {
        const parsedId = z.string().min(1).parse(id);
        const parsedUpdatedAt = DateTimeSchema.parse(updatedAt);
        await env.DB.prepare(`
          UPDATE merchants SET status = 'active', updated_at = ?1 WHERE id = ?2
        `).bind(parsedUpdatedAt, parsedId).run();
        const row = await db.select().from(merchants).where(eq(merchants.id, parsedId)).get();
        return row === undefined ? null : merchantFromRow(row);
      },
    },

    credentials: {
      async create(input) {
        const parsed = parseCredentialCreate(input);
        const row = await db.insert(apiCredentials).values({
          id: parsed.view.id,
          merchantId: parsed.view.merchantId,
          name: parsed.view.name,
          environment: parsed.view.environment,
          kind: parsed.view.kind,
          scopesJson: canonicalJson(parsed.view.scopes),
          allowedOriginsJson: canonicalJson(parsed.allowedOrigins),
          digest: parsed.digest,
          suffix: parsed.view.suffix,
          status: parsed.view.status,
          expiresAt: parsed.view.expiresAt ?? null,
          createdAt: parsed.view.createdAt,
          createdBy: parsed.view.createdBy,
        }).returning().get();
        return credentialFromRow(row);
      },

      async findByDigest(digest) {
        const parsedDigest = CredentialDigestSchema.parse(digest);
        const row = await db.select().from(apiCredentials).where(
          eq(apiCredentials.digest, parsedDigest),
        ).get();
        return row === undefined ? null : credentialFromRow(row);
      },

      async authenticateByDigest(digest) {
        const parsedDigest = CredentialDigestSchema.parse(digest);
        const row = await db.select().from(apiCredentials).where(
          eq(apiCredentials.digest, parsedDigest),
        ).get();
        if (row === undefined) return null;
        return {
          credential: credentialFromRow(row),
          allowedOrigins: parseJson(row.allowedOriginsJson, AllowedOriginsSchema),
        };
      },

      async list(merchantId) {
        const rows = await db.select().from(apiCredentials).where(
          eq(apiCredentials.merchantId, merchantId),
        ).orderBy(asc(apiCredentials.createdAt), asc(apiCredentials.id)).all();
        return rows.map(credentialFromRow);
      },

      async revoke(merchantId, id, revokedAt, revokedBy) {
        const parsedMerchantId = z.string().min(1).parse(merchantId);
        const parsedId = z.string().min(1).parse(id);
        const parsedRevokedAt = DateTimeSchema.parse(revokedAt);
        const parsedRevokedBy = z.string().min(1).parse(revokedBy);
        await env.DB.prepare(`
          UPDATE api_credentials
          SET status = 'revoked', revoked_at = ?1, revoked_by = ?2
          WHERE merchant_id = ?3 AND id = ?4 AND status = 'active'
        `).bind(parsedRevokedAt, parsedRevokedBy, parsedMerchantId, parsedId).run();
        const row = await db.select().from(apiCredentials).where(and(
          eq(apiCredentials.merchantId, parsedMerchantId),
          eq(apiCredentials.id, parsedId),
        )).get();
        return row === undefined ? null : credentialFromRow(row);
      },

      async markUsed(id, usedAt) {
        await env.DB.prepare(`
          UPDATE api_credentials SET last_used_at = ?1 WHERE id = ?2 AND status = 'active'
        `).bind(DateTimeSchema.parse(usedAt), z.string().min(1).parse(id)).run();
      },
    },

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
      ) {
        const parsed = VariableDefinitionSchema.parse(definition);
        const existing = await getSchemaDefinition(merchantId, id);
        if (
          existing === null
          || existing.schemaVersion !== schemaVersion
          || existing.state !== 'draft'
        ) {
          throw new SchemaRevisionConflictError();
        }
        const { definitions, targetIndex } = mutationSnapshotTarget(existing, expectedDefinitions);
        const nextDefinitions = definitions.map((candidate, index) => (
          index === targetIndex ? parsed : candidate
        ));
        const existingDefinition = existing.definition;
        const derivedReferenceKey = (
          parsed.key !== existingDefinition.key
          || parsed.source !== existingDefinition.source
          || parsed.type !== existingDefinition.type
        ) ? existingDefinition.key : null;
        const expectedJson = definitionsJson(definitions);
        const nextJson = definitionsJson(nextDefinitions);
        try {
          const [versionResult, definitionResult] = await env.DB.batch([
            env.DB.prepare(`
              UPDATE schema_versions SET definitions_json = ?1
              WHERE merchant_id = ?2 AND version = ?3
                AND state = 'draft' AND definitions_json = ?4
                AND EXISTS (
                  SELECT 1 FROM variable_definitions
                  WHERE merchant_id = ?2 AND schema_version = ?3
                    AND id = ?5 AND state = 'draft'
                    AND key = ?6 AND source = ?7 AND type = ?8
                )
                AND (?9 IS NULL OR NOT EXISTS (
                  SELECT 1
                  FROM programs AS referenced_program
                  INNER JOIN program_revisions AS referenced_revision
                    ON referenced_revision.merchant_id = referenced_program.merchant_id
                    AND referenced_revision.program_id = referenced_program.id
                    AND referenced_revision.revision IN (
                      referenced_program.active_revision,
                      referenced_program.draft_revision
                    )
                  INNER JOIN json_tree(referenced_revision.config_json, '$') AS condition_node
                  WHERE referenced_program.merchant_id = ?2
                    AND condition_node.key = 'variable'
                    AND condition_node.value = ?9
                ))
            `).bind(
              nextJson,
              merchantId,
              schemaVersion,
              expectedJson,
              id,
              existingDefinition.key,
              existingDefinition.source,
              existingDefinition.type,
              derivedReferenceKey,
            ),
            env.DB.prepare(`
              UPDATE variable_definitions SET
                key = ?1, label = ?2, source = ?3, type = ?4, required = ?5,
                enum_values_json = ?6, description = ?7, default_error_message = ?8
              WHERE merchant_id = ?9 AND id = ?10 AND schema_version = ?11
                AND state = 'draft'
                AND key = ?12 AND source = ?13 AND type = ?14
                AND EXISTS (
                  SELECT 1 FROM schema_versions
                  WHERE merchant_id = ?9 AND version = ?11
                    AND state = 'draft' AND definitions_json = ?15
                )
                AND (?16 IS NULL OR NOT EXISTS (
                  SELECT 1
                  FROM programs AS referenced_program
                  INNER JOIN program_revisions AS referenced_revision
                    ON referenced_revision.merchant_id = referenced_program.merchant_id
                    AND referenced_revision.program_id = referenced_program.id
                    AND referenced_revision.revision IN (
                      referenced_program.active_revision,
                      referenced_program.draft_revision
                    )
                  INNER JOIN json_tree(referenced_revision.config_json, '$') AS condition_node
                  WHERE referenced_program.merchant_id = ?9
                    AND condition_node.key = 'variable'
                    AND condition_node.value = ?16
                ))
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
              existingDefinition.key,
              existingDefinition.source,
              existingDefinition.type,
              nextJson,
              derivedReferenceKey,
            ),
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
      ) {
        const existing = await getSchemaDefinition(merchantId, id);
        if (
          existing === null
          || existing.schemaVersion !== schemaVersion
          || existing.state !== 'draft'
        ) {
          throw new SchemaRevisionConflictError();
        }
        const { definitions, targetIndex } = mutationSnapshotTarget(existing, expectedDefinitions);
        const nextDefinitions = definitions.filter((_candidate, index) => index !== targetIndex);
        const existingDefinition = existing.definition;
        const expectedJson = definitionsJson(definitions);
        const nextJson = definitionsJson(nextDefinitions);
        const [versionResult, definitionResult] = await env.DB.batch([
          env.DB.prepare(`
            UPDATE schema_versions SET definitions_json = ?1
            WHERE merchant_id = ?2 AND version = ?3
              AND state = 'draft' AND definitions_json = ?4
              AND EXISTS (
                SELECT 1 FROM variable_definitions
                WHERE merchant_id = ?2 AND schema_version = ?3
                  AND id = ?5 AND state = 'draft'
                  AND key = ?6 AND source = ?7 AND type = ?8
              )
              AND NOT EXISTS (
                SELECT 1
                FROM programs AS referenced_program
                INNER JOIN program_revisions AS referenced_revision
                  ON referenced_revision.merchant_id = referenced_program.merchant_id
                  AND referenced_revision.program_id = referenced_program.id
                  AND referenced_revision.revision IN (
                    referenced_program.active_revision,
                    referenced_program.draft_revision
                  )
                INNER JOIN json_tree(referenced_revision.config_json, '$') AS condition_node
                WHERE referenced_program.merchant_id = ?2
                  AND condition_node.key = 'variable'
                  AND condition_node.value = ?6
              )
          `).bind(
            nextJson,
            merchantId,
            schemaVersion,
            expectedJson,
            id,
            existingDefinition.key,
            existingDefinition.source,
            existingDefinition.type,
          ),
          env.DB.prepare(`
            DELETE FROM variable_definitions
            WHERE merchant_id = ?1 AND id = ?2 AND schema_version = ?3
              AND state = 'draft'
              AND key = ?4 AND source = ?5 AND type = ?6
              AND EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?1 AND version = ?3
                  AND state = 'draft' AND definitions_json = ?7
              )
              AND NOT EXISTS (
                SELECT 1
                FROM programs AS referenced_program
                INNER JOIN program_revisions AS referenced_revision
                  ON referenced_revision.merchant_id = referenced_program.merchant_id
                  AND referenced_revision.program_id = referenced_program.id
                  AND referenced_revision.revision IN (
                    referenced_program.active_revision,
                    referenced_program.draft_revision
                  )
                INNER JOIN json_tree(referenced_revision.config_json, '$') AS condition_node
                WHERE referenced_program.merchant_id = ?1
                  AND condition_node.key = 'variable'
                  AND condition_node.value = ?4
              )
          `).bind(
            merchantId,
            id,
            schemaVersion,
            existingDefinition.key,
            existingDefinition.source,
            existingDefinition.type,
            nextJson,
          ),
        ]);
        if (definitionResult?.meta.changes !== 1 || versionResult?.meta.changes !== 1) {
          throw new SchemaRevisionConflictError();
        }
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
        const parsed = parseSchemaVersion({
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

      async getDefinitionImpact(merchantId, key) {
        const parsedMerchantId = z.string().min(1).parse(merchantId);
        const parsedKey = z.string().min(1).parse(key);
        const [versions, references, customerCount] = await Promise.all([
          env.DB.prepare(`
            SELECT DISTINCT schema_version AS version
            FROM variable_definitions
            WHERE merchant_id = ?1 AND key = ?2
              AND state IN ('published', 'deprecated')
            ORDER BY schema_version
          `).bind(parsedMerchantId, parsedKey).all<{ version: number }>(),
          env.DB.prepare(`
            SELECT DISTINCT logical.external_ref AS externalRef
            FROM programs AS logical
            INNER JOIN program_revisions AS revision
              ON revision.merchant_id = logical.merchant_id
              AND revision.program_id = logical.id
              AND revision.revision IN (logical.active_revision, logical.draft_revision)
            INNER JOIN json_tree(revision.config_json, '$') AS condition_node
              ON condition_node.key = 'variable' AND condition_node.value = ?2
            WHERE logical.merchant_id = ?1
            ORDER BY logical.external_ref
          `).bind(parsedMerchantId, parsedKey).all<{ externalRef: string }>(),
          env.DB.prepare(`
            SELECT COUNT(*) AS count FROM customers WHERE merchant_id = ?1
          `).bind(parsedMerchantId).first<{ count: number }>(),
        ]);
        return {
          publishedVersions: versions.results.map(row => row.version),
          referencedProgramRefs: references.results.map(row => row.externalRef),
          storedCustomerCount: customerCount?.count ?? 0,
        };
      },

      async deprecateDefinition(input) {
        const merchantId = z.string().min(1).parse(input.merchantId);
        const id = z.string().min(1).parse(input.id);
        const schemaVersion = PositiveIntegerSchema.parse(input.schemaVersion);
        const deprecatedAt = DateTimeSchema.parse(input.deprecatedAt);
        const deprecatedBy = z.string().min(1).parse(input.deprecatedBy);
        const result = await env.DB.prepare(`
          UPDATE variable_definitions
          SET state = 'deprecated', deprecated_at = ?1, deprecated_by = ?2
          WHERE merchant_id = ?3 AND id = ?4 AND schema_version = ?5
            AND state = 'published'
        `).bind(deprecatedAt, deprecatedBy, merchantId, id, schemaVersion).run();
        if (result.meta.changes !== 1) throw new SchemaRevisionConflictError();
      },
    },

    customers: {
      async create(merchantId, customer) {
        canonicalJson(customer);
        const snapshot = CustomerSnapshotSchema.parse(customer);
        return insertCustomer(merchantId, snapshot, now());
      },

      get: getCustomer,

      async upsert(input: CustomerUpsert) {
        canonicalJson({
          externalRef: input.externalRef,
          attributes: input.attributes,
        });
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
          attributesJson: canonicalJson(snapshot.attributes),
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
        const schema = programSchemaSnapshot(merchantId, input.schema);
        const createdAt = DateTimeSchema.parse(input.createdAt ?? now());
        const id = crypto.randomUUID();
        const isDraft = parsedProgram.status === 'draft';
        try {
          const [logicalResult, revisionResult, counterResult] = await env.DB.batch([
            env.DB.prepare(`
            INSERT INTO programs (
              id, merchant_id, external_ref, type, name, status, config_json,
              priority, max_uses, usage_count, budget_remaining,
              active_revision, draft_revision, created_at, updated_at
            )
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13, ?13
            WHERE (
              ?14 IS NULL AND ?17 = 'draft' AND NOT EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?2 AND state IN ('draft', 'published')
              )
            ) OR (
              ?14 IS NOT NULL AND EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?2 AND version = ?14
                  AND state = ?15 AND definitions_json = ?16
              )
              AND (?17 = 'draft' OR ?15 = 'published')
              AND NOT EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?2 AND state = ?15 AND version > ?14
              )
              AND (?15 <> 'published' OR ?17 <> 'draft' OR NOT EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?2 AND state = 'draft'
              ))
            )
          `).bind(
            id,
            merchantId,
            parsedProgram.id,
            parsedProgram.type,
            parsedProgram.name,
            parsedProgram.status,
            storedProgramJson(parsedProgram),
            parsedProgram.priority,
            parsedProgram.usageCap ?? null,
            parsedProgram.budget?.minorUnits ?? null,
            isDraft ? null : 1,
            isDraft ? 1 : null,
            createdAt,
            schema?.version ?? null,
            schema?.state ?? null,
            schema === null ? null : JSON.stringify(schema.definitions),
            parsedProgram.status,
          ),
            env.DB.prepare(`
              INSERT INTO program_revisions (
                program_id, merchant_id, revision, config_json, created_at, created_by,
                published_at, published_by
              )
              SELECT ?1, ?2, 1, ?3, ?4, 'system:legacy-api', ?5, ?6
              WHERE changes() = 1
            `).bind(
              id,
              merchantId,
              storedProgramJson(parsedProgram),
              createdAt,
              isDraft ? null : createdAt,
              isDraft ? null : 'system:legacy-api',
            ),
            env.DB.prepare(`
              INSERT INTO program_counters (
                program_id, merchant_id, max_uses, usage_count, budget_remaining
              )
              SELECT ?1, ?2, ?3, 0, ?4 WHERE changes() = 1
            `).bind(
              id,
              merchantId,
              parsedProgram.usageCap ?? null,
              parsedProgram.budget?.minorUnits ?? null,
            ),
          ]);
          if (
            logicalResult?.meta.changes !== 1
            || revisionResult?.meta.changes !== 1
            || counterResult?.meta.changes !== 1
          ) {
            throw new ProgramConflictError('The schema changed before the program was stored');
          }
        } catch (error) {
          if (error instanceof ProgramConflictError) throw error;
          if (isConstraintError(error)) {
            throw new ProgramConflictError('A program with this external reference already exists');
          }
          throw error;
        }
        const stored = await getProgramById(merchantId, id);
        if (stored === null) throw new ProgramConflictError('The program was not stored');
        return stored;
      },

      async get(merchantId, externalRef) {
        return getProgramByExternalRef(merchantId, externalRef);
      },

      async list(merchantId) {
        const rows = await env.DB.prepare(`${programProjection}
          WHERE logical.merchant_id = ?1
          ORDER BY logical.created_at, logical.external_ref
        `).bind(merchantId).all<StoredProgramRow>();
        return rows.results.map(programFromRow);
      },

      async updateDraft(input) {
        const merchantId = z.string().min(1).parse(input.merchantId);
        const externalRef = z.string().min(1).parse(input.externalRef);
        const parsedProgram = PromoProgramSchema.parse(input.program);
        const expectedProgram = PromoProgramSchema.parse(input.expectedProgram);
        if (parsedProgram.id !== externalRef) {
          throw new ProgramConflictError('The program external reference is immutable');
        }
        if (expectedProgram.id !== externalRef) {
          throw new ProgramConflictError('Expected program does not match the external reference');
        }
        const expectedUpdatedAt = DateTimeSchema.parse(input.expectedUpdatedAt);
        const schema = programSchemaSnapshot(merchantId, input.schema);
        const candidateUpdatedAt = DateTimeSchema.parse(input.updatedAt ?? now());
        const updatedAt = nextProgramTimestamp(expectedUpdatedAt, candidateUpdatedAt);
        const result = await env.DB.prepare(`
          UPDATE programs SET
            type = ?1, name = ?2, status = ?3, config_json = ?4,
            priority = ?5, max_uses = ?6, budget_remaining = ?7, updated_at = ?8
          WHERE merchant_id = ?9 AND external_ref = ?10 AND status = 'draft'
            AND config_json = ?11 AND updated_at = ?12
            AND (
              ?13 IS NULL AND ?16 = 'draft' AND NOT EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?9 AND state IN ('draft', 'published')
              )
            OR
              ?13 IS NOT NULL AND EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?9 AND version = ?13
                  AND state = ?14 AND definitions_json = ?15
              )
              AND (?16 = 'draft' OR ?14 = 'published')
              AND NOT EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?9 AND state = ?14 AND version > ?13
              )
              AND (?14 <> 'published' OR ?16 <> 'draft' OR NOT EXISTS (
                SELECT 1 FROM schema_versions
                WHERE merchant_id = ?9 AND state = 'draft'
              ))
            )
        `).bind(
          parsedProgram.type,
          parsedProgram.name,
          parsedProgram.status,
          storedProgramJson(parsedProgram),
          parsedProgram.priority,
          parsedProgram.usageCap ?? null,
          parsedProgram.budget?.minorUnits ?? null,
          updatedAt,
          merchantId,
          externalRef,
          storedProgramJson(expectedProgram),
          expectedUpdatedAt,
          schema?.version ?? null,
          schema?.state ?? null,
          schema === null ? null : JSON.stringify(schema.definitions),
          parsedProgram.status,
        ).run();

        // D1 may include rows written by the owned revision/counter sync triggers.
        // The merchant/external-ref unique key still limits the CAS target to one parent row.
        if (result.meta.changes < 1) {
          throw new ProgramConflictError('Only draft programs can be edited');
        }
        const stored = await getProgramByExternalRef(merchantId, externalRef);
        if (stored === null) throw new ProgramConflictError('The program was not stored');
        return stored;
      },

      async listReferencedVariableKeys(merchantId) {
        const rows = await env.DB.prepare(`${programProjection}
          WHERE logical.merchant_id = ?1
        `).bind(merchantId).all<StoredProgramRow>();
        const keys = new Set<string>();
        for (const row of rows.results) {
          const program = programFromRow(row).program;
          for (const condition of program.eligibility.conditions) keys.add(condition.variable);
          for (const group of program.eligibility.groups ?? []) {
            for (const condition of group.conditions) keys.add(condition.variable);
          }
          for (const rule of program.rewardRules) {
            for (const condition of rule.conditions.conditions) keys.add(condition.variable);
            for (const group of rule.conditions.groups ?? []) {
              for (const condition of group.conditions) keys.add(condition.variable);
            }
          }
        }
        return keys;
      },

      async getRevision(merchantId, externalRef, revision) {
        const row = await db.select({
          programId: programRevisions.programId,
          merchantId: programRevisions.merchantId,
          revision: programRevisions.revision,
          configJson: programRevisions.configJson,
          createdAt: programRevisions.createdAt,
          createdBy: programRevisions.createdBy,
          publishedAt: programRevisions.publishedAt,
          publishedBy: programRevisions.publishedBy,
          externalRef: programs.externalRef,
        }).from(programRevisions).innerJoin(
          programs,
          and(
            eq(programRevisions.merchantId, programs.merchantId),
            eq(programRevisions.programId, programs.id),
          ),
        ).where(and(
          eq(programs.merchantId, merchantId),
          eq(programs.externalRef, externalRef),
          eq(programRevisions.revision, PositiveIntegerSchema.parse(revision)),
        )).get();
        return row === undefined ? null : programRevisionFromRow(row);
      },

      async getCounters(merchantId, externalRef) {
        const row = await db.select({
          programId: programCounters.programId,
          merchantId: programCounters.merchantId,
          maxUses: programCounters.maxUses,
          usageCount: programCounters.usageCount,
          budgetRemaining: programCounters.budgetRemaining,
        }).from(programCounters).innerJoin(
          programs,
          and(
            eq(programCounters.merchantId, programs.merchantId),
            eq(programCounters.programId, programs.id),
          ),
        ).where(and(
          eq(programs.merchantId, merchantId),
          eq(programs.externalRef, externalRef),
        )).get();
        return row === undefined ? null : programCounterFromRow(row);
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
          requestJson: canonicalJson(parsed.request),
          factsJson: canonicalJson(parsed.facts),
          decisionsJson: canonicalJson(parsed.decisions),
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
          resultJson: redemptionEnvelope(parsed),
          discountMinorUnits: parsed.discountMinorUnits,
          currency: parsed.currency,
          createdAt: parsed.createdAt,
        }).run();
      },

      async commitAtomically(input) {
        const parsed = parseAtomicRedemption(input);
        const [counter, ledger] = await env.DB.batch([
          env.DB.prepare(`
            UPDATE programs
            SET usage_count = usage_count + 1,
                budget_remaining = CASE
                  WHEN budget_remaining IS NULL THEN NULL
                  ELSE budget_remaining - ?1
                END
            WHERE id = ?2 AND merchant_id = ?3 AND external_ref = ?4
              AND status = 'active' AND config_json = ?5
              AND (
                (?10 IS NULL AND max_uses IS NULL)
                OR (?10 IS NOT NULL AND max_uses = ?10)
              )
              AND usage_count >= 0
              AND (?10 IS NULL OR usage_count <= ?10)
              AND (
                (?11 IS NULL AND budget_remaining IS NULL)
                OR (
                  ?11 IS NOT NULL AND budget_remaining IS NOT NULL
                  AND budget_remaining BETWEEN 0 AND ?11
                )
              )
              AND (max_uses IS NULL OR usage_count < max_uses)
              AND (budget_remaining IS NULL OR budget_remaining >= ?1)
              AND (?6 IS NULL OR NOT EXISTS (
                SELECT 1 FROM redemptions
                WHERE merchant_id = ?3 AND external_order_ref = ?6
              ))
              AND (?7 IS NULL OR NOT EXISTS (
                SELECT 1 FROM redemptions
                WHERE merchant_id = ?3 AND idempotency_key = ?7
              ))
              AND (
                ?8 IS NULL OR (
                  ?9 IS NOT NULL AND (
                    SELECT COUNT(*)
                    FROM redemptions AS prior
                    INNER JOIN evaluation_decisions AS prior_decision
                      ON prior.merchant_id = prior_decision.merchant_id
                      AND prior.evaluation_id = prior_decision.id
                    WHERE prior.merchant_id = ?3
                      AND prior_decision.customer_ref = ?9
                      AND json_extract(prior.result_json, '$.result.programRef') = ?4
                  ) < ?8
                )
              )
          `).bind(
            parsed.discountMinorUnits,
            parsed.programId,
            parsed.merchantId,
            parsed.programRef,
            storedProgramJson(parsed.expectedProgram),
            parsed.externalOrderRef ?? null,
            parsed.idempotencyKey ?? null,
            parsed.perCustomerCap ?? null,
            parsed.customerRef ?? null,
            parsed.expectedProgram.usageCap ?? null,
            parsed.expectedProgram.budget?.minorUnits ?? null,
          ),
          env.DB.prepare(`
            INSERT INTO redemptions (
              id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
              result_json, discount_minor_units, currency, created_at
            )
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
            WHERE changes() = 1
          `).bind(
            parsed.redemptionId,
            parsed.merchantId,
            parsed.externalOrderRef ?? null,
            parsed.idempotencyKey ?? null,
            parsed.evaluationId,
            redemptionEnvelope(parsed),
            parsed.discountMinorUnits,
            parsed.currency,
            parsed.createdAt,
          ),
        ]);
        if (counter?.meta.changes === 0 && ledger?.meta.changes === 0) return false;
        if (counter?.meta.changes !== 1 || ledger?.meta.changes !== 1) {
          throw new Error('Atomic redemption counter and ledger diverged');
        }
        return true;
      },

      async getByExternalOrderRef(merchantId, externalOrderRef, verifyIntegrity) {
        const row = await db.select().from(redemptions).where(and(
          eq(redemptions.merchantId, merchantId),
          eq(redemptions.externalOrderRef, externalOrderRef),
        )).get();
        return row === undefined ? null : verifiedRedemptionFromRow(row, verifyIntegrity);
      },

      async getByIdempotencyKey(merchantId, idempotencyKey, verifyIntegrity) {
        const row = await db.select().from(redemptions).where(and(
          eq(redemptions.merchantId, merchantId),
          eq(redemptions.idempotencyKey, idempotencyKey),
        )).get();
        return row === undefined ? null : verifiedRedemptionFromRow(row, verifyIntegrity);
      },

      async countCommittedForCustomerProgram(
        merchantId,
        customerRef,
        programRef,
        verifyIntegrity,
      ) {
        const parsedMerchantId = z.string().min(1).parse(merchantId);
        const parsedCustomerRef = z.string().min(1).parse(customerRef);
        const parsedProgramRef = z.string().min(1).parse(programRef);
        const candidates = await db.select({
          redemptionId: redemptions.id,
          redemptionMerchantId: redemptions.merchantId,
          externalOrderRef: redemptions.externalOrderRef,
          idempotencyKey: redemptions.idempotencyKey,
          redemptionEvaluationId: redemptions.evaluationId,
          resultJson: redemptions.resultJson,
          discountMinorUnits: redemptions.discountMinorUnits,
          currency: redemptions.currency,
          redemptionCreatedAt: redemptions.createdAt,
          decisionId: evaluationDecisions.id,
          decisionMerchantId: evaluationDecisions.merchantId,
          decisionCustomerRef: evaluationDecisions.customerRef,
          customerVersion: evaluationDecisions.customerVersion,
          schemaVersion: evaluationDecisions.schemaVersion,
          requestJson: evaluationDecisions.requestJson,
          factsJson: evaluationDecisions.factsJson,
          decisionsJson: evaluationDecisions.decisionsJson,
          integrityHash: evaluationDecisions.integrityHash,
          expiresAt: evaluationDecisions.expiresAt,
          decisionCreatedAt: evaluationDecisions.createdAt,
        }).from(redemptions).innerJoin(
          evaluationDecisions,
          and(
            eq(redemptions.merchantId, evaluationDecisions.merchantId),
            eq(redemptions.evaluationId, evaluationDecisions.id),
          ),
        ).where(and(
          eq(redemptions.merchantId, parsedMerchantId),
          eq(evaluationDecisions.customerRef, parsedCustomerRef),
        )).all();

        let count = 0;
        for (const candidate of candidates) {
          const redemption = redemptionFromRow({
            id: candidate.redemptionId,
            merchantId: candidate.redemptionMerchantId,
            externalOrderRef: candidate.externalOrderRef,
            idempotencyKey: candidate.idempotencyKey,
            evaluationId: candidate.redemptionEvaluationId,
            resultJson: candidate.resultJson,
            discountMinorUnits: candidate.discountMinorUnits,
            currency: candidate.currency,
            createdAt: candidate.redemptionCreatedAt,
          });
          const snapshot = decisionFromRow({
            id: candidate.decisionId,
            merchantId: candidate.decisionMerchantId,
            customerRef: candidate.decisionCustomerRef,
            customerVersion: candidate.customerVersion,
            schemaVersion: candidate.schemaVersion,
            requestJson: candidate.requestJson,
            factsJson: candidate.factsJson,
            decisionsJson: candidate.decisionsJson,
            integrityHash: candidate.integrityHash,
            expiresAt: candidate.expiresAt,
            createdAt: candidate.decisionCreatedAt,
          });
          if (!(await verifyIntegrity.verifyReceipt(redemption))) {
            throw new Error('Redemption receipt integrity verification failed');
          }
          if (!(await verifyIntegrity.verifyDecision(snapshot))) {
            throw new Error('Decision snapshot integrity verification failed');
          }
          const matchingDecision = snapshot.decisions.find(decision => (
            decision.outcome === 'qualified'
            && decision.commitRequired
            && decision.programRef === redemption.result.programRef
            && decision.rewardRuleRef === redemption.result.rewardRuleRef
            && canonicalJson(decision.effects) === canonicalJson(redemption.result.effects)
          ));
          if (
            redemption.evaluationId !== snapshot.evaluationId
            || matchingDecision === undefined
          ) {
            throw new Error('Redemption does not match a qualified decision snapshot');
          }
          if (redemption.result.programRef === parsedProgramRef) count += 1;
        }
        return count;
      },
    },

    audit: {
      async append(input) {
        canonicalJson(input);
        const entry = AuditEntrySchema.parse(input);
        await db.insert(productAudit).values({
          id: entry.id,
          occurredAt: entry.occurredAt,
          actorKind: entry.actorKind,
          actorId: entry.actorId,
          merchantId: entry.merchantId ?? null,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          outcome: entry.outcome,
          correlationId: entry.correlationId,
          metadataJson: entry.metadata === undefined ? null : canonicalJson(entry.metadata),
        }).run();
      },

      async list(merchantId) {
        const rows = await db.select().from(productAudit).where(
          eq(productAudit.merchantId, merchantId),
        ).orderBy(desc(productAudit.occurredAt), desc(productAudit.id)).all();
        return rows.map(auditFromRow);
      },
    },
  };
}
