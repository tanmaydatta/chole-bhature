import {
  ApiCredentialScopeSchema,
  ApiCredentialViewSchema,
  AuditEntrySchema,
  CodeEvaluationResultSchema,
  CustomerSnapshotSchema,
  EffectSchema,
  EvaluationRequestSchema,
  IncentiveDecisionSchema,
  MerchantActivationRequestSchema,
  MerchantActivationResultSchema,
  MerchantProvisionRequestSchema,
  MerchantProvisionResultSchema,
  PromoProgramSchema,
  ProgramLifecycleSchema,
  ProgramRevisionSchema,
  ProgramStatusSchema,
  RedemptionResponseSchema,
  VariableDefinitionSchema,
  normalizeDistinctPromoCodes,
  normalizePromoCode,
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
  redemptionEntries,
  redemptions,
  schemaVersions,
  variableDefinitions,
} from '../db/schema.js';
import type { Env } from '../env.js';
import { MerchantIdentityConflictError } from '../errors/merchant-errors.js';
import { canonicalJson } from '../json.js';
import {
  OptimisticVersionConflictError,
  PromoCodeConflictError,
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
  type RedemptionEntryRecord,
  type RedemptionReceiptIntegrityVerifier,
  type Repositories,
  type SchemaVersionRecord,
  type VariableDefinitionCreate,
  type VariableDefinitionRecord,
} from './types.js';

const AttributesSchema = z.record(z.string(), z.unknown());
const DefinitionsSchema = z.array(VariableDefinitionSchema);
const DecisionsSchema = z.array(IncentiveDecisionSchema);
const CodeResultsSchema = z.array(CodeEvaluationResultSchema);
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
const CalendarDateSchema = z.iso.date();
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
const RequestDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const EvaluationModeSchema = z.enum(['automatic', 'coded']);
const StoredRedemptionEnvelopeSchema = z.object({
  version: z.literal(2),
  result: RedemptionResponseSchema,
  receiptIntegrityHash: ReceiptIntegrityHashSchema,
}).strict();
const LegacyRedemptionResultSchema = z.object({
  redemptionId: z.string().min(1),
  evaluationId: z.string().min(1),
  externalOrderRef: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  programRef: z.string().min(1),
  rewardRuleRef: z.string().min(1).optional(),
  status: z.literal('committed'),
  effects: z.array(EffectSchema),
}).strict();
const LegacyRedemptionEnvelopeSchema = z.object({
  version: z.literal(1),
  result: LegacyRedemptionResultSchema,
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

function programCurrency(program: z.infer<typeof PromoProgramSchema>): string | undefined {
  if (program.budget !== undefined) return program.budget.currency;
  const rewards = [
    ...program.rewardRules.map(rule => rule.reward),
    ...(program.fallbackReward === undefined ? [] : [program.fallbackReward.reward]),
  ];
  return rewards.find(reward => 'amount' in reward)?.amount.currency;
}

function validStoredCustomerValue(definition: VariableDefinition, value: unknown): boolean {
  switch (definition.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && (definition.enumValues ?? []).includes(value);
    case 'date':
      return typeof value === 'string' && z.iso.date().safeParse(value).success;
  }
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

function parseCanonicalJson<T>(value: string, schema: z.ZodType<T>): T {
  const stored = JSON.parse(value) as unknown;
  const parsed = schema.parse(stored);
  if (canonicalJson(stored) !== canonicalJson(parsed)) {
    throw new Error('Stored JSON requires canonicalization');
  }
  return parsed;
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
  const status = row.status === 'active'
    && row.expiresAt !== null
    && Date.parse(row.expiresAt) <= Date.now()
    ? 'expired'
    : row.status;
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
    status,
    suffix: row.suffix,
    ...(row.kind === 'publishable'
      ? {
        allowedOrigins: parseJson(row.allowedOriginsJson, AllowedOriginsSchema),
        requestsPerMinute: row.requestsPerMinute,
      }
      : {}),
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
  committedSpend: number;
  createdAt: string;
  updatedAt: string;
}

function parseProgramRow(row: StoredProgramRow): ProgramRecord {
  let storedProgram: ReturnType<typeof PromoProgramSchema.parse>;
  try {
    storedProgram = parseJson(row.configJson, PromoProgramSchema);
  } catch (cause) {
    throw new Error('Stored program config is not canonical', { cause });
  }
  const lifecycleStatus = ProgramStatusSchema.parse(row.status);
  const selectedDraft = row.draftRevision === row.revision;
  const program = selectedDraft
    ? storedProgram
    : PromoProgramSchema.parse({ ...storedProgram, status: lifecycleStatus });
  if (!Number.isSafeInteger(row.usageCount) || row.usageCount < 0) {
    throw new Error('Program usage counter is invalid');
  }
  const usageCount = row.usageCount;
  if (!Number.isSafeInteger(row.committedSpend) || row.committedSpend < 0) {
    throw new Error('Program committed spend counter is invalid');
  }
  if (
    program.id !== row.externalRef
    || program.type !== row.type
    || (
      selectedDraft
      && row.activeRevision !== null
      && storedProgram.status !== 'draft'
    )
    || (
      selectedDraft
      && row.activeRevision === null
      && storedProgram.status !== lifecycleStatus
    )
  ) {
    throw new Error('Program JSON does not match its relational columns');
  }
  const configOwnsCounters = row.activeRevision === null || !selectedDraft;
  if (configOwnsCounters && (
    (program.usageCap === undefined && row.maxUses !== null)
    || (program.usageCap !== undefined && row.maxUses !== program.usageCap)
    || (program.usageCap !== undefined && usageCount > program.usageCap)
  )) {
    throw new Error('Program usage cap does not match its relational counter columns');
  }
  if (configOwnsCounters && (
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
  )) {
    throw new Error('Program budget does not match its relational counter columns');
  }

  return {
    id: row.id,
    merchantId: row.merchantId,
    externalRef: row.externalRef,
    program,
    revision: row.revision,
    ...optional('activeRevision', row.activeRevision),
    ...optional('draftRevision', row.draftRevision),
    usageCount,
    ...optional('budgetRemaining', row.budgetRemaining),
    committedSpend: row.committedSpend,
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
    committedSpend: NonnegativeIntegerSchema.parse(row.committedSpend),
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
  const { createdAt: createdAtInput, ...request } = input;
  const provision = MerchantProvisionRequestSchema.parse(request);
  const createdAt = DateTimeSchema.parse(createdAtInput ?? now());
  return {
    id: provision.id,
    name: provision.name,
    status: 'provisioning',
    provisioningId: provision.provisioningId,
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
    ...(input.kind === 'publishable'
      ? { allowedOrigins: input.allowedOrigins ?? [], requestsPerMinute: input.requestsPerMinute }
      : {}),
  });
  return {
    view,
    digest: CredentialDigestSchema.parse(input.digest),
    allowedOrigins: AllowedOriginsSchema.parse(input.allowedOrigins ?? []),
  };
}

function parseCredentialAudit(
  input: unknown,
  expected: {
    action: 'credential.created' | 'credential.revoked';
    merchantId: string;
    targetId: string;
    actorId: string;
  },
) {
  const audit = AuditEntrySchema.parse(input);
  if (
    audit.action !== expected.action
    || audit.targetType !== 'credential'
    || audit.merchantId !== expected.merchantId
    || audit.targetId !== expected.targetId
    || audit.actorId !== expected.actorId
    || audit.outcome !== 'succeeded'
  ) {
    throw new Error('Credential audit does not match its mutation');
  }
  return audit;
}

function parseCustomerAudit(
  input: unknown,
  expected: { merchantId: string; targetId: string },
) {
  const audit = AuditEntrySchema.parse(input);
  if (
    audit.action !== 'customer.upserted'
    || audit.targetType !== 'customer'
    || audit.merchantId !== expected.merchantId
    || audit.targetId !== expected.targetId
    || audit.outcome !== 'succeeded'
    || !['root', 'member'].includes(audit.actorKind)
    || audit.metadata !== undefined
  ) {
    throw new Error('Customer audit does not match its mutation');
  }
  return audit;
}

function auditInsertStatement(env: Env, entry: ReturnType<typeof AuditEntrySchema.parse>) {
  return env.DB.prepare(`
    INSERT INTO product_audit (
      id, occurred_at, actor_kind, actor_id, merchant_id, action,
      target_type, target_id, outcome, correlation_id, metadata_json
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
  `).bind(
    entry.id,
    entry.occurredAt,
    entry.actorKind,
    entry.actorId,
    entry.merchantId ?? null,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.outcome,
    entry.correlationId,
    entry.metadata === undefined ? null : canonicalJson(entry.metadata),
  );
}

function conditionalAuditInsertStatement(
  env: Env,
  entry: ReturnType<typeof AuditEntrySchema.parse>,
) {
  return env.DB.prepare(`
    INSERT INTO product_audit (
      id, occurred_at, actor_kind, actor_id, merchant_id, action,
      target_type, target_id, outcome, correlation_id, metadata_json
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
    WHERE changes() = 1
  `).bind(
    entry.id,
    entry.occurredAt,
    entry.actorKind,
    entry.actorId,
    entry.merchantId ?? null,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.outcome,
    entry.correlationId,
    entry.metadata === undefined ? null : canonicalJson(entry.metadata),
  );
}

function parseDecision(
  input: EvaluationDecisionRecord,
  options: { legacy?: boolean } = {},
): EvaluationDecisionRecord {
  canonicalJson(input.request);
  canonicalJson(input.facts);
  canonicalJson(input.decisions);
  canonicalJson(input.submittedCodes);
  canonicalJson(input.codeResults);

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
  const mode = EvaluationModeSchema.parse(input.mode);
  const submittedCodes = z.array(z.string().min(1)).max(10).parse(input.submittedCodes);
  const codeResults = CodeResultsSchema.parse(input.codeResults);
  const normalizedRequestCodes = normalizeDistinctPromoCodes(request.codes ?? []);
  if (
    canonicalJson(submittedCodes)
      !== canonicalJson(normalizedRequestCodes.map(code => code.display))
  ) {
    throw new Error('Submitted codes must match the normalized evaluation request order');
  }
  if (
    mode !== (submittedCodes.length === 0 ? 'automatic' : 'coded')
    || (mode === 'automatic' && codeResults.length !== 0)
    || (mode === 'coded' && codeResults.length !== submittedCodes.length)
    || codeResults.some((result, index) => (
      result.code !== submittedCodes[index]
      || result.normalizedCode !== normalizedRequestCodes[index]?.normalized
    ))
  ) {
    throw new Error('Evaluation mode and code diagnostics are inconsistent');
  }
  canonicalJson(request);
  canonicalJson(facts);
  canonicalJson(decisions);
  canonicalJson(codeResults);

  return {
    evaluationId: z.string().min(1).parse(input.evaluationId),
    merchantId: z.string().min(1).parse(input.merchantId),
    mode,
    submittedCodes,
    codeResults,
    requestDigest: options.legacy === true
      ? z.string().regex(/^legacy:[^:]+$/u).parse(input.requestDigest)
      : RequestDigestSchema.parse(input.requestDigest),
    correlationId: z.string().min(1).max(200).parse(input.correlationId),
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
  const request = parseCanonicalJson(row.requestJson, EvaluationRequestSchema);
  const facts = parseCanonicalJson(row.factsJson, FactsSchema);
  const decisions = parseCanonicalJson(row.decisionsJson, DecisionsSchema);
  const submittedCodes = parseCanonicalJson(
    row.submittedCodesJson,
    z.array(z.string().min(1)).max(10),
  );
  const codeResults = parseCanonicalJson(row.codeResultsJson, CodeResultsSchema);
  const record = {
    evaluationId: row.id,
    merchantId: row.merchantId,
    mode: EvaluationModeSchema.parse(row.mode),
    submittedCodes,
    codeResults,
    requestDigest: row.requestDigest,
    correlationId: row.correlationId,
    ...optional('customerRef', row.customerRef),
    ...optional('customerVersion', row.customerVersion),
    schemaVersion: row.schemaVersion,
    request,
    facts,
    decisions,
    integrityHash: row.integrityHash,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
  if (row.requestDigest.startsWith('legacy:')) {
    if (
      row.requestDigest !== `legacy:${row.id}`
      || row.correlationId !== `migration:${row.id}`
    ) {
      throw new Error('Legacy evaluation migration markers are invalid');
    }
    return parseDecision(record, { legacy: true });
  }
  return parseDecision(record);
}

function decisionFromRow(row: typeof evaluationDecisions.$inferSelect): EvaluationDecisionRecord {
  return persistedRecord('evaluation decision', () => parseDecisionRow(row));
}

function parseRedemptionEntry(input: RedemptionEntryRecord): RedemptionEntryRecord {
  const rewardRuleRef = input.rewardRuleRef === undefined
    ? undefined
    : z.string().min(1).parse(input.rewardRuleRef);
  const effects = z.array(EffectSchema).parse(input.effects);
  canonicalJson(effects);
  return {
    position: z.number().int().nonnegative().parse(input.position),
    programRef: z.string().min(1).parse(input.programRef),
    programRevision: PositiveIntegerSchema.parse(input.programRevision),
    ...optional('rewardRuleRef', rewardRuleRef),
    effects,
    discountMinorUnits: NonnegativeIntegerSchema.parse(input.discountMinorUnits),
    currency: CurrencySchema.parse(input.currency),
  };
}

function parseRedemption(input: RedemptionCreate): RedemptionCreate {
  const redemptionId = z.string().min(1).parse(input.redemptionId);
  const evaluationId = z.string().min(1).parse(input.evaluationId);
  const externalOrderRef = z.string().min(1).parse(input.externalOrderRef);
  const idempotencyKey = z.string().min(1).parse(input.idempotencyKey);
  const result = RedemptionResponseSchema.parse(input.result);
  const entries = z.array(z.unknown()).min(1).parse(input.entries)
    .map(entry => parseRedemptionEntry(entry as RedemptionEntryRecord));
  if (entries.some((entry, position) => entry.position !== position)) {
    throw new Error('Redemption entry positions must be contiguous and ordered');
  }
  const publicEntries = entries.map((entry) => ({
    programRef: entry.programRef,
    programRevision: entry.programRevision,
    ...optional('rewardRuleRef', entry.rewardRuleRef),
    effects: entry.effects,
  }));
  if (
    result.redemptionId !== redemptionId
    || result.evaluationId !== evaluationId
    || result.externalOrderRef !== externalOrderRef
    || result.idempotencyKey !== idempotencyKey
    || canonicalJson(result.entries) !== canonicalJson(publicEntries)
  ) {
    throw new Error('Redemption result does not match its relational bundle');
  }

  return {
    redemptionId,
    merchantId: z.string().min(1).parse(input.merchantId),
    externalOrderRef,
    idempotencyKey,
    evaluationId,
    requestDigest: RequestDigestSchema.parse(input.requestDigest),
    result,
    entries,
    createdAt: DateTimeSchema.parse(input.createdAt),
    receiptIntegrityHash: ReceiptIntegrityHashSchema.parse(input.receiptIntegrityHash),
  };
}

function redemptionTotals(redemption: RedemptionCreate): {
  discountMinorUnits: number;
  currency: string;
} {
  const currencies = new Set(redemption.entries.map(entry => entry.currency));
  if (currencies.size !== 1) throw new Error('Redemption entries must use one currency');
  const total = redemption.entries.reduce(
    (sum, entry) => sum + BigInt(entry.discountMinorUnits),
    0n,
  );
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Redemption discount exceeds the supported range');
  }
  return {
    discountMinorUnits: Number(total),
    currency: redemption.entries[0]!.currency,
  };
}

function parseRedemptionRow(
  row: typeof redemptions.$inferSelect,
  entryRows: Array<typeof redemptionEntries.$inferSelect>,
): RedemptionCreate {
  if (row.externalOrderRef === null || row.idempotencyKey === null) {
    throw new Error('Current redemption bundles require both identifiers');
  }
  const envelope = parseJson(row.resultJson, StoredRedemptionEnvelopeSchema);
  const redemption = parseRedemption({
    redemptionId: row.id,
    merchantId: row.merchantId,
    externalOrderRef: row.externalOrderRef,
    idempotencyKey: row.idempotencyKey,
    evaluationId: row.evaluationId,
    requestDigest: row.requestDigest,
    result: envelope.result,
    entries: entryRows.map(entry => ({
      position: entry.position,
      programRef: entry.programRef,
      programRevision: entry.programRevision,
      ...optional('rewardRuleRef', entry.rewardRuleRef),
      effects: parseJson(entry.effectsJson, z.array(EffectSchema)),
      discountMinorUnits: entry.discountMinorUnits,
      currency: entry.currency,
    })),
    createdAt: row.createdAt,
    receiptIntegrityHash: envelope.receiptIntegrityHash,
  });
  const totals = redemptionTotals(redemption);
  if (
    row.discountMinorUnits !== totals.discountMinorUnits
    || row.currency !== totals.currency
  ) {
    throw new Error('Redemption header totals do not match its entries');
  }
  return redemption;
}

function readLegacyRedemptionRow(
  row: typeof redemptions.$inferSelect,
  entryRows: Array<typeof redemptionEntries.$inferSelect>,
) {
  const envelope = parseJson(row.resultJson, LegacyRedemptionEnvelopeSchema);
  const [entry] = entryRows;
  if (entry === undefined) {
    throw new Error('Legacy redemption has no migrated entry');
  }
  if (
    row.requestDigest !== `legacy:${row.id}`
    || entryRows.length !== 1
    || entry.position !== 0
    || envelope.result.redemptionId !== row.id
    || envelope.result.evaluationId !== row.evaluationId
    || envelope.result.externalOrderRef !== (row.externalOrderRef ?? undefined)
    || envelope.result.idempotencyKey !== (row.idempotencyKey ?? undefined)
    || envelope.result.programRef !== entry.programRef
    || envelope.result.rewardRuleRef !== (entry.rewardRuleRef ?? undefined)
    || canonicalJson(envelope.result.effects)
      !== canonicalJson(parseJson(entry.effectsJson, z.array(EffectSchema)))
    || row.discountMinorUnits !== entry.discountMinorUnits
    || row.currency !== entry.currency
  ) {
    throw new Error('Legacy redemption row does not match its migrated entry');
  }
  return { row, entry, envelope };
}

function historicalRedemptionFromRows(
  row: typeof redemptions.$inferSelect,
  entryRows: Array<typeof redemptionEntries.$inferSelect>,
): RedemptionCreate {
  return persistedRecord('redemption', () => {
    const raw = JSON.parse(row.resultJson) as { version?: unknown };
    if (raw.version !== 1) return parseRedemptionRow(row, entryRows);
    const legacy = readLegacyRedemptionRow(row, entryRows);
    return {
      redemptionId: row.id,
      merchantId: row.merchantId,
      ...optional('externalOrderRef', row.externalOrderRef ?? undefined),
      ...optional('idempotencyKey', row.idempotencyKey ?? undefined),
      evaluationId: row.evaluationId,
      requestDigest: row.requestDigest,
      result: legacy.envelope.result,
      entries: [{
        position: legacy.entry.position,
        programRef: legacy.entry.programRef,
        programRevision: legacy.entry.programRevision,
        ...optional('rewardRuleRef', legacy.entry.rewardRuleRef),
        effects: parseJson(legacy.entry.effectsJson, z.array(EffectSchema)),
        discountMinorUnits: legacy.entry.discountMinorUnits,
        currency: legacy.entry.currency,
      }],
      createdAt: row.createdAt,
      receiptIntegrityHash: legacy.envelope.receiptIntegrityHash,
    } as unknown as RedemptionCreate;
  });
}

function redemptionFromRows(
  row: typeof redemptions.$inferSelect,
  entryRows: Array<typeof redemptionEntries.$inferSelect>,
): RedemptionCreate {
  return persistedRecord('redemption', () => {
    const raw = JSON.parse(row.resultJson) as { version?: unknown };
    if (raw.version === 1) {
      readLegacyRedemptionRow(row, entryRows);
      throw new Error('Legacy redemption is available only to the private audit reader');
    }
    return parseRedemptionRow(row, entryRows);
  });
}

function redemptionEnvelope(redemption: RedemptionCreate): string {
  return JSON.stringify(StoredRedemptionEnvelopeSchema.parse({
    version: 2,
    result: redemption.result,
    receiptIntegrityHash: redemption.receiptIntegrityHash,
  }));
}

async function verifiedRedemptionFromRows(
  row: typeof redemptions.$inferSelect,
  entryRows: Array<typeof redemptionEntries.$inferSelect>,
  verifyIntegrity: RedemptionReceiptIntegrityVerifier,
): Promise<RedemptionCreate> {
  const redemption = redemptionFromRows(row, entryRows);
  if (!(await verifyIntegrity(redemption))) {
    throw new Error('Redemption receipt integrity verification failed');
  }
  return redemption;
}

function parseAtomicRedemption(input: AtomicRedemptionCommit): AtomicRedemptionCommit {
  const parsed = parseRedemption(input);
  const programRef = z.string().min(1).parse(input.programRef);
  const expectedActiveRevision = PositiveIntegerSchema.parse(input.expectedActiveRevision);
  const expectedProgram = PromoProgramSchema.parse(input.expectedProgram);
  if (
    expectedProgram.id !== programRef
    || parsed.entries.length !== 1
    || parsed.entries[0]?.programRef !== programRef
    || parsed.entries.some(entry => entry.programRevision !== expectedActiveRevision)
  ) {
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
    expectedActiveRevision,
    expectedProgram,
    ...optional('customerRef', customerRef),
    ...optional('perCustomerCap', perCustomerCap),
  };
}

export function createRepositories(env: Env): Repositories {
  const db = createDatabase(env);

  function programProjection(revision: 'working' | 'active' = 'working'): string {
    const revisionPointer = revision === 'active'
      ? 'logical.active_revision'
      : 'COALESCE(logical.draft_revision, logical.active_revision)';
    return `
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
      counter.committed_spend AS committedSpend,
      logical.created_at AS createdAt,
      logical.updated_at AS updatedAt
    FROM programs AS logical
    INNER JOIN program_revisions AS revision
      ON revision.merchant_id = logical.merchant_id
      AND revision.program_id = logical.id
      AND revision.revision = ${revisionPointer}
    INNER JOIN program_counters AS counter
      ON counter.merchant_id = logical.merchant_id
      AND counter.program_id = logical.id
  `;
  }

  async function getProgramById(
    merchantId: string,
    id: string,
  ): Promise<ProgramRecord | null> {
    const row = await env.DB.prepare(`${programProjection()}
      WHERE logical.merchant_id = ?1 AND logical.id = ?2
    `).bind(merchantId, id).first<StoredProgramRow>();
    return row === null ? null : programFromRow(row);
  }

  async function getProgramByExternalRef(
    merchantId: string,
    externalRef: string,
  ): Promise<ProgramRecord | null> {
    const row = await env.DB.prepare(`${programProjection()}
      WHERE logical.merchant_id = ?1 AND logical.external_ref = ?2
    `).bind(merchantId, externalRef).first<StoredProgramRow>();
    return row === null ? null : programFromRow(row);
  }

  async function getActiveProgramByExternalRef(
    merchantId: string,
    externalRef: string,
  ): Promise<ProgramRecord | null> {
    const row = await env.DB.prepare(`${programProjection('active')}
      WHERE logical.merchant_id = ?1 AND logical.external_ref = ?2
        AND logical.active_revision IS NOT NULL
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
          throw new MerchantIdentityConflictError(
            'Merchant provisioning identity conflicts with an existing merchant',
          );
        }
        return MerchantProvisionResultSchema.parse(record);
      },

      async get(id) {
        const row = await db.select().from(merchants).where(eq(merchants.id, id)).get();
        return row === undefined ? null : merchantFromRow(row);
      },

      async activate(input, updatedAt) {
        const parsed = MerchantActivationRequestSchema.parse(input);
        const parsedUpdatedAt = DateTimeSchema.parse(updatedAt);
        const existing = await db.select().from(merchants).where(eq(merchants.id, parsed.id)).get();
        if (
          existing === undefined
          || existing.provisioningId !== parsed.provisioningId
        ) {
          throw new MerchantIdentityConflictError(
            'Merchant activation provisioning identity conflicts with existing state',
          );
        }
        if (existing.status === 'active') {
          return MerchantActivationResultSchema.parse(merchantFromRow(existing));
        }
        const result = await env.DB.prepare(`
          UPDATE merchants SET status = 'active', updated_at = ?1
          WHERE id = ?2 AND provisioning_id = ?3 AND status = 'provisioning'
        `).bind(parsedUpdatedAt, parsed.id, parsed.provisioningId).run();
        if (result.meta.changes !== 1) {
          throw new MerchantIdentityConflictError(
            'Merchant activation provisioning identity conflicts with existing state',
          );
        }
        const row = await db.select().from(merchants).where(eq(merchants.id, parsed.id)).get();
        if (row === undefined) throw new Error('Activated merchant could not be read');
        return MerchantActivationResultSchema.parse(merchantFromRow(row));
      },
    },

    credentials: {
      async createWithAudit(input, auditInput) {
        const parsed = parseCredentialCreate(input);
        const audit = parseCredentialAudit(auditInput, {
          action: 'credential.created',
          merchantId: parsed.view.merchantId,
          targetId: parsed.view.id,
          actorId: parsed.view.createdBy,
        });
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO api_credentials (
              id, merchant_id, name, environment, kind, scopes_json,
              allowed_origins_json, requests_per_minute, digest, suffix, status,
              expires_at, created_at, created_by
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
            )
          `).bind(
            parsed.view.id,
            parsed.view.merchantId,
            parsed.view.name,
            parsed.view.environment,
            parsed.view.kind,
            canonicalJson(parsed.view.scopes),
            canonicalJson(parsed.allowedOrigins),
            parsed.view.kind === 'publishable' ? parsed.view.requestsPerMinute : null,
            parsed.digest,
            parsed.view.suffix,
            parsed.view.status,
            parsed.view.expiresAt ?? null,
            parsed.view.createdAt,
            parsed.view.createdBy,
          ),
          auditInsertStatement(env, audit),
        ]);
        const row = await db.select().from(apiCredentials).where(
          eq(apiCredentials.id, parsed.view.id),
        ).get();
        if (row === undefined) throw new Error('Credential creation did not persist');
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

      async hasAllowedPublishableOrigin(origin, scope, checkedAt) {
        const parsedOrigin = ExactOriginSchema.parse(origin);
        const parsedScope = ApiCredentialScopeSchema.parse(scope);
        const parsedCheckedAt = DateTimeSchema.parse(checkedAt);
        const row = await env.DB.prepare(`
          SELECT credential.id
          FROM api_credentials AS credential
          INNER JOIN merchants AS merchant ON merchant.id = credential.merchant_id
          WHERE credential.kind = 'publishable'
            AND credential.status = 'active'
            AND merchant.status = 'active'
            AND (
              credential.expires_at IS NULL
              OR julianday(credential.expires_at) > julianday(?1)
            )
            AND EXISTS (
              SELECT 1 FROM json_each(credential.scopes_json)
              WHERE json_each.value = ?2
            )
            AND EXISTS (
              SELECT 1 FROM json_each(credential.allowed_origins_json)
              WHERE json_each.value = ?3
            )
          LIMIT 1
        `).bind(parsedCheckedAt, parsedScope, parsedOrigin).first<{ id: string }>();
        return row !== null;
      },

      async list(merchantId) {
        const rows = await db.select().from(apiCredentials).where(
          eq(apiCredentials.merchantId, merchantId),
        ).orderBy(asc(apiCredentials.createdAt), asc(apiCredentials.id)).all();
        return rows.map(credentialFromRow);
      },

      async revokeWithAudit(merchantId, id, revokedAt, revokedBy, auditInput) {
        const parsedMerchantId = z.string().min(1).parse(merchantId);
        const parsedId = z.string().min(1).parse(id);
        const parsedRevokedAt = DateTimeSchema.parse(revokedAt);
        const parsedRevokedBy = z.string().min(1).parse(revokedBy);
        const audit = parseCredentialAudit(auditInput, {
          action: 'credential.revoked',
          merchantId: parsedMerchantId,
          targetId: parsedId,
          actorId: parsedRevokedBy,
        });
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE api_credentials
            SET status = 'revoked', revoked_at = ?1, revoked_by = ?2
            WHERE merchant_id = ?3 AND id = ?4 AND status = 'active'
          `).bind(parsedRevokedAt, parsedRevokedBy, parsedMerchantId, parsedId),
          env.DB.prepare(`
            INSERT INTO product_audit (
              id, occurred_at, actor_kind, actor_id, merchant_id, action,
              target_type, target_id, outcome, correlation_id, metadata_json
            )
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
            WHERE EXISTS (
              SELECT 1 FROM api_credentials
              WHERE merchant_id = ?12 AND id = ?13 AND status = 'revoked'
                AND revoked_at = ?14 AND revoked_by = ?15
            )
              AND NOT EXISTS (
                SELECT 1 FROM product_audit
                WHERE merchant_id = ?12 AND target_type = 'credential'
                  AND target_id = ?13 AND action = 'credential.revoked'
              )
          `).bind(
            audit.id,
            audit.occurredAt,
            audit.actorKind,
            audit.actorId,
            audit.merchantId ?? null,
            audit.action,
            audit.targetType,
            audit.targetId,
            audit.outcome,
            audit.correlationId,
            audit.metadata === undefined ? null : canonicalJson(audit.metadata),
            parsedMerchantId,
            parsedId,
            parsedRevokedAt,
            parsedRevokedBy,
          ),
        ]);
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

      async consumePublishableRateLimit(credentialId, requestsPerMinute, windowStartedAt) {
        const parsedCredentialId = z.string().min(1).parse(credentialId);
        const parsedRequestsPerMinute = PositiveIntegerSchema.max(10_000).parse(
          requestsPerMinute,
        );
        const parsedWindowStartedAt = NonnegativeIntegerSchema.refine(
          value => value % 60_000 === 0,
          'Rate-limit window must align to a minute',
        ).parse(windowStartedAt);
        const result = await env.DB.prepare(`
          INSERT INTO credential_rate_limit_windows (
            credential_id, window_started_at, request_count
          ) VALUES (?1, ?2, 1)
          ON CONFLICT (credential_id) DO UPDATE SET
            window_started_at = excluded.window_started_at,
            request_count = CASE
              WHEN credential_rate_limit_windows.window_started_at = excluded.window_started_at
              THEN credential_rate_limit_windows.request_count + 1
              ELSE 1
            END
          WHERE credential_rate_limit_windows.window_started_at <> excluded.window_started_at
            OR credential_rate_limit_windows.request_count < ?3
        `).bind(
          parsedCredentialId,
          parsedWindowStartedAt,
          parsedRequestsPerMinute,
        ).run();
        return result.meta.changes === 1;
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
          const deprecatedRows = await env.DB.prepare(`
            SELECT DISTINCT key FROM variable_definitions
            WHERE merchant_id = ?1 AND state = 'deprecated'
          `).bind(merchantId).all<{ key: string }>();
          const deprecatedKeys = new Set(deprecatedRows.results.map(row => row.key));
          const definitions = normalizedDefinitions(
            (published?.definitions ?? []).filter(definition => (
              !deprecatedKeys.has(definition.key)
            )),
          );
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
        const [versions, references, definitionRow, customerRows] = await Promise.all([
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
            SELECT key, label, source, type, required, enum_values_json AS enumValuesJson,
              description, default_error_message AS defaultErrorMessage
            FROM variable_definitions
            WHERE merchant_id = ?1 AND key = ?2
            ORDER BY schema_version DESC LIMIT 1
          `).bind(parsedMerchantId, parsedKey).first<{
            key: string;
            label: string;
            source: string;
            type: string;
            required: number;
            enumValuesJson: string | null;
            description: string | null;
            defaultErrorMessage: string | null;
          }>(),
          env.DB.prepare(`
            SELECT attributes_json AS attributesJson
            FROM customers WHERE merchant_id = ?1
          `).bind(parsedMerchantId).all<{ attributesJson: string }>(),
        ]);
        if (definitionRow === null) return {
          publishedVersions: versions.results.map(row => row.version),
          referencedProgramRefs: references.results.map(row => row.externalRef),
          storedCustomerCount: 0,
        };
        const definition = VariableDefinitionSchema.parse({
          key: definitionRow.key,
          label: definitionRow.label,
          source: definitionRow.source,
          type: definitionRow.type,
          required: definitionRow.required === 1,
          ...optional(
            'enumValues',
            definitionRow.enumValuesJson === null
              ? undefined
              : parseJson(definitionRow.enumValuesJson, z.array(z.string())),
          ),
          ...optional('description', definitionRow.description),
          ...optional('defaultErrorMessage', definitionRow.defaultErrorMessage),
        });
        let storedCustomerCount = 0;
        if (definition.source === 'customer') {
          const field = definition.key.slice('customer.'.length);
          for (const row of customerRows.results) {
            const attributes = parseJson(row.attributesJson, AttributesSchema);
            const present = Object.hasOwn(attributes, field);
            const valid = present && validStoredCustomerValue(definition, attributes[field]);
            if (valid) storedCustomerCount += 1;
          }
        }
        return {
          publishedVersions: versions.results.map(row => row.version),
          referencedProgramRefs: references.results.map(row => row.externalRef),
          storedCustomerCount,
        };
      },

      async countIncompatibleCustomers(merchantId, definitionInput) {
        const parsedMerchantId = z.string().min(1).parse(merchantId);
        const definition = VariableDefinitionSchema.parse(definitionInput);
        if (definition.source !== 'customer') return 0;
        const field = definition.key.slice('customer.'.length);
        const rows = await env.DB.prepare(`
          SELECT attributes_json AS attributesJson
          FROM customers WHERE merchant_id = ?1
        `).bind(parsedMerchantId).all<{ attributesJson: string }>();
        let incompatible = 0;
        for (const row of rows.results) {
          const attributes = parseJson(row.attributesJson, AttributesSchema);
          const present = Object.hasOwn(attributes, field);
          const valid = present && validStoredCustomerValue(definition, attributes[field]);
          if ((!present && definition.required) || (present && !valid)) incompatible += 1;
        }
        return incompatible;
      },

      async listDeprecatedKeys(merchantId) {
        const rows = await env.DB.prepare(`
          SELECT DISTINCT key FROM variable_definitions
          WHERE merchant_id = ?1 AND state = 'deprecated'
          ORDER BY key
        `).bind(z.string().min(1).parse(merchantId)).all<{ key: string }>();
        return new Set(rows.results.map(({ key }) => key));
      },

      async deprecateDefinition(input) {
        const merchantId = z.string().min(1).parse(input.merchantId);
        const id = z.string().min(1).parse(input.id);
        const schemaVersion = PositiveIntegerSchema.parse(input.schemaVersion);
        const deprecatedAt = DateTimeSchema.parse(input.deprecatedAt);
        const deprecatedBy = z.string().min(1).parse(input.deprecatedBy);
        const addressed = await getSchemaDefinition(merchantId, id);
        if (
          addressed === null
          || addressed.schemaVersion !== schemaVersion
          || addressed.state === 'deprecated'
        ) throw new SchemaRevisionConflictError();
        const published = addressed.state === 'published'
          ? addressed
          : await db.select().from(variableDefinitions).where(and(
              eq(variableDefinitions.merchantId, merchantId),
              eq(variableDefinitions.key, addressed.definition.key),
              eq(variableDefinitions.state, 'published'),
            )).orderBy(desc(variableDefinitions.schemaVersion)).get()
            .then(row => row === undefined ? null : definitionFromRow(row));
        if (published === null) throw new SchemaRevisionConflictError();
        const draft = await getLatestSchemaVersion(merchantId, 'draft');
        const draftRecords = draft === null
          ? null
          : await env.DB.prepare(`
              SELECT id, key FROM variable_definitions
              WHERE merchant_id = ?1 AND schema_version = ?2 AND state = 'draft'
                AND key = ?3
            `).bind(merchantId, draft.version, published.definition.key).all<{
              id: string;
              key: string;
            }>();
        if (draft === null || draftRecords === null || draftRecords.results.length === 0) {
          const result = await env.DB.prepare(`
            UPDATE variable_definitions
            SET state = 'deprecated', deprecated_at = ?1, deprecated_by = ?2
            WHERE merchant_id = ?3 AND id = ?4 AND schema_version = ?5
              AND state = 'published'
          `).bind(deprecatedAt, deprecatedBy, merchantId, id, schemaVersion).run();
          if (result.meta.changes !== 1) throw new SchemaRevisionConflictError();
          return;
        }
        const expectedJson = definitionsJson(draft.definitions);
        const nextDefinitions = draft.definitions.filter(definition => (
          definition.key !== published.definition.key
        ));
        try {
          await env.DB.batch([
            env.DB.prepare(`
              UPDATE variable_definitions
              SET state = 'deprecated', deprecated_at = ?1, deprecated_by = ?2
              WHERE merchant_id = ?3 AND id = ?4 AND schema_version = ?5
                AND state = 'published'
                AND EXISTS (
                  SELECT 1 FROM schema_versions
                  WHERE merchant_id = ?3 AND version = ?6 AND state = 'draft'
                    AND definitions_json = ?7
                )
            `).bind(
              deprecatedAt,
              deprecatedBy,
              merchantId,
              published.id,
              published.schemaVersion,
              draft.version,
              expectedJson,
            ),
            env.DB.prepare(`
              DELETE FROM variable_definitions
              WHERE merchant_id = ?1 AND schema_version = ?2 AND state = 'draft'
                AND key = ?3 AND changes() = 1
            `).bind(merchantId, draft.version, published.definition.key),
            env.DB.prepare(`
              UPDATE schema_versions SET definitions_json = ?1
              WHERE merchant_id = ?2 AND version = ?3 AND state = 'draft'
                AND definitions_json = ?4 AND changes() = 1
                AND NOT EXISTS (
                  SELECT 1 FROM variable_definitions
                  WHERE merchant_id = ?2 AND schema_version = ?3 AND key = ?5
                    AND state = 'draft'
                )
            `).bind(
              definitionsJson(nextDefinitions),
              merchantId,
              draft.version,
              expectedJson,
              published.definition.key,
            ),
            env.DB.prepare(`
              SELECT json_extract(
                CASE WHEN changes() = 1 THEN 'null' ELSE 'deprecation-cas-miss' END,
                '$'
              )
            `),
          ]);
        } catch (error) {
          if (error instanceof Error && /malformed JSON/u.test(error.message)) {
            throw new SchemaRevisionConflictError();
          }
          throw error;
        }
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

      async upsertWithAudit(input: CustomerUpsert, auditInput) {
        canonicalJson({
          externalRef: input.externalRef,
          attributes: input.attributes,
        });
        const snapshot = CustomerSnapshotSchema.parse({
          externalRef: input.externalRef,
          attributes: input.attributes,
        });
        const merchantId = z.string().min(1).parse(input.merchantId);
        const updatedAt = DateTimeSchema.parse(input.updatedAt ?? now());
        const audit = parseCustomerAudit(auditInput, {
          merchantId,
          targetId: snapshot.externalRef,
        });
        let results: D1Result[];

        if (input.expectedVersion === undefined) {
          try {
            results = await env.DB.batch([
              env.DB.prepare(`
                INSERT INTO customers (
                  id, merchant_id, external_ref, attributes_json, version, updated_at
                ) VALUES (?1, ?2, ?3, ?4, 1, ?5)
              `).bind(
                crypto.randomUUID(), merchantId, snapshot.externalRef,
                canonicalJson(snapshot.attributes), updatedAt,
              ),
              conditionalAuditInsertStatement(env, audit),
            ]);
          } catch (error) {
            if (await getCustomer(merchantId, snapshot.externalRef) !== null) {
              throw new OptimisticVersionConflictError();
            }
            throw error;
          }
        } else {
          const expectedVersion = PositiveIntegerSchema.parse(input.expectedVersion);
          results = await env.DB.batch([
            env.DB.prepare(`
              UPDATE customers
              SET attributes_json = ?1, version = ?2, updated_at = ?3
              WHERE merchant_id = ?4 AND external_ref = ?5 AND version = ?6
            `).bind(
              canonicalJson(snapshot.attributes), expectedVersion + 1, updatedAt,
              merchantId, snapshot.externalRef, expectedVersion,
            ),
            conditionalAuditInsertStatement(env, audit),
          ]);
        }

        if (results[1]?.meta.changes !== 1) throw new OptimisticVersionConflictError();
        const stored = await getCustomer(merchantId, snapshot.externalRef);
        if (stored === null) throw new Error('Customer mutation did not produce a readable row');
        return stored;
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
                program_id, merchant_id, max_uses, usage_count, budget_remaining,
                committed_spend
              )
              SELECT ?1, ?2, ?3, 0, ?4, 0 WHERE changes() = 1
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

      async getActive(merchantId, externalRef) {
        return getActiveProgramByExternalRef(merchantId, externalRef);
      },

      async getPublishedByNormalizedCode(merchantId, normalizedCode) {
        const claim = await env.DB.prepare(`
          SELECT code_claim.program_ref AS programRef
          FROM promo_code_claims AS code_claim
          INNER JOIN programs AS logical
            ON logical.merchant_id = code_claim.merchant_id
            AND logical.id = code_claim.program_id
            AND logical.active_revision = code_claim.active_revision
          WHERE code_claim.merchant_id = ?1
            AND code_claim.normalized_code = ?2
            AND code_claim.released_at IS NULL
            AND logical.status IN ('active', 'scheduled', 'paused')
            AND COALESCE(code_claim.ends_at, '9999-12-31') >= date('now')
          ORDER BY
            CASE
              WHEN COALESCE(code_claim.starts_at, '0001-01-01') <= date('now')
                THEN 0
              ELSE 1
            END,
            COALESCE(code_claim.starts_at, '0001-01-01T00:00:00.000Z'),
            code_claim.created_at,
            code_claim.program_ref
          LIMIT 1
        `).bind(
          z.string().min(1).parse(merchantId),
          z.string().min(1).parse(normalizedCode),
        ).first<{ programRef: string }>();
        return claim === null
          ? null
          : getActiveProgramByExternalRef(merchantId, claim.programRef);
      },

      async list(merchantId) {
        const rows = await env.DB.prepare(`${programProjection()}
          WHERE logical.merchant_id = ?1
          ORDER BY logical.created_at, logical.external_ref
        `).bind(merchantId).all<StoredProgramRow>();
        return rows.results.map(programFromRow);
      },

      async listActive(merchantId) {
        const rows = await env.DB.prepare(`${programProjection('active')}
          WHERE logical.merchant_id = ?1 AND logical.active_revision IS NOT NULL
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
        const logical = await env.DB.prepare(`
          SELECT id, status, active_revision AS activeRevision,
            draft_revision AS draftRevision, updated_at AS updatedAt
          FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
        `).bind(merchantId, externalRef).first<{
          id: string;
          status: string;
          activeRevision: number | null;
          draftRevision: number | null;
          updatedAt: string;
        }>();
        if (logical === null || logical.updatedAt !== expectedUpdatedAt) {
          throw new ProgramConflictError('The program draft changed before it was stored');
        }

        if (logical.activeRevision !== null) {
          if (parsedProgram.status !== 'draft') {
            throw new ProgramConflictError('Replacement revisions must remain drafts');
          }
          const configJson = storedProgramJson(parsedProgram);
          if (logical.draftRevision === null) {
            const nextRevision = Math.max(logical.activeRevision, 0) + 1;
            const [revisionResult, logicalResult] = await env.DB.batch([
              env.DB.prepare(`
                INSERT INTO program_revisions (
                  program_id, merchant_id, revision, config_json, created_at, created_by,
                  published_at, published_by
                )
                SELECT id, merchant_id, ?1, ?2, ?3, 'system:operator', NULL, NULL
                FROM programs
                WHERE merchant_id = ?4 AND external_ref = ?5
                  AND active_revision = ?6 AND draft_revision IS NULL
                  AND updated_at = ?7
              `).bind(
                nextRevision,
                configJson,
                updatedAt,
                merchantId,
                externalRef,
                logical.activeRevision,
                expectedUpdatedAt,
              ),
              env.DB.prepare(`
                UPDATE programs SET draft_revision = ?1, updated_at = ?2
                WHERE merchant_id = ?3 AND external_ref = ?4
                  AND active_revision = ?5 AND draft_revision IS NULL
                  AND updated_at = ?6
                  AND EXISTS (
                    SELECT 1 FROM program_revisions
                    WHERE merchant_id = ?3 AND program_id = programs.id
                      AND revision = ?1 AND published_at IS NULL
                  )
              `).bind(
                nextRevision,
                updatedAt,
                merchantId,
                externalRef,
                logical.activeRevision,
                expectedUpdatedAt,
              ),
            ]);
            if (
              revisionResult?.meta.changes !== 1
              || (logicalResult?.meta.changes ?? 0) < 1
            ) {
              throw new ProgramConflictError('The program draft changed before it was stored');
            }
          } else {
            let results: D1Result[];
            try {
              results = await env.DB.batch([
                env.DB.prepare(`
                  UPDATE program_revisions SET config_json = ?1
                  WHERE merchant_id = ?2 AND program_id = ?3 AND revision = ?4
                    AND published_at IS NULL AND config_json = ?5
                    AND EXISTS (
                      SELECT 1 FROM programs
                      WHERE merchant_id = ?2 AND id = ?3 AND draft_revision = ?4
                        AND updated_at = ?6
                    )
                `).bind(
                  configJson,
                  merchantId,
                  logical.id,
                  logical.draftRevision,
                  storedProgramJson(expectedProgram),
                  expectedUpdatedAt,
                ),
                env.DB.prepare(`
                  UPDATE programs SET updated_at = ?1
                  WHERE merchant_id = ?2 AND external_ref = ?3
                    AND changes() = 1
                    AND draft_revision = ?4 AND updated_at = ?5
                `).bind(
                  updatedAt,
                  merchantId,
                  externalRef,
                  logical.draftRevision,
                  expectedUpdatedAt,
                ),
                env.DB.prepare(`
                  SELECT json_extract(
                    CASE WHEN changes() = 1 THEN 'null' ELSE 'draft-save-cas-miss' END,
                    '$'
                  )
                `),
              ]);
            } catch (error) {
              if (error instanceof Error && /malformed JSON/u.test(error.message)) {
                throw new ProgramConflictError('The program draft changed before it was stored');
              }
              throw error;
            }
            const [revisionResult, logicalResult] = results;
            if (
              (revisionResult?.meta.changes ?? 0) < 1
              || (logicalResult?.meta.changes ?? 0) < 1
            ) {
              throw new ProgramConflictError('The program draft changed before it was stored');
            }
          }
          const stored = await getProgramByExternalRef(merchantId, externalRef);
          if (stored === null) throw new ProgramConflictError('The program was not stored');
          return stored;
        }

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

      async publishDraftWithCodeClaim(input) {
        const merchantId = z.string().min(1).parse(input.merchantId);
        const externalRef = z.string().min(1).parse(input.externalRef);
        const expectedDraftRevision = PositiveIntegerSchema.parse(input.expectedDraftRevision);
        const publishedAt = DateTimeSchema.parse(input.publishedAt);
        const publishedBy = z.string().min(1).parse(input.publishedBy);
        const current = await env.DB.prepare(`
          SELECT logical.id AS programId, logical.updated_at AS updatedAt,
            logical.status AS lifecycleStatus,
            logical.active_revision AS activeRevision,
            draft.config_json AS draftConfigJson,
            active.config_json AS activeConfigJson,
            counter.max_uses AS maxUses,
            counter.usage_count AS usageCount,
            counter.budget_remaining AS budgetRemaining,
            counter.committed_spend AS committedSpend,
            COALESCE((
              SELECT SUM(redemption.discount_minor_units)
              FROM redemptions AS redemption
              WHERE redemption.merchant_id = logical.merchant_id
                AND json_valid(redemption.result_json)
                AND json_extract(redemption.result_json, '$.result.programRef')
                  = logical.external_ref
            ), 0) AS ledgerCommittedSpend
          FROM programs AS logical
          INNER JOIN program_revisions AS draft
            ON draft.merchant_id = logical.merchant_id
            AND draft.program_id = logical.id
            AND draft.revision = logical.draft_revision
          LEFT JOIN program_revisions AS active
            ON active.merchant_id = logical.merchant_id
            AND active.program_id = logical.id
            AND active.revision = logical.active_revision
          INNER JOIN program_counters AS counter
            ON counter.merchant_id = logical.merchant_id
            AND counter.program_id = logical.id
          WHERE logical.merchant_id = ?1 AND logical.external_ref = ?2
            AND logical.draft_revision = ?3
        `).bind(merchantId, externalRef, expectedDraftRevision).first<{
          programId: string;
          updatedAt: string;
          lifecycleStatus: string;
          activeRevision: number | null;
          draftConfigJson: string;
          activeConfigJson: string | null;
          maxUses: number | null;
          usageCount: number;
          budgetRemaining: number | null;
          committedSpend: number;
          ledgerCommittedSpend: number;
        }>();
        if (current === null) throw new ProgramConflictError('There is no draft revision to publish');
        const draft = parseJson(current.draftConfigJson, PromoProgramSchema);
        const active = current.activeConfigJson === null
          ? null
          : parseJson(current.activeConfigJson, PromoProgramSchema);
        const lifecycleStatus = ProgramStatusSchema.parse(current.lifecycleStatus);
        const publicationDate = publishedAt.slice(0, 10);
        const status = lifecycleStatus === 'ended'
          || (active?.endDate !== undefined && active.endDate < publicationDate)
          ? 'ended'
          : lifecycleStatus === 'paused'
          ? 'paused'
          : draft.endDate !== undefined && draft.endDate < publicationDate
          ? 'ended'
          : draft.startDate !== undefined && draft.startDate > publicationDate
          ? 'scheduled'
          : 'active';
        const codeClaim = input.codeClaim;
        if (draft.autoApply) {
          if (codeClaim !== undefined) {
            throw new ProgramConflictError('Automatic Promos cannot claim a code');
          }
        } else {
          if (codeClaim === undefined) {
            throw new ProgramConflictError('Coded Promos require a publication claim');
          }
          const normalized = normalizePromoCode(draft.code);
          if (
            z.string().min(1).parse(codeClaim.merchantId) !== merchantId
            || z.string().min(1).parse(codeClaim.programId) !== current.programId
            || z.string().min(1).parse(codeClaim.programRef) !== externalRef
            || PositiveIntegerSchema.parse(codeClaim.activeRevision) !== expectedDraftRevision
            || z.string().min(1).parse(codeClaim.displayCode) !== normalized.display
            || z.string().min(1).parse(codeClaim.normalizedCode) !== normalized.normalized
            || DateTimeSchema.parse(codeClaim.claimedAt) !== publishedAt
            || (
              codeClaim.startsAt === undefined
                ? draft.startDate !== undefined
                : CalendarDateSchema.parse(codeClaim.startsAt) !== draft.startDate
            )
            || (
              codeClaim.endsAt === undefined
                ? draft.endDate !== undefined
                : CalendarDateSchema.parse(codeClaim.endsAt) !== draft.endDate
            )
          ) {
            throw new ProgramConflictError('The Promo code claim does not match its draft');
          }
        }
        const nextMaxUses = draft.usageCap ?? null;
        if (nextMaxUses !== null && current.usageCount > nextMaxUses) {
          throw new ProgramConflictError('The replacement usage cap is below current usage');
        }
        const nextBudget = draft.budget;
        const spent = Math.max(current.committedSpend, current.ledgerCommittedSpend);
        if (
          active !== null
          && spent > 0
          && programCurrency(active) !== programCurrency(draft)
        ) {
          throw new ProgramConflictError('A spent program budget cannot change currency');
        }
        const nextBudgetRemaining = nextBudget === undefined
          ? null
          : nextBudget.minorUnits - spent;
        if (nextBudgetRemaining !== null && nextBudgetRemaining < 0) {
          throw new ProgramConflictError('The replacement budget is below committed spend');
        }
        const updatedAt = nextProgramTimestamp(current.updatedAt, publishedAt);
        const legacyMirrorJson = storedProgramJson({ ...draft, status });
        const requiresCodeClaim = codeClaim !== undefined && status !== 'ended';
        const claimId = crypto.randomUUID();
        let results: D1Result[];
        try {
          results = await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO promo_code_claims (
                id, merchant_id, program_id, program_ref, active_revision,
                display_code, normalized_code, starts_at, ends_at,
                released_at, created_at
              )
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10
              WHERE ?11 = 1
                AND NOT EXISTS (
                  SELECT 1
                  FROM promo_code_claims AS existing
                  WHERE existing.released_at IS NULL
                    AND existing.merchant_id = ?2
                    AND existing.normalized_code = ?7
                    AND existing.program_ref <> ?4
                    AND COALESCE(
                      existing.ends_at,
                      '9999-12-31T23:59:59.999Z'
                    ) >= COALESCE(?8, '0001-01-01T00:00:00.000Z')
                    AND COALESCE(
                      ?9,
                      '9999-12-31T23:59:59.999Z'
                    ) >= COALESCE(
                      existing.starts_at,
                      '0001-01-01T00:00:00.000Z'
                    )
                )
            `).bind(
              claimId,
              merchantId,
              current.programId,
              externalRef,
              expectedDraftRevision,
              codeClaim?.displayCode ?? '',
              codeClaim?.normalizedCode ?? '',
              codeClaim?.startsAt ?? null,
              codeClaim?.endsAt ?? null,
              codeClaim?.claimedAt ?? publishedAt,
              requiresCodeClaim ? 1 : 0,
            ),
            env.DB.prepare(`
              SELECT existing.program_ref AS programRef
              FROM promo_code_claims AS existing
              WHERE ?1 = 1
                AND NOT EXISTS (
                  SELECT 1 FROM promo_code_claims AS inserted WHERE inserted.id = ?2
                )
                AND existing.released_at IS NULL
                AND existing.merchant_id = ?3
                AND existing.normalized_code = ?4
                AND existing.program_ref <> ?5
                AND COALESCE(
                  existing.ends_at,
                  '9999-12-31T23:59:59.999Z'
                ) >= COALESCE(?6, '0001-01-01T00:00:00.000Z')
                AND COALESCE(
                  ?7,
                  '9999-12-31T23:59:59.999Z'
                ) >= COALESCE(
                  existing.starts_at,
                  '0001-01-01T00:00:00.000Z'
                )
              ORDER BY existing.created_at, existing.program_ref
              LIMIT 1
            `).bind(
              requiresCodeClaim ? 1 : 0,
              claimId,
              merchantId,
              codeClaim?.normalizedCode ?? '',
              externalRef,
              codeClaim?.startsAt ?? null,
              codeClaim?.endsAt ?? null,
            ),
            env.DB.prepare(`
              UPDATE program_revisions
              SET published_at = ?1, published_by = ?2
              WHERE merchant_id = ?3 AND revision = ?4
                AND published_at IS NULL AND published_by IS NULL
                AND (?11 = 0 OR EXISTS (
                  SELECT 1 FROM promo_code_claims AS inserted WHERE inserted.id = ?12
                ))
                AND program_id = (
                  SELECT logical.id FROM programs AS logical
                  INNER JOIN program_counters AS counter
                    ON counter.merchant_id = logical.merchant_id
                    AND counter.program_id = logical.id
                  WHERE logical.merchant_id = ?3 AND logical.external_ref = ?5
                    AND logical.draft_revision = ?4 AND logical.updated_at = ?6
                    AND counter.usage_count = ?7
                    AND ((?8 IS NULL AND counter.max_uses IS NULL)
                      OR counter.max_uses = ?8)
                    AND ((?9 IS NULL AND counter.budget_remaining IS NULL)
                      OR counter.budget_remaining = ?9)
                    AND counter.committed_spend = ?10
                )
            `).bind(
              publishedAt,
              publishedBy,
              merchantId,
              expectedDraftRevision,
              externalRef,
              current.updatedAt,
              current.usageCount,
              current.maxUses,
              current.budgetRemaining,
              current.committedSpend,
              requiresCodeClaim ? 1 : 0,
              claimId,
            ),
            env.DB.prepare(`
              UPDATE program_counters
              SET max_uses = ?1, budget_remaining = ?2, committed_spend = ?9
              WHERE merchant_id = ?3 AND program_id = ?4
                AND changes() = 1
                AND usage_count = ?5
                AND ((?6 IS NULL AND max_uses IS NULL) OR max_uses = ?6)
                AND ((?7 IS NULL AND budget_remaining IS NULL) OR budget_remaining = ?7)
                AND committed_spend = ?8
            `).bind(
              nextMaxUses,
              nextBudgetRemaining,
              merchantId,
              current.programId,
              current.usageCount,
              current.maxUses,
              current.budgetRemaining,
              current.committedSpend,
              spent,
            ),
            env.DB.prepare(`
              UPDATE programs
              SET type = ?1, name = ?2, status = ?3, config_json = ?4,
                priority = ?5, active_revision = draft_revision, draft_revision = NULL,
                max_uses = ?6, budget_remaining = ?7, updated_at = ?8
              WHERE merchant_id = ?9 AND external_ref = ?10
                AND changes() = 1
                AND draft_revision = ?11 AND updated_at = ?12
                AND usage_count = ?13
                AND EXISTS (
                  SELECT 1 FROM program_revisions
                  WHERE merchant_id = ?9 AND program_id = programs.id
                    AND revision = ?11 AND published_at = ?14 AND published_by = ?15
                )
                AND EXISTS (
                  SELECT 1 FROM program_counters
                  WHERE merchant_id = ?9 AND program_id = programs.id
                    AND usage_count = ?13
                    AND ((?6 IS NULL AND max_uses IS NULL) OR max_uses = ?6)
                    AND ((?7 IS NULL AND budget_remaining IS NULL) OR budget_remaining = ?7)
                    AND committed_spend = ?16
                )
            `).bind(
              draft.type,
              draft.name,
              status,
              legacyMirrorJson,
              draft.priority,
              nextMaxUses,
              nextBudgetRemaining,
              updatedAt,
              merchantId,
              externalRef,
              expectedDraftRevision,
              current.updatedAt,
              current.usageCount,
              publishedAt,
              publishedBy,
              spent,
            ),
            env.DB.prepare(`
              SELECT json_extract(
                CASE
                  WHEN changes() = 1 THEN 'null'
                  WHEN ?1 = 1 AND NOT EXISTS (
                    SELECT 1 FROM promo_code_claims AS inserted WHERE inserted.id = ?2
                  ) THEN 'null'
                  ELSE 'publication-cas-miss'
                END,
                '$'
              )
            `).bind(requiresCodeClaim ? 1 : 0, claimId),
            env.DB.prepare(`
              UPDATE promo_code_claims
              SET released_at = ?1
              WHERE merchant_id = ?2 AND program_id = ?3
                AND active_revision <> ?4
                AND released_at IS NULL
                AND EXISTS (
                  SELECT 1 FROM programs AS logical
                  WHERE logical.merchant_id = ?2 AND logical.id = ?3
                    AND logical.active_revision = ?4
                    AND logical.draft_revision IS NULL
                    AND logical.updated_at = ?1
                )
            `).bind(
              updatedAt,
              merchantId,
              current.programId,
              expectedDraftRevision,
            ),
          ]);
        } catch (error) {
          if (error instanceof Error && /malformed JSON/u.test(error.message)) {
            throw new ProgramConflictError('The program draft changed before publication');
          }
          throw error;
        }
        const [
          claimResult,
          conflictResult,
          revisionResult,
          counterResult,
          logicalResult,
        ] = results;
        if (requiresCodeClaim && claimResult?.meta.changes !== 1) {
          const conflict = z.object({ programRef: z.string().min(1) }).safeParse(
            conflictResult?.results[0],
          );
          if (conflict.success) {
            throw new PromoCodeConflictError(conflict.data.programRef);
          }
          throw new ProgramConflictError('The Promo code claim could not be acquired');
        }
        if (
          revisionResult?.meta.changes !== 1
          || counterResult?.meta.changes !== 1
          || (logicalResult?.meta.changes ?? 0) < 1
        ) {
          throw new ProgramConflictError('The program draft changed before publication');
        }
        const published = await getActiveProgramByExternalRef(merchantId, externalRef);
        if (published === null) throw new ProgramConflictError('The published revision is missing');
        return published;
      },

      async updateLifecycle(input) {
        const merchantId = z.string().min(1).parse(input.merchantId);
        const externalRef = z.string().min(1).parse(input.externalRef);
        const expectedStatus = ProgramStatusSchema.parse(input.expectedStatus);
        const status = ProgramStatusSchema.parse(input.status);
        if (status === 'draft') throw new ProgramConflictError('Lifecycle cannot return to draft');
        const candidateUpdatedAt = DateTimeSchema.parse(input.updatedAt);
        const current = await env.DB.prepare(`
          SELECT active_revision AS activeRevision, draft_revision AS draftRevision,
            updated_at AS updatedAt
          FROM programs WHERE merchant_id = ?1 AND external_ref = ?2
            AND status = ?3 AND active_revision IS NOT NULL
        `).bind(merchantId, externalRef, expectedStatus).first<{
          activeRevision: number;
          draftRevision: number | null;
          updatedAt: string;
        }>();
        if (current === null) throw new ProgramConflictError('The program lifecycle changed');
        const updatedAt = nextProgramTimestamp(current.updatedAt, candidateUpdatedAt);
        let results: D1Result[];
        try {
          results = await env.DB.batch([
            env.DB.prepare(`
              UPDATE programs
              SET status = ?1,
                config_json = json_set(config_json, '$.status', ?1),
                updated_at = ?2
              WHERE merchant_id = ?3 AND external_ref = ?4
                AND status = ?5 AND active_revision = ?6 AND updated_at = ?7
            `).bind(
              status,
              updatedAt,
              merchantId,
              externalRef,
              expectedStatus,
              current.activeRevision,
              current.updatedAt,
            ),
            env.DB.prepare(`
              UPDATE promo_code_claims
              SET released_at = ?1
              WHERE ?2 = 'ended'
                AND changes() = 1
                AND merchant_id = ?3
                AND program_ref = ?4
                AND active_revision = ?5
                AND released_at IS NULL
            `).bind(
              updatedAt,
              status,
              merchantId,
              externalRef,
              current.activeRevision,
            ),
            env.DB.prepare(`
              SELECT json_extract(
                CASE WHEN EXISTS (
                  SELECT 1 FROM programs
                  WHERE merchant_id = ?1 AND external_ref = ?2
                    AND status = ?3 AND active_revision = ?4 AND updated_at = ?5
                ) THEN 'null' ELSE 'lifecycle-cas-miss' END,
                '$'
              )
            `).bind(
              merchantId,
              externalRef,
              status,
              current.activeRevision,
              updatedAt,
            ),
          ]);
        } catch (error) {
          if (error instanceof Error && /malformed JSON/u.test(error.message)) {
            throw new ProgramConflictError('The program lifecycle changed');
          }
          throw error;
        }
        if ((results[0]?.meta.changes ?? 0) < 1) {
          throw new ProgramConflictError('The program lifecycle changed');
        }
        return ProgramLifecycleSchema.parse({
          programRef: externalRef,
          status,
          activeRevision: current.activeRevision,
          ...optional('draftRevision', current.draftRevision),
          updatedAt,
        });
      },

      async listReferencedVariableKeys(merchantId) {
        const rows = await env.DB.prepare(`${programProjection()}
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
          committedSpend: programCounters.committedSpend,
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
          mode: parsed.mode,
          submittedCodesJson: canonicalJson(parsed.submittedCodes),
          codeResultsJson: canonicalJson(parsed.codeResults),
          requestDigest: parsed.requestDigest,
          correlationId: parsed.correlationId,
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
        const totals = redemptionTotals(parsed);
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO redemptions (
              id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
              result_json, discount_minor_units, currency, created_at, request_digest
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
          `).bind(
            parsed.redemptionId,
            parsed.merchantId,
            parsed.externalOrderRef,
            parsed.idempotencyKey,
            parsed.evaluationId,
            redemptionEnvelope(parsed),
            totals.discountMinorUnits,
            totals.currency,
            parsed.createdAt,
            parsed.requestDigest,
          ),
          ...parsed.entries.map(entry => env.DB.prepare(`
            INSERT INTO redemption_entries (
              merchant_id, redemption_id, position, program_ref, program_revision,
              reward_rule_ref, effects_json, discount_minor_units, currency
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
          `).bind(
            parsed.merchantId,
            parsed.redemptionId,
            entry.position,
            entry.programRef,
            entry.programRevision,
            entry.rewardRuleRef ?? null,
            canonicalJson(entry.effects),
            entry.discountMinorUnits,
            entry.currency,
          )),
          env.DB.prepare(`
            INSERT INTO redemption_operations (
              merchant_id, idempotency_key, external_order_ref, evaluation_id,
              request_digest, state, terminal_error_code, retryable, redemption_id,
              created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, 'committed', NULL, NULL, ?6, ?7, ?7)
          `).bind(
            parsed.merchantId,
            parsed.idempotencyKey,
            parsed.externalOrderRef,
            parsed.evaluationId,
            parsed.requestDigest,
            parsed.redemptionId,
            parsed.createdAt,
          ),
        ]);
      },

      async commitAtomically(input) {
        const parsed = parseAtomicRedemption(input);
        const totals = redemptionTotals(parsed);
        let results;
        try {
          results = await env.DB.batch([
            env.DB.prepare(`
            UPDATE program_counters
            SET usage_count = usage_count + 1,
                committed_spend = committed_spend + ?1,
                budget_remaining = CASE
                  WHEN budget_remaining IS NULL THEN NULL
                  ELSE budget_remaining - ?1
                END
            WHERE program_id = ?2 AND merchant_id = ?3
              AND EXISTS (
                SELECT 1 FROM programs AS logical
                INNER JOIN program_revisions AS active
                  ON active.merchant_id = logical.merchant_id
                  AND active.program_id = logical.id
                  AND active.revision = logical.active_revision
                WHERE logical.id = ?2 AND logical.merchant_id = ?3
                  AND logical.external_ref = ?4
                  AND logical.active_revision = ?11
                  AND logical.status IN ('active', 'scheduled')
                  AND (
                    json_extract(active.config_json, '$.startDate') IS NULL
                    OR json_extract(active.config_json, '$.startDate') <= substr(?12, 1, 10)
                  )
                  AND (
                    json_extract(active.config_json, '$.endDate') IS NULL
                    OR json_extract(active.config_json, '$.endDate') >= substr(?12, 1, 10)
                  )
              )
              AND (
                (?9 IS NULL AND max_uses IS NULL)
                OR (?9 IS NOT NULL AND max_uses = ?9)
              )
              AND usage_count >= 0
              AND (?9 IS NULL OR usage_count <= ?9)
              AND (
                (?10 IS NULL AND budget_remaining IS NULL)
                OR (
                  ?10 IS NOT NULL AND budget_remaining IS NOT NULL
                  AND budget_remaining >= 0
                  AND budget_remaining + committed_spend = ?10
                )
              )
              AND committed_spend >= 0
              AND (max_uses IS NULL OR usage_count < max_uses)
              AND (budget_remaining IS NULL OR budget_remaining >= ?1)
              AND (?5 IS NULL OR NOT EXISTS (
                SELECT 1 FROM redemptions
                WHERE merchant_id = ?3 AND external_order_ref = ?5
              ))
              AND (?6 IS NULL OR NOT EXISTS (
                SELECT 1 FROM redemptions
                WHERE merchant_id = ?3 AND idempotency_key = ?6
              ))
              AND (
                ?7 IS NULL OR (
                  ?8 IS NOT NULL AND (
                    SELECT COUNT(DISTINCT prior.id)
                    FROM redemptions AS prior
                    INNER JOIN evaluation_decisions AS prior_decision
                      ON prior.merchant_id = prior_decision.merchant_id
                      AND prior.evaluation_id = prior_decision.id
                    INNER JOIN redemption_entries AS prior_entry
                      ON prior_entry.merchant_id = prior.merchant_id
                      AND prior_entry.redemption_id = prior.id
                    WHERE prior.merchant_id = ?3
                      AND prior_decision.customer_ref = ?8
                      AND prior_entry.program_ref = ?4
                  ) < ?7
                )
              )
          `).bind(
            totals.discountMinorUnits,
            parsed.programId,
            parsed.merchantId,
            parsed.programRef,
            parsed.externalOrderRef ?? null,
            parsed.idempotencyKey ?? null,
            parsed.perCustomerCap ?? null,
            parsed.customerRef ?? null,
            parsed.expectedProgram.usageCap ?? null,
            parsed.expectedProgram.budget?.minorUnits ?? null,
            parsed.expectedActiveRevision,
            parsed.createdAt,
          ),
            env.DB.prepare(`
            UPDATE programs
            SET usage_count = (
                  SELECT usage_count FROM program_counters
                  WHERE merchant_id = ?1 AND program_id = ?2
                ),
                budget_remaining = (
                  SELECT budget_remaining FROM program_counters
                  WHERE merchant_id = ?1 AND program_id = ?2
                )
            WHERE merchant_id = ?1 AND id = ?2 AND external_ref = ?3
              AND changes() = 1
          `).bind(parsed.merchantId, parsed.programId, parsed.programRef),
            env.DB.prepare(`
            INSERT INTO redemptions (
              id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
              result_json, discount_minor_units, currency, created_at, request_digest
            )
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
            WHERE changes() = 1
          `).bind(
            parsed.redemptionId,
            parsed.merchantId,
            parsed.externalOrderRef ?? null,
            parsed.idempotencyKey ?? null,
            parsed.evaluationId,
            redemptionEnvelope(parsed),
            totals.discountMinorUnits,
            totals.currency,
            parsed.createdAt,
            parsed.requestDigest,
          ),
            ...parsed.entries.map(entry => env.DB.prepare(`
              INSERT INTO redemption_entries (
                merchant_id, redemption_id, position, program_ref, program_revision,
                reward_rule_ref, effects_json, discount_minor_units, currency
              )
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
              WHERE changes() = 1
            `).bind(
              parsed.merchantId,
              parsed.redemptionId,
              entry.position,
              entry.programRef,
              entry.programRevision,
              entry.rewardRuleRef ?? null,
              canonicalJson(entry.effects),
              entry.discountMinorUnits,
              entry.currency,
            )),
            env.DB.prepare(`
              INSERT INTO redemption_operations (
                merchant_id, idempotency_key, external_order_ref, evaluation_id,
                request_digest, state, terminal_error_code, retryable, redemption_id,
                created_at, updated_at
              )
              SELECT ?1, ?2, ?3, ?4, ?5, 'committed', NULL, NULL, ?6, ?7, ?7
              WHERE changes() = 1
            `).bind(
              parsed.merchantId,
              parsed.idempotencyKey,
              parsed.externalOrderRef,
              parsed.evaluationId,
              parsed.requestDigest,
              parsed.redemptionId,
              parsed.createdAt,
            ),
            env.DB.prepare(`
              INSERT INTO redemption_commit_guards (
                redemption_id, position, changed_rows
              ) VALUES (?1, 0, changes())
            `).bind(parsed.redemptionId),
            env.DB.prepare(`
              DELETE FROM redemption_commit_guards
              WHERE redemption_id = ?1 AND position = 0 AND changes() = 1
            `).bind(parsed.redemptionId),
          ]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/redemption_commit_guards|changed_rows = 1/u.test(message)) return false;
          throw error;
        }
        const [counter, legacyCounter, ledger] = results;
        if (
          counter?.meta.changes === 0
          && legacyCounter?.meta.changes === 0
          && ledger?.meta.changes === 0
        ) return false;
        if (
          counter?.meta.changes !== 1
          || (legacyCounter?.meta.changes ?? 0) < 1
          || ledger?.meta.changes !== 1
        ) {
          throw new Error('Atomic redemption counter and ledger diverged');
        }
        return true;
      },

      async getByExternalOrderRef(merchantId, externalOrderRef, verifyIntegrity) {
        const row = await db.select().from(redemptions).where(and(
          eq(redemptions.merchantId, merchantId),
          eq(redemptions.externalOrderRef, externalOrderRef),
        )).get();
        if (row === undefined) return null;
        const entries = await db.select().from(redemptionEntries).where(and(
          eq(redemptionEntries.merchantId, row.merchantId),
          eq(redemptionEntries.redemptionId, row.id),
        )).orderBy(asc(redemptionEntries.position)).all();
        return verifiedRedemptionFromRows(row, entries, verifyIntegrity);
      },

      async getByIdempotencyKey(merchantId, idempotencyKey, verifyIntegrity) {
        const row = await db.select().from(redemptions).where(and(
          eq(redemptions.merchantId, merchantId),
          eq(redemptions.idempotencyKey, idempotencyKey),
        )).get();
        if (row === undefined) return null;
        const entries = await db.select().from(redemptionEntries).where(and(
          eq(redemptionEntries.merchantId, row.merchantId),
          eq(redemptionEntries.redemptionId, row.id),
        )).orderBy(asc(redemptionEntries.position)).all();
        return verifiedRedemptionFromRows(row, entries, verifyIntegrity);
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
          redemptionRequestDigest: redemptions.requestDigest,
          decisionId: evaluationDecisions.id,
          decisionMerchantId: evaluationDecisions.merchantId,
          decisionCustomerRef: evaluationDecisions.customerRef,
          customerVersion: evaluationDecisions.customerVersion,
          schemaVersion: evaluationDecisions.schemaVersion,
          requestJson: evaluationDecisions.requestJson,
          factsJson: evaluationDecisions.factsJson,
          decisionsJson: evaluationDecisions.decisionsJson,
          mode: evaluationDecisions.mode,
          submittedCodesJson: evaluationDecisions.submittedCodesJson,
          codeResultsJson: evaluationDecisions.codeResultsJson,
          requestDigest: evaluationDecisions.requestDigest,
          correlationId: evaluationDecisions.correlationId,
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
          const redemptionRow = {
            id: candidate.redemptionId,
            merchantId: candidate.redemptionMerchantId,
            externalOrderRef: candidate.externalOrderRef,
            idempotencyKey: candidate.idempotencyKey,
            evaluationId: candidate.redemptionEvaluationId,
            resultJson: candidate.resultJson,
            discountMinorUnits: candidate.discountMinorUnits,
            currency: candidate.currency,
            createdAt: candidate.redemptionCreatedAt,
            requestDigest: candidate.redemptionRequestDigest,
          };
          const entryRows = await db.select().from(redemptionEntries).where(and(
            eq(redemptionEntries.merchantId, candidate.redemptionMerchantId),
            eq(redemptionEntries.redemptionId, candidate.redemptionId),
          )).orderBy(asc(redemptionEntries.position)).all();
          const redemption = historicalRedemptionFromRows(redemptionRow, entryRows);
          const snapshot = decisionFromRow({
            id: candidate.decisionId,
            merchantId: candidate.decisionMerchantId,
            customerRef: candidate.decisionCustomerRef,
            customerVersion: candidate.customerVersion,
            schemaVersion: candidate.schemaVersion,
            requestJson: candidate.requestJson,
            factsJson: candidate.factsJson,
            decisionsJson: candidate.decisionsJson,
            mode: candidate.mode,
            submittedCodesJson: candidate.submittedCodesJson,
            codeResultsJson: candidate.codeResultsJson,
            requestDigest: candidate.requestDigest,
            correlationId: candidate.correlationId,
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
          const everyEntryMatches = redemption.entries.every(entry => (
            snapshot.decisions.some(decision => (
              decision.outcome === 'qualified'
              && decision.commitRequired
              && decision.programRef === entry.programRef
              && decision.programRevision === entry.programRevision
              && decision.rewardRuleRef === entry.rewardRuleRef
              && canonicalJson(decision.effects) === canonicalJson(entry.effects)
            ))
          ));
          if (redemption.evaluationId !== snapshot.evaluationId || !everyEntryMatches) {
            throw new Error('Redemption does not match a qualified decision snapshot');
          }
          if (redemption.entries.some(entry => entry.programRef === parsedProgramRef)) count += 1;
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
