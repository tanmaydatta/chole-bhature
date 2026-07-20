import { Hono } from 'hono';

import {
  publishablePreflight,
  requirePublishableScope,
} from '../auth/api-credentials.js';
import type { AppEnvironment } from '../env.js';
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
