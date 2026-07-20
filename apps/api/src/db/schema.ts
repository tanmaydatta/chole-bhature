import { desc, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  provisioningId: text('provisioning_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
}, table => [
  uniqueIndex('merchants_provisioning_id_unique')
    .on(table.provisioningId)
    .where(sql`${table.provisioningId} IS NOT NULL`),
]);

export const variableDefinitions = sqliteTable('variable_definitions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  schemaVersion: integer('schema_version').notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  source: text('source').notNull(),
  type: text('type').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull(),
  enumValuesJson: text('enum_values_json'),
  description: text('description'),
  defaultErrorMessage: text('default_error_message'),
  state: text('state').notNull(),
  createdAt: text('created_at').notNull(),
  deprecatedAt: text('deprecated_at'),
  deprecatedBy: text('deprecated_by'),
}, table => [
  uniqueIndex('variable_definitions_merchant_version_key_unique').on(
    table.merchantId,
    table.schemaVersion,
    table.key,
  ),
  check(
    'variable_definitions_state_valid',
    sql`${table.state} IN ('draft', 'published', 'deprecated')`,
  ),
  check(
    'variable_definitions_deprecation_invariant',
    sql`(${table.state} = 'deprecated' AND ${table.deprecatedAt} IS NOT NULL AND ${table.deprecatedBy} IS NOT NULL) OR (${table.state} <> 'deprecated' AND ${table.deprecatedAt} IS NULL AND ${table.deprecatedBy} IS NULL)`,
  ),
]);

export const schemaVersions = sqliteTable('schema_versions', {
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  version: integer('version').notNull(),
  state: text('state').notNull(),
  publishedAt: text('published_at'),
  definitionsJson: text('definitions_json').notNull(),
}, table => [
  primaryKey({ columns: [table.merchantId, table.version] }),
]);

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  externalRef: text('external_ref').notNull(),
  attributesJson: text('attributes_json').notNull(),
  version: integer('version').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('customers_merchant_external_ref_unique').on(
    table.merchantId,
    table.externalRef,
  ),
]);

export const programs = sqliteTable('programs', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  externalRef: text('external_ref').notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull(),
  configJson: text('config_json').notNull(),
  priority: integer('priority').notNull(),
  maxUses: integer('max_uses'),
  usageCount: integer('usage_count').notNull().default(0),
  budgetRemaining: integer('budget_remaining'),
  activeRevision: integer('active_revision'),
  draftRevision: integer('draft_revision'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('programs_merchant_external_ref_unique').on(
    table.merchantId,
    table.externalRef,
  ),
  uniqueIndex('programs_merchant_id_unique').on(table.merchantId, table.id),
  check(
    'programs_active_revision_positive',
    sql`${table.activeRevision} IS NULL OR ${table.activeRevision} > 0`,
  ),
  check(
    'programs_draft_revision_positive',
    sql`${table.draftRevision} IS NULL OR ${table.draftRevision} > 0`,
  ),
]);

export const programRevisions = sqliteTable('program_revisions', {
  programId: text('program_id').notNull(),
  merchantId: text('merchant_id').notNull(),
  revision: integer('revision').notNull(),
  configJson: text('config_json').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  publishedAt: text('published_at'),
  publishedBy: text('published_by'),
}, table => [
  primaryKey({ columns: [table.merchantId, table.programId, table.revision] }),
  foreignKey({
    columns: [table.merchantId, table.programId],
    foreignColumns: [programs.merchantId, programs.id],
  }).onDelete('cascade'),
  check('program_revisions_revision_positive', sql`${table.revision} > 0`),
  check(
    'program_revisions_publication_pair',
    sql`(${table.publishedAt} IS NULL) = (${table.publishedBy} IS NULL)`,
  ),
  index('program_revisions_merchant_program_created_index').on(
    table.merchantId,
    table.programId,
    table.createdAt,
  ),
]);

export const programCounters = sqliteTable('program_counters', {
  programId: text('program_id').notNull(),
  merchantId: text('merchant_id').notNull(),
  maxUses: integer('max_uses'),
  usageCount: integer('usage_count').notNull().default(0),
  budgetRemaining: integer('budget_remaining'),
}, table => [
  primaryKey({ columns: [table.merchantId, table.programId] }),
  foreignKey({
    columns: [table.merchantId, table.programId],
    foreignColumns: [programs.merchantId, programs.id],
  }).onDelete('cascade'),
  check('program_counters_max_uses_positive', sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`),
  check('program_counters_usage_nonnegative', sql`${table.usageCount} >= 0`),
  check(
    'program_counters_usage_within_cap',
    sql`${table.maxUses} IS NULL OR ${table.usageCount} <= ${table.maxUses}`,
  ),
  check(
    'program_counters_budget_nonnegative',
    sql`${table.budgetRemaining} IS NULL OR ${table.budgetRemaining} >= 0`,
  ),
]);

export const apiCredentials = sqliteTable('api_credentials', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  name: text('name').notNull(),
  environment: text('environment').notNull(),
  kind: text('kind').notNull(),
  scopesJson: text('scopes_json').notNull(),
  digest: text('digest').notNull(),
  suffix: text('suffix').notNull(),
  status: text('status').notNull().default('active'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  revokedBy: text('revoked_by'),
}, table => [
  uniqueIndex('api_credentials_digest_unique').on(table.digest),
  uniqueIndex('api_credentials_merchant_id_unique').on(table.merchantId, table.id),
  index('api_credentials_merchant_created_at_index').on(
    table.merchantId,
    table.createdAt,
    table.id,
  ),
  check(
    'api_credentials_environment_valid',
    sql`${table.environment} IN ('local', 'staging', 'production')`,
  ),
  check('api_credentials_kind_valid', sql`${table.kind} IN ('publishable', 'secret')`),
  check(
    'api_credentials_status_valid',
    sql`${table.status} IN ('active', 'revoked', 'expired')`,
  ),
  check(
    'api_credentials_revoked_status_timestamp',
    sql`(${table.status} = 'revoked') = (${table.revokedAt} IS NOT NULL)`,
  ),
  check(
    'api_credentials_revocation_pair',
    sql`(${table.revokedAt} IS NULL) = (${table.revokedBy} IS NULL)`,
  ),
]);

export const productAudit = sqliteTable('product_audit', {
  id: text('id').primaryKey(),
  occurredAt: text('occurred_at').notNull(),
  actorKind: text('actor_kind').notNull(),
  actorId: text('actor_id').notNull(),
  merchantId: text('merchant_id').references(() => merchants.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  outcome: text('outcome').notNull(),
  correlationId: text('correlation_id').notNull(),
  metadataJson: text('metadata_json'),
}, table => [
  index('product_audit_merchant_occurred_index').on(
    table.merchantId,
    desc(table.occurredAt),
    table.id,
  ),
  index('product_audit_correlation_index').on(table.correlationId),
  check(
    'product_audit_actor_kind_valid',
    sql`${table.actorKind} IN ('root', 'member', 'credential', 'system')`,
  ),
  check(
    'product_audit_outcome_valid',
    sql`${table.outcome} IN ('succeeded', 'failed', 'denied')`,
  ),
]);

export const evaluationDecisions = sqliteTable('evaluation_decisions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  customerRef: text('customer_ref'),
  customerVersion: integer('customer_version'),
  schemaVersion: integer('schema_version').notNull(),
  requestJson: text('request_json').notNull(),
  factsJson: text('facts_json').notNull(),
  decisionsJson: text('decisions_json').notNull(),
  integrityHash: text('integrity_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('evaluation_decisions_merchant_id_id_unique').on(table.merchantId, table.id),
  foreignKey({
    columns: [table.merchantId, table.schemaVersion],
    foreignColumns: [schemaVersions.merchantId, schemaVersions.version],
  }),
  foreignKey({
    columns: [table.merchantId, table.customerRef],
    foreignColumns: [customers.merchantId, customers.externalRef],
  }),
]);

export const redemptions = sqliteTable('redemptions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  externalOrderRef: text('external_order_ref'),
  idempotencyKey: text('idempotency_key'),
  evaluationId: text('evaluation_id').notNull(),
  resultJson: text('result_json').notNull(),
  discountMinorUnits: integer('discount_minor_units').notNull(),
  currency: text('currency').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  check(
    'redemptions_identifier_required',
    sql`${table.externalOrderRef} IS NOT NULL OR ${table.idempotencyKey} IS NOT NULL`,
  ),
  uniqueIndex('redemptions_merchant_external_order_ref_unique')
    .on(table.merchantId, table.externalOrderRef)
    .where(sql`${table.externalOrderRef} IS NOT NULL`),
  uniqueIndex('redemptions_merchant_idempotency_key_unique')
    .on(table.merchantId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  foreignKey({
    columns: [table.merchantId, table.evaluationId],
    foreignColumns: [evaluationDecisions.merchantId, evaluationDecisions.id],
  }),
]);

export type MerchantRow = typeof merchants.$inferSelect;
export type VariableDefinitionRow = typeof variableDefinitions.$inferSelect;
export type SchemaVersionRow = typeof schemaVersions.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type ProgramRow = typeof programs.$inferSelect;
export type ProgramRevisionRow = typeof programRevisions.$inferSelect;
export type ProgramCounterRow = typeof programCounters.$inferSelect;
export type ApiCredentialRow = typeof apiCredentials.$inferSelect;
export type ProductAuditRow = typeof productAudit.$inferSelect;
export type EvaluationDecisionRow = typeof evaluationDecisions.$inferSelect;
export type RedemptionRow = typeof redemptions.$inferSelect;
