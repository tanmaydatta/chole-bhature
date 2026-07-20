import {
  ApiErrorSchema,
  type ApiError,
  type ApiFieldError,
} from '@incentives/contracts';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import type { AppEnvironment } from './env.js';
import {
  OptimisticVersionConflictError,
  ProgramConflictError,
  SchemaRevisionConflictError,
} from './repositories/types.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

abstract class ApiFailure extends Error {
  abstract readonly code: string;
  abstract readonly status: ContentfulStatusCode;
  readonly retryable: boolean = false;
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

export class RateLimitError extends ApiFailure {
  override readonly name = 'RateLimitError';
  readonly code = 'RATE_LIMITED';
  readonly status = 429;
  override readonly retryable = true;

  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests for this publishable credential');
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

export class VersionConflictError extends ApiFailure {
  override readonly name = 'VersionConflictError';
  readonly code = 'VERSION_CONFLICT';
  readonly status = 409;

  constructor(message = 'The redemption identifiers or decision version conflict') {
    super(message);
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

export class ContextValidationError extends ApiFailure {
  override readonly name = 'ContextValidationError';
  readonly code = 'CONTEXT_VALIDATION_FAILED';
  readonly status = 400;

  constructor(message: string, readonly fields?: ApiFieldError[]) {
    super(message);
  }
}

export class CredentialPolicyError extends ApiFailure {
  override readonly name = 'CredentialPolicyError';
  readonly code = 'CREDENTIAL_POLICY_FAILED';
  readonly status = 400;

  constructor() {
    super('Credential policy validation failed');
  }
}

interface MappedFailure {
  status: ContentfulStatusCode;
  error: ApiError['error'];
}

function fieldErrors(error: z.ZodError): ApiFieldError[] {
  return error.issues.flatMap((issue): ApiFieldError[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map(key => ({
        path: [...issue.path, key].map(String).join('.'),
        code: issue.code,
        message: `Unrecognized key: ${key}`,
      }));
    }
    return [{
      path: issue.path.length === 0 ? '$' : issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    }];
  });
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

  if (
    error instanceof OptimisticVersionConflictError
    || error instanceof SchemaRevisionConflictError
  ) {
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

  if (error instanceof ProgramConflictError) {
    return {
      status: 409,
      error: {
        code: 'PROGRAM_CONFLICT',
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
        ...(error instanceof ContextValidationError && error.fields !== undefined
          ? { fields: error.fields }
          : {}),
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
    ...(error instanceof RateLimitError
      ? { 'Retry-After': String(error.retryAfterSeconds) }
      : {}),
  });
}
