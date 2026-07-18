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
import { VariableDefinitionSchema } from './variables.js';

const jsonContent = <T>(schema: T) => ({
  'application/json': { schema },
});

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export function buildOpenApiDocument(): OpenApiDocument {
  const registry = new OpenAPIRegistry();

  registry.register('Money', MoneySchema);
  registry.register('VariableDefinition', VariableDefinitionSchema);
  registry.register('Effect', EffectSchema);
  const evaluationRequest = registry.register('EvaluationRequest', EvaluationRequestSchema);
  const evaluationResponse = registry.register('EvaluationResponse', EvaluationResponseSchema);
  const redemptionRequest = registry.register('RedemptionRequest', RedemptionRequestSchema);
  const redemptionResponse = registry.register('RedemptionResponse', RedemptionResponseSchema);
  const apiError = registry.register('ApiError', ApiErrorSchema);
  registry.register('PromoProgram', PromoProgramSchema);

  registry.registerPath({
    method: 'post',
    path: '/v1/evaluate',
    summary: 'Evaluate configured incentive programs',
    request: {
      body: {
        required: true,
        content: jsonContent(evaluationRequest),
      },
    },
    responses: {
      200: {
        description: 'Structured incentive decisions',
        content: jsonContent(evaluationResponse),
      },
      400: {
        description: 'Invalid evaluation request',
        content: jsonContent(apiError),
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/redemptions',
    summary: 'Commit a selected incentive decision',
    request: {
      body: {
        required: true,
        content: jsonContent(redemptionRequest),
      },
    },
    responses: {
      200: {
        description: 'Idempotently committed redemption',
        content: jsonContent(redemptionResponse),
      },
      409: {
        description: 'Decision conflict or exhausted capacity',
        content: jsonContent(apiError),
      },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Incentives Core API',
      version: '1.0.0',
    },
  });
}
