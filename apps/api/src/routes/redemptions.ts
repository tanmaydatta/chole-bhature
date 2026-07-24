import { Hono } from 'hono';
import type { Context } from 'hono';

import { requireSecretScope } from '../auth/api-credentials.js';
import type { AppEnvironment } from '../env.js';
import { ContextValidationError } from '../errors.js';
import { createRedemptionService } from '../services/redemption-service.js';

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

export function createRedemptionRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();
  routes.post('/', requireSecretScope('redemptions:write'), async (context) => {
    const service = createRedemptionService(
      context.get('repositories'),
      context.get('atomicRedemptions'),
      context.env,
    );
    return context.json(await service.redeem(
      context.get('merchantId'),
      await requestJson(context),
      context.get('correlationId'),
    ));
  });
  return routes;
}
