import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { requirePublishable, requireSecret, SEEDED_MERCHANT_ID } from './auth/static-token.js';
import type { AppEnvironment } from './env.js';
import {
  apiErrorResponse,
  CORRELATION_ID_HEADER,
  NotFoundError,
} from './errors.js';
import { createRepositories } from './repositories/d1-repositories.js';
import { createCustomerRoutes } from './routes/customers.js';
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
  context.set('merchantId', SEEDED_MERCHANT_ID);
  context.set('repositories', createRepositories(context.env));
  await next();
};

function contextSummary(context: Context<AppEnvironment>) {
  return context.json({
    merchantId: context.get('merchantId'),
    correlationId: context.get('correlationId'),
    repositories: context.get('repositories') !== undefined,
  });
}

export function createApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use('*', correlationId);
  app.use('*', requestScope);
  app.onError((error, context) => apiErrorResponse(context, error));
  app.notFound((context) => apiErrorResponse(context, new NotFoundError()));

  app.get('/v1/health', (context) => context.json({ status: 'ok' }));
  app.get('/v1/test-publishable', requirePublishable, contextSummary);
  app.get('/v1/test-secret', requireSecret, contextSummary);
  app.route('/v1/customers', createCustomerRoutes());
  app.route('/v1/schema', createSchemaRoutes());

  return app;
}
