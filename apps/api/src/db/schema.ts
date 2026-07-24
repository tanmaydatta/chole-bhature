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
  committedSpend: integer('committed_spend').notNull().default(0),
}, table => [
  primaryKey({ columns: [table.merchantId, table.programId] }),
  foreignKey({
    columns: [table.merchantId, table.programId],
    foreignColumns: [programs.merchantId, programs.id],
  }).onDelete('cascade'),
  check('program_counters_max_uses_positive', sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`),
  check('program_counters_usage_nonnegative', sql`${table.usageCount} >= 0`),
  check('program_counters_committed_spend_nonnegative', sql`${table.committedSpend} >= 0`),
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
  allowedOriginsJson: text('allowed_origins_json').notNull().default('[]'),
  requestsPerMinute: integer('requests_per_minute'),
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
  check(
    'api_credentials_rate_policy_valid',
    sql`(${table.kind} = 'publishable' AND ${table.requestsPerMinute} BETWEEN 1 AND 10000) OR (${table.kind} = 'secret' AND ${table.requestsPerMinute} IS NULL)`,
  ),
]);

export const credentialRateLimitWindows = sqliteTable('credential_rate_limit_windows', {
  credentialId: text('credential_id').primaryKey().references(
    () => apiCredentials.id,
    { onDelete: 'cascade' },
  ),
  windowStartedAt: integer('window_started_at').notNull(),
  requestCount: integer('request_count').notNull(),
}, table => [
  check(
    'credential_rate_limit_windows_start_nonnegative',
    sql`${table.windowStartedAt} >= 0`,
  ),
  check(
    'credential_rate_limit_windows_start_aligned',
    sql`${table.windowStartedAt} % 60000 = 0`,
  ),
  check(
    'credential_rate_limit_windows_count_positive',
    sql`${table.requestCount} > 0`,
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
  mode: text('mode').notNull().default('automatic'),
  submittedCodesJson: text('submitted_codes_json').notNull().default('[]'),
  codeResultsJson: text('code_results_json').notNull().default('[]'),
  requestDigest: text('request_digest').notNull().default('legacy:unknown'),
  correlationId: text('correlation_id').notNull().default('migration:unknown'),
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
  check('evaluation_decisions_mode_valid', sql`${table.mode} IN ('automatic', 'coded')`),
  check(
    'evaluation_decisions_submitted_codes_json_valid',
    sql`json_valid(${table.submittedCodesJson}) AND json_type(${table.submittedCodesJson}) = 'array'`,
  ),
  check(
    'evaluation_decisions_code_results_json_valid',
    sql`json_valid(${table.codeResultsJson}) AND json_type(${table.codeResultsJson}) = 'array'`,
  ),
  check(
    'evaluation_decisions_request_digest_nonempty',
    sql`length(${table.requestDigest}) > 0`,
  ),
  check(
    'evaluation_decisions_correlation_id_nonempty',
    sql`length(${table.correlationId}) > 0`,
  ),
  index('evaluation_decisions_merchant_created_index').on(
    table.merchantId,
    table.createdAt,
    table.id,
  ),
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
  requestDigest: text('request_digest').notNull().default('legacy:unknown'),
}, table => [
  check(
    'redemptions_identifier_required',
    sql`${table.externalOrderRef} IS NOT NULL OR ${table.idempotencyKey} IS NOT NULL`,
  ),
  check('redemptions_request_digest_nonempty', sql`length(${table.requestDigest}) > 0`),
  uniqueIndex('redemptions_merchant_external_order_ref_unique')
    .on(table.merchantId, table.externalOrderRef)
    .where(sql`${table.externalOrderRef} IS NOT NULL`),
  uniqueIndex('redemptions_merchant_idempotency_key_unique')
    .on(table.merchantId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  uniqueIndex('redemptions_merchant_id_unique').on(table.merchantId, table.id),
  index('redemptions_merchant_evaluation_index').on(
    table.merchantId,
    table.evaluationId,
    table.createdAt,
    table.id,
  ),
  foreignKey({
    columns: [table.merchantId, table.evaluationId],
    foreignColumns: [evaluationDecisions.merchantId, evaluationDecisions.id],
  }),
]);

export const promoCodeClaims = sqliteTable('promo_code_claims', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  programId: text('program_id').notNull(),
  programRef: text('program_ref').notNull(),
  activeRevision: integer('active_revision').notNull(),
  displayCode: text('display_code').notNull(),
  normalizedCode: text('normalized_code').notNull(),
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  releasedAt: text('released_at'),
  createdAt: text('created_at').notNull(),
}, table => [
  foreignKey({
    columns: [table.merchantId, table.programId],
    foreignColumns: [programs.merchantId, programs.id],
  }).onDelete('cascade'),
  foreignKey({
    columns: [table.merchantId, table.programId, table.activeRevision],
    foreignColumns: [
      programRevisions.merchantId,
      programRevisions.programId,
      programRevisions.revision,
    ],
  }).onDelete('cascade'),
  check('promo_code_claims_revision_positive', sql`${table.activeRevision} > 0`),
  check('promo_code_claims_display_code_nonempty', sql`length(${table.displayCode}) > 0`),
  check(
    'promo_code_claims_normalized_code_nonempty',
    sql`length(${table.normalizedCode}) > 0`,
  ),
  index('promo_code_claims_lookup').on(
    table.merchantId,
    table.normalizedCode,
    table.releasedAt,
  ),
  index('promo_code_claims_program_index').on(
    table.merchantId,
    table.programId,
    table.activeRevision,
  ),
]);

export const redemptionOperations = sqliteTable('redemption_operations', {
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  idempotencyKey: text('idempotency_key').notNull(),
  externalOrderRef: text('external_order_ref').notNull(),
  evaluationId: text('evaluation_id').notNull(),
  requestDigest: text('request_digest').notNull(),
  state: text('state').notNull(),
  terminalErrorCode: text('terminal_error_code'),
  retryable: integer('retryable', { mode: 'boolean' }),
  redemptionId: text('redemption_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.merchantId, table.idempotencyKey] }),
  foreignKey({
    columns: [table.merchantId, table.evaluationId],
    foreignColumns: [evaluationDecisions.merchantId, evaluationDecisions.id],
  }),
  foreignKey({
    columns: [table.merchantId, table.redemptionId],
    foreignColumns: [redemptions.merchantId, redemptions.id],
  }),
  check(
    'redemption_operations_state_valid',
    sql`${table.state} IN ('pending', 'committed', 'rejected')`,
  ),
  check(
    'redemption_operations_idempotency_key_nonempty',
    sql`length(${table.idempotencyKey}) > 0`,
  ),
  check(
    'redemption_operations_external_order_ref_nonempty',
    sql`length(${table.externalOrderRef}) > 0`,
  ),
  check(
    'redemption_operations_request_digest_nonempty',
    sql`length(${table.requestDigest}) > 0`,
  ),
  check(
    'redemption_operations_terminal_state_valid',
    sql`(
      ${table.state} = 'pending'
      AND ${table.terminalErrorCode} IS NULL
      AND ${table.retryable} IS NULL
      AND ${table.redemptionId} IS NULL
    ) OR (
      ${table.state} = 'committed'
      AND ${table.terminalErrorCode} IS NULL
      AND ${table.retryable} IS NULL
      AND ${table.redemptionId} IS NOT NULL
    ) OR (
      ${table.state} = 'rejected'
      AND ${table.terminalErrorCode} IS NOT NULL
      AND ${table.retryable} = 0
      AND ${table.redemptionId} IS NULL
    )`,
  ),
  uniqueIndex('redemption_operations_merchant_external_order_unique').on(
    table.merchantId,
    table.externalOrderRef,
  ),
  index('redemption_operations_merchant_evaluation_index').on(
    table.merchantId,
    table.evaluationId,
    table.state,
  ),
]);

export const redemptionEntries = sqliteTable('redemption_entries', {
  merchantId: text('merchant_id').notNull(),
  redemptionId: text('redemption_id').notNull(),
  position: integer('position').notNull(),
  programRef: text('program_ref').notNull(),
  programRevision: integer('program_revision').notNull(),
  rewardRuleRef: text('reward_rule_ref'),
  effectsJson: text('effects_json').notNull(),
  discountMinorUnits: integer('discount_minor_units').notNull(),
  currency: text('currency').notNull(),
}, table => [
  primaryKey({ columns: [table.redemptionId, table.position] }),
  foreignKey({
    columns: [table.merchantId, table.redemptionId],
    foreignColumns: [redemptions.merchantId, redemptions.id],
  }).onDelete('cascade'),
  check('redemption_entries_position_nonnegative', sql`${table.position} >= 0`),
  check('redemption_entries_revision_positive', sql`${table.programRevision} > 0`),
  check(
    'redemption_entries_program_ref_nonempty',
    sql`length(${table.programRef}) > 0`,
  ),
  check(
    'redemption_entries_effects_json_valid',
    sql`json_valid(${table.effectsJson}) AND json_type(${table.effectsJson}) = 'array'`,
  ),
  check(
    'redemption_entries_discount_nonnegative',
    sql`${table.discountMinorUnits} >= 0`,
  ),
  check(
    'redemption_entries_currency_valid',
    sql`${table.currency} GLOB '[A-Z][A-Z][A-Z]' AND length(${table.currency}) = 3`,
  ),
  index('redemption_entries_merchant_redemption_order_index').on(
    table.merchantId,
    table.redemptionId,
    table.position,
  ),
  index('redemption_entries_merchant_program_counts_index').on(
    table.merchantId,
    table.programRef,
    table.redemptionId,
    table.position,
  ),
]);

export const redemptionCommitGuards = sqliteTable('redemption_commit_guards', {
  redemptionId: text('redemption_id').notNull(),
  position: integer('position').notNull(),
  changedRows: integer('changed_rows').notNull(),
}, table => [
  primaryKey({ columns: [table.redemptionId, table.position] }),
  check('redemption_commit_guards_changed_once', sql`${table.changedRows} = 1`),
]);

export type MerchantRow = typeof merchants.$inferSelect;
export type VariableDefinitionRow = typeof variableDefinitions.$inferSelect;
export type SchemaVersionRow = typeof schemaVersions.$inferSelect;
export type CustomerRow = typeof customers.$inferSelect;
export type ProgramRow = typeof programs.$inferSelect;
export type ProgramRevisionRow = typeof programRevisions.$inferSelect;
export type ProgramCounterRow = typeof programCounters.$inferSelect;
export type ApiCredentialRow = typeof apiCredentials.$inferSelect;
export type CredentialRateLimitWindowRow = typeof credentialRateLimitWindows.$inferSelect;
export type ProductAuditRow = typeof productAudit.$inferSelect;
export type EvaluationDecisionRow = typeof evaluationDecisions.$inferSelect;
export type RedemptionRow = typeof redemptions.$inferSelect;
export type PromoCodeClaimRow = typeof promoCodeClaims.$inferSelect;
export type RedemptionOperationRow = typeof redemptionOperations.$inferSelect;
export type RedemptionEntryRow = typeof redemptionEntries.$inferSelect;
