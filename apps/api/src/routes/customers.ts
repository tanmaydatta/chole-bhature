import { Hono } from 'hono';
import type { Context } from 'hono';

import { requireSecretScope } from '../auth/api-credentials.js';
import type { AppEnvironment } from '../env.js';
import { ContextValidationError } from '../errors.js';
import { createCustomerService } from '../services/customer-service.js';

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

export function createCustomerRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.get('/:customerRef', requireSecretScope('customers:write'), async (context) => {
    const service = createCustomerService(context.get('repositories'));
    return context.json(await service.get(
      context.get('merchantId'),
      context.req.param('customerRef'),
    ));
  });

  routes.patch('/:customerRef', requireSecretScope('customers:write'), async (context) => {
    const service = createCustomerService(context.get('repositories'));
    return context.json(await service.upsert(
      context.get('merchantId'),
      context.req.param('customerRef'),
      await requestJson(context),
    ));
  });

  return routes;
}
