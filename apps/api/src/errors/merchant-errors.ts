export class MerchantIdentityConflictError extends Error {
  readonly code = 'CONFLICT';
  readonly retryable = false;
}
