import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { requireSecret } from '../src/auth/api-credentials.js';
import type { AppEnvironment } from '../src/env.js';
import {
  apiErrorResponse,
  CORRELATION_ID_HEADER,
  ContextValidationError,
  NotFoundError,
} from '../src/errors.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import { createProgramRoutes } from '../src/routes/programs.js';
import { createSchemaService } from '../src/services/schema-service.js';

const correlationId: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  context.set('correlationId', context.req.header(CORRELATION_ID_HEADER) ?? crypto.randomUUID());
  try {
    await next();
  } finally {
    context.header(CORRELATION_ID_HEADER, context.get('correlationId'));
  }
};

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

function createOperatorAuthoringApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();
  app.use('*', correlationId);
  app.use('*', async (context, next) => {
    context.set('repositories', createRepositories(context.env));
    await next();
  });
  app.onError((error, context) => apiErrorResponse(context, error));
  app.notFound((context) => apiErrorResponse(context, new NotFoundError()));

  app.route('/v1/programs', createProgramRoutes());
  app.get('/v1/schema/definitions', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.list(context.get('merchantId')));
  });
  app.post('/v1/schema/definitions', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(
      await service.create(context.get('merchantId'), await requestJson(context)),
      201,
    );
  });
  app.patch('/v1/schema/definitions/:id', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.update(
      context.get('merchantId'),
      context.req.param('id'),
      await requestJson(context),
    ));
  });
  app.delete('/v1/schema/definitions/:id', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    await service.delete(context.get('merchantId'), context.req.param('id'));
    return context.body(null, 204);
  });
  app.post('/v1/schema/publish', requireSecret, async (context) => {
    const service = createSchemaService(context.get('repositories'));
    return context.json(await service.publish(context.get('merchantId')), 201);
  });
  return app;
}

const operatorAuthoringApp = createOperatorAuthoringApp();

export function operatorAuthoringRequest(
  request: Request,
  env: AppEnvironment['Bindings'],
): Promise<Response> {
  return operatorAuthoringApp.request(request, undefined, env);
}
