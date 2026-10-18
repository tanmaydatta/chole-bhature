import { IdentityControlCallSchema, CoreControlReplySchema, type E2eControlReply, type StoredControlLease,
  type CoreControlCall, type E2eControlLease, type E2eControlRuntime } from '@incentives/contracts';
import { resolveSetupSecret, resolveIdentitySecrets, type IdentityWorkerEnv } from '../staging-secrets.js';
import { capabilityHash, matchesHash, controlRuntime } from '../e2e-control-runtime.js';
import { createIdentityControlStore } from './e2e-control-store.js';
import { withControlWrite } from './e2e-write-fence.js';
import { issueControlAccount } from './e2e-fixtures.js';
import { createIdentityAuth, getSessionAccess } from '../auth.js';
import { createOrganizationService } from './organizations.js';

const migrations = ['0005_e2e_tenant_lifecycle.sql','0006_e2e_fixture_session.sql','0007_e2e_control_leases.sql'];
function view(lease: StoredControlLease): E2eControlLease {
  const { proofHash:_proof,controllerHash:_controller,requestId:_request,payloadHash:_payload,accountQuota:_quota,...publicLease } = lease;
  return publicLease;
}
async function ready(db: D1Database) {
  const markers = (await db.prepare('SELECT name FROM d1_migrations').all<{ name:string }>()).results;
  const schema = (await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'e2e_control_%'").all<{ name:string }>()).results;
  if (!migrations.every(name => markers.some(row => row.name === name)) || !['e2e_control_runs','e2e_control_accounts',
    'e2e_control_cleanup','e2e_control_requests','e2e_control_write_guards','e2e_control_valid_runs','e2e_control_valid_write_guards',
    'e2e_control_guard_insert','e2e_control_guard_final','e2e_control_session_insert','e2e_control_session_update',
    'e2e_control_fixture_session_tuple','e2e_control_account_reserve','e2e_control_membership_tuple',
    'e2e_control_organization_reservation','e2e_control_session_audit'].every(name => schema.some(row => row.name === name))) throw new Error('E2E_CONTROL_INCOMPATIBLE');
}

export function createIdentityE2eControl(env: IdentityWorkerEnv) {
  const db = env.AUTH_DB, store = createIdentityControlStore(db);
  async function core(call: CoreControlCall) {
    if (!env.CORE.e2eControl) throw new Error('E2E_CONTROL_INCOMPATIBLE');
    const reply = CoreControlReplySchema.parse(await env.CORE.e2eControl(call));
    if ('error' in reply) throw new Error('E2E_CONTROL_'+reply.error.code);
    return reply;
  }
  async function handshake(runtime: E2eControlRuntime, envelope: CoreControlCall['envelope']) {
    await ready(db);
    const product = await core({ operation:'capabilities',envelope });
    if (!('product' in product) || typeof product.product !== 'number' || !('runtime' in product)
      || product.runtime.environment !== runtime.environment || product.runtime.generation !== runtime.generation
      || product.runtime.targetId !== runtime.targetId
      || !['0008_e2e_tenant_lifecycle.sql','0009_e2e_control_leases.sql'].every(name => product.migrations.includes(name))) throw new Error('E2E_CONTROL_INCOMPATIBLE');
    return { protocol:'incentives-e2e-control' as const,version:2 as const,
      runtime:{ environment:runtime.environment,generation:runtime.generation,targetId:runtime.targetId },
      operator:2 as const,identity:2 as const,product:2 as const,
      migrations:{ auth:migrations,product:product.migrations },fencing:true as const,recovery:true as const };
  }
  const userScope = 'SELECT user_id FROM e2e_control_accounts WHERE run_id=?1';
  const predicates: Record<string,string> = {
    client_provisionings:'provisioning_id=?2 OR merchant_id=?3', organizations:'id=?4 OR merchant_id=?3 OR e2e_control_run_id=?1',
    users:'e2e_control_run_id=?1 OR id IN ('+userScope+')', memberships:'organization_id=?4 OR user_id IN ('+userScope+')',
    invitations:'organization_id=?4', sessions:'userId IN ('+userScope+')', fixture_sessions:'run_id=?1 OR user_id IN ('+userScope+')',
    auth_profile:'user_id IN ('+userScope+')', account:'userId IN ('+userScope+')', passkey:'userId IN ('+userScope+')',
    local_email_capture:"substr(lower(recipient),1,length('e2e+'||?1||'_'))='e2e+'||?1||'_' AND substr(lower(recipient),-12)='@e2e.invalid'",
    verification:"substr(lower(identifier),1,length('e2e+'||?1||'_'))='e2e+'||?1||'_' AND substr(lower(identifier),-12)='@e2e.invalid'",
    identity_audit:'merchant_id=?3 OR actor_id IN ('+userScope+") OR (target_type='user' AND target_id IN ("+userScope+")) OR (target_type='session' AND target_id IN (SELECT session_id FROM e2e_control_accounts WHERE run_id=?1))",
  };
  const physical: Record<string,string> = { users:'user',fixture_sessions:'e2e_fixture_sessions',sessions:'session' };
  function statement(sql: string, lease: StoredControlLease) {
    // All predicates use the same numbered tuple, including unused placeholders.
    return db.prepare(sql+' AND ?1 IS NOT NULL AND ?2 IS NOT NULL AND ?3 IS NOT NULL AND ?4 IS NOT NULL')
      .bind(lease.runId,lease.provisioningId,lease.merchantId,lease.organizationId);
  }
  async function inventory(lease: StoredControlLease) {
    const counts: Record<string,number> = {};
    for (const [name,predicate] of Object.entries(predicates)) counts[name] = (await statement('SELECT COUNT(*) AS n FROM '+(physical[name] ?? name)+' WHERE ('+predicate+')',lease).first<{ n:number }>())?.n ?? 0;
    return counts;
  }
  async function ownership(lease: StoredControlLease) {
    const orgs = (await statement('SELECT id,merchant_id AS merchantId,provisioning_id AS provisioningId,e2e_control_run_id AS runId,name FROM organizations WHERE (id=?4 OR merchant_id=?3 OR e2e_control_run_id=?1)',lease)
      .all<{ id:string;merchantId:string;provisioningId:string;runId:string;name:string }>()).results;
    if (orgs.length>1 || orgs.some(o => o.id !== lease.organizationId || o.merchantId !== lease.merchantId || o.provisioningId !== lease.provisioningId
      || o.runId !== lease.runId || o.name !== lease.runId+'_merchant')) throw new Error('E2E_CONTROL_QUARANTINED');
    const provisionings = (await statement('SELECT organization_id AS organizationId,merchant_id AS merchantId,name FROM client_provisionings WHERE (provisioning_id=?2 OR merchant_id=?3)',lease)
      .all<{ organizationId:string;merchantId:string;name:string }>()).results;
    if (provisionings.length>1 || provisionings.some(p => p.organizationId !== lease.organizationId || p.merchantId !== lease.merchantId || p.name !== lease.runId+'_merchant')) throw new Error('E2E_CONTROL_QUARANTINED');
    const foreign = await statement('SELECT 1 FROM memberships WHERE (user_id IN ('+userScope+') AND organization_id<>?4)',lease).first();
    const unexpected = await statement(`SELECT 1 FROM memberships m WHERE (m.organization_id=?4 AND NOT EXISTS
      (SELECT 1 FROM e2e_control_accounts a WHERE a.run_id=?1 AND a.membership_id=m.id AND a.user_id=m.user_id))`,lease).first();
    if (foreign || unexpected) throw new Error('E2E_CONTROL_QUARANTINED');
  }
  async function status(lease: StoredControlLease, envelope: CoreControlCall['envelope']) {
    const product = await core({ operation:'status',envelope,reservation:lease });
    if (!('lease' in product)) throw new Error('E2E_CONTROL_INCOMPATIBLE');
    return { lease:view(lease),auth:await inventory(lease),product:product.product };
  }
  return { async execute(raw: unknown): Promise<E2eControlReply> {
    const parsed = IdentityControlCallSchema.safeParse(raw), id = parsed.success ? parsed.data.input.envelope.requestId : crypto.randomUUID();
    try {
      if (!parsed.success) throw new Error('E2E_CONTROL_INVALID_REQUEST');
      const { authorization,input } = parsed.data, runtime = controlRuntime(env);
      if (authorization.value.length>512 || input.envelope.generation !== runtime.generation || input.envelope.targetId !== runtime.targetId) throw new Error('E2E_CONTROL_INCOMPATIBLE');
      if (authorization.kind === 'setup' && !await matchesHash(authorization.value,await capabilityHash(await resolveSetupSecret(env)))) throw new Error('E2E_CONTROL_UNAUTHORIZED');
      if (['capabilities','bootstrap'].includes(input.operation) && authorization.kind !== 'setup') throw new Error('E2E_CONTROL_FORBIDDEN');
      if (authorization.kind === 'setup' && !['capabilities','bootstrap','status','dispose'].includes(input.operation)) throw new Error('E2E_CONTROL_FORBIDDEN');
      if (input.operation === 'capabilities') return await handshake(runtime,input.envelope);
      if (!runtime.enabled && (input.operation === 'bootstrap' || authorization.kind === 'controller')) throw new Error('E2E_CONTROL_EXPIRED');
      let lease = await store.read(input.runId);
      const proofHash = await capabilityHash(input.proof);
      if (lease && !await matchesHash(input.proof,lease.proofHash)) throw new Error('E2E_CONTROL_FORBIDDEN');
      if (authorization.kind === 'controller') {
        if (!lease || !await matchesHash(authorization.value,lease.controllerHash)) throw new Error('E2E_CONTROL_FORBIDDEN');
        if (lease.phase !== 'active' || lease.expiresAt<=Date.now()) throw new Error('E2E_CONTROL_EXPIRED');
        const verified = await db.prepare(`SELECT 1 FROM e2e_control_requests
          WHERE run_id=?1 AND request_id=?2 AND action='bootstrap' AND payload_hash=?3 AND status='completed'`)
          .bind(lease.runId,lease.requestId,lease.payloadHash).first();
        if (!verified) throw new Error('E2E_CONTROL_FORBIDDEN');
      }
      if (lease && (lease.targetId !== runtime.targetId || (lease.generation !== runtime.generation
        && (authorization.kind !== 'setup' || !['status','dispose'].includes(input.operation) || !runtime.cleanupGenerations.includes(lease.generation))))) throw new Error('E2E_CONTROL_INCOMPATIBLE');
      await handshake(runtime,input.envelope);
      if (input.operation === 'bootstrap') {
        const payloadHash = await capabilityHash(JSON.stringify({ runId:input.runId,proof:input.proof,controllerToken:input.controllerToken,name:input.name }));
        const controllerHash = await capabilityHash(input.controllerToken);
        if (lease) {
          if (lease.payloadHash !== payloadHash || lease.requestId !== input.envelope.requestId || !await matchesHash(input.controllerToken,lease.controllerHash)) throw new Error('E2E_CONTROL_CONFLICT');
          if (lease.phase === 'active' || !['reserved','product-provisioned','auth-provisioned'].includes(lease.phase)) return await status(lease,input.envelope);
        }
        const authEnv = await resolveIdentitySecrets(env);
        createIdentityAuth(authEnv); // Validate auth configuration before reserving any rows.
        lease ??= await store.reserve({ runId:input.runId,merchantId:crypto.randomUUID(),provisioningId:crypto.randomUUID(),
          generation:runtime.generation,targetId:runtime.targetId,proofHash,controllerHash,requestId:input.envelope.requestId,payloadHash,accountQuota:runtime.accountQuota });
        await core({ operation:'reserve',envelope:input.envelope,reservation:{ ...lease,phase:'reserved' } });
        if (lease.phase === 'reserved') {
          const provisioned = await core({ operation:'provision',envelope:input.envelope,reservation:lease });
          if (!('lease' in provisioned) || !['product-provisioned','auth-provisioned','active'].includes(provisioned.lease.phase)) throw new Error('E2E_CONTROL_INCOMPATIBLE');
          lease = await store.advance(lease.runId,'reserved','product-provisioned');
        }
        if (lease.phase === 'product-provisioned') {
          await withControlWrite(db,runtime,lease,'provision',[
            db.prepare(`INSERT INTO client_provisionings (provisioning_id,merchant_id,organization_id,name,status,current_step,retryable,attempt_count,created_at,updated_at,correlation_id)
              VALUES (?1,?2,?3,?4,'active','complete',0,1,?5,?5,?6)`)
              .bind(lease.provisioningId,lease.merchantId,lease.organizationId,lease.runId+'_merchant',lease.issuedAt,id),
            db.prepare(`INSERT INTO organizations (id,merchant_id,provisioning_id,name,status,created_at,updated_at,e2e_control_run_id)
              VALUES (?1,?2,?3,?4,'active',?5,?5,?6)`)
              .bind(lease.organizationId,lease.merchantId,lease.provisioningId,lease.runId+'_merchant',lease.issuedAt,lease.runId),
          ]);
          lease = await store.advance(lease.runId,'product-provisioned','auth-provisioned');
        }
        const activated = await core({ operation:'activate',envelope:input.envelope,reservation:lease });
        if (!('lease' in activated) || activated.lease.phase !== 'active') throw new Error('E2E_CONTROL_INCOMPATIBLE');
        lease = await store.advance(lease.runId,'auth-provisioned','active');
        const admin = await issueControlAccount(db,runtime,lease,'admin','admin',id,await capabilityHash('bootstrap-admin'),
          grant => createIdentityAuth(authEnv,{ controlGrant:grant }).createFixtureSession({ userId:grant.userId,runId:grant.lease.runId,merchantId:grant.lease.merchantId }));
        await verifyAccount(authEnv,lease,admin);
        // Issuance alone is not readiness. Publish controller authority only after
        // the real cookie and principal verify, under the immutable lease fence.
        const [completion] = await withControlWrite(db,runtime,lease,'provision',[
          db.prepare(`UPDATE e2e_control_requests SET status='completed'
            WHERE run_id=?1 AND request_id=?2 AND action='bootstrap' AND payload_hash=?3 AND status='reserved'`)
            .bind(lease.runId,lease.requestId,lease.payloadHash),
        ]);
        if (completion?.meta.changes !== 1) throw new Error('E2E_CONTROL_CONFLICT');
        return { lease:view(lease),admin:{ ...admin,role:'admin' } };
      }
      if (!lease) throw new Error('E2E_CONTROL_NOT_FOUND');
      await ownership(lease);
      if (input.operation === 'status') return await status(lease,input.envelope);
      if (input.operation === 'inspect') return await core({ operation:'inspect',envelope:input.envelope,reservation:lease,
        query:{ evaluationId:input.evaluationId,idempotencyKey:input.idempotencyKey,programRefs:input.programRefs } }) as E2eControlReply;
      if (input.operation === 'account') {
        const payloadHash = await capabilityHash(JSON.stringify(input));
        const existing = await db.prepare('SELECT role FROM e2e_control_accounts WHERE run_id=?1 AND slug=?2').bind(lease.runId,input.slug).first<{ role:string }>();
        if (existing) {
          const intent = await db.prepare('SELECT payload_hash AS payloadHash FROM e2e_control_requests WHERE run_id=?1 AND request_id=?2 AND action=?3')
            .bind(lease.runId,id,'account:'+input.slug).first<{ payloadHash:string }>();
          if (existing.role !== input.role || intent?.payloadHash !== payloadHash) throw new Error('E2E_CONTROL_CONFLICT');
          return await status(lease,input.envelope);
        }
        const authEnv = await resolveIdentitySecrets(env);
        const account = await issueControlAccount(db,runtime,lease,input.slug,input.role,id,payloadHash,
          grant => createIdentityAuth(authEnv,{ controlGrant:grant }).createFixtureSession({ userId:grant.userId,runId:grant.lease.runId,merchantId:grant.lease.merchantId }));
        await verifyAccount(authEnv,lease,account);
        return account;
      }
      const cleanup = await store.beginCleanup(lease.runId,proofHash,runtime.generation,id);
      if (cleanup.expiresAt<=Date.now()) throw new Error('E2E_CONTROL_EXPIRED');
      if (!['fencing','disposing','disposed'].includes(lease.phase)) {
        await withControlWrite(db,runtime,lease,'fence',[
          db.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE run_id=?1").bind(lease.runId),
          db.prepare("UPDATE e2e_control_accounts SET state='revoked' WHERE run_id=?1 AND state<>'revoked'").bind(lease.runId),
        ],cleanup);
        lease = (await store.read(lease.runId))!;
      }
      const fenced = await core({ operation:'fence',envelope:input.envelope,reservation:lease,cleanup });
      if (!('lease' in fenced) || !['fencing','disposing','disposed'].includes(fenced.lease.phase)) throw new Error('E2E_CONTROL_INCOMPATIBLE');
      if (input.operation === 'cancel') return { lease:view(lease),auth:await inventory(lease),product:fenced.product };
      const product = await core({ operation:'dispose',envelope:input.envelope,reservation:lease,cleanup });
      if (!('lease' in product) || product.lease.phase !== 'disposed' || Object.values(product.product).some(n => n !== 0)) throw new Error('E2E_CONTROL_QUARANTINED');
      if (lease.phase !== 'disposed') {
        await ownership(lease);
        if (lease.phase === 'fencing' || lease.phase === 'quarantined') lease = await store.advance(lease.runId,lease.phase,'disposing');
        await withControlWrite(db,runtime,lease,'dispose',[
          ...['invitations','local_email_capture','verification','identity_audit','users','memberships','organizations','client_provisionings']
            .map(name => statement('DELETE FROM '+(physical[name] ?? name)+' WHERE ('+predicates[name]+')',lease!)),
          db.prepare("UPDATE e2e_run_claims SET status='disposed',disposed_at=?1 WHERE run_id=?2").bind(Date.now(),lease.runId),
        ],cleanup);
        if (Object.values(await inventory(lease)).some(n => n !== 0)) throw new Error('E2E_CONTROL_QUARANTINED');
        lease = await store.advance(lease.runId,'disposing','disposed');
      }
      return { lease:view(lease),auth:await inventory(lease),product:product.product };
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      const code = reason === 'E2E_CONTROL_INVALID_REQUEST' ? 'INVALID_REQUEST' : reason.includes('UNAUTHORIZED') ? 'UNAUTHORIZED'
        : reason.includes('FORBIDDEN') ? 'FORBIDDEN' : reason.includes('QUARANTINED') || reason.includes('CORRUPT') ? 'QUARANTINED'
          : reason.includes('NOT_FOUND') ? 'NOT_FOUND' : reason.includes('CONFLICT') || reason.includes('ACCOUNT_RESERVATION') ? 'CONFLICT'
            : reason.includes('EXPIRED') || reason.includes('FENCED') ? 'EXPIRED' : 'INCOMPATIBLE';
      return { error:{ code,correlationId:id,retryable:false } };
    }
  } };
}

async function verifyAccount(env: Awaited<ReturnType<typeof resolveIdentitySecrets>>, lease: StoredControlLease,
  account: { userId:string;sessionId:string;merchantId:string;membershipId:string;cookieHeader:string }) {
  const cookie = await createIdentityAuth(env).getSession(new Headers({ cookie:account.cookieHeader }));
  const principal = await createOrganizationService({ database:env.AUTH_DB,appEnv:env.APP_ENV,ciEnv:env,localTestMode:env.E2E_LOCAL_TEST_MODE }).resolvePrincipal(account.sessionId);
  if (!cookie || cookie.user.id !== account.userId || cookie.session.id !== account.sessionId || !principal
    || principal.platformRole !== undefined || principal.authenticationMethods.length !== 1 || principal.authenticationMethods[0] !== 'e2e-fixture'
    || principal.merchantId !== lease.merchantId || principal.membershipId !== account.membershipId
    || !await getSessionAccess(env,account.sessionId) || lease.expiresAt<=Date.now()) throw new Error('E2E_CONTROL_EXPIRED');
}
