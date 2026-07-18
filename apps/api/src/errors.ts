import {
  ApiErrorSchema,
  type ApiError,
  type ApiFieldError,
} from '@incentives/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type { AppEnvironment } from './env.js';
import { OptimisticVersionConflictError } from './repositories/types.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

abstract class ApiFailure extends Error {
  abstract readonly code: string;
  abstract readonly status: ContentfulStatusCode;
  readonly retryable = false;
}

export class UnauthorizedError extends ApiFailure {
  override readonly name = 'UnauthorizedError';
  readonly code = 'UNAUTHORIZED';
  readonly status = 401;

  constructor() {
    super('A valid API credential is required');
  }
}

export class ForbiddenError extends ApiFailure {
  override readonly name = 'ForbiddenError';
  readonly code = 'FORBIDDEN';
  readonly status = 403;

  constructor() {
    super('This credential cannot access the requested resource');
  }
}

export class NotFoundError extends ApiFailure {
  override readonly name = 'NotFoundError';
  readonly status = 404;

  constructor(
    message = 'The requested resource was not found',
    readonly code = 'NOT_FOUND',
  ) {
    super(message);
  }
}

export class DecisionExpiredError extends ApiFailure {
  override readonly name = 'DecisionExpiredError';
  readonly code = 'DECISION_EXPIRED';
  readonly status = 410;

  constructor() {
    super('The incentive decision has expired');
  }
}

export class ExhaustedError extends ApiFailure {
  override readonly name = 'ExhaustedError';
  readonly code = 'EXHAUSTED';
  readonly status = 409;

  constructor() {
    super('The incentive is no longer available');
  }
}

export class SchemaConflictError extends ApiFailure {
  override readonly name = 'SchemaConflictError';
  readonly code = 'SCHEMA_CONFLICT';
  readonly status = 409;

  constructor(message: string) {
    super(message);
  }
}

interface MappedFailure {
  status: ContentfulStatusCode;
  error: ApiError['error'];
}

function fieldErrors(error: z.ZodError): ApiFieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? '$' : issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function mapFailure(error: unknown, correlationId: string): MappedFailure {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      error: {
        code: 'CONTEXT_VALIDATION_FAILED',
        message: 'The request context failed validation',
        correlationId,
        retryable: false,
        fields: fieldErrors(error),
      },
    };
  }

  if (error instanceof OptimisticVersionConflictError) {
    return {
      status: 409,
      error: {
        code: 'VERSION_CONFLICT',
        message: error.message,
        correlationId,
        retryable: false,
      },
    };
  }

  if (error instanceof ApiFailure) {
    return {
      status: error.status,
      error: {
        code: error.code,
        message: error.message,
        correlationId,
        retryable: error.retryable,
      },
    };
  }

  return {
    status: 503,
    error: {
      code: 'EVALUATION_UNAVAILABLE',
      message: 'The evaluation service is temporarily unavailable',
      correlationId,
      retryable: true,
    },
  };
}

export function apiErrorResponse(
  context: Context<AppEnvironment>,
  error: unknown,
): Response {
  const correlationId = context.get('correlationId') || crypto.randomUUID();
  const mapped = mapFailure(error, correlationId);
  const body = ApiErrorSchema.parse({ error: mapped.error });

  return context.json(body, mapped.status, {
    [CORRELATION_ID_HEADER]: correlationId,
  });
}
