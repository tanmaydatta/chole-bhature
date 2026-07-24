import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  publishablePreflight,
  requirePublishableScope,
} from '../auth/api-credentials.js';
import type { AppEnvironment } from '../env.js';
import { ContextValidationError } from '../errors.js';
import { createEvaluationService } from '../services/evaluation-service.js';

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

export function createEvaluationRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.options('/', publishablePreflight(
    'evaluations:write',
    'POST',
    ['Authorization', 'Content-Type'],
  ));
  routes.post('/', requirePublishableScope('evaluations:write'), async (context) => {
    const service = createEvaluationService(context.get('repositories'), context.env);
    return context.json(await service.evaluate(
      context.get('merchantId'),
      await requestJson(context),
      context.get('correlationId'),
    ));
  });

  return routes;
}
