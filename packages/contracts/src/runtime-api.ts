import { ProgramLifecycleSchema, PromoProgramSchema } from './programs.js';
import { EvaluationRequestSchema } from './evaluation.js';
import { OperatorCallContextSchema } from './operator.js';
import { VariableDefinitionSchema } from './variables.js';
import { z } from './zod.js';

const UnknownObjectSchema = z.record(z.string(), z.unknown());

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
}).strict();

export const OperatorEvaluationRequestSchema = z.object({
  operatorContext: OperatorCallContextSchema,
  request: EvaluationRequestSchema,
}).strict();

export const AccessSummarySchema = z.object({
  merchantId: z.string().min(1),
  correlationId: z.string().min(1),
  repositories: z.boolean(),
}).strict();

export const SchemaDefinitionViewSchema = z.object({
  id: z.string().min(1),
  definition: VariableDefinitionSchema,
  readOnly: z.boolean(),
  referenced: z.boolean(),
}).strict();

export const SchemaDefinitionsResponseSchema = z.object({
  definitions: z.array(SchemaDefinitionViewSchema),
  draftVersion: z.number().int().positive().optional(),
  publishedVersion: z.number().int().positive().optional(),
}).strict();

export const PublishedSchemaResponseSchema = z.object({
  version: z.number().int().positive(),
  publishedAt: z.iso.datetime({ offset: true }),
  definitions: z.array(VariableDefinitionSchema),
  jsonSchema: UnknownObjectSchema,
  sample: UnknownObjectSchema,
}).strict();

export const SchemaLifecycleWarningSchema = z.object({
  code: z.enum(['REQUIRED_LIVE_FIELD', 'ENUM_VALUE_ADDED']),
  message: z.string().min(1),
}).strict();

export const SchemaDefinitionImpactPreviewSchema = z.object({
  publishedVersions: z.array(z.number().int().positive()),
  referencedProgramRefs: z.array(z.string().min(1)),
  storedCustomerCount: z.number().int().nonnegative(),
  incompatibleCustomerCount: z.number().int().nonnegative(),
  warnings: z.array(SchemaLifecycleWarningSchema),
}).strict();

export const SchemaPublicationResultSchema = PublishedSchemaResponseSchema.extend({
  warnings: z.array(SchemaLifecycleWarningSchema),
}).strict();

export const ProgramPublicationWarningSchema = z.object({
  code: z.literal('OVERLAPPING_REWARD_RULES'),
  message: z.string().min(1),
}).strict();

export const ProgramPublicationResultSchema = ProgramLifecycleSchema.extend({
  warnings: z.array(ProgramPublicationWarningSchema),
}).strict();

export const CustomerPatchRequestSchema = z.object({
  attributes: UnknownObjectSchema,
  expectedVersion: z.number().int().positive().optional(),
}).strict();

export const CustomerRecordSchema = z.object({
  externalRef: z.string().min(1),
  attributes: UnknownObjectSchema,
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const ProgramListResponseSchema = z.object({
  programs: z.array(PromoProgramSchema),
}).strict();

export const OpenApiDocumentResponseSchema = UnknownObjectSchema;

export type CustomerPatchRequest = z.infer<typeof CustomerPatchRequestSchema>;
export type CustomerRecord = z.infer<typeof CustomerRecordSchema>;
export type PublishedSchemaResponse = z.infer<typeof PublishedSchemaResponseSchema>;
export type ProgramPublicationResult = z.infer<typeof ProgramPublicationResultSchema>;
export type ProgramPublicationWarning = z.infer<typeof ProgramPublicationWarningSchema>;
export type SchemaDefinitionImpactPreview = z.infer<
  typeof SchemaDefinitionImpactPreviewSchema
>;
export type SchemaDefinitionView = z.infer<typeof SchemaDefinitionViewSchema>;
export type SchemaLifecycleWarning = z.infer<typeof SchemaLifecycleWarningSchema>;
export type SchemaPublicationResult = z.infer<typeof SchemaPublicationResultSchema>;
export type OperatorEvaluationRequest = z.infer<typeof OperatorEvaluationRequestSchema>;
