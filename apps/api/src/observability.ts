export type ApiFailureDependency =
  | 'atomic_redemption'
  | 'd1'
  | 'decision_integrity';

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
  console.error(JSON.stringify(input));
}
