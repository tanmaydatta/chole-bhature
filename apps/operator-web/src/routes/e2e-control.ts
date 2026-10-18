import { IdentityControlCallSchema, E2eControlReplySchema, type E2eControlError } from '@incentives/contracts';
import type { OperatorWebWorkerEnv } from '../staging-secrets.js';
import { controlRuntime } from '../e2e-control-runtime.js';

const statusCodes = { NOT_FOUND:404,UNAUTHORIZED:401,FORBIDDEN:403,INVALID_REQUEST:400,INCOMPATIBLE:409,
  CONFLICT:409,EXPIRED:410,QUARANTINED:409,UNAVAILABLE:503 } as const;

function response(value: unknown, status: number, id: string) {
  return new Response(JSON.stringify(value),{ status,headers:{ 'content-type':'application/json',
    'cache-control':'no-store','x-correlation-id':id,'x-content-type-options':'nosniff' } });
}

async function body(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('INVALID_REQUEST');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size=0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size>16384) { await reader.cancel(); throw new Error('INVALID_REQUEST'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset=0;
  for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
  return JSON.parse(new TextDecoder('utf-8',{ fatal:true }).decode(bytes)) as unknown;
}

export async function handleE2eControl(request: Request, env: OperatorWebWorkerEnv, id: string): Promise<Response> {
  const failure = (code: E2eControlError['error']['code']) => response({ error:{ code,correlationId:id,retryable:false } },statusCodes[code],id);
  try {
    const runtime = controlRuntime(env), url = new URL(request.url);
    if (request.method !== 'POST' || url.origin !== env.PUBLIC_APP_ORIGIN || url.search || url.hash
      || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) return failure('INVALID_REQUEST');
    for (const name of request.headers.keys()) {
      if (['cookie','origin','referer','location','access-control-request-method','access-control-request-headers'].includes(name)
        || name.startsWith('sec-fetch-') || name.startsWith('sec-ch-')) return failure('FORBIDDEN');
    }
    const authorization = request.headers.get('authorization');
    if (!authorization) return failure('UNAUTHORIZED');
    const match = /^E2E-(Setup|Controller) ([^\s,]{1,512})$/u.exec(authorization);
    if (!match) return failure('UNAUTHORIZED');
    const route = /^\/operator\/v1\/e2e-control\/(capabilities|bootstrap|runs\/(e2e_[a-f0-9]{24})\/(status|accounts|inspect|cancel|dispose))$/u.exec(url.pathname);
    if (!route) return failure('NOT_FOUND');
    const call = IdentityControlCallSchema.safeParse({ authorization:{ kind:match[1] === 'Setup' ? 'setup' : 'controller',value:match[2] }, input:await body(request) });
    if (!call.success) return failure('INVALID_REQUEST');
    const operation = route[3] === 'accounts' ? 'account' : route[3] ?? route[1];
    if (call.data.input.operation !== operation || ('runId' in call.data.input && route[2] !== undefined && call.data.input.runId !== route[2])) return failure('INVALID_REQUEST');
    if (call.data.input.envelope.generation !== runtime.generation || call.data.input.envelope.targetId !== runtime.targetId) return failure('INCOMPATIBLE');
    if (!runtime.enabled && (operation === 'bootstrap' || call.data.authorization.kind === 'controller')) return failure('EXPIRED');
    if (!env.IDENTITY.e2eControl) return failure('INCOMPATIBLE');
    const result = E2eControlReplySchema.safeParse(await env.IDENTITY.e2eControl(call.data));
    if (!result.success) return failure('INCOMPATIBLE');
    if ('error' in result.data) return response(result.data,statusCodes[result.data.error.code],id);
    if ('runtime' in result.data && (result.data.runtime.environment !== runtime.environment
      || result.data.runtime.generation !== runtime.generation || result.data.runtime.targetId !== runtime.targetId)) return failure('INCOMPATIBLE');
    return response(result.data,200,id);
  } catch { return failure('INVALID_REQUEST'); }
}
