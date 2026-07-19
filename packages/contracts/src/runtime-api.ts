import { PromoProgramSchema } from './programs.js';
import { VariableDefinitionSchema } from './variables.js';
import { z } from './zod.js';

const UnknownObjectSchema = z.record(z.string(), z.unknown());

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
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
export type SchemaDefinitionView = z.infer<typeof SchemaDefinitionViewSchema>;
