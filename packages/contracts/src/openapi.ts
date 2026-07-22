import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

import { ApiErrorSchema } from './errors.js';
import { AffiliateProgramSchema } from './affiliate-program.js';
import {
  EffectSchema,
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  RedemptionRequestSchema,
  RedemptionResponseSchema,
} from './evaluation.js';
import { LoyaltyProgramSchema } from './loyalty-program.js';
import { MoneySchema } from './money.js';
import { PromoProgramSchema } from './programs.js';
import { ReferralProgramSchema } from './referral-program.js';
import {
  CommerceRewardSchema,
  PromoRewardRuleSchema,
} from './reward-rules.js';
import {
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
    description: 'Merchant publishable credential. Scoped secret credentials are also accepted.',
  });
  registry.registerComponent('securitySchemes', 'secretBearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'Merchant secret credential for scoped customer, evaluation, and redemption access.',
  });
  registry.registerComponent('headers', 'CorrelationId', {
    description: 'Request correlation identifier returned by the runtime',
    schema: { type: 'string', minLength: 1 },
  });
  registry.registerComponent('parameters', 'CustomerRef', {
    name: 'customerRef',
    in: 'path',
    required: true,
    description: 'Opaque client customer reference',
    schema: { type: 'string', minLength: 1 },
  });

  registry.register('Money', MoneySchema);
  registry.register('VariableDefinition', VariableDefinitionSchema);
  registry.register('Effect', EffectSchema);
  registry.register('CommerceReward', CommerceRewardSchema);
  registry.register('RewardRule', PromoRewardRuleSchema);
  const evaluationRequest = registry.register('EvaluationRequest', EvaluationRequestSchema);
  const evaluationResponse = registry.register('EvaluationResponse', EvaluationResponseSchema);
  const redemptionRequest = registry.register('RedemptionRequest', RedemptionRequestSchema);
  const redemptionResponse = registry.register('RedemptionResponse', RedemptionResponseSchema);
  const apiError = registry.register('ApiError', ApiErrorSchema);
  registry.register('PromoProgram', PromoProgramSchema);
  registry.register('AffiliateProgram', AffiliateProgramSchema);
  registry.register('ReferralProgram', ReferralProgramSchema);
  registry.register('LoyaltyProgram', LoyaltyProgramSchema);
  const healthResponse = registry.register('HealthResponse', HealthResponseSchema);
  registry.register('SchemaDefinitionView', SchemaDefinitionViewSchema);
  registry.register(
    'SchemaDefinitionsResponse',
    SchemaDefinitionsResponseSchema,
  );
  const publishedSchema = registry.register(
    'PublishedSchemaResponse',
    PublishedSchemaResponseSchema,
  );
  const customerPatch = registry.register('CustomerPatchRequest', CustomerPatchRequestSchema);
  const customerRecord = registry.register('CustomerRecord', CustomerRecordSchema);
  registry.register('ProgramListResponse', ProgramListResponseSchema);
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
    headers: {
      'x-correlation-id': { $ref: '#/components/headers/CorrelationId' },
    },
  });
  const errors = {
    400: errorResponse('Request or typed context validation failed'),
    401: errorResponse('Missing or invalid bearer token'),
    403: errorResponse('The bearer token does not have secret access'),
    404: errorResponse('The merchant-scoped resource was not found'),
    409: errorResponse('The requested mutation conflicts or capacity is exhausted'),
    410: errorResponse('The evaluation decision has expired'),
    429: errorResponse('The publishable credential request quota is exhausted'),
    503: errorResponse('The runtime is temporarily unavailable; inspect retryable'),
  };
  const customerRef = { $ref: '#/components/parameters/CustomerRef' };

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
    path: '/v1/schema/published',
    summary: 'Fetch the active typed schema, JSON Schema, and sample',
    security: publishableSecurity,
    responses: {
      200: { description: 'Current published schema', content: jsonContent(publishedSchema) },
      401: errors[401],
      404: errors[404],
      429: errors[429],
      503: errors[503],
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/v1/customers/{customerRef}',
    summary: 'Fetch the latest stored customer attributes',
    security: secretSecurity,
    parameters: [customerRef],
    responses: {
      200: { description: 'Stored customer record', content: jsonContent(customerRecord) },
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
    parameters: [customerRef],
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
      429: errors[429],
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
