import { Hono } from 'hono';
import {
  SchemaDefinitionImpactPreviewSchema,
  SchemaPublicationResultSchema,
  type OperatorCallContext,
} from '@incentives/contracts';

import { requireOperatorContext } from '../auth/operator-context.js';
import {
  publishablePreflight,
  requirePublishableScope,
} from '../auth/api-credentials.js';
import type { AppEnvironment, Env } from '../env.js';
import { createRepositories } from '../repositories/d1-repositories.js';
import { createSchemaService } from '../services/schema-service.js';

export function createSchemaRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.options('/published', publishablePreflight(
    'schema:read',
    'GET',
    ['Authorization'],
  ));
  routes.get('/published', requirePublishableScope('schema:read'), async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.published(context.get('merchantId')));
  });

  return routes;
}

function operatorSchemaService(
  env: Env,
  context: OperatorCallContext,
  permission: 'schemas:read' | 'schemas:manage' | 'schemas:publish',
) {
  const operator = requireOperatorContext(context, permission);
  return {
    operator,
    service: createSchemaService(createRepositories(env)),
  };
}

export async function listSchemaDefinitions(env: Env, context: OperatorCallContext) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:read');
  return service.list(operator.merchantId);
}

export async function createSchemaDefinition(
  env: Env,
  context: OperatorCallContext,
  input: unknown,
) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:manage');
  return service.create(operator.merchantId, input);
}

export async function updateSchemaDefinition(
  env: Env,
  context: OperatorCallContext,
  definitionId: string,
  input: unknown,
) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:manage');
  return service.update(operator.merchantId, definitionId, input);
}

export async function deleteSchemaDefinition(
  env: Env,
  context: OperatorCallContext,
  definitionId: string,
) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:manage');
  return service.delete(operator.merchantId, definitionId);
}

export async function previewSchemaDefinitionImpact(
  env: Env,
  context: OperatorCallContext,
  definitionId: string,
) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:read');
  return SchemaDefinitionImpactPreviewSchema.parse(
    await service.impact(operator.merchantId, definitionId),
  );
}

export async function deprecateSchemaDefinition(
  env: Env,
  context: OperatorCallContext,
  definitionId: string,
) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:manage');
  return service.deprecate(operator.merchantId, definitionId, operator.actorUserId);
}

export async function publishSchema(env: Env, context: OperatorCallContext) {
  const { operator, service } = operatorSchemaService(env, context, 'schemas:publish');
  return SchemaPublicationResultSchema.parse(
    await service.publishForOperator(operator.merchantId),
  );
}
