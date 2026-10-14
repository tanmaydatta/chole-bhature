import { randomUUID } from 'node:crypto';
import { ApiErrorSchema } from '@incentives/contracts';

export type Phase = 'configuration' | 'capabilities' | 'schema' | 'customer-read' | 'customer-upsert' | 'fixture-evaluate'
  | 'customer-update' | 'evaluate' | 'stale-evaluate' | 'redeem' | 'retry' | 'capture'
  | 'stale-redemption' | 'exhausted' | 'reprice';
export interface Diagnostic { phase: Phase; status?: number; code?: string; correlationId?: string }
const SAFE_API_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'SCHEMA_NOT_PUBLISHED',
  'CONTEXT_VALIDATION_FAILED', 'VERSION_CONFLICT', 'EXHAUSTED', 'DECISION_EXPIRED',
  'EVALUATION_UNAVAILABLE', 'RATE_LIMITED', 'INVALID_REQUEST', 'INVALID_PROMO_CODE',
  'USAGE_CAP_EXHAUSTED', 'BUDGET_EXHAUSTED', 'PER_CUSTOMER_CAP_EXHAUSTED']);
export class SimulatorError extends Error {
  constructor(readonly phase: Phase, readonly code: string, readonly status?: number, readonly correlationId?: string) {
    super(`Simulator ${phase} refused: ${code}`); this.name = 'SimulatorError';
  }
  diagnostic(): Diagnostic {
    return { phase: this.phase, code: this.code,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.correlationId === undefined ? {} : { correlationId: this.correlationId }) };
  }
}
export function approvedOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new SimulatorError('configuration', 'INVALID_CONFIG');
  try {
    const url = new URL(value);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password
      || url.search || url.hash || url.pathname !== '/' || (value !== url.origin && value !== `${url.origin}/`)) throw Error('invalid');
    return url.origin;
  } catch { throw new SimulatorError('configuration', 'INVALID_CONFIG'); }
}
async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw Error('missing body');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1_048_576) { await reader.cancel(); throw Error('oversized response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export class PublicClient {
  readonly #origin: string; readonly #key: string;
  constructor(origin: string, key: string, private readonly trace: Diagnostic[]) {
    this.#origin = approvedOrigin(origin);
    if (typeof key !== 'string' || !/^sk_[A-Za-z0-9_-]{32,256}$/u.test(key)) throw new SimulatorError('configuration', 'INVALID_CONFIG');
    this.#key = key;
  }
  async request<T>(phase: Phase, method: 'GET' | 'PATCH' | 'POST', pathname: string,
    schema: { parse(value: unknown): T }, body?: unknown): Promise<T> {
    const url = new URL(pathname, this.#origin);
    if (!pathname.startsWith('/v1/') || url.origin !== this.#origin || url.search || url.hash) throw new SimulatorError(phase, 'INVALID_CONFIG');
    const correlationId = randomUUID(); let response: Response;
    try {
      response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${this.#key}`, 'x-correlation-id': correlationId,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new SimulatorError(phase, 'TRANSPORT_UNAVAILABLE'); }
    if ((response.status >= 300 && response.status < 400) || new URL(response.url).origin !== this.#origin) {
      await response.body?.cancel(); throw new SimulatorError(phase, 'REDIRECT_REFUSED', response.status);
    }
    let value: unknown;
    try { value = await boundedJson(response); } catch { throw new SimulatorError(phase, 'INVALID_RESPONSE', response.status); }
    // Only our generated UUID may enter diagnostics; server messages/fields never do.
    const acceptedCorrelation = response.headers.get('x-correlation-id') === correlationId ? correlationId : undefined;
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(value);
      const code = parsed.success && SAFE_API_CODES.has(parsed.data.error.code) ? parsed.data.error.code : 'API_FAILURE';
      const failure = new SimulatorError(phase, code, response.status, acceptedCorrelation);
      this.trace.push(failure.diagnostic()); throw failure;
    }
    let result: T;
    try { result = schema.parse(value); } catch { throw new SimulatorError(phase, 'INVALID_RESPONSE', response.status, acceptedCorrelation); }
    this.trace.push({ phase, status: response.status, ...(acceptedCorrelation === undefined ? {} : { correlationId: acceptedCorrelation }) });
    return result;
  }
}
