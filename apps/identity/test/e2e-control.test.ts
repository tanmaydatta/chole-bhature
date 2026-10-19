import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, test } from 'vitest';
import { createIdentityE2eControl } from '../src/services/e2e-control.js';
import { E2eControlBootstrapResultSchema, E2eControlAccountSchema, CoreControlCallSchema, type StoredControlLease } from '@incentives/contracts';
import { createIdentityAuth } from '../src/auth.js';
import { createOrganizationService } from '../src/services/organizations.js';
import { IdentityOperatorService } from '../src/worker.js';
import { createExecutionContext } from 'cloudflare:test';

const generation = 'a'.repeat(40), targetId = 'b'.repeat(64);
const envelope = (release=generation) => ({ protocol: 'incentives-e2e-control', version: 2,
  generation:release, targetId, requestId: crypto.randomUUID() });
const setup = 'disposable-memory-only-control-credential';
const proof = 'A'.repeat(43), controllerToken = 'B'.repeat(42) + 'A';
const ownedRuns = new Map<string,string>();
const bootstrap = (capabilities: { proof?:string;controllerToken?:string } = {}) => {
  const result = { operation: 'bootstrap' as const, envelope: envelope(),
  runId: `e2e_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
  proof, controllerToken, name: 'Disposable scenario',...capabilities };
  ownedRuns.set(result.runId,result.proof); return result;
};
const rows = async () => {
  const result: Record<string, unknown> = {};
  for (const table of ['e2e_control_runs', 'e2e_run_claims', 'e2e_control_requests', 'e2e_control_accounts', 'client_provisionings', 'organizations', 'auth_profile', 'user', 'session', 'e2e_fixture_sessions', 'memberships', 'invitations', 'identity_audit', 'local_email_capture']) {
    const stored=(await env.AUTH_DB.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all<Record<string,unknown>>()).results;
    result[table]=await Promise.all(stored.map(async row => Object.fromEntries(await Promise.all(Object.entries(row).map(async ([key,value]) => {
      if (typeof value==='string' && (/token|body|text/iu.test(key))) {
        value=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
      }
      return [key,value];
    })))));
  }
  return result;
};

function observedDatabase() {
  let refusal: { boundary:string; code:string } | undefined;
  let sessionInsert: Record<string,unknown> | undefined;
  const observe = (error:unknown,boundary:string) => { refusal={ boundary,code:(error instanceof Error ? error.message : '').match(/E2E_CONTROL_[A-Z_]+/u)?.[0] ?? 'D1_REFUSED' }; };
  const wrap = (stmt:D1PreparedStatement,sql:string):D1PreparedStatement => new Proxy(stmt,{ get(target,key) {
    if (key==='bind') return (...values:unknown[]) => {
      if (/insert into "session"/iu.test(sql)) {
        const fields=sql.match(/\(([^)]+)\)\s*values/iu)?.[1]?.split(',').map(field=>field.trim().replaceAll('"','')) ?? [];
        sessionInsert=Object.fromEntries(fields.map((field,index)=>[field,values[index]]));
      }
      return wrap(target.bind(...values),sql);
    };
    const value:unknown=Reflect.get(target,key,target);
    if (typeof value !== 'function') return value;
    return async (...args:unknown[]) => { try { return await value.apply(target,args); } catch (error) {
      observe(error,sql.trim().split(/\s+/u).slice(0,3).join(' '));throw error;
    } };
  } });
  const db=new Proxy(env.AUTH_DB,{ get(target,key) {
    if (key==='prepare') return (sql:string) => wrap(target.prepare(sql),sql);
    if (key==='batch') return async (statements:D1PreparedStatement[]) => { try { return await target.batch(statements); }
      catch (error) { observe(error,'batch');throw error; } };
    const value:unknown=Reflect.get(target,key,target);return typeof value==='function' ? value.bind(target) : value;
  } });
  return { db,refusal:()=>refusal,sessionShape:(sid:unknown,userId:unknown,expiresAt:number) => ({
    exactSid:sessionInsert?.id===sid,exactUser:sessionInsert?.userId===userId,
    method:sessionInsert?.authenticationMethod,recoveryOnly:sessionInsert?.recoveryOnly,
    createdType:typeof sessionInsert?.createdAt,expiryType:typeof sessionInsert?.expiresAt,
    expiryWithinLease:typeof sessionInsert?.expiresAt==='number' && sessionInsert.expiresAt<=expiresAt,
  }) };
}

function pausedDatabase(matches:(sql:string)=>boolean) {
  let reached!:()=>void,release!:()=>void,paused=false;
  const atBoundary=new Promise<void>(resolve=>{ reached=resolve; }),resume=new Promise<void>(resolve=>{ release=resolve; });
  const queries=new WeakMap<D1PreparedStatement,string>();
  const pause=async (sql:string) => { if (!paused && matches(sql)) { paused=true;reached();await resume; } };
  const wrap=(stmt:D1PreparedStatement,sql:string):D1PreparedStatement => {
    const tracked=new Proxy(stmt,{ get(target,key) {
      if (key==='bind') return (...values:unknown[]) => wrap(target.bind(...values),sql);
      const value:unknown=Reflect.get(target,key,target);
      if (typeof value!=='function') return value;
      if (['run','all','first','raw'].includes(String(key))) return async (...args:unknown[]) => { await pause(sql);return value.apply(target,args); };
      return value.bind(target);
    } });
    queries.set(tracked,sql);return tracked;
  };
  const db=new Proxy(env.AUTH_DB,{ get(target,key) {
    if (key==='prepare') return (sql:string) => wrap(target.prepare(sql),sql);
    if (key==='batch') return async (statements:D1PreparedStatement[]) => { await pause(statements.map(stmt=>queries.get(stmt) ?? '').join('\n'));return target.batch(statements); };
    const value:unknown=Reflect.get(target,key,target);return typeof value==='function' ? value.bind(target) : value;
  } });
  return { db,atBoundary,release };
}

async function expire(runId:string) {
  const trigger=await env.AUTH_DB.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='e2e_control_run_immutable'").first<{ sql:string }>();
  if (!trigger) throw new Error('Missing original lease trigger');
  await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_run_immutable').run();
  try { await env.AUTH_DB.prepare('UPDATE e2e_control_runs SET issued_at=0,expires_at=900000 WHERE run_id=?1').bind(runId).run(); }
  finally { await env.AUTH_DB.prepare(trigger.sql).run(); }
  expect(await env.AUTH_DB.prepare(`SELECT expires_at-issued_at AS lifetime,expires_at<CAST(unixepoch('subsec')*1000 AS INTEGER) AS expired
    FROM e2e_control_runs WHERE run_id=?1`).bind(runId).first()).toEqual({ lifetime:900000,expired:1 });
}

function managed(release=generation) {
  const runs = new Map<string, StoredControlLease>();
  return { ...env, APP_ENV: 'local' as const, E2E_LOCAL_TEST_MODE: '1',
    PUBLIC_APP_ORIGIN: 'http://127.0.0.1:5173', PASSKEY_RP_ID: '127.0.0.1',
    E2E_CONTROL_ENABLED: '1', E2E_CONTROL_GENERATION: release,
    E2E_CONTROL_TARGET_ID: targetId, E2E_SETUP_SECRET: setup,
    CORE: { async e2eControl(raw: unknown) {
      const call = CoreControlCallSchema.parse(raw);
      if (call.operation !== 'capabilities') {
        let lease = runs.get(call.reservation.runId) ?? call.reservation;
        if (call.operation === 'reserve') runs.set(lease.runId, lease);
        if (call.operation === 'provision') lease = { ...lease, phase: 'product-provisioned' };
        if (call.operation === 'activate') lease = { ...lease, phase: 'active' };
        if (call.operation === 'fence') lease = { ...lease, phase: 'fencing' };
        if (call.operation === 'dispose') lease = { ...lease, phase: 'disposed' };
        runs.set(lease.runId, lease);
        const { proofHash:_proof,controllerHash:_controller,requestId:_request,payloadHash:_payload,accountQuota:_quota,...publicLease } = lease;
        return { lease:publicLease, product: { merchants: lease.phase === 'disposed' || lease.phase === 'reserved' ? 0 : 1 } };
      }
      return { protocol: 'incentives-e2e-control', version: 2, product: 2,
        runtime: { environment: 'local', generation:release, targetId },
        migrations: ['0008_e2e_tenant_lifecycle.sql', '0009_e2e_control_leases.sql'], fencing: true, recovery: true };
    } } };
}

describe('Identity dedicated setup authority', () => {
  test('projects fixture metadata from its own run and refuses cross-run selection and cancelled leases', async () => {
    const config = managed() as Parameters<typeof createIdentityE2eControl>[0];
    const control = createIdentityE2eControl(config), firstInput = bootstrap();
    const secondInput = bootstrap({ proof: 'C'.repeat(42) + 'A', controllerToken: 'D'.repeat(42) + 'A' });
    const first = E2eControlBootstrapResultSchema.parse(await control.execute({ authorization: { kind: 'setup', value: setup }, input: firstInput }));
    const second = E2eControlBootstrapResultSchema.parse(await control.execute({ authorization: { kind: 'setup', value: setup }, input: secondInput }));
    const rpc = new IdentityOperatorService(createExecutionContext(), config);
    expect(rpc.resolveBrowserSession).toBeTypeOf('function');
    const input = { cookieHeader: first.admin.cookieHeader, correlationId: 'fixture-display' };
    expect(await rpc.resolveBrowserSession(input)).toMatchObject({
      principal: { userId: first.admin.userId, sessionId: first.admin.sessionId, authenticationMethods: ['e2e-fixture'] },
      display: { user: { name: `${firstInput.runId}_admin`, email: `e2e+${firstInput.runId}_admin@e2e.invalid` }, role: 'admin',
        client: { merchantId: first.admin.merchantId, organizationId: first.admin.organizationId, name: `${firstInput.runId}_merchant` } },
    });
    expect(await rpc.resolveBrowserSession({ ...input, selectedMerchantId: second.admin.merchantId })).toHaveProperty('error');
    for (const role of ['operator', 'viewer'] as const) {
      const account = E2eControlAccountSchema.parse(await control.execute({ authorization: { kind: 'controller', value: controllerToken },
        input: { operation: 'account', envelope: envelope(), runId: firstInput.runId, proof, slug: role, role } }));
      expect(await rpc.resolveBrowserSession({ cookieHeader: account.cookieHeader, correlationId: `fixture-${role}` })).toMatchObject({
        principal: { userId: account.userId, authenticationMethods: ['e2e-fixture'] },
        display: { user: { name: `${firstInput.runId}_${role}`, email: `e2e+${firstInput.runId}_${role}@e2e.invalid` }, role,
          client: { merchantId: first.admin.merchantId, organizationId: first.admin.organizationId, name: `${firstInput.runId}_merchant` } },
      });
    }
    expect(await control.execute({ authorization: { kind: 'controller', value: controllerToken },
      input: { operation: 'cancel', envelope: envelope(), runId: firstInput.runId, proof } })).not.toHaveProperty('error');
    expect(await rpc.resolveBrowserSession(input)).toHaveProperty('error');
    expect(await rpc.resolveBrowserSession({ cookieHeader: second.admin.cookieHeader, correlationId: 'other-live-run' }))
      .toHaveProperty('display.user.email', `e2e+${secondInput.runId}_admin@e2e.invalid`);
  });

  test.each(['cancel','expire'])('native Better Auth issuance paused at actual INSERT refuses a concurrent %s and publishes no cookie', async boundary => {
    const paused=pausedDatabase(sql=>/insert into "session"/iu.test(sql)),config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap();
    E2eControlBootstrapResultSchema.parse(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },input }));
    const pending=createIdentityE2eControl({ ...config,AUTH_DB:paused.db }).execute({ authorization:{ kind:'controller',value:controllerToken },
      input:{ operation:'account',envelope:envelope(),runId:input.runId,proof,slug:'racing',role:'viewer' } });
    await Promise.race([paused.atBoundary,pending.then(()=>{ throw new Error('Native session INSERT not reached'); })]);
    try {
      if (boundary==='cancel') expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'controller',value:controllerToken },
        input:{ operation:'cancel',envelope:envelope(),runId:input.runId,proof } })).not.toHaveProperty('error');
      else await expire(input.runId);
      const before=await rows();paused.release();
      const result=await pending;
      expect(result).toHaveProperty('error');expect(result).not.toHaveProperty('admin');expect(result).not.toHaveProperty('cookieHeader');
      expect(await rows()).toEqual(before);
      expect(await env.AUTH_DB.prepare(`SELECT COUNT(*) AS n FROM session WHERE userId IN (SELECT user_id FROM e2e_control_accounts WHERE run_id=?1 AND slug='racing')`)
        .bind(input.runId).first()).toEqual({ n:0 });
    } finally { paused.release();await pending; }
  });
  test('an unverified bootstrap grants no controller operation and exact setup disposal closes its pending native producer', async () => {
    const paused=pausedDatabase(sql=>/insert into "session"/iu.test(sql)),config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap();
    const pending=createIdentityE2eControl({ ...config,AUTH_DB:paused.db }).execute({ authorization:{ kind:'setup',value:setup },input });
    await Promise.race([paused.atBoundary,pending.then(()=>{ throw new Error('Bootstrap native INSERT not reached'); })]);
    try {
      const before=await rows();
      for (const operation of ['status','cancel','dispose','account'] as const) {
        const action=operation==='account' ? { operation,envelope:envelope(),runId:input.runId,proof,slug:'premature',role:'viewer' }
          : { operation,envelope:envelope(),runId:input.runId,proof };
        expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'controller',value:controllerToken },input:action })).toHaveProperty('error');
        expect(await rows()).toEqual(before);
      }
      expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },input:{ operation:'dispose',envelope:envelope(),runId:input.runId,proof } }))
        .toMatchObject({ lease:{ phase:'disposed' },auth:{ users:0,sessions:0 } });
      const fenced=await rows();paused.release();
      expect(await pending).toHaveProperty('error');expect(await rows()).toEqual(fenced);
    } finally { paused.release();await pending; }
  });
  test.each(['complete','expire','dispose'])('issued Admin remains controller-ineligible until cookie/principal verification: %s', async outcome => {
    const paused=pausedDatabase(sql=>sql==='SELECT id FROM session WHERE token=?1'),config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap();
    const pending=createIdentityE2eControl({ ...config,AUTH_DB:paused.db }).execute({ authorization:{ kind:'setup',value:setup },input });
    await Promise.race([paused.atBoundary,pending.then(()=>{ throw new Error('Actual cookie verification not reached'); })]);
    try {
      expect(await env.AUTH_DB.prepare('SELECT state FROM e2e_control_accounts WHERE run_id=?1 AND slug=\'admin\'').bind(input.runId).first()).toEqual({ state:'issued' });
      expect(await env.AUTH_DB.prepare('SELECT status FROM e2e_control_requests WHERE run_id=?1 AND action=\'bootstrap\'').bind(input.runId).first()).toEqual({ status:'reserved' });
      const before=await rows();
      for (const operation of ['status','cancel','dispose','account'] as const) {
        const action=operation==='account' ? { operation,envelope:envelope(),runId:input.runId,proof,slug:'premature',role:'viewer' }
          : { operation,envelope:envelope(),runId:input.runId,proof };
        expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'controller',value:controllerToken },input:action })).toHaveProperty('error');
        expect(await rows()).toEqual(before);
      }
      if (outcome==='expire') await expire(input.runId);
      if (outcome==='dispose') expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },
        input:{ operation:'dispose',envelope:envelope(),runId:input.runId,proof } })).toMatchObject({ lease:{ phase:'disposed' },auth:{ users:0,sessions:0 } });
      paused.release();
      const reply=await pending;
      if (outcome==='complete') {
        const created=E2eControlBootstrapResultSchema.parse(reply);
        expect((await createIdentityAuth(config as Parameters<typeof createIdentityAuth>[0]).getSession(new Headers({ cookie:created.admin.cookieHeader })))?.user.id).toBe(created.admin.userId);
        expect(await env.AUTH_DB.prepare('SELECT status FROM e2e_control_requests WHERE run_id=?1 AND action=\'bootstrap\'').bind(input.runId).first()).toEqual({ status:'completed' });
        expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'controller',value:controllerToken },
          input:{ operation:'status',envelope:envelope(),runId:input.runId,proof } })).toMatchObject({ lease:{ phase:'active' } });
      } else {
        expect(reply).toHaveProperty('error');expect(reply).not.toHaveProperty('admin');expect(reply).not.toHaveProperty('cookieHeader');
        expect(await env.AUTH_DB.prepare('SELECT status FROM e2e_control_requests WHERE run_id=?1 AND action=\'bootstrap\'').bind(input.runId).first()).toEqual({ status:'reserved' });
        expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'controller',value:controllerToken },
          input:{ operation:'status',envelope:envelope(),runId:input.runId,proof } })).toHaveProperty('error');
      }
    } finally { paused.release();await pending; }
  });
  test.each(['cancel','expire'])('native cookie refresh paused at the real ownership SELECT refuses concurrent %s without renewal or audit writes', async boundary => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap();
    const created=E2eControlBootstrapResultSchema.parse(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },input }));
    const paused=pausedDatabase(sql=>sql.includes('JOIN e2e_control_valid_runs r ON r.run_id=a.run_id'));
    const pending=createIdentityAuth({ ...config,AUTH_DB:paused.db } as Parameters<typeof createIdentityAuth>[0]).handler(new Request('http://127.0.0.1:5173/auth/get-session?disableRefresh=false',{
      headers:{ cookie:created.admin.cookieHeader },
    }));
    await Promise.race([paused.atBoundary,pending.then(()=>{ throw new Error('Real ownership SELECT not reached'); })]);
    try {
      if (boundary==='cancel') expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'controller',value:controllerToken },
        input:{ operation:'cancel',envelope:envelope(),runId:input.runId,proof } })).not.toHaveProperty('error');
      else await expire(input.runId);
      const before=await rows();paused.release();
      const response=await pending;
      expect(response.status).toBe(401);expect(response.headers.has('set-cookie')).toBe(false);
      expect(await response.json()).not.toHaveProperty('session');expect(await rows()).toEqual(before);
      expect(await createOrganizationService({ database:env.AUTH_DB,appEnv:'local',ciEnv:config,localTestMode:'1' }).resolvePrincipal(created.admin.sessionId)).toBeNull();
    } finally { paused.release();await pending; }
  });
  test('two simultaneous runs use distinct capabilities and real member cookies with crossed authority rejected before writes', async () => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],service=createIdentityE2eControl(config),a=bootstrap(),
      b=bootstrap({ proof:'C'.repeat(42)+'A',controllerToken:'D'.repeat(42)+'A' });
    const [first,second]=await Promise.all([a,b].map(async input=>E2eControlBootstrapResultSchema.parse(await service.execute({ authorization:{ kind:'setup',value:setup },input }))));
    expect(first.admin.userId).not.toBe(second.admin.userId);expect(first.admin.sessionId).not.toBe(second.admin.sessionId);
    expect(first.admin.merchantId).not.toBe(second.admin.merchantId);
    const before=await rows();
    for (const [value,ownershipProof] of [[a.controllerToken,b.proof],[b.controllerToken,a.proof],[a.controllerToken,a.proof]]) {
      expect(await service.execute({ authorization:{ kind:'controller',value },input:{ operation:'account',envelope:envelope(),runId:b.runId,
        proof:ownershipProof,slug:'crossed',role:'viewer' } })).toHaveProperty('error');
      expect(await rows()).toEqual(before);
    }
    const rpc=new IdentityOperatorService(createExecutionContext(),config);
    const denialStartedAt=Date.now();
    expect(await rpc.resolveBrowserPrincipal({ cookieHeader:first.admin.cookieHeader,selectedMerchantId:second.admin.merchantId,correlationId:'crossed-real-state' })).toHaveProperty('error');
    const after=await rows();
    const { identity_audit:priorAudits,...priorBusinessRows }=before;
    const { identity_audit:afterAudits,...afterBusinessRows }=after;
    expect(afterBusinessRows).toEqual(priorBusinessRows);
    expect(afterAudits).toEqual([...(priorAudits as unknown[]),{
      id:expect.stringMatching(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u),
      occurred_at:expect.any(Number),actor_kind:'anonymous',actor_id:'anonymous',merchant_id:null,
      action:'authorization.denied',target_type:'operation',target_id:'private_rpc',outcome:'denied',
      correlation_id:'crossed-real-state',metadata_json:null,
    }]);
    const denial=(afterAudits as { occurred_at:number }[]).at(-1)!;
    expect(denial.occurred_at).toBeGreaterThanOrEqual(denialStartedAt);
    expect(denial.occurred_at).toBeLessThanOrEqual(Date.now());
    expect(await createOrganizationService({ database:env.AUTH_DB,appEnv:'local',ciEnv:config,localTestMode:'1' }).resolvePrincipal(first.admin.sessionId,second.admin.merchantId)).toBeNull();
  });
  test('expired creation permits exact-proof readback and bounded disposal only, without minting or extending fixture expiry', async () => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],service=createIdentityE2eControl(config),input=bootstrap();
    const created=E2eControlBootstrapResultSchema.parse(await service.execute({ authorization:{ kind:'setup',value:setup },input }));
    await expire(input.runId);
    const before=await rows();
    expect(await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:{ operation:'account',envelope:envelope(),runId:input.runId,proof,slug:'late',role:'viewer' } })).toHaveProperty('error');
    expect(await rows()).toEqual(before);
    expect(await service.execute({ authorization:{ kind:'setup',value:setup },input:{ operation:'status',envelope:envelope(),runId:input.runId,proof } }))
      .toMatchObject({ lease:{ issuedAt:0,expiresAt:900000 },auth:{ users:1,sessions:1 } });
    expect(await rows()).toEqual(before);
    expect(await createIdentityAuth(config as Parameters<typeof createIdentityAuth>[0]).getSession(new Headers({ cookie:created.admin.cookieHeader }))).toBeNull();
    const disposed=await service.execute({ authorization:{ kind:'setup',value:setup },input:{ operation:'dispose',envelope:envelope(),runId:input.runId,proof } });
    expect(disposed).toMatchObject({ lease:{ phase:'disposed',issuedAt:0,expiresAt:900000 },auth:{ users:0,sessions:0 } });
  });
  test('an interrupted reserved bootstrap has exact zero-row readback and can dispose without a completed organization', async () => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap(),original=config.CORE.e2eControl!;
    config.CORE.e2eControl=async call => { if (call.operation==='provision') throw new Error('unit provision interruption');return original(call); };
    const service=createIdentityE2eControl(config);
    expect(await service.execute({ authorization:{ kind:'setup',value:setup },input })).toHaveProperty('error');
    expect(await service.execute({ authorization:{ kind:'setup',value:setup },input:{ operation:'status',envelope:envelope(),runId:input.runId,proof } }))
      .toMatchObject({ lease:{ phase:'reserved' },auth:{ organizations:0,users:0,sessions:0 },product:{ merchants:0 } });
    expect(await service.execute({ authorization:{ kind:'setup',value:setup },input:{ operation:'dispose',envelope:envelope(),runId:input.runId,proof } }))
      .toMatchObject({ lease:{ phase:'disposed' },auth:{ organizations:0,users:0,sessions:0 },product:{ merchants:0 } });
  });
  test('the actual Auth get-session route accepts the real member without sliding its immutable deadline', async () => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap();
    const created=E2eControlBootstrapResultSchema.parse(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },input }));
    const before=await rows();
    const observed=observedDatabase();
    const response=await createIdentityAuth({ ...config,AUTH_DB:observed.db } as Parameters<typeof createIdentityAuth>[0]).handler(new Request('http://127.0.0.1:5173/auth/get-session',{
      headers:{ cookie:created.admin.cookieHeader },
    }));
    expect(observed.refusal()).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(await rows()).toEqual(before);
  });
  test.each(['schema','mixed release','transport failure'])('%s refuses bootstrap before every fixture write with a closed reply', async mismatch => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],input=bootstrap(),before=await rows();
    let restore:string|undefined;
    if (mismatch==='schema') {
      restore=(await env.AUTH_DB.prepare("SELECT sql FROM sqlite_master WHERE name='e2e_control_session_insert'").first<{ sql:string }>())?.sql;
      await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_session_insert').run();
    } else config.CORE.e2eControl=async () => { if (mismatch==='transport failure') throw new Error('unit transport unavailable');
      return { protocol:'incentives-e2e-control',version:1 } as never; };
    try {
      expect(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },input })).toHaveProperty('error');
      expect(await rows()).toEqual(before);
    } finally { if (restore) await env.AUTH_DB.prepare(restore).run(); }
  });
  test('operator and viewer accounts resolve exact fixed permissions and same-role slugs do not conflict', async () => {
    const config=managed() as Parameters<typeof createIdentityE2eControl>[0],service=createIdentityE2eControl(config),input=bootstrap();
    E2eControlBootstrapResultSchema.parse(await service.execute({ authorization:{ kind:'setup',value:setup },input }));
    for (const [slug,role,permissions] of [['operator','operator',['schemas:read','schemas:manage','schemas:publish','customers:read','customers:manage',
      'programs:read','programs:manage','programs:publish','evaluations:run','redemptions:commit','audit:read']],
      ['viewer','viewer',['schemas:read','programs:read','evaluations:run','audit:read']]] as const) {
      const request={ operation:'account',envelope:envelope(),runId:input.runId,proof,slug,role };
      const account=E2eControlAccountSchema.parse(await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:request }));
      const principal=await createOrganizationService({ database:env.AUTH_DB,appEnv:'local',ciEnv:config,localTestMode:'1' }).resolvePrincipal(account.sessionId);
      expect(principal?.permissions).toEqual(permissions);
      expect(principal?.platformRole).toBeUndefined();
      expect(principal?.authenticationMethods).toEqual(['e2e-fixture']);
      expect((await createIdentityAuth(config as Parameters<typeof createIdentityAuth>[0]).getSession(new Headers({ cookie:account.cookieHeader })))?.user.id).toBe(account.userId);
      const before=await rows();
      const retry=await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:request });
      expect(retry).toHaveProperty('lease');expect(retry).not.toHaveProperty('cookieHeader');expect(await rows()).toEqual(before);
      expect(await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:{ ...request,envelope:envelope() } })).toHaveProperty('error');
      expect(await rows()).toEqual(before);
    }
    const before=await rows();
    expect(await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:{ operation:'account',envelope:envelope(),runId:input.runId,proof,slug:'fourth',role:'viewer' } })).toHaveProperty('error');
    expect(await rows()).toEqual(before);
  });
  test.each(['1','32'])('configured quota %s uses durable admission with independent same-role slugs', async quota => {
    const config={ ...managed(),E2E_CONTROL_ACCOUNT_QUOTA:quota } as Parameters<typeof createIdentityE2eControl>[0],service=createIdentityE2eControl(config),input=bootstrap();
    E2eControlBootstrapResultSchema.parse(await service.execute({ authorization:{ kind:'setup',value:setup },input }));
    if (quota==='32') for (let index=1;index<32;index++) {
      const account=await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:{ operation:'account',envelope:envelope(),runId:input.runId,proof,slug:'viewer_'+index,role:'viewer' } });
      expect(account).not.toHaveProperty('error');
    }
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_accounts WHERE run_id=?1').bind(input.runId).first()).toEqual({ n:Number(quota) });
    const before=await rows();
    expect(await service.execute({ authorization:{ kind:'controller',value:controllerToken },input:{ operation:'account',envelope:envelope(),runId:input.runId,proof,slug:'overflow',role:'viewer' } })).toHaveProperty('error');
    expect(await rows()).toEqual(before);
  });
  test('ordinary private RPC creates a run-scoped invitation with real D1 persistence and rejects crossed tenant authority', async () => {
    const config = managed() as Parameters<typeof createIdentityE2eControl>[0], input=bootstrap();
    const created=E2eControlBootstrapResultSchema.parse(await createIdentityE2eControl(config).execute({ authorization:{ kind:'setup',value:setup },input }));
    const rpc = new IdentityOperatorService(createExecutionContext(),config);
    const request = { sessionId:created.admin.sessionId,selectedMerchantId:created.admin.merchantId,
      input:{ organizationId:created.admin.organizationId,email:`e2e+${input.runId}_invite@e2e.invalid`,role:'viewer' as const,expiresInSeconds:600,correlationId:'control-invitation' } };
    expect(await rpc.createInvitation(request)).not.toHaveProperty('error');
    expect(await env.AUTH_DB.prepare('SELECT organization_id AS organizationId,role FROM invitations WHERE email=?1').bind(request.input.email).first())
      .toEqual({ organizationId:created.admin.organizationId,role:'viewer' });
    const before=await rows();
    expect(await rpc.createInvitation({ ...request,selectedMerchantId:crypto.randomUUID() })).toHaveProperty('error');
    expect(await rows()).toEqual(before);
  });
  afterEach(async () => {
    for (const [runId,ownershipProof] of ownedRuns) {
      if (!await env.AUTH_DB.prepare("SELECT 1 FROM e2e_control_runs WHERE run_id=?1 AND phase<>'disposed'").bind(runId).first()) continue;
      const result = await createIdentityE2eControl(managed() as Parameters<typeof createIdentityE2eControl>[0]).execute({ authorization:{ kind:'setup',value:setup },
        input:{ operation:'dispose',envelope:envelope(),runId,proof:ownershipProof } });
      expect(result).not.toHaveProperty('error');
    }
    ownedRuns.clear();
  });
  test('bootstrap issues the exact durable Better Auth SID, admin membership and immutable deadlines without ROOT', async () => {
    const config = managed() as Parameters<typeof createIdentityE2eControl>[0];
    const observed=observedDatabase();
    const input = bootstrap();
    const reply = await createIdentityE2eControl({ ...config,AUTH_DB:observed.db }).execute({
      authorization: { kind: 'setup', value: setup }, input,
    });
    const reservedAccount=await env.AUTH_DB.prepare('SELECT session_id AS sid,user_id AS userId FROM e2e_control_accounts WHERE run_id=?1').bind(input.runId).first<{ sid:string;userId:string }>();
    const recordedLease=await env.AUTH_DB.prepare('SELECT expires_at AS expiry FROM e2e_control_runs WHERE run_id=?1').bind(input.runId).first<{ expiry:number }>();
    expect(observed.sessionShape(reservedAccount?.sid,reservedAccount?.userId,recordedLease?.expiry ?? 0))
      .toEqual({ exactSid:true,exactUser:true,method:'e2e-fixture',recoveryOnly:0,createdType:'number',expiryType:'number',expiryWithinLease:true });
    expect(observed.refusal()).toBeUndefined();
    expect({ reply, state:await env.AUTH_DB.prepare('SELECT phase,(SELECT COUNT(*) FROM e2e_control_accounts WHERE run_id=?1) AS accounts FROM e2e_control_runs WHERE run_id=?1').bind(input.runId).first() })
      .toMatchObject({ state:{ phase:'active',accounts:1 } });
    expect(reply).not.toHaveProperty('error');
    const result = E2eControlBootstrapResultSchema.parse(reply);
    const account = await env.AUTH_DB.prepare('SELECT user_id AS userId, session_id AS sessionId, state FROM e2e_control_accounts WHERE run_id=?1 AND slug=\'admin\'')
      .bind(input.runId).first();
    expect(account).toEqual({ userId: result.admin.userId, sessionId: result.admin.sessionId, state: 'issued' });
    const principal = await createOrganizationService({ database: env.AUTH_DB, appEnv: 'local', ciEnv: config,
      localTestMode: '1' }).resolvePrincipal(result.admin.sessionId);
    expect(principal?.authenticationMethods).toEqual(['e2e-fixture']);
    expect(principal?.platformRole).toBeUndefined();
    expect(principal?.merchantId).toBe(result.admin.merchantId);
    expect(principal?.membershipId).toBe(result.admin.membershipId);
    expect(principal?.permissions).toEqual(['members:read','members:manage','schemas:read','schemas:manage','schemas:publish',
      'customers:read','customers:manage','programs:read','programs:manage','programs:publish','evaluations:run','redemptions:commit',
      'credentials:read','credentials:manage','audit:read']);
    expect((await createIdentityAuth(config as Parameters<typeof createIdentityAuth>[0]).getSession(new Headers({ cookie: result.admin.cookieHeader })))?.user.id)
      .toBe(result.admin.userId);
    expect(await env.AUTH_DB.prepare(`SELECT f.hard_expires_at-f.issued_at AS duration,
      s.expiresAt<=r.expires_at AS bounded, p.email_login_enabled AS emailLogin, p.subject_kind AS subject
      FROM e2e_fixture_sessions f JOIN session s ON s.id=f.session_id JOIN e2e_control_runs r ON r.run_id=f.run_id
      JOIN auth_profile p ON p.user_id=f.user_id WHERE f.session_id=?1`).bind(result.admin.sessionId).first())
      .toEqual({ duration: 900000, bounded: 1, emailLogin: 0, subject: 'employee' });
    expect(result.admin.cookieAttributes).toMatchObject({ path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expiresAt: result.lease.expiresAt });
  });
  test('cancellation revokes both real resolvers and exact proof disposal removes owned Auth rows but preserves manual users', async () => {
    const config = managed() as Parameters<typeof createIdentityE2eControl>[0], service = createIdentityE2eControl(config), input = bootstrap();
    const created = E2eControlBootstrapResultSchema.parse(await service.execute({ authorization: { kind: 'setup', value: setup }, input }));
    const now = Date.now();
    await env.AUTH_DB.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES ('manual-preserved','Manual','manual@example.test',0,?1,?1)`).bind(now).run();
    const cancel = { operation: 'cancel', envelope: envelope(), runId: input.runId, proof };
    expect(await service.execute({ authorization: { kind: 'controller', value: controllerToken }, input: cancel })).not.toHaveProperty('error');
    expect(await createIdentityAuth(config as Parameters<typeof createIdentityAuth>[0]).getSession(new Headers({ cookie: created.admin.cookieHeader }))).toBeNull();
    expect(await createOrganizationService({ database: env.AUTH_DB, appEnv: 'local', ciEnv: config, localTestMode: '1' }).resolvePrincipal(created.admin.sessionId)).toBeNull();
    const action = { operation: 'dispose', envelope: envelope(), runId: input.runId, proof };
    const disposed = await service.execute({ authorization: { kind: 'setup', value: setup }, input: action });
    expect(disposed).toMatchObject({ lease: { phase: 'disposed' }, auth: { users: 0, sessions: 0, organizations: 0 }, product: { merchants: 0 } });
    expect(await service.execute({ authorization: { kind: 'setup', value: setup }, input: action })).toEqual(disposed);
    expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id=\'manual-preserved\'').first()).toEqual({ id: 'manual-preserved' });
    expect(await env.AUTH_DB.prepare('SELECT expires_at-issued_at AS duration FROM e2e_control_cleanup WHERE run_id=?1').bind(input.runId).first()).toEqual({ duration: 300000 });
  });
  test.each(['wrong proof', 'wrong controller', 'wrong generation', 'wrong target', 'altered bootstrap'])
    ('%s cannot change an existing run or mint another session', async mismatch => {
      const config = managed() as Parameters<typeof createIdentityE2eControl>[0], service = createIdentityE2eControl(config), input = bootstrap();
      E2eControlBootstrapResultSchema.parse(await service.execute({ authorization: { kind: 'setup', value: setup }, input }));
      const before = await rows();
      const action = { operation: 'account', envelope: envelope(), runId: input.runId,
        proof: mismatch === 'wrong proof' ? 'C'.repeat(42)+'A' : proof, slug: 'viewer', role: 'viewer' };
      if (mismatch === 'wrong generation') action.envelope.generation = 'c'.repeat(40);
      if (mismatch === 'wrong target') action.envelope.targetId = 'c'.repeat(64);
      expect(await service.execute({ authorization: { kind: mismatch === 'altered bootstrap' ? 'setup' : 'controller',
        value: mismatch === 'altered bootstrap' ? setup : mismatch === 'wrong controller' ? 'C'.repeat(42)+'A' : controllerToken },
        input: mismatch === 'altered bootstrap' ? { ...input, name: 'Changed' } : action })).toHaveProperty('error');
      expect(await rows()).toEqual(before);
    });
  test('authenticates the dedicated setup credential and traverses live v2 schema capabilities', async () => {
    expect(await createIdentityE2eControl(managed() as Parameters<typeof createIdentityE2eControl>[0]).execute({
      authorization: { kind: 'setup', value: setup }, input: { operation: 'capabilities', envelope: envelope() },
    })).toMatchObject({ version: 2, identity: 2, product: 2, operator: 2, fencing: true, recovery: true });
  });
  test.each(['wrong', 'auth signing key', 'controller'])('%s cannot discover or write fixtures', async kind => {
    const config = managed();
    const before = await rows();
    const reply = await createIdentityE2eControl(config as Parameters<typeof createIdentityE2eControl>[0]).execute({
      authorization: { kind: kind === 'controller' ? 'controller' : 'setup',
        value: kind === 'auth signing key' ? config.AUTH_SECRET : kind === 'controller' ? 'A'.repeat(43) : 'wrong' },
      input: { operation: 'capabilities', envelope: envelope() },
    });
    expect(reply).toHaveProperty('error');
    expect(await rows()).toEqual(before);
  });
});
