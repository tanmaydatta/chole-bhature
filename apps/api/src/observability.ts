import type { RepositoryDependency } from './repositories/types.js';

export type ApiFailureDependency =
  | 'atomic_redemption'
  | 'decision_integrity'
  | RepositoryDependency;

export interface ApiFailureLog {
  event: 'api_request_failed';
  correlationId: string;
  route: string;
  method: string;
  code: string;
  status: number;
  retryable: boolean;
  merchantId?: string;
  credentialId?: string;
  dependency?: ApiFailureDependency;
}

export function logApiFailure(input: ApiFailureLog): void {
  const event: ApiFailureLog = {
    event: input.event,
    correlationId: input.correlationId,
    route: input.route,
    method: input.method,
    code: input.code,
    status: input.status,
    retryable: input.retryable,
    ...(input.merchantId === undefined ? {} : { merchantId: input.merchantId }),
    ...(input.credentialId === undefined ? {} : { credentialId: input.credentialId }),
    ...(input.dependency === undefined ? {} : { dependency: input.dependency }),
  };
  console.error(JSON.stringify(event));
}
