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
  logApiFailure,
  type ApiFailureDependency,
} from './observability.js';
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
  readonly dependency: ApiFailureDependency | undefined = undefined;
}

export class AuthorizedPromoCodeConflictError extends ApiFailure {
  override readonly name = 'PromoCodeConflictError';
  readonly code = 'PROMO_CODE_CONFLICT';
  readonly status = 409;

  constructor(readonly conflictingProgramRef: string) {
    super(`PROMO_CODE_CONFLICT:${JSON.stringify({ conflictingProgramRef })}`);
  }
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

export type ExhaustionErrorCode =
  | 'EXHAUSTED'
  | 'USAGE_CAP_EXHAUSTED'
  | 'BUDGET_EXHAUSTED'
  | 'PER_CUSTOMER_CAP_EXHAUSTED';

export class ExhaustedError extends ApiFailure {
  override readonly name = 'ExhaustedError';
  readonly status = 409;

  constructor(readonly code: ExhaustionErrorCode = 'EXHAUSTED') {
    super('The incentive is no longer available');
  }
}

export class NothingToCommitError extends ApiFailure {
  override readonly name = 'NothingToCommitError';
  readonly code = 'NOTHING_TO_COMMIT';
  readonly status = 409;

  constructor() {
    super('The evaluation contains no selected committable decision');
  }
}

export class EvaluationPipelineError extends Error {
  override readonly name = 'EvaluationPipelineError';

  constructor(
    readonly dependency: ApiFailureDependency | undefined,
    cause: unknown,
  ) {
    super('Evaluation pipeline failed', { cause });
  }
}

export class RedemptionUnavailableError extends ApiFailure {
  override readonly name = 'RedemptionUnavailableError';
  readonly code = 'REDEMPTION_UNAVAILABLE';
  readonly status = 503;
  override readonly retryable = true;

  constructor(
    override readonly dependency: ApiFailureDependency | undefined = undefined,
  ) {
    super('The redemption coordinator is temporarily unavailable');
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

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

function safeIdentifier(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_IDENTIFIER.test(value) ? value : undefined;
}

function safeRoute(path: string): string {
  if (path === '/v1/evaluate' || path.startsWith('/v1/evaluate/')) {
    return '/v1/evaluate';
  }
  if (path === '/v1/redemptions' || path.startsWith('/v1/redemptions/')) {
    return '/v1/redemptions';
  }
  if (path === '/v1/customers' || path.startsWith('/v1/customers/')) {
    return '/v1/customers';
  }
  if (path === '/v1/schema' || path.startsWith('/v1/schema/')) {
    return '/v1/schema';
  }
  if (path === '/v1/health') return '/v1/health';
  if (path === '/v1/openapi.json') return '/v1/openapi.json';
  return '/unknown';
}

function safeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'].includes(normalized)
    ? normalized
    : 'UNKNOWN';
}

function failureDependency(error: unknown): ApiFailureDependency | undefined {
  return error instanceof ApiFailure || error instanceof EvaluationPipelineError
    ? error.dependency
    : undefined;
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

  if (error instanceof AuthorizedPromoCodeConflictError) {
    return {
      status: error.status,
      error: {
        code: error.code,
        message: `This code overlaps published Promo ${JSON.stringify(
          error.conflictingProgramRef,
        )}`,
        correlationId,
        retryable: error.retryable,
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
  const route = safeRoute(context.req.path);
  const merchantId = safeIdentifier(context.get('merchantId'));
  const credentialId = safeIdentifier(context.get('credentialId'));
  const dependency = failureDependency(error);

  logApiFailure({
    event: 'api_request_failed',
    correlationId,
    route,
    method: safeMethod(context.req.method),
    code: mapped.error.code,
    status: mapped.status,
    retryable: mapped.error.retryable,
    ...(merchantId === undefined ? {} : { merchantId }),
    ...(credentialId === undefined ? {} : { credentialId }),
    ...(dependency === undefined ? {} : { dependency }),
  });

  return context.json(body, mapped.status, {
    [CORRELATION_ID_HEADER]: correlationId,
    ...(error instanceof RateLimitError
      ? { 'Retry-After': String(error.retryAfterSeconds) }
      : {}),
  });
}
