import { describe, expect, test, vi } from 'vitest';
import { createOperatorWebWorker } from '../src/worker.js';

const generation = 'a'.repeat(40), targetId = 'b'.repeat(64);
const capability = { protocol: 'incentives-e2e-control', version: 2,
  runtime: { environment: 'local', generation, targetId }, operator: 2, identity: 2,
  product: 2, migrations: { auth: ['0007_e2e_control_leases.sql'], product: ['0009_e2e_control_leases.sql'] }, fencing: true, recovery: true };
const config = () => ({ APP_ENV: 'local' as const, E2E_LOCAL_TEST_MODE: '1',
  PUBLIC_APP_ORIGIN: 'http://127.0.0.1:5173', OPERATOR_SELECTION_SECRET: 'disposable-selection-signing-secret',
  E2E_CONTROL_ENABLED: '1', E2E_CONTROL_GENERATION: generation, E2E_CONTROL_TARGET_ID: targetId,
  IDENTITY: { e2eControl: vi.fn(async () => capability), resolveBrowserPrincipal: vi.fn(async () => { throw new Error('no principal for control'); }) },
  IDENTITY_AUTH: { fetch: vi.fn() }, CORE: {}, ASSETS: { fetch: vi.fn() } });
const input = () => ({ operation: 'capabilities', envelope: { protocol: 'incentives-e2e-control',
  version: 2, generation, targetId, requestId: crypto.randomUUID() } });

async function invoke(request: Request, change?:(settings:ReturnType<typeof config>)=>void) {
  const worker = createOperatorWebWorker(), settings = config();
  change?.(settings);
  return { response: await worker.fetch!(request, settings as Parameters<NonNullable<typeof worker.fetch>>[1], {} as ExecutionContext), settings };
}

describe('non-browser Operator control surface', () => {
  test.each(['bootstrap','controller account'])('Operator deployment disablement blocks %s before any Identity forwarding', async operation => {
    const runId='e2e_0123456789abcdef01234567',base={ ...input().envelope };
    const call=operation==='bootstrap' ? { operation:'bootstrap',envelope:base,runId,proof:'A'.repeat(43),controllerToken:'B'.repeat(42)+'A',name:'Disposable' }
      : { operation:'account',envelope:base,runId,proof:'A'.repeat(43),slug:'viewer',role:'viewer' };
    const pathname=operation==='bootstrap' ? 'bootstrap' : 'runs/'+runId+'/accounts';
    const { response,settings }=await invoke(new Request('http://127.0.0.1:5173/operator/v1/e2e-control/'+pathname,{
      method:'POST',headers:{ authorization:operation==='bootstrap' ? 'E2E-Setup disposable-memory-only-control-credential' : 'E2E-Controller '+'B'.repeat(42)+'A',
        'content-type':'application/json' },body:JSON.stringify(call),
    }),settings=>{ settings.E2E_CONTROL_ENABLED='0'; });
    expect(response.status).toBe(410);expect(settings.IDENTITY.e2eControl).not.toHaveBeenCalled();
  });
  test.each(['status','inspect','cancel','dispose'])('disabled Operator rejects controller %s before Identity forwarding', async operation => {
    const runId='e2e_0123456789abcdef01234567';
    const call={ operation,envelope:input().envelope,runId,proof:'A'.repeat(43),
      ...(operation==='inspect' ? { evaluationId:'evaluation',idempotencyKey:'checkout',programRefs:['promo'] } : {}) };
    const { response,settings }=await invoke(new Request('http://127.0.0.1:5173/operator/v1/e2e-control/runs/'+runId+'/'+operation,{
      method:'POST',headers:{ authorization:'E2E-Controller '+'B'.repeat(42)+'A','content-type':'application/json' },body:JSON.stringify(call),
    }),settings=>{ settings.E2E_CONTROL_ENABLED='0'; });
    expect(response.status).toBe(410);expect(settings.IDENTITY.e2eControl).not.toHaveBeenCalled();
  });
  test.each(['capabilities','status','dispose'])('disabled Operator preserves separately authenticated setup %s recovery', async operation => {
    const runId='e2e_0123456789abcdef01234567',envelope=input().envelope;
    const call=operation==='capabilities' ? { operation,envelope } : { operation,envelope,runId,proof:'A'.repeat(43) };
    const expected=operation==='capabilities' ? capability : { lease:{ runId,merchantId:'11111111-1111-4111-8111-111111111111',
      provisioningId:'22222222-2222-4222-8222-222222222222',generation,targetId,issuedAt:0,expiresAt:900000,
      phase:operation==='dispose' ? 'disposed' : 'active' },auth:{ users:0 },product:{ merchants:0 } };
    const path=operation==='capabilities' ? operation : 'runs/'+runId+'/'+operation;
    const { response,settings }=await invoke(new Request('http://127.0.0.1:5173/operator/v1/e2e-control/'+path,{
      method:'POST',headers:{ authorization:'E2E-Setup disposable-memory-only-control-credential','content-type':'application/json' },body:JSON.stringify(call),
    }),settings=>{ settings.E2E_CONTROL_ENABLED='0';settings.IDENTITY.e2eControl=vi.fn(async()=>expected as typeof capability); });
    expect(response.status).toBe(200);expect(await response.json()).toEqual(expected);
    expect(settings.IDENTITY.e2eControl).toHaveBeenCalledExactlyOnceWith({ authorization:{ kind:'setup',value:'disposable-memory-only-control-credential' },input:call });
  });
  test.each(['missing credential','query','malformed','oversized streamed','GET','wrong run'])('%s refuses before private forwarding', async mismatch => {
    let body=JSON.stringify(input()),url='http://127.0.0.1:5173/operator/v1/e2e-control/capabilities';
    const headers:Record<string,string>={ authorization:'E2E-Setup disposable-memory-only-control-credential','content-type':'application/json' };
    if (mismatch==='missing credential') delete headers.authorization;
    if (mismatch==='query') url+='?environment=local';
    if (mismatch==='malformed') body='{';
    if (mismatch==='wrong run') { url='http://127.0.0.1:5173/operator/v1/e2e-control/runs/e2e_0123456789abcdef01234567/status';
      body=JSON.stringify({ operation:'status',envelope:input().envelope,runId:'e2e_89abcdef0123456701234567',proof:'A'.repeat(43) }); }
    let request:Request;
    if (mismatch==='oversized streamed') {
      const stream=new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8192));controller.enqueue(new Uint8Array(8193));controller.close(); } });
      request=new Request(url,{ method:'POST',headers,body:stream,duplex:'half' } as RequestInit);
    } else request=new Request(url,{ method:mismatch==='GET' ? 'GET' : 'POST',headers,...(mismatch==='GET' ? {} : { body }) });
    const { response,settings }=await invoke(request);
    expect(response.status).toBeGreaterThanOrEqual(400);expect(settings.IDENTITY.e2eControl).not.toHaveBeenCalled();
  });
  test.each(['local flag','unknown generation','wrong target'])('trusted Operator %s refuses before forwarding', async mismatch => {
    const { response,settings }=await invoke(new Request('http://127.0.0.1:5173/operator/v1/e2e-control/capabilities',{
      method:'POST',headers:{ authorization:'E2E-Setup disposable-memory-only-control-credential','content-type':'application/json' },body:JSON.stringify(input()),
    }),settings=>{ if (mismatch==='local flag') settings.E2E_LOCAL_TEST_MODE='0';
      if (mismatch==='unknown generation') settings.E2E_CONTROL_GENERATION='invalid';
      if (mismatch==='wrong target') settings.E2E_CONTROL_TARGET_ID='c'.repeat(64); });
    expect(response.status).toBeGreaterThanOrEqual(400);expect(settings.IDENTITY.e2eControl).not.toHaveBeenCalled();
  });
  test('a bounded dedicated authorization traverses Identity without a browser principal', async () => {
    const { response, settings } = await invoke(new Request('http://127.0.0.1:5173/operator/v1/e2e-control/capabilities', {
      method: 'POST', headers: { authorization: 'E2E-Setup disposable-memory-only-control-credential', 'content-type': 'application/json' }, body: JSON.stringify(input()),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(capability);
    expect(settings.IDENTITY.resolveBrowserPrincipal).not.toHaveBeenCalled();
  });
  test.each([{ cookie: 'root=signed' }, { origin: 'http://127.0.0.1:5173' }, { 'sec-fetch-site': 'same-origin' }, { authorization: 'E2E-Setup one, E2E-Setup two' }])
    ('refuses browser or duplicate authorization metadata %j before forwarding', async headers => {
      const { response, settings } = await invoke(new Request('http://127.0.0.1:5173/operator/v1/e2e-control/capabilities', {
        method: 'POST', headers: { authorization: 'E2E-Setup disposable-memory-only-control-credential', 'content-type': 'application/json', ...headers }, body: JSON.stringify(input()),
      }));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(settings.IDENTITY.e2eControl).not.toHaveBeenCalled();
    });
});
