import { Hono } from 'hono';
import type { Context } from 'hono';

import { requireSecret } from '../auth/static-token.js';
import type { AppEnvironment } from '../env.js';
import { ContextValidationError } from '../errors.js';
import { createProgramService } from '../services/program-service.js';

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

export function createProgramRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.get('/', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.list(context.get('merchantId')));
  });

  routes.post('/', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.create(
      context.get('merchantId'),
      await requestJson(context),
    ), 201);
  });

  routes.get('/:externalRef', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.get(
      context.get('merchantId'),
      context.req.param('externalRef'),
    ));
  });

  routes.patch('/:externalRef', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.update(
      context.get('merchantId'),
      context.req.param('externalRef'),
      await requestJson(context),
    ));
  });

  return routes;
}
