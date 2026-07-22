import {
  OperatorSchemaDefinitionRequestSchema,
  PublishedSchemaResponseSchema,
  SchemaDefinitionImpactPreviewSchema,
  SchemaDefinitionViewSchema,
  SchemaDefinitionsResponseSchema,
  SchemaPublicationResultSchema,
} from '@incentives/contracts';

import { EmptyBodySchema, NullSchema, requiredParam, type ProtectedRoute } from './types.js';

export const schemaRoutes: readonly ProtectedRoute[] = [
  {
    method: 'GET', pattern: /^\/operator\/v1\/schema\/published$/u,
    permission: 'schemas:read', responseSchema: PublishedSchemaResponseSchema,
    downstream: 'core',
    invoke: context => context.env.CORE.getPublishedSchema(context.operator),
  },
  {
    method: 'GET', pattern: /^\/operator\/v1\/schema\/definitions$/u,
    permission: 'schemas:read', responseSchema: SchemaDefinitionsResponseSchema,
    downstream: 'core',
    invoke: context => context.env.CORE.listSchemaDefinitions(context.operator),
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/schema\/definitions$/u,
    permission: 'schemas:manage', bodySchema: OperatorSchemaDefinitionRequestSchema,
    downstream: 'core',
    responseSchema: SchemaDefinitionViewSchema, status: 201,
    invoke: context => context.env.CORE.createSchemaDefinition(
      context.operator, OperatorSchemaDefinitionRequestSchema.parse(context.body),
    ),
    validateOutput(value, context) {
      const output = SchemaDefinitionViewSchema.parse(value);
      const input = OperatorSchemaDefinitionRequestSchema.parse(context.body);
      if (output.definition.key !== input.key) {
        throw new Error('Schema definition response did not match its request');
      }
    },
  },
  {
    method: 'PUT', pattern: /^\/operator\/v1\/schema\/definitions\/([^/]+)$/u,
    parameterNames: ['definitionId'], permission: 'schemas:manage',
    downstream: 'core',
    bodySchema: OperatorSchemaDefinitionRequestSchema, responseSchema: SchemaDefinitionViewSchema,
    invoke: context => context.env.CORE.updateSchemaDefinition(
      context.operator,
      requiredParam(context, 'definitionId'),
      OperatorSchemaDefinitionRequestSchema.parse(context.body),
    ),
    validateOutput(value, context) {
      if (SchemaDefinitionViewSchema.parse(value).id !== requiredParam(context, 'definitionId')) {
        throw new Error('Schema definition response did not match its request');
      }
    },
  },
  {
    method: 'DELETE', pattern: /^\/operator\/v1\/schema\/definitions\/([^/]+)$/u,
    parameterNames: ['definitionId'], permission: 'schemas:manage', responseSchema: NullSchema,
    downstream: 'core',
    invoke: context => context.env.CORE.deleteSchemaDefinition(
      context.operator, requiredParam(context, 'definitionId'),
    ),
  },
  {
    method: 'GET', pattern: /^\/operator\/v1\/schema\/definitions\/([^/]+)\/impact$/u,
    parameterNames: ['definitionId'], permission: 'schemas:read',
    downstream: 'core',
    responseSchema: SchemaDefinitionImpactPreviewSchema,
    invoke: context => context.env.CORE.previewSchemaDefinitionImpact(
      context.operator, requiredParam(context, 'definitionId'),
    ),
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/schema\/definitions\/([^/]+)\/deprecate$/u,
    parameterNames: ['definitionId'], permission: 'schemas:manage',
    downstream: 'core',
    bodySchema: EmptyBodySchema, responseSchema: NullSchema,
    invoke: context => context.env.CORE.deprecateSchemaDefinition(
      context.operator, requiredParam(context, 'definitionId'),
    ),
  },
  {
    method: 'POST', pattern: /^\/operator\/v1\/schema\/publish$/u,
    permission: 'schemas:publish', bodySchema: EmptyBodySchema,
    downstream: 'core',
    responseSchema: SchemaPublicationResultSchema,
    invoke: context => context.env.CORE.publishSchema(context.operator),
  },
];
