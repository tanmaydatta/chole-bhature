import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const merchants = sqliteTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

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
}, table => [
  uniqueIndex('variable_definitions_merchant_version_key_unique').on(
    table.merchantId,
    table.schemaVersion,
    table.key,
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
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('programs_merchant_external_ref_unique').on(
    table.merchantId,
    table.externalRef,
  ),
]);

export const evaluationDecisions = sqliteTable('evaluation_decisions', {
  id: text('id').primaryKey(),
  merchantId: text('merchant_id').notNull().references(() => merchants.id),
  customerRef: text('customer_ref'),
  customerVersion: integer('customer_version'),
  schemaVersion: integer('schema_version').notNull(),
  requestJson: text('request_json').notNull(),
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
export type EvaluationDecisionRow = typeof evaluationDecisions.$inferSelect;
export type RedemptionRow = typeof redemptions.$inferSelect;
