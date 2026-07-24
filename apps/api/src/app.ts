import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { AppEnvironment } from './env.js';
import {
  apiErrorResponse,
  CORRELATION_ID_HEADER,
  NotFoundError,
} from './errors.js';
import { createD1AtomicRedemptionCoordinator } from './redemption/d1-atomic-redemption-coordinator.js';
import { createRepositories } from './repositories/d1-repositories.js';
import { createCustomerRoutes } from './routes/customers.js';
import { createEvaluationRoutes } from './routes/evaluate.js';
import { createOpenApiRoutes } from './routes/openapi.js';
import { createRedemptionRoutes } from './routes/redemptions.js';
import { createSchemaRoutes } from './routes/schemas.js';

const correlationId: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  const supplied = context.req.header(CORRELATION_ID_HEADER)?.trim();
  const id = supplied === undefined || supplied.length === 0
    ? crypto.randomUUID()
    : supplied;

  context.set('correlationId', id);
  try {
    await next();
  } finally {
    context.header(CORRELATION_ID_HEADER, id);
  }
};

const requestScope: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  context.set('repositories', createRepositories(context.env));
  context.set('atomicRedemptions', createD1AtomicRedemptionCoordinator(context.env));
  await next();
};

export function createApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use('*', correlationId);
  app.use('*', requestScope);
  app.onError((error, context) => apiErrorResponse(context, error));
  app.notFound((context) => apiErrorResponse(context, new NotFoundError()));

  app.get('/v1/health', (context) => context.json({ status: 'ok' }));
  app.route('/v1/customers', createCustomerRoutes());
  app.route('/v1/schema', createSchemaRoutes());
  app.route('/v1/evaluate', createEvaluationRoutes());
  app.route('/v1/redemptions', createRedemptionRoutes());
  app.route('/v1/openapi.json', createOpenApiRoutes());

  return app;
}
