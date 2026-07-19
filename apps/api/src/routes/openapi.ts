import { buildOpenApiDocument } from '@incentives/contracts';
import { Hono } from 'hono';

import type { AppEnvironment } from '../env.js';

export function createOpenApiRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();
  routes.get('/', (context) => context.json(buildOpenApiDocument()));
  return routes;
}
