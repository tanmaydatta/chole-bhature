import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

import { ApiErrorSchema } from './errors.js';
import {
  EffectSchema,
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  RedemptionRequestSchema,
  RedemptionResponseSchema,
} from './evaluation.js';
import { MoneySchema } from './money.js';
import { PromoProgramSchema } from './programs.js';
import {
  AccessSummarySchema,
  CustomerPatchRequestSchema,
  CustomerRecordSchema,
  HealthResponseSchema,
  OpenApiDocumentResponseSchema,
  ProgramListResponseSchema,
  PublishedSchemaResponseSchema,
  SchemaDefinitionViewSchema,
  SchemaDefinitionsResponseSchema,
} from './runtime-api.js';
import { VariableDefinitionSchema } from './variables.js';

const jsonContent = <T>(schema: T) => ({
  'application/json': { schema },
});

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'publishableBearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'Publishable static token. Secret tokens are also accepted on publishable routes.',
  });
  registry.registerComponent('securitySchemes', 'secretBearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'Secret static token for configuration, customer writes, and redemptions.',
  });

  registry.register('Money', MoneySchema);
  const variableDefinition = registry.register('VariableDefinition', VariableDefinitionSchema);
  registry.register('Effect', EffectSchema);
  const evaluationRequest = registry.register('EvaluationRequest', EvaluationRequestSchema);
  const evaluationResponse = registry.register('EvaluationResponse', EvaluationResponseSchema);
  const redemptionRequest = registry.register('RedemptionRequest', RedemptionRequestSchema);
  const redemptionResponse = registry.register('RedemptionResponse', RedemptionResponseSchema);
  const apiError = registry.register('ApiError', ApiErrorSchema);
  const promoProgram = registry.register('PromoProgram', PromoProgramSchema);
  const healthResponse = registry.register('HealthResponse', HealthResponseSchema);
  const accessSummary = registry.register('AccessSummary', AccessSummarySchema);
  const definitionView = registry.register('SchemaDefinitionView', SchemaDefinitionViewSchema);
  const definitionsResponse = registry.register(
    'SchemaDefinitionsResponse',
    SchemaDefinitionsResponseSchema,
  );
  const publishedSchema = registry.register(
    'PublishedSchemaResponse',
    PublishedSchemaResponseSchema,
  );
  const customerPatch = registry.register('CustomerPatchRequest', CustomerPatchRequestSchema);
  const customerRecord = registry.register('CustomerRecord', CustomerRecordSchema);
  const programList = registry.register('ProgramListResponse', ProgramListResponseSchema);
  const openApiDocument = registry.register(
    'OpenApiDocument',
    OpenApiDocumentResponseSchema,
  );

  const publishableSecurity = [
    { publishableBearer: [] },
    { secretBearer: [] },
  ];
  const secretSecurity = [{ secretBearer: [] }];
  const errorResponse = (description: string) => ({
    description,
    content: jsonContent(apiError),
  });
  const errors = {
    400: errorResponse('Request or typed context validation failed'),
    401: errorResponse('Missing or invalid bearer token'),
    403: errorResponse('The bearer token does not have secret access'),
    404: errorResponse('The merchant-scoped resource was not found'),
    409: errorResponse('The requested mutation conflicts or capacity is exhausted'),
    410: errorResponse('The evaluation decision has expired'),
    503: errorResponse('The runtime is temporarily unavailable; inspect retryable'),
  };
  const pathParameter = (name: string, description: string) => ({
    name,
    in: 'path' as const,
    required: true,
    description,
    schema: { type: 'string' as const, minLength: 1 },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/health',
    summary: 'Check runtime health',
    responses: {
      200: { description: 'Runtime is available', content: jsonContent(healthResponse) },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/openapi.json',
    summary: 'Fetch this generated OpenAPI document',
    responses: {
      200: { description: 'Canonical generated OpenAPI document', content: jsonContent(openApiDocument) },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/test-publishable',
    summary: 'Verify publishable-or-secret credential access',
    security: publishableSecurity,
    responses: {
      200: { description: 'Resolved request scope', content: jsonContent(accessSummary) },
      401: errors[401],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/test-secret',
    summary: 'Verify secret credential access',
    security: secretSecurity,
    responses: {
      200: { description: 'Resolved request scope', content: jsonContent(accessSummary) },
      401: errors[401],
      403: errors[403],
      503: errors[503],
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/schema/definitions',
    summary: 'List editable and built-in typed fields',
    security: secretSecurity,
    responses: {
      200: { description: 'Schema definitions and revision versions', content: jsonContent(definitionsResponse) },
      401: errors[401],
      403: errors[403],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/schema/definitions',
    summary: 'Create a typed field in the current draft',
    security: secretSecurity,
    request: { body: { required: true, content: jsonContent(variableDefinition) } },
    responses: {
      201: { description: 'Draft field created', content: jsonContent(definitionView) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: errors[409],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/schema/definitions/{id}',
    summary: 'Replace a typed draft field definition',
    security: secretSecurity,
    request: {
      body: { required: true, content: jsonContent(variableDefinition) },
    },
    parameters: [pathParameter('id', 'Definition identifier returned by the list/create API')],
    responses: {
      200: { description: 'Draft field replaced', content: jsonContent(definitionView) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/v1/schema/definitions/{id}',
    summary: 'Delete an unreferenced typed draft field',
    security: secretSecurity,
    parameters: [pathParameter('id', 'Definition identifier returned by the list/create API')],
    responses: {
      204: { description: 'Draft field deleted' },
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/schema/publish',
    summary: 'Publish the current immutable schema version',
    security: secretSecurity,
    responses: {
      201: { description: 'Schema version published', content: jsonContent(publishedSchema) },
      401: errors[401],
      403: errors[403],
      409: errors[409],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/schema/published',
    summary: 'Fetch the active typed schema, JSON Schema, and sample',
    security: publishableSecurity,
    responses: {
      200: { description: 'Current published schema', content: jsonContent(publishedSchema) },
      401: errors[401],
      404: errors[404],
      503: errors[503],
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/customers/{customerRef}',
    summary: 'Fetch the latest stored customer attributes',
    security: secretSecurity,
    parameters: [pathParameter('customerRef', 'Opaque client customer reference')],
    responses: {
      200: { description: 'Stored customer record', content: jsonContent(customerRecord) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/customers/{customerRef}',
    summary: 'Replace all stored customer attributes with optimistic versioning',
    security: secretSecurity,
    parameters: [pathParameter('customerRef', 'Opaque client customer reference')],
    request: { body: { required: true, content: jsonContent(customerPatch) } },
    responses: {
      200: { description: 'Created or replaced customer record', content: jsonContent(customerRecord) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      503: errors[503],
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/programs',
    summary: 'List Promo programs',
    security: secretSecurity,
    responses: {
      200: { description: 'Merchant Promo programs', content: jsonContent(programList) },
      401: errors[401],
      403: errors[403],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/programs',
    summary: 'Create a validated Promo program',
    security: secretSecurity,
    request: { body: { required: true, content: jsonContent(promoProgram) } },
    responses: {
      201: { description: 'Promo program created', content: jsonContent(promoProgram) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      409: errors[409],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/programs/{externalRef}',
    summary: 'Fetch a Promo program',
    security: secretSecurity,
    parameters: [pathParameter('externalRef', 'Immutable Promo program reference')],
    responses: {
      200: { description: 'Promo program', content: jsonContent(promoProgram) },
      401: errors[401],
      403: errors[403],
      404: errors[404],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/v1/programs/{externalRef}',
    summary: 'Replace an editable draft Promo program',
    security: secretSecurity,
    parameters: [pathParameter('externalRef', 'Immutable Promo program reference')],
    request: { body: { required: true, content: jsonContent(promoProgram) } },
    responses: {
      200: { description: 'Promo program replaced', content: jsonContent(promoProgram) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      503: errors[503],
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/evaluate',
    summary: 'Evaluate configured incentive programs',
    security: publishableSecurity,
    request: { body: { required: true, content: jsonContent(evaluationRequest) } },
    responses: {
      200: { description: 'Structured incentive decisions', content: jsonContent(evaluationResponse) },
      400: errors[400],
      401: errors[401],
      404: errors[404],
      503: errors[503],
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/v1/redemptions',
    summary: 'Commit a selected qualified incentive decision',
    security: secretSecurity,
    request: { body: { required: true, content: jsonContent(redemptionRequest) } },
    responses: {
      200: { description: 'Idempotently committed redemption', content: jsonContent(redemptionResponse) },
      400: errors[400],
      401: errors[401],
      403: errors[403],
      404: errors[404],
      409: errors[409],
      410: errors[410],
      503: errors[503],
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Incentives Core API',
      version: '1.0.0',
      description: 'Platform-neutral runtime API for typed customer data, Promo evaluation, and redemption.',
    },
  });
}
