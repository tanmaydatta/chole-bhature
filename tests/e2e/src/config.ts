import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const RunIdSchema = z.string().regex(/^e2e_[a-f0-9]{24}$/u);
export type RunId = z.infer<typeof RunIdSchema>;

export interface Target {
  kind: 'local' | 'staging';
  operatorOrigin: string;
  apiOrigin: string;
}

function exactOrigin(value: string, label: string): string {
  const parsed = new URL(value);
  if (parsed.origin !== value) throw new Error(`${label} must be an exact origin`);
  return value;
}

export function loadTarget(env: NodeJS.ProcessEnv): Target {
  const kind = env.E2E_TARGET ?? 'local';
  if (kind !== 'local' && kind !== 'staging') {
    throw new Error('E2E_TARGET must be local or staging');
  }
  if (kind === 'staging') {
    if (env.E2E_ENABLE_STAGING !== '1') {
      throw new Error('Staging automation requires E2E_ENABLE_STAGING=1');
    }
    const operatorOrigin = exactOrigin(
      env.E2E_OPERATOR_ORIGIN ?? 'https://operator.staging.wastd.dev',
      'Operator origin',
    );
    const apiOrigin = exactOrigin(
      env.E2E_API_ORIGIN ?? 'https://api.staging.wastd.dev',
      'API origin',
    );
    if (
      operatorOrigin !== 'https://operator.staging.wastd.dev'
      || apiOrigin !== 'https://api.staging.wastd.dev'
    ) throw new Error('Staging origin does not match the protected deployment');
    return { kind, operatorOrigin, apiOrigin };
  }
  const operatorOrigin = exactOrigin(
    env.E2E_OPERATOR_ORIGIN ?? 'http://localhost:5173', 'Operator origin',
  );
  const apiOrigin = exactOrigin(env.E2E_API_ORIGIN ?? 'http://localhost:8787', 'API origin');
  for (const origin of [operatorOrigin, apiOrigin]) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new Error('Local origin must use HTTP loopback');
    }
  }
  return { kind, operatorOrigin, apiOrigin };
}

export function newRunId(): RunId {
  return `e2e_${randomBytes(12).toString('hex')}`;
}

export function runScoped(runId: RunId, suffix: string): string {
  RunIdSchema.parse(runId);
  if (!/^[a-z][a-z0-9_]*$/u.test(suffix)) {
    throw new Error('Run-scoped suffix must be lowercase ASCII');
  }
  return `${runId}_${suffix}`;
}
