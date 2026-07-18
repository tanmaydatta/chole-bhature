import { Hono } from 'hono';
import type { Context } from 'hono';

import { requirePublishable, requireSecret } from '../auth/static-token.js';
import type { AppEnvironment } from '../env.js';
import { ContextValidationError } from '../errors.js';
import { createSchemaService } from '../services/schema-service.js';

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

export function createSchemaRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.get('/definitions', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.list(context.get('merchantId')));
  });

  routes.post('/definitions', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(
      await service.create(context.get('merchantId'), await requestJson(context)),
      201,
    );
  });

  routes.patch('/definitions/:id', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.update(
      context.get('merchantId'),
      context.req.param('id'),
      await requestJson(context),
    ));
  });

  routes.delete('/definitions/:id', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    await service.delete(context.get('merchantId'), context.req.param('id'));
    return context.body(null, 204);
  });

  routes.post('/publish', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.publish(context.get('merchantId')), 201);
  });

  routes.get('/published', requirePublishable, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.published(context.get('merchantId')));
  });

  return routes;
}
