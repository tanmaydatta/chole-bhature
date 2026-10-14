import { RuntimeCapabilitiesResponseSchema } from '@incentives/contracts';
import { Hono } from 'hono';

import { requireSecretScope } from '../auth/api-credentials.js';
import type { AppEnvironment } from '../env.js';

export function createRuntimeCapabilitiesRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();
  routes.get('/', requireSecretScope('schema:read'), context => {
    const configured = context.env.APP_ENV;
    const environment = configured === 'local' || configured === 'staging'
      || configured === 'production' || configured === 'ci' ? configured : 'unknown';
    const response = RuntimeCapabilitiesResponseSchema.parse({
      environment, simulatorAllowed: environment === 'local' || environment === 'staging',
    });
    context.header('Cache-Control', 'no-store');
    return context.json(response);
  });
  return routes;
}
