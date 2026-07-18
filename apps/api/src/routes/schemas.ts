import { Hono } from 'hono';

import { requirePublishable, requireSecret } from '../auth/static-token.js';
import type { AppEnvironment } from '../env.js';
import { createSchemaService } from '../services/schema-service.js';

export function createSchemaRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.get('/definitions', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.list(context.get('merchantId')));
  });

  routes.post('/definitions', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(
      await service.create(context.get('merchantId'), await context.req.json<unknown>()),
      201,
    );
  });

  routes.patch('/definitions/:id', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.update(
      context.get('merchantId'),
      context.req.param('id'),
      await context.req.json<unknown>(),
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
