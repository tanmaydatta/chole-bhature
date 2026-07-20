import { Hono } from 'hono';
import type { Context } from 'hono';
import type { OperatorCallContext } from '@incentives/contracts';

import { requireSecret } from '../auth/api-credentials.js';
import { requireOperatorContext } from '../auth/operator-context.js';
import type { AppEnvironment, Env } from '../env.js';
import { ContextValidationError } from '../errors.js';
import { createRepositories } from '../repositories/d1-repositories.js';
import { createProgramService } from '../services/program-service.js';

async function requestJson(context: Context<AppEnvironment>): Promise<unknown> {
  try {
    return await context.req.json<unknown>();
  } catch {
    throw new ContextValidationError('The request body must be valid JSON');
  }
}

export function createProgramRoutes(): Hono<AppEnvironment> {
  const routes = new Hono<AppEnvironment>();

  routes.get('/', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.list(context.get('merchantId')));
  });

  routes.post('/', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.create(
      context.get('merchantId'),
      await requestJson(context),
    ), 201);
  });

  routes.get('/:externalRef', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.get(
      context.get('merchantId'),
      context.req.param('externalRef'),
    ));
  });

  routes.patch('/:externalRef', requireSecret, async (context) => {
    const service = createProgramService(context.get('repositories'));
    return context.json(await service.update(
      context.get('merchantId'),
      context.req.param('externalRef'),
      await requestJson(context),
    ));
  });

  return routes;
}

function operatorProgramService(
  env: Env,
  context: OperatorCallContext,
  permission: 'programs:read' | 'programs:manage' | 'programs:publish',
) {
  const operator = requireOperatorContext(context, permission);
  return {
    operator,
    service: createProgramService(createRepositories(env)),
  };
}

export async function createProgramDraft(
  env: Env,
  context: OperatorCallContext,
  input: unknown,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:manage');
  return service.createDraft(operator.merchantId, input);
}

export async function getProgram(
  env: Env,
  context: OperatorCallContext,
  externalRef: string,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:read');
  return service.get(operator.merchantId, externalRef);
}

export async function listPrograms(env: Env, context: OperatorCallContext) {
  const { operator, service } = operatorProgramService(env, context, 'programs:read');
  return service.list(operator.merchantId);
}

export async function updateProgramDraft(
  env: Env,
  context: OperatorCallContext,
  externalRef: string,
  input: unknown,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:manage');
  return service.updateDraft(operator.merchantId, externalRef, input);
}

export async function publishProgram(
  env: Env,
  context: OperatorCallContext,
  externalRef: string,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:publish');
  return service.publish(operator.merchantId, externalRef, operator.actorUserId);
}

export async function pauseProgram(
  env: Env,
  context: OperatorCallContext,
  externalRef: string,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:manage');
  return service.pause(operator.merchantId, externalRef);
}

export async function resumeProgram(
  env: Env,
  context: OperatorCallContext,
  externalRef: string,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:manage');
  return service.resume(operator.merchantId, externalRef);
}

export async function endProgram(
  env: Env,
  context: OperatorCallContext,
  externalRef: string,
) {
  const { operator, service } = operatorProgramService(env, context, 'programs:manage');
  return service.end(operator.merchantId, externalRef);
}
