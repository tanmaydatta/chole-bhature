import { BffClientError } from '../lib/bff-client';

export function ErrorState({
  error,
  retry,
  forceRetry = false,
  retryLabel = 'Try again',
}: {
  error: BffClientError;
  retry?: () => void;
  forceRetry?: boolean;
  retryLabel?: string;
}) {
  const permissionDenied = error.status === 403;
  return (
    <div role="alert" className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-5">
      <p className="font-semibold">
        {permissionDenied ? 'You do not have permission to view this page.' : error.message}
      </p>
      <p className="mt-2 text-[12px] text-[var(--muted)]">Code: {error.code}</p>
      <p className="mt-1 text-[12px] text-[var(--muted)]">Retryable: {error.retryable ? 'yes' : 'no'}</p>
      <p className="mt-2 text-[12px] text-[var(--muted)]">Correlation: {error.correlationId}</p>
      {(error.retryable || forceRetry) && retry && (
        <button type="button" className="mt-3 rounded-[7px] bg-[var(--accent)] px-3 py-2 text-white" onClick={retry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
