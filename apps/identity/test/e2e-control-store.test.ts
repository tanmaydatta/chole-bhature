import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, test } from 'vitest';
import type { E2eControlRuntime, OperatorPrincipal, StoredControlLease } from '@incentives/contracts';

import { createIdentityControlStore } from '../src/services/e2e-control-store.js';
import { withAuthBusinessWrite, withControlWrite } from '../src/services/e2e-write-fence.js';
import { createOrganizationService } from '../src/services/organizations.js';
import { createInvitationService } from '../src/services/invitations.js';
import { createIdentityE2eFixtures } from '../src/services/e2e-fixtures.js';
import { createIdentityE2eLifecycle } from '../src/services/e2e-lifecycle.js';
import { createIdentityAuth } from '../src/auth.js';
import type { Env } from '../src/worker.js';
import { createIdentityEmailAdapter, createLocalCaptureEmailAdapter } from '../src/email.js';

const runtime: E2eControlRuntime = { environment: 'local', generation: 'a'.repeat(40),
  targetId: 'b'.repeat(64), enabled: true, accountQuota: 3, cleanupGenerations: ['a'.repeat(40)] };

const migrationText = (env as typeof env & { E2E_CONTROL_MIGRATION_TEXT:string }).E2E_CONTROL_MIGRATION_TEXT;
function triggerDDL(name: string): string {
  const match = migrationText.match(new RegExp('CREATE TRIGGER '+name+'\\b[\\s\\S]*?\\n(?:BEGIN[^\\n]*END;|END;)'));
  if (!match) throw new Error('Missing test trigger '+name);
  return match[0];
}

function pausedDatabase(matches:(sql:string)=>boolean) {
  const queries = new WeakMap<D1PreparedStatement,string>();
  let reached!:()=>void,release!:()=>void;
  const atBoundary = new Promise<void>(resolve=>{ reached=resolve; });
  const resume = new Promise<void>(resolve=>{ release=resolve; });
  let paused=false;
  const db = new Proxy(env.AUTH_DB,{
    get(target,key) {
      if (key==='prepare') return (sql:string) => {
        const statement = target.prepare(sql);
        const tracked = new Proxy(statement,{
          get(prepared,property) {
            if (property==='bind') return (...values:unknown[]) => {
              const bound=prepared.bind(...values); queries.set(bound,sql); return bound;
            };
            const value:unknown=Reflect.get(prepared,property,prepared);
            return typeof value==='function' ? value.bind(prepared) : value;
          },
        });
        queries.set(tracked,sql); return tracked;
      };
      if (key==='batch') return async (statements:D1PreparedStatement[]) => {
        if (!paused && statements.some(statement=>matches(queries.get(statement) ?? ''))) {
          paused=true; reached(); await resume;
        }
        return target.batch(statements);
      };
      const value:unknown=Reflect.get(target,key,target);
      return typeof value==='function' ? value.bind(target) : value;
    },
  });
  return { db,atBoundary,release,didPause:()=>paused };
}

async function activeOrganization(proofHash='c'.repeat(64)) {
  const store = createIdentityControlStore(env.AUTH_DB);
  const lease = await store.reserve({ ...reservation(),proofHash });
  await withControlWrite(env.AUTH_DB, runtime, lease, 'provision', [
    env.AUTH_DB.prepare(`INSERT INTO client_provisionings
      (provisioning_id,merchant_id,organization_id,name,status,current_step,retryable,attempt_count,created_at,updated_at,correlation_id)
      VALUES (?1,?2,?3,?4,'active','complete',0,1,?5,?5,'control-test')`)
      .bind(lease.provisioningId,lease.merchantId,lease.organizationId,lease.runId+'_merchant',lease.issuedAt),
    env.AUTH_DB.prepare(`INSERT INTO organizations
      (id,merchant_id,provisioning_id,name,status,created_at,updated_at,e2e_control_run_id)
      VALUES (?1,?2,?3,?4,'active',?5,?5,?6)`)
      .bind(lease.organizationId,lease.merchantId,lease.provisioningId,lease.runId+'_merchant',lease.issuedAt,lease.runId),
  ]);
  await store.advance(lease.runId,'reserved','product-provisioned');
  await store.advance(lease.runId,'product-provisioned','auth-provisioned');
  return store.advance(lease.runId,'auth-provisioned','active');
}

async function account(lease: StoredControlLease, slug = 'viewer') {
  const userId = crypto.randomUUID(), membershipId = crypto.randomUUID();
  await env.AUTH_DB.prepare(`INSERT INTO e2e_control_accounts
    (run_id,slug,user_id,membership_id,generation,role,state)
    VALUES (?1,?2,?3,?4,?5,'viewer','reserved')`)
    .bind(lease.runId,slug,userId,membershipId,lease.generation).run();
  await withControlWrite(env.AUTH_DB, runtime, lease,'provision',[
    env.AUTH_DB.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,e2e_control_run_id)
      VALUES (?1,'viewer',?2,0,?3,?3,?4)`).bind(userId,`e2e+${lease.runId}_${slug}@e2e.invalid`,lease.issuedAt,lease.runId),
    env.AUTH_DB.prepare(`INSERT INTO auth_profile (user_id,subject_kind,status,email_login_enabled)
      VALUES (?1,'employee','active',0)`).bind(userId),
    env.AUTH_DB.prepare(`INSERT INTO memberships
      (id,organization_id,user_id,role,status,created_at,updated_at)
      VALUES (?1,?2,?3,'viewer','active',?4,?4)`).bind(membershipId,lease.organizationId,userId,lease.issuedAt),
  ]);
  return { userId,membershipId };
}

async function issuingAccount(lease:StoredControlLease,slug='viewer') {
  const member = await account(lease,slug);
  const sessionId = 'opaque-'+crypto.randomUUID();
  await withControlWrite(env.AUTH_DB,runtime,lease,'provision',[
    env.AUTH_DB.prepare("UPDATE e2e_control_accounts SET state='issuing',session_id=?1 WHERE run_id=?2 AND slug=?3")
      .bind(sessionId,lease.runId,slug),
  ]);
  const issuedAt = Date.now();
  const insert = env.AUTH_DB.prepare(`INSERT INTO session
    (id,userId,token,createdAt,updatedAt,expiresAt,authenticationMethod,authenticatedAt,recoveryOnly)
    VALUES (?1,?2,?3,?4,?4,?5,'e2e-fixture',?4,0)`)
    .bind(sessionId,member.userId,crypto.randomUUID(),issuedAt,lease.expiresAt);
  return { ...member,sessionId,issuedAt,insert };
}

function rootPrincipal(lease: StoredControlLease): OperatorPrincipal {
  return { userId: 'root-control-test', sessionId: 'root-session', platformRole: 'root',
    merchantId: lease.merchantId, authenticationMethods: ['passkey'],
    authenticatedAt:'2026-10-12T00:00:00.000Z', permissions: ['members:manage'] };
}

async function snapshot(lease:StoredControlLease) {
  const rows:Record<string,unknown> = {};
  rows.organization = await env.AUTH_DB.prepare('SELECT * FROM organizations WHERE id=?1').bind(lease.organizationId).first();
  rows.provisioning = await env.AUTH_DB.prepare('SELECT * FROM client_provisionings WHERE merchant_id=?1').bind(lease.merchantId).first();
  for (const table of ['memberships','invitations']) {
    rows[table] = (await env.AUTH_DB.prepare('SELECT * FROM '+table+' WHERE organization_id=?1 ORDER BY rowid')
      .bind(lease.organizationId).all()).results;
  }
  rows.accounts = (await env.AUTH_DB.prepare('SELECT * FROM e2e_control_accounts WHERE run_id=?1 ORDER BY slug').bind(lease.runId).all()).results;
  rows.users = (await env.AUTH_DB.prepare('SELECT u.* FROM user u JOIN e2e_control_accounts a ON a.user_id=u.id WHERE a.run_id=?1 ORDER BY u.id')
    .bind(lease.runId).all()).results;
  rows.sessions = (await env.AUTH_DB.prepare('SELECT s.* FROM session s JOIN e2e_control_accounts a ON a.user_id=s.userId WHERE a.run_id=?1 ORDER BY s.id')
    .bind(lease.runId).all()).results;
  rows.audit = (await env.AUTH_DB.prepare('SELECT * FROM identity_audit WHERE merchant_id=?1 ORDER BY rowid').bind(lease.merchantId).all()).results;
  return rows;
}

function reservation(targetId = 'b'.repeat(64)): Omit<StoredControlLease, 'issuedAt' | 'expiresAt' | 'phase'> {
  return {
    runId: `e2e_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
    merchantId: crypto.randomUUID(), provisioningId: crypto.randomUUID(),
    generation: 'a'.repeat(40), targetId, proofHash: 'c'.repeat(64),
    controllerHash: 'd'.repeat(64), requestId: crypto.randomUUID(),
    payloadHash: 'e'.repeat(64), accountQuota: 3,
  };
}

async function corruptedMembershipFixture(missing:'account'|'account and run',operation:string) {
  const lease=await activeOrganization(),member=await account(lease);
  const manualOrganization=crypto.randomUUID(),manualMerchant=crypto.randomUUID(),manualProvisioning=crypto.randomUUID(),manualUser=crypto.randomUUID();
  const foreignMembership=crypto.randomUUID(),now=Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare(`INSERT INTO client_provisionings
      (provisioning_id,merchant_id,organization_id,name,status,current_step,retryable,attempt_count,created_at,updated_at,correlation_id)
      VALUES (?1,?2,?3,'Manual','active','complete',0,1,?4,?4,'manual-membership')`)
      .bind(manualProvisioning,manualMerchant,manualOrganization,now),
    env.AUTH_DB.prepare(`INSERT INTO organizations (id,merchant_id,provisioning_id,name,status,created_at,updated_at)
      VALUES (?1,?2,?3,'Manual','active',?4,?4)`).bind(manualOrganization,manualMerchant,manualProvisioning,now),
    env.AUTH_DB.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt)
      VALUES (?1,'Manual',?2,0,?3,?3)`).bind(manualUser,manualUser+'@example.test',now),
  ]);
  if (operation==='insert active') await createOrganizationService({ database:env.AUTH_DB,controlRuntime:runtime })
    .removeMember(rootPrincipal(lease),{ membershipId:member.membershipId,correlationId:'prepare-active' });
  const retained=missing==='account' ? ['e2e_control_account_retained']
    : ['e2e_control_account_retained','e2e_control_request_retained','e2e_control_run_retained'];
  const retainedSql=await Promise.all(retained.map(async name=>{
    const row=await env.AUTH_DB.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?1").bind(name).first<{ sql:string }>();
    if (!row) throw new Error('Missing production trigger '+name);
    return row.sql;
  }));
  for (const name of retained) await env.AUTH_DB.prepare('DROP TRIGGER '+name).run();
  try {
    await env.AUTH_DB.prepare('DELETE FROM e2e_control_accounts WHERE run_id=?1').bind(lease.runId).run();
    if (missing==='account and run') await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('DELETE FROM e2e_control_requests WHERE run_id=?1').bind(lease.runId),
      env.AUTH_DB.prepare('DELETE FROM e2e_control_runs WHERE run_id=?1').bind(lease.runId),
    ]);
  } finally { for (const sql of retainedSql) await env.AUTH_DB.prepare(sql).run(); }
  if (!operation.startsWith('insert')) {
    // Seed the corrupt association only in local setup, then restore ALL
    // production INSERT/tuple predicates before testing UPDATE or DELETE.
    const classifiers=['e2e_control_memberships_insert','e2e_control_membership_tuple'];
    const classifierSql=await Promise.all(classifiers.map(async name=>{
      const row=await env.AUTH_DB.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?1").bind(name).first<{ sql:string }>();
      if (!row) throw new Error('Missing production trigger '+name);
      return row.sql;
    }));
    for (const name of classifiers) await env.AUTH_DB.prepare('DROP TRIGGER '+name).run();
    try {
      await env.AUTH_DB.prepare(`INSERT INTO memberships (id,organization_id,user_id,role,status,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer','removed',?4,?4)`)
        .bind(foreignMembership,manualOrganization,operation==='update NEW user' ? manualUser : member.userId,now).run();
    } finally { for (const sql of classifierSql) await env.AUTH_DB.prepare(sql).run(); }
  }
  const rows=async()=> ({
    users:(await env.AUTH_DB.prepare('SELECT * FROM user WHERE id IN (?1,?2) ORDER BY id').bind(member.userId,manualUser).all()).results,
    memberships:(await env.AUTH_DB.prepare('SELECT * FROM memberships WHERE user_id IN (?1,?2) OR id=?3 ORDER BY id')
      .bind(member.userId,manualUser,foreignMembership).all()).results,
    organizations:(await env.AUTH_DB.prepare('SELECT * FROM organizations WHERE id IN (?1,?2) ORDER BY id')
      .bind(lease.organizationId,manualOrganization).all()).results,
    audit:(await env.AUTH_DB.prepare('SELECT * FROM identity_audit WHERE merchant_id IN (?1,?2) ORDER BY rowid')
      .bind(lease.merchantId,manualMerchant).all()).results,
  });
  const statement=operation.startsWith('insert') ? env.AUTH_DB.prepare(`INSERT INTO memberships
    (id,organization_id,user_id,role,status,created_at,updated_at) VALUES (?1,?2,?3,'viewer',?4,?5,?5)`)
    .bind(foreignMembership,manualOrganization,member.userId,operation==='insert active' ? 'active' : 'removed',now)
    : operation==='update OLD user' ? env.AUTH_DB.prepare('UPDATE memberships SET user_id=?1 WHERE id=?2').bind(manualUser,foreignMembership)
      : operation==='update NEW user' ? env.AUTH_DB.prepare('UPDATE memberships SET user_id=?1 WHERE id=?2').bind(member.userId,foreignMembership)
        : operation==='guarded role update' ? env.AUTH_DB.prepare("UPDATE memberships SET role='operator' WHERE id=?1").bind(foreignMembership)
          : env.AUTH_DB.prepare('DELETE FROM memberships WHERE id=?1').bind(foreignMembership);
  expect(await env.AUTH_DB.prepare('SELECT e2e_control_run_id FROM user WHERE id=?1').bind(member.userId).first()).toEqual({ e2e_control_run_id:lease.runId });
  expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_accounts WHERE run_id=?1').bind(lease.runId).first()).toEqual({ n:0 });
  return { lease,rows,statements:[env.AUTH_DB.prepare("UPDATE organizations SET name='Changed' WHERE id=?1").bind(manualOrganization),statement] };
}

describe('durable Identity reservations in migrated D1', () => {
  test('FIX1 reserved membership cannot convert an existing unmarked user into a fixture account', async () => {
    const lease=await activeOrganization(),userId=crypto.randomUUID(),membershipId=crypto.randomUUID(),now=Date.now();
    await env.AUTH_DB.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?1,\'Manual\',?2,0,?3,?3)')
      .bind(userId,userId+'@example.test',now).run();
    await env.AUTH_DB.prepare(`INSERT INTO e2e_control_accounts (run_id,slug,user_id,membership_id,generation,role,state)
      VALUES (?1,'manual',?2,?3,?4,'viewer','reserved')`).bind(lease.runId,userId,membershipId,lease.generation).run();
    const before=(await env.AUTH_DB.prepare('SELECT * FROM user WHERE id=?1').bind(userId).all()).results;
    await expect(withControlWrite(env.AUTH_DB,runtime,lease,'provision',[
      env.AUTH_DB.prepare(`INSERT INTO identity_audit
        (id,action,merchant_id,actor_kind,actor_id,target_type,target_id,outcome,correlation_id,occurred_at)
        VALUES (?1,'e2e.fixture.account_created',?2,'system','fixture','user',?3,'succeeded','manual-conversion',?4)`)
        .bind(crypto.randomUUID(),lease.merchantId,userId,now),
      env.AUTH_DB.prepare(`INSERT INTO memberships (id,organization_id,user_id,role,status,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer','active',?4,?4)`).bind(membershipId,lease.organizationId,userId,now),
    ])).rejects.toThrow();
    expect((await env.AUTH_DB.prepare('SELECT * FROM user WHERE id=?1').bind(userId).all()).results).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE id=?1').bind(membershipId).first()).toEqual({ n:0 });
    expect(await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM identity_audit WHERE correlation_id='manual-conversion'").first()).toEqual({ n:0 });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n:0 });
    const marked=await account(lease,'marked');
    expect(await env.AUTH_DB.prepare('SELECT e2e_control_run_id FROM user WHERE id=?1').bind(marked.userId).first())
      .toEqual({ e2e_control_run_id:lease.runId });
    expect(await env.AUTH_DB.prepare('SELECT user_id FROM memberships WHERE id=?1').bind(marked.membershipId).first())
      .toEqual({ user_id:marked.userId });
  });
  afterEach(async () => {
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE phase IN ('reserved','product-provisioned','auth-provisioned','active','quarantined')"),
      env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='disposing' WHERE phase='fencing'"),
      env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='disposed' WHERE phase='disposing'"),
    ]);
  });
  test('real membership role and removal batches work for a live guarded fixture', async () => {
    const lease = await activeOrganization();
    const member = await account(lease);
    const service = createOrganizationService({ database: env.AUTH_DB, controlRuntime: runtime });
    await service.changeMemberRole(rootPrincipal(lease),{ membershipId: member.membershipId,role:'operator',correlationId:'role' });
    expect(await env.AUTH_DB.prepare('SELECT role FROM memberships WHERE id=?1').bind(member.membershipId).first())
      .toEqual({ role:'operator' });
    await service.removeMember(rootPrincipal(lease),{ membershipId:member.membershipId,correlationId:'remove' });
    expect(await env.AUTH_DB.prepare('SELECT status FROM memberships WHERE id=?1').bind(member.membershipId).first())
      .toEqual({ status:'removed' });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM identity_audit WHERE merchant_id=?1').bind(lease.merchantId).first())
      .toEqual({ n:2 });
  });

  test('real invitations can be created in an active fixture with guarded delivery metadata', async () => {
    const lease = await activeOrganization();
    const service = createInvitationService({ database:env.AUTH_DB,controlRuntime:runtime,publicOrigin:'https://operator.example.test',
      email:{ async send() {} } });
    const created = await service.createInvitation(rootPrincipal(lease),{
      organizationId:lease.organizationId!,email:`e2e+${lease.runId}_invited@e2e.invalid`,
      role:'viewer',expiresInSeconds:600,correlationId:'invite',
    });
    expect(created.status).toBe('sent');
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM identity_audit WHERE merchant_id=?1')
      .bind(lease.merchantId).first()).toEqual({ n:2 });
  });
  test.each(['member role','member removal','invitation create','invitation expiry','invitation retry','invitation delivered metadata'] as const)(
    'actual Auth %s batch cannot commit after fencing', async boundary => {
      const lease = await activeOrganization();
      const member = await issuingAccount(lease);
      await member.insert.run();
      const email = `e2e+${lease.runId}_invited@e2e.invalid`;
      let deliveries=0;
      const mail = { async send() { deliveries++; } };
      let invitationId='';
      if (boundary==='invitation expiry' || boundary==='invitation retry') {
        const existing = await createInvitationService({ database:env.AUTH_DB,controlRuntime:runtime,publicOrigin:'https://operator.example.test',email:mail })
          .createInvitation(rootPrincipal(lease),{ organizationId:lease.organizationId!,email,role:'viewer',expiresInSeconds:600,correlationId:'prepare' });
        invitationId=existing.id;
        expect(existing.status).toBe('sent');
        if (boundary==='invitation expiry') await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
          env.AUTH_DB.prepare('UPDATE invitations SET expires_at=0 WHERE id=?1').bind(invitationId),
        ]);
      }
      const paused = pausedDatabase(sql=> boundary==='member role' ? /UPDATE memberships SET role/u.test(sql)
        : boundary==='member removal' ? /UPDATE memberships SET status/u.test(sql)
          : boundary==='invitation create' ? /INSERT INTO invitations/u.test(sql)
            : boundary==='invitation expiry' ? /UPDATE invitations SET status = 'expired'/u.test(sql)
              : boundary==='invitation retry' ? /UPDATE invitations SET token_hash/u.test(sql) : /UPDATE invitations SET status = \?1/u.test(sql));
      const organizations = createOrganizationService({ database:paused.db,controlRuntime:runtime });
      const invitations = createInvitationService({ database:paused.db,controlRuntime:runtime,publicOrigin:'https://operator.example.test',email:mail });
      const operation = (boundary==='member role' ? organizations.changeMemberRole(rootPrincipal(lease),{ membershipId:member.membershipId,role:'operator',correlationId:'paused' })
        : boundary==='member removal' ? organizations.removeMember(rootPrincipal(lease),{ membershipId:member.membershipId,correlationId:'paused' })
          : boundary==='invitation retry' ? invitations.retryInvitation(rootPrincipal(lease),invitationId,'paused')
            : invitations.createInvitation(rootPrincipal(lease),{ organizationId:lease.organizationId!,email,role:'viewer',expiresInSeconds:600,correlationId:'paused' }))
        .then(value=>({ value }),error=>({ error:error as unknown }));
      try {
        expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
        expect(paused.didPause()).toBe(true);
        const before = await snapshot(lease);
        expect(deliveries).toBe(boundary==='invitation delivered metadata' || boundary==='invitation retry' || boundary==='invitation expiry' ? 1 : 0);
        await createIdentityControlStore(env.AUTH_DB).advance(lease.runId,'active','fencing');
        paused.release();
        if (boundary==='invitation delivered metadata') expect(await operation).toMatchObject({ value:{ status:'pending' } });
        else expect(await operation).toHaveProperty('error');
        expect(await snapshot(lease)).toEqual(before);
        expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n:0 });
      } finally { paused.release(); await operation; }
    });

  test.each([false,true])('ordinary v2 invitation acceptance refuses before all writes (expired=%s)', async expired => {
    const lease = await activeOrganization();
    const email = `e2e+${lease.runId}_invited@e2e.invalid`;
    let text='';
    const service = createInvitationService({ database:env.AUTH_DB,controlRuntime:runtime,publicOrigin:'https://operator.example.test',
      email:{ async send(message) { text=message.text; } } });
    const invitation = await service.createInvitation(rootPrincipal(lease),{ organizationId:lease.organizationId!,email,role:'viewer',expiresInSeconds:600,correlationId:'prepare' });
    const url = text.match(/https:\/\/\S+/u)?.[0];
    if (!url) throw new Error('Missing recorded invitation URL');
    const token = new URL(url).searchParams.get('token');
    if (!token) throw new Error('Missing recorded invitation token');
    if (expired) await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare('UPDATE invitations SET expires_at=0 WHERE id=?1').bind(invitation.id),
    ]);
    const before = await snapshot(lease);
    await expect(service.acceptInvitation({ token,email,correlationId:'denied' })).rejects.toThrow();
    expect(await snapshot(lease)).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM user WHERE email=?1').bind(email).first()).toEqual({ n:0 });
  });

  test('ordinary v1 Auth fixtures and disposal hit SQL but cannot mutate v2 provenance', async () => {
    const lease = await activeOrganization();
    const identity={ runId:lease.runId,merchantId:lease.merchantId,provisioningId:lease.provisioningId,proofHash:lease.proofHash };
    let sessions=0,productDisposals=0;
    const fixtures=createIdentityE2eFixtures({ database:env.AUTH_DB,appEnv:'staging',
      async createSession() { sessions++; throw new Error('Unexpected session producer'); } });
    const before=await snapshot(lease);
    await expect(fixtures.createAccount({ ...identity,slug:'legacy_attempt',role:'viewer' },'fixture-root','v1-attempt')).rejects.toThrow(/E2E_CONTROL/u);
    expect(sessions).toBe(0);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM user WHERE email=?1')
      .bind(`e2e+${lease.runId}_legacy_attempt@e2e.invalid`).first()).toEqual({ n:0 });
    const lifecycle=createIdentityE2eLifecycle({ database:env.AUTH_DB,appEnv:'staging',core:{
      async preview() { return { status:'active',counts:{ merchants:1 } }; },
      async dispose() { productDisposals++; return { status:'disposed',counts:{ merchants:0 } }; },
    } });
    expect(await lifecycle.preview(identity)).toMatchObject({ status:'active',auth:{ organizations:1 } });
    await expect(lifecycle.dispose(identity,'fixture-root','v1-attempt')).rejects.toThrow(/E2E_CONTROL/u);
    expect(productDisposals).toBe(0);
    expect(await snapshot(lease)).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT status,control_version FROM e2e_run_claims WHERE run_id=?1').bind(lease.runId).first()).toEqual({ status:'active',control_version:2 });
  });
  test('v1 existing-account session producer cannot mint an unreserved session for v2 user', async () => {
    const lease=await activeOrganization(),member=await account(lease);
    let calls=0;
    const before=await snapshot(lease);
    const fixtures=createIdentityE2eFixtures({ database:env.AUTH_DB,appEnv:'staging',async createSession(userId) {
      calls++;
      const sessionId=crypto.randomUUID(),now=Date.now();
      await env.AUTH_DB.prepare(`INSERT INTO session (id,userId,token,createdAt,updatedAt,expiresAt,authenticationMethod,authenticatedAt,recoveryOnly)
        VALUES (?1,?2,?3,?4,?4,?5,'e2e-fixture',?4,0)`).bind(sessionId,userId,crypto.randomUUID(),now,now+900000).run();
      return { sessionId,cookieHeader:'unexpected-cookie' };
    } });
    await expect(fixtures.createAccount({ runId:lease.runId,merchantId:lease.merchantId,provisioningId:lease.provisioningId,proofHash:lease.proofHash,
      slug:'viewer',role:'viewer' },'fixture-root','legacy-retry')).rejects.toThrow(/E2E_CONTROL/u);
    expect(calls).toBe(1);
    expect(await snapshot(lease)).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?1').bind(member.userId).first()).toEqual({ n:0 });
  });
  test('actual Auth magic-link handler does not create tokens, mail or sessions for a disabled v2 synthetic identity', async () => {
    const lease=await activeOrganization(),member=await account(lease);
    let mail=0,lookups=0;
    const auth=createIdentityAuth(env as unknown as Env,{
      emailAdapter:{ async send() { mail++; } },
      async beforeMagicLinkEmployeeLookup() { lookups++; },
    });
    const before=await snapshot(lease);
    const tokens=(await env.AUTH_DB.prepare('SELECT * FROM verification ORDER BY rowid').all()).results;
    const messages=(await env.AUTH_DB.prepare('SELECT * FROM local_email_capture ORDER BY rowid').all()).results;
    const response=await auth.handler(new Request('https://operator.example.test/auth/sign-in/magic-link',{
      method:'POST',headers:{ origin:'https://operator.example.test','content-type':'application/json','cf-connecting-ip':'203.0.113.97' },
      body:JSON.stringify({ email:`e2e+${lease.runId}_viewer@e2e.invalid`,callbackURL:'/signed-in' }),
    }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ ok:true });
    expect(lookups).toBe(1); expect(mail).toBe(0);
    expect((await env.AUTH_DB.prepare('SELECT * FROM verification ORDER BY rowid').all()).results).toEqual(tokens);
    expect((await env.AUTH_DB.prepare('SELECT * FROM local_email_capture ORDER BY rowid').all()).results).toEqual(messages);
    expect(await snapshot(lease)).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?1').bind(member.userId).first()).toEqual({ n:0 });
  });
  test.each([false,true])('run-owned unreserved invitation mail capture refuses after fencing (parents deleted=%s)', async deleted => {
    const lease=await activeOrganization(),store=createIdentityControlStore(env.AUTH_DB);
    const recipient=`e2e+${lease.runId}_invited@e2e.invalid`;
    await createInvitationService({ database:env.AUTH_DB,controlRuntime:runtime,publicOrigin:'https://operator.example.test',email:{ async send() {} } })
      .createInvitation(rootPrincipal(lease),{ organizationId:lease.organizationId!,email:recipient,role:'viewer',expiresInSeconds:600,correlationId:'capture' });
    await store.advance(lease.runId,'active','fencing');
    if (deleted) {
      const cleanup=await store.beginCleanup(lease.runId,lease.proofHash,runtime.generation,crypto.randomUUID());
      const disposing=await store.advance(lease.runId,'fencing','disposing');
      await withControlWrite(env.AUTH_DB,runtime,disposing,'dispose',[
        env.AUTH_DB.prepare('DELETE FROM invitations WHERE organization_id=?1').bind(lease.organizationId),
        env.AUTH_DB.prepare('DELETE FROM organizations WHERE id=?1').bind(lease.organizationId),
        env.AUTH_DB.prepare('DELETE FROM client_provisionings WHERE provisioning_id=?1').bind(lease.provisioningId),
        env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='disposed' WHERE run_id=?1").bind(lease.runId),
      ],cleanup);
      expect(await env.AUTH_DB.prepare('SELECT id FROM organizations WHERE id=?1').bind(lease.organizationId).first()).toBeNull();
    }
    const before=(await env.AUTH_DB.prepare('SELECT * FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results;
    await expect(createLocalCaptureEmailAdapter(env.AUTH_DB).send({ to:recipient,subject:'Late',text:'late capture' })).rejects.toThrow();
    expect((await env.AUTH_DB.prepare('SELECT * FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results).toEqual(before);
    const manual=crypto.randomUUID()+'@example.test';
    await createLocalCaptureEmailAdapter(env.AUTH_DB).send({ to:manual,subject:'Manual',text:'normal capture' });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(manual).first()).toEqual({ n:1 });
  });
  test.each(['invited','invited.long-'+ 'x'.repeat(45)])('actual explicitly guarded local adapter delivers active synthetic invitation %s exactly once', async suffix => {
    const lease=await activeOrganization(),recipient=`e2e+${lease.runId}_${suffix}@e2e.invalid`;
    const adapter=createIdentityEmailAdapter({ mode:'local-capture',database:env.AUTH_DB,allowedRecipients:new Set(),controlRuntime:runtime });
    const service=createInvitationService({ database:env.AUTH_DB,controlRuntime:runtime,publicOrigin:'https://operator.example.test',email:adapter });
    const result=await service.createInvitation(rootPrincipal(lease),{ organizationId:lease.organizationId!,email:recipient,role:'viewer',expiresInSeconds:600,correlationId:'real-capture' });
    expect(result.status).toBe('sent');
    const messages=(await env.AUTH_DB.prepare('SELECT recipient,subject,text_body FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ recipient,subject:'You are invited to Incentives Operator',
      text_body:expect.stringMatching(/^Use this single-use invitation before it expires\.\nhttps:\/\/operator\.example\.test\//u) });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM identity_audit WHERE merchant_id=?1').bind(lease.merchantId).first()).toEqual({ n:2 });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n:0 });
  });
  test('actual local capture INSERT pauses at its guarded batch and refuses a concurrent fence', async () => {
    const lease=await activeOrganization(),recipient=`e2e+${lease.runId}_paused@e2e.invalid`;
    await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
        .bind(crypto.randomUUID(),lease.organizationId,recipient,crypto.randomUUID(),Date.now()+600000),
    ]);
    const paused=pausedDatabase(sql=> /INSERT INTO local_email_capture/u.test(sql));
    const operation=createLocalCaptureEmailAdapter(paused.db,runtime).send({ to:recipient,subject:'Invitation',text:'exact body' })
      .then(value=>({ value }),error=>({ error:error as unknown }));
    try {
      expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
      expect(paused.didPause()).toBe(true);
      const before=await snapshot(lease);
      const messages=(await env.AUTH_DB.prepare('SELECT * FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results;
      await createIdentityControlStore(env.AUTH_DB).advance(lease.runId,'active','fencing');
      paused.release();
      expect(await operation).toHaveProperty('error');
      expect(await snapshot(lease)).toEqual(before);
      expect((await env.AUTH_DB.prepare('SELECT * FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results).toEqual(messages);
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n:0 });
    } finally { paused.release(); await operation; }
  });
  test.each(['missing ledger','ambiguous namespace','ambiguous invitations','reserved account','no pending invitation','expired invitation','missing runtime'] as const)(
    'actual local adapter refuses %s synthetic mail authority without row mutation', async failure => {
      const lease=await activeOrganization(),recipient=`e2e+${lease.runId}_invited@e2e.invalid`;
      if (failure==='reserved account') await account(lease,'invited');
      if (failure!=='no pending invitation') await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
        env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
          VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
          .bind(crypto.randomUUID(),lease.organizationId,recipient,crypto.randomUUID(),failure==='expired invitation' ? 0 : Date.now()+600000),
      ]);
      if (failure==='ambiguous invitations') {
        const other=await activeOrganization();
        await withAuthBusinessWrite(env.AUTH_DB,runtime,other.organizationId!,[
          env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
            VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
            .bind(crypto.randomUUID(),other.organizationId,recipient,crypto.randomUUID(),Date.now()+600000),
        ]);
      } else if (failure==='missing ledger') {
        const names=['e2e_control_request_retained','e2e_control_run_retained'];
        for (const name of names) await env.AUTH_DB.prepare('DROP TRIGGER '+name).run();
        try { await env.AUTH_DB.batch([
          env.AUTH_DB.prepare('DELETE FROM e2e_control_requests WHERE run_id=?1').bind(lease.runId),
          env.AUTH_DB.prepare('DELETE FROM e2e_control_runs WHERE run_id=?1').bind(lease.runId),
        ]); } finally { for (const name of names) await env.AUTH_DB.prepare(triggerDDL(name)).run(); }
      } else if (failure==='ambiguous namespace') {
        const names=['e2e_control_organization_marker','e2e_control_organizations_update'];
        for (const name of names) await env.AUTH_DB.prepare('DROP TRIGGER '+name).run();
        try { await env.AUTH_DB.prepare('UPDATE organizations SET merchant_id=?1 WHERE id=?2').bind(crypto.randomUUID(),lease.organizationId).run(); }
        finally { for (const name of names) await env.AUTH_DB.prepare(triggerDDL(name)).run(); }
      }
      const before=await snapshot(lease);
      const messages=(await env.AUTH_DB.prepare('SELECT * FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results;
      await expect(createLocalCaptureEmailAdapter(env.AUTH_DB,failure==='missing runtime' ? undefined : runtime)
        .send({ to:recipient,subject:'Late',text:'exact body' })).rejects.toThrow();
      expect(await snapshot(lease)).toEqual(before);
      expect((await env.AUTH_DB.prepare('SELECT * FROM local_email_capture WHERE recipient=?1').bind(recipient).all()).results).toEqual(messages);
    });
  test('capture SQL rechecks pending invitation after adapter lookup, not only the lease', async () => {
    const lease=await activeOrganization(),recipient=`e2e+${lease.runId}_paused@e2e.invalid`,invitationId=crypto.randomUUID();
    await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
        .bind(invitationId,lease.organizationId,recipient,crypto.randomUUID(),Date.now()+600000),
    ]);
    const paused=pausedDatabase(sql=> /INSERT INTO local_email_capture/u.test(sql));
    const operation=createLocalCaptureEmailAdapter(paused.db,runtime).send({ to:recipient,subject:'Invitation',text:'exact body' })
      .then(value=>({ value }),error=>({ error:error as unknown }));
    try {
      expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
      expect(paused.didPause()).toBe(true);
      await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
        env.AUTH_DB.prepare("UPDATE invitations SET status='sent' WHERE id=?1").bind(invitationId),
      ]);
      const before=await snapshot(lease);
      paused.release();
      expect(await operation).toHaveProperty('error');
      expect(await snapshot(lease)).toEqual(before);
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(recipient).first()).toEqual({ n:0 });
    } finally { paused.release(); await operation; }
  });
  test('capture SQL rejects a foreign synthetic recipient even inside another live organization guard', async () => {
    const first=await activeOrganization(),second=await activeOrganization(),recipient=`e2e+${second.runId}_invited@e2e.invalid`;
    const owned=await account(first);
    await withAuthBusinessWrite(env.AUTH_DB,runtime,second.organizationId!,[
      env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
        .bind(crypto.randomUUID(),second.organizationId,recipient,crypto.randomUUID(),Date.now()+600000),
    ]);
    const before=await snapshot(first);
    await expect(withAuthBusinessWrite(env.AUTH_DB,runtime,first.organizationId!,[
      env.AUTH_DB.prepare("UPDATE memberships SET role='operator' WHERE id=?1").bind(owned.membershipId),
      env.AUTH_DB.prepare(`INSERT INTO local_email_capture (id,recipient,subject,text_body,created_at) VALUES (?1,?2,'Crossed','Crossed',0)`)
        .bind(crypto.randomUUID(),recipient),
    ])).rejects.toThrow();
    expect(await snapshot(first)).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(recipient).first()).toEqual({ n:0 });
  });
  test('a valid business guard cannot author mail for a reserved controller account', async () => {
    const lease=await activeOrganization(),member=await account(lease,'invited'),recipient=`e2e+${lease.runId}_invited@e2e.invalid`;
    await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
        .bind(crypto.randomUUID(),lease.organizationId,recipient,crypto.randomUUID(),Date.now()+600000),
    ]);
    const before=await snapshot(lease);
    await expect(withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare("UPDATE memberships SET role='operator' WHERE id=?1").bind(member.membershipId),
      env.AUTH_DB.prepare(`INSERT INTO local_email_capture (id,recipient,subject,text_body,created_at) VALUES (?1,?2,'Forbidden','Forbidden',0)`)
        .bind(crypto.randomUUID(),recipient),
    ])).rejects.toThrow();
    expect(await snapshot(lease)).toEqual(before);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(recipient).first()).toEqual({ n:0 });
  });
  test('real/shared recipients and literal-prefix or exact-domain near misses retain unowned capture behavior', async () => {
    const first=await activeOrganization(),second=await activeOrganization(),recipient='shared-'+crypto.randomUUID()+'@example.test';
    for (const lease of [first,second]) {
      await createInvitationService({ database:env.AUTH_DB,controlRuntime:runtime,publicOrigin:'https://operator.example.test',email:{ async send() {} } })
        .createInvitation(rootPrincipal(lease),{ organizationId:lease.organizationId!,email:recipient,role:'viewer',expiresInSeconds:600,correlationId:'shared' });
      await createIdentityControlStore(env.AUTH_DB).advance(lease.runId,'active','fencing');
    }
    const recipients=[recipient,`e2e+${first.runId.replace('e2e_','e2eX')}_invited@e2e.invalid`,
      `e2e+${first.runId}_invited@e2e.invalid.example.test`];
    for (const to of recipients) {
      await createLocalCaptureEmailAdapter(env.AUTH_DB).send({ to,subject:'Unowned',text:'unchanged' });
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(to).first()).toEqual({ n:1 });
    }
  });
  test('ordinary ROOT v1 provisioning retry cannot write or invoke Core for a v2 reservation', async () => {
    const proof='A'.repeat(43);
    const proofHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const lease=await activeOrganization(proofHash),before=await snapshot(lease);
    let calls=0;
    const service=createOrganizationService({ database:env.AUTH_DB,appEnv:'staging',core:{
      async provisionMerchant() { calls++; throw new Error('Unexpected Core'); },
      async activateMerchant() { calls++; throw new Error('Unexpected Core'); },
    } });
    await expect(service.provisionClient(rootPrincipal(lease),{ merchantId:lease.merchantId,provisioningId:lease.provisioningId,
      name:lease.runId+'_merchant',correlationId:'legacy-retry',e2eRun:{ runId:lease.runId,proof } })).rejects.toThrow();
    expect(calls).toBe(0);
    expect(await snapshot(lease)).toEqual(before);
  });

  test('manual and v1 Auth provisioning, invitation acceptance, fixture and disposal source flows remain compatible', async () => {
    const proof='A'.repeat(43);
    const proofHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    for (const v1 of [false,true]) {
      const tuple={ ...reservation(),proofHash };
      const principal=rootPrincipal({ ...tuple,organizationId:crypto.randomUUID(),issuedAt:0,expiresAt:900000,phase:'reserved' });
      const organizations=createOrganizationService({ database:env.AUTH_DB,appEnv:'staging',core:{
        async provisionMerchant(_context,input) { return { ok:true,value:{ id:input.id,name:input.name,provisioningId:input.provisioningId,
          status:'provisioning',createdAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-12T00:00:00.000Z' } }; },
        async activateMerchant(_context,input) { return { ok:true,value:{ id:input.id,name:tuple.runId+'_merchant',provisioningId:input.provisioningId,
          status:'active',createdAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-12T00:00:00.000Z' } }; },
      } });
      const provisioned=await organizations.provisionClient(principal,{ merchantId:tuple.merchantId,provisioningId:tuple.provisioningId,
        name:tuple.runId+'_merchant',correlationId:'legacy',...(v1 ? { e2eRun:{ runId:tuple.runId,proof } } : {}) });
      expect(provisioned.status).toBe('active');
      const organizationId=provisioned.organizationId!;
      expect(await env.AUTH_DB.prepare('SELECT e2e_control_run_id FROM organizations WHERE id=?1').bind(organizationId).first()).toEqual({ e2e_control_run_id:null });
      let recorded='';
      const invitations=createInvitationService({ database:env.AUTH_DB,publicOrigin:'https://operator.example.test',email:{ async send(message) {
        recorded=message.text; await createLocalCaptureEmailAdapter(env.AUTH_DB).send(message);
      } } });
      const email=`e2e+${tuple.runId}_accepted@e2e.invalid`;
      const invited=await invitations.createInvitation(principal,{ organizationId,email,role:'viewer',expiresInSeconds:600,correlationId:'legacy' });
      expect(invited.status).toBe('sent');
      expect(await invitations.retryInvitation(principal,invited.id,'legacy-retry')).toMatchObject({ status:'sent' });
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(email).first()).toEqual({ n:2 });
      const url=recorded.match(/https:\/\/\S+/u)?.[0];
      if (!url) throw new Error('Missing recorded URL');
      const token=new URL(url).searchParams.get('token');
      if (!token) throw new Error('Missing recorded token');
      const accepted=await invitations.acceptInvitation({ token,email,correlationId:'legacy-accept' });
      expect(await env.AUTH_DB.prepare('SELECT email_login_enabled FROM auth_profile WHERE user_id=?1').bind(accepted.userId).first()).toEqual({ email_login_enabled:1 });
      expect(await organizations.changeMemberRole(principal,{ membershipId:accepted.id,role:'operator',correlationId:'legacy-role' })).toMatchObject({ role:'operator' });
      if (v1) {
        let sessions=0;
        const fixtures=createIdentityE2eFixtures({ database:env.AUTH_DB,appEnv:'staging',async createSession(userId) {
          sessions++;
          const sessionId=crypto.randomUUID(),now=Date.now();
          await env.AUTH_DB.prepare(`INSERT INTO session (id,userId,token,createdAt,updatedAt,expiresAt,authenticationMethod,authenticatedAt,recoveryOnly)
            VALUES (?1,?2,?3,?4,?4,?5,'e2e-fixture',?4,0)`).bind(sessionId,userId,crypto.randomUUID(),now,now+900000).run();
          return { sessionId,cookieHeader:'test-only-fixture-cookie' };
        } });
        const created=await fixtures.createAccount({ runId:tuple.runId,merchantId:tuple.merchantId,provisioningId:tuple.provisioningId,proofHash,
          slug:'legacy_fixture',role:'viewer' },'fixture-root','legacy-fixture');
        expect(created.role).toBe('viewer'); expect(sessions).toBe(1);
        expect(await env.AUTH_DB.prepare('SELECT control_version FROM e2e_run_claims WHERE run_id=?1').bind(tuple.runId).first()).toEqual({ control_version:1 });
        const disposed=await createIdentityE2eLifecycle({ database:env.AUTH_DB,appEnv:'staging',core:{
          async preview() { return { status:'active',counts:{ merchants:1 } }; },
          async dispose() { return { status:'disposed',counts:{ merchants:0 } }; },
        } }).dispose({ runId:tuple.runId,merchantId:tuple.merchantId,provisioningId:tuple.provisioningId,proofHash },'fixture-root','legacy-dispose');
        expect(disposed.status).toBe('disposed');
        expect(Object.values(disposed.auth).every(n=>n===0)).toBe(true);
      }
    }
  });
  // Removing the atomic SQL admission check would persist the ninth row.
  test('admits exactly eight simultaneous leases per target', async () => {
    const store = createIdentityControlStore(env.AUTH_DB);
    const targetId = '1'.repeat(64);
    const outcomes = await Promise.allSettled(Array.from({ length: 9 }, () => store.reserve(reservation(targetId))));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(8);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_runs WHERE target_id = ?1')
      .bind(targetId).first()).toEqual({ n: 8 });
    expect(await store.reserve(reservation('2'.repeat(64)))).toMatchObject({ phase: 'reserved' });
  });
  test.each(['live same tuple','live fresh tenant IDs','disposed same tuple','disposed fresh tenant IDs'] as const)(
    'FIX1 v1 collision: Auth %s refuses before any durable v2 reservation', async scenario => {
      const input=reservation(),now=Date.now(),original={ ...input,organizationId:crypto.randomUUID(),issuedAt:now,expiresAt:now+900000,phase:'active' as const };
      const userId=crypto.randomUUID(),membershipId=crypto.randomUUID();
      await env.AUTH_DB.batch([
        env.AUTH_DB.prepare(`INSERT INTO client_provisionings
          (provisioning_id,merchant_id,organization_id,name,status,current_step,retryable,attempt_count,created_at,updated_at,correlation_id)
          VALUES (?1,?2,?3,?4,'active','complete',0,1,?5,?5,'legacy-collision')`)
          .bind(input.provisioningId,input.merchantId,original.organizationId,input.runId+'_merchant',now),
        env.AUTH_DB.prepare(`INSERT INTO organizations (id,merchant_id,provisioning_id,name,status,created_at,updated_at)
          VALUES (?1,?2,?3,?4,'active',?5,?5)`).bind(original.organizationId,input.merchantId,input.provisioningId,input.runId+'_merchant',now),
        env.AUTH_DB.prepare(`INSERT INTO e2e_run_claims (run_id,merchant_id,provisioning_id,proof_hash,status,created_at)
          VALUES (?1,?2,?3,?4,'active',?5)`).bind(input.runId,input.merchantId,input.provisioningId,input.proofHash,now),
        env.AUTH_DB.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt)
          VALUES (?1,'Legacy',?2,0,?3,?3)`).bind(userId,`e2e+${input.runId}_legacy@e2e.invalid`,now),
        env.AUTH_DB.prepare("INSERT INTO auth_profile (user_id,subject_kind,status,email_login_enabled) VALUES (?1,'employee','active',0)").bind(userId),
        env.AUTH_DB.prepare(`INSERT INTO memberships (id,organization_id,user_id,role,status,created_at,updated_at)
          VALUES (?1,?2,?3,'viewer','active',?4,?4)`).bind(membershipId,original.organizationId,userId,now),
      ]);
      let productDisposed=false;
      const lifecycle=createIdentityE2eLifecycle({ database:env.AUTH_DB,appEnv:'staging',core:{
        async preview() { return { status:productDisposed ? 'disposed' : 'active',counts:{ merchants:productDisposed ? 0 : 1 } }; },
        async dispose() { productDisposed=true; return { status:'disposed',counts:{ merchants:0 } }; },
      } });
      const identity={ runId:input.runId,merchantId:input.merchantId,provisioningId:input.provisioningId,proofHash:input.proofHash };
      if (scenario.startsWith('disposed')) expect((await lifecycle.dispose(identity,'fixture-root','legacy-collision')).status).toBe('disposed');
      const before=await snapshot(original),claim=await env.AUTH_DB.prepare('SELECT * FROM e2e_run_claims WHERE run_id=?1').bind(input.runId).first();
      const proposed=scenario.endsWith('fresh tenant IDs') ? { ...input,merchantId:crypto.randomUUID(),provisioningId:crypto.randomUUID() } : input;
      await expect(createIdentityControlStore(env.AUTH_DB).reserve(proposed)).rejects.toThrow();
      expect(await env.AUTH_DB.prepare(`SELECT
        (SELECT COUNT(*) FROM e2e_control_runs WHERE run_id=?1 OR merchant_id=?2 OR provisioning_id=?3) AS runs,
        (SELECT COUNT(*) FROM e2e_control_requests WHERE run_id=?1) AS requests,
        (SELECT COUNT(*) FROM e2e_run_claims WHERE run_id=?1 OR merchant_id=?2 OR provisioning_id=?3) AS claims`)
        .bind(input.runId,proposed.merchantId,proposed.provisioningId).first()).toEqual({ runs:0,requests:0,claims:1 });
      expect(await env.AUTH_DB.prepare('SELECT * FROM e2e_run_claims WHERE run_id=?1').bind(input.runId).first()).toEqual(claim);
      expect(await snapshot(original)).toEqual(before);
      if (scenario.endsWith('fresh tenant IDs')) expect(await env.AUTH_DB.prepare(`SELECT
        (SELECT COUNT(*) FROM organizations WHERE merchant_id=?1) AS organizations,
        (SELECT COUNT(*) FROM client_provisionings WHERE merchant_id=?1) AS provisionings`).bind(proposed.merchantId).first()).toEqual({ organizations:0,provisionings:0 });
      if (scenario.startsWith('live')) {
        expect(await createOrganizationService({ database:env.AUTH_DB }).changeMemberRole(rootPrincipal(original),{
          membershipId,role:'operator',correlationId:'legacy-compatible' })).toMatchObject({ role:'operator' });
      }
      const disposed=await lifecycle.dispose(identity,'fixture-root','legacy-collision');
      expect(disposed.status).toBe('disposed'); expect(Object.values(disposed.auth).every(n=>n===0)).toBe(true);
    });

  test('an identical retry preserves the original organization, issuance and deadline', async () => {
    const store = createIdentityControlStore(env.AUTH_DB);
    const input = reservation();
    const first = await store.reserve(input);
    expect(await store.reserve(input)).toEqual(first);
    expect(first.organizationId).toMatch(/^[a-f0-9-]{36}$/u);
    expect(first.expiresAt - first.issuedAt).toBe(900_000);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_runs WHERE run_id = ?1')
      .bind(input.runId).first()).toEqual({ n: 1 });
  });
  test('FIX1 reserved organization rejects an FK-valid foreign tuple and rolls provisioning back', async () => {
    const lease=await createIdentityControlStore(env.AUTH_DB).reserve(reservation());
    const foreignMerchant=crypto.randomUUID(),foreignProvisioning=crypto.randomUUID();
    const provisioning=(merchantId:string,provisioningId:string) => env.AUTH_DB.prepare(`INSERT INTO client_provisionings
      (provisioning_id,merchant_id,organization_id,name,status,current_step,retryable,attempt_count,created_at,updated_at,correlation_id)
      VALUES (?1,?2,?3,'Reserved','provisioning','identity_organization',0,1,?4,?4,'reserved-org')`)
      .bind(provisioningId,merchantId,lease.organizationId,lease.issuedAt);
    const organization=(merchantId:string,provisioningId:string,marker:string|null) => env.AUTH_DB.prepare(`INSERT INTO organizations
      (id,merchant_id,provisioning_id,name,status,created_at,updated_at,e2e_control_run_id)
      VALUES (?1,?2,?3,'Reserved','provisioning',?4,?4,?5)`)
      .bind(lease.organizationId,merchantId,provisioningId,lease.issuedAt,marker);
    await expect(withControlWrite(env.AUTH_DB,runtime,lease,'provision',[
      provisioning(foreignMerchant,foreignProvisioning),organization(foreignMerchant,foreignProvisioning,null),
    ])).rejects.toThrow();
    expect(await env.AUTH_DB.prepare(`SELECT
      (SELECT COUNT(*) FROM client_provisionings WHERE provisioning_id=?1 OR merchant_id=?2) AS provisionings,
      (SELECT COUNT(*) FROM organizations WHERE id=?3 OR merchant_id=?2) AS organizations,
      (SELECT COUNT(*) FROM e2e_control_write_guards WHERE run_id=?4) AS guards`)
      .bind(foreignProvisioning,foreignMerchant,lease.organizationId,lease.runId).first()).toEqual({ provisionings:0,organizations:0,guards:0 });
    await withControlWrite(env.AUTH_DB,runtime,lease,'provision',[
      provisioning(lease.merchantId,lease.provisioningId),organization(lease.merchantId,lease.provisioningId,lease.runId),
    ]);
    expect(await env.AUTH_DB.prepare('SELECT merchant_id,provisioning_id,e2e_control_run_id FROM organizations WHERE id=?1')
      .bind(lease.organizationId).first()).toEqual({ merchant_id:lease.merchantId,provisioning_id:lease.provisioningId,e2e_control_run_id:lease.runId });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards WHERE run_id=?1').bind(lease.runId).first()).toEqual({ n:0 });
  });
  test('Auth durable identities and deadlines are immutable and phase/quarantine cannot reopen', async () => {
    const store=createIdentityControlStore(env.AUTH_DB),reserved=await store.reserve(reservation());
    const before=await store.read(reserved.runId);
    for (const [field,value] of [['merchant_id',crypto.randomUUID()],['provisioning_id',crypto.randomUUID()],['organization_id',crypto.randomUUID()],
      ['generation','f'.repeat(40)],['target_id','f'.repeat(64)],['proof_hash','f'.repeat(64)],['controller_hash','f'.repeat(64)],
      ['request_id',crypto.randomUUID()],['payload_hash','f'.repeat(64)],['account_quota',4]] as const) {
      await expect(env.AUTH_DB.prepare('UPDATE e2e_control_runs SET '+field+'=?1 WHERE run_id=?2').bind(value,reserved.runId).run()).rejects.toThrow();
      expect(await store.read(reserved.runId)).toEqual(before);
    }
    await expect(env.AUTH_DB.prepare('UPDATE e2e_control_runs SET issued_at=issued_at+1,expires_at=expires_at+1 WHERE run_id=?1').bind(reserved.runId).run()).rejects.toThrow();
    await expect(store.advance(reserved.runId,'active','fencing')).rejects.toThrow();
    await store.quarantine(reserved.runId);
    await expect(store.advance(reserved.runId,'quarantined','active')).rejects.toThrow();
    expect((await store.read(reserved.runId))?.phase).toBe('quarantined');
  });
  test('Auth cleanup retry is immutable and an expired invocation cannot remove business rows', async () => {
    const lease=await activeOrganization(),member=await account(lease),store=createIdentityControlStore(env.AUTH_DB);
    const requestId=crypto.randomUUID(),cleanup=await store.beginCleanup(lease.runId,lease.proofHash,runtime.generation,requestId);
    expect(await store.beginCleanup(lease.runId,lease.proofHash,runtime.generation,requestId)).toEqual(cleanup);
    await expect(store.beginCleanup(lease.runId,'f'.repeat(64),runtime.generation,requestId)).rejects.toThrow();
    await expect(store.beginCleanup(lease.runId,lease.proofHash,'f'.repeat(40),requestId)).rejects.toThrow();
    await expect(env.AUTH_DB.prepare('UPDATE e2e_control_cleanup SET expires_at=expires_at+1,issued_at=issued_at+1 WHERE id=?1').bind(cleanup.id).run()).rejects.toThrow();
    await store.advance(lease.runId,'active','fencing');
    await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_cleanup_immutable').run();
    try { await env.AUTH_DB.prepare('UPDATE e2e_control_cleanup SET issued_at=0,expires_at=300000 WHERE id=?1').bind(cleanup.id).run(); }
    finally { await env.AUTH_DB.prepare(triggerDDL('e2e_control_cleanup_immutable')).run(); }
    const aged=await store.beginCleanup(lease.runId,lease.proofHash,runtime.generation,requestId);
    expect(aged).toEqual({ ...cleanup,issuedAt:0,expiresAt:300000 });
    const before=await snapshot(lease);
    await expect(withControlWrite(env.AUTH_DB,runtime,(await store.read(lease.runId))!,'dispose',[
      env.AUTH_DB.prepare('DELETE FROM memberships WHERE id=?1').bind(member.membershipId),
    ],aged)).rejects.toThrow();
    expect(await snapshot(lease)).toEqual(before);
  });

  test('rejects equal request ID with an altered payload without adding a lease', async () => {
    const store = createIdentityControlStore(env.AUTH_DB);
    const input = reservation();
    await store.reserve(input);
    await expect(store.reserve({ ...reservation(), requestId: input.requestId, payloadHash: 'f'.repeat(64) }))
      .rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_runs WHERE request_id = ?1')
      .bind(input.requestId).first()).toEqual({ n: 1 });
  });

  test('concurrent account reservations enforce quota and unique run slug before users exist', async () => {
    const reserved = await createIdentityControlStore(env.AUTH_DB).reserve(reservation());
    const insert = (slug: string) => env.AUTH_DB.prepare(`INSERT INTO e2e_control_accounts
      (run_id, slug, user_id, membership_id, generation, role, state)
      VALUES (?1, ?2, ?3, ?4, ?5, 'viewer', 'reserved')`)
      .bind(reserved.runId, slug, crypto.randomUUID(), crypto.randomUUID(), reserved.generation).run();
    const outcomes = await Promise.allSettled(['first', 'second', 'third', 'fourth', 'first'].map(insert));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(3);
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_accounts WHERE run_id = ?1')
      .bind(reserved.runId).first()).toEqual({ n: 3 });
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM user JOIN e2e_control_accounts a ON a.user_id=user.id WHERE a.run_id=?1')
      .bind(reserved.runId).first()).toEqual({ n: 0 });
  });

  test('cleanup authority cannot create an invitation', async () => {
    const lease = await activeOrganization();
    const store = createIdentityControlStore(env.AUTH_DB);
    await store.advance(lease.runId,'active','fencing');
    const disposing = await store.advance(lease.runId,'fencing','disposing');
    const cleanup = await store.beginCleanup(lease.runId,lease.proofHash,runtime.generation,crypto.randomUUID());
    await expect(withControlWrite(env.AUTH_DB,runtime,disposing,'dispose',[
      env.AUTH_DB.prepare(`INSERT INTO invitations
        (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,'late@example.test','viewer',?3,'pending','root',?4,?5,?5)`)
        .bind(crypto.randomUUID(),lease.organizationId,crypto.randomUUID(),lease.expiresAt,lease.issuedAt),
    ],cleanup)).rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM invitations WHERE organization_id=?1')
      .bind(lease.organizationId).first()).toEqual({ n:0 });
  });

  test('expired session deletion permits its fixture-record cascade without creation authority', async () => {
    const lease = await activeOrganization();
    const member = await account(lease);
    const sessionId = 'opaque-fixture-session-'+crypto.randomUUID();
    await withControlWrite(env.AUTH_DB,runtime,lease,'provision',[
      env.AUTH_DB.prepare("UPDATE e2e_control_accounts SET state='issuing',session_id=?1 WHERE run_id=?2 AND slug='viewer'")
        .bind(sessionId,lease.runId),
    ]);
    const now = Date.now();
    await env.AUTH_DB.prepare(`INSERT INTO session
      (id,userId,token,createdAt,updatedAt,expiresAt,authenticationMethod,authenticatedAt,recoveryOnly)
      VALUES (?1,?2,?3,?4,?4,?5,'e2e-fixture',?4,0)`)
      .bind(sessionId,member.userId,crypto.randomUUID(),now,lease.expiresAt).run();
    await withControlWrite(env.AUTH_DB,runtime,lease,'provision',[
      env.AUTH_DB.prepare(`INSERT INTO e2e_fixture_sessions
        (session_id,user_id,run_id,merchant_id,issued_at,hard_expires_at) VALUES (?1,?2,?3,?4,?5,?6)`)
        .bind(sessionId,member.userId,lease.runId,lease.merchantId,now,now+900_000),
    ]);
    // Age only the local persisted fixture, then restore production immutability before DELETE.
    await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_session_update').run();
    try {
      await env.AUTH_DB.prepare('UPDATE session SET expiresAt=0 WHERE id=?1').bind(sessionId).run();
    } finally {
      await env.AUTH_DB.prepare(triggerDDL('e2e_control_session_update')).run();
    }
    expect(await env.AUTH_DB.prepare(`SELECT expiresAt < CAST(unixepoch('subsec') * 1000 AS INTEGER) AS expired
      FROM session WHERE id=?1`).bind(sessionId).first()).toEqual({ expired:1 });
    expect(await env.AUTH_DB.prepare('SELECT hard_expires_at-issued_at AS lifetime FROM e2e_fixture_sessions WHERE session_id=?1')
      .bind(sessionId).first()).toEqual({ lifetime:900000 });
    await env.AUTH_DB.prepare('DELETE FROM session WHERE id=?1').bind(sessionId).run();
    expect(await env.AUTH_DB.prepare('SELECT id FROM session WHERE id=?1').bind(sessionId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT session_id FROM e2e_fixture_sessions WHERE session_id=?1').bind(sessionId).first()).toBeNull();
  });

  test.each(['profile','account','passkey','audit'] as const)
    ('a permanent user marker refuses %s writes when its account/run ledgers are missing', async mutation => {
      const lease = await activeOrganization();
      const member = await account(lease);
      const retained = ['e2e_control_account_retained','e2e_control_request_retained','e2e_control_run_retained'];
      try {
        for (const name of retained) await env.AUTH_DB.prepare('DROP TRIGGER '+name).run();
        await env.AUTH_DB.batch([
          env.AUTH_DB.prepare('DELETE FROM e2e_control_accounts WHERE run_id=?1').bind(lease.runId),
          env.AUTH_DB.prepare('DELETE FROM e2e_control_requests WHERE run_id=?1').bind(lease.runId),
          env.AUTH_DB.prepare('DELETE FROM e2e_control_runs WHERE run_id=?1').bind(lease.runId),
        ]);
        const statements = {
          profile: env.AUTH_DB.prepare('UPDATE auth_profile SET email_login_enabled=1 WHERE user_id=?1').bind(member.userId),
          account: env.AUTH_DB.prepare(`INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt)
            VALUES (?1,'new','credential',?2,0,0)`).bind(crypto.randomUUID(),member.userId),
          passkey: env.AUTH_DB.prepare(`INSERT INTO passkey (id,publicKey,userId,credentialID,counter,deviceType,backedUp)
            VALUES (?1,'public',?2,?3,0,'singleDevice',0)`).bind(crypto.randomUUID(),member.userId,crypto.randomUUID()),
          audit: env.AUTH_DB.prepare(`INSERT INTO identity_audit
            (id,occurred_at,actor_kind,actor_id,action,target_type,target_id,outcome,correlation_id)
            VALUES (?1,0,'member',?2,'late.business','user',?2,'succeeded','late')`).bind(crypto.randomUUID(),member.userId),
        };
        const snapshot = () => env.AUTH_DB.prepare(`SELECT
          (SELECT email_login_enabled FROM auth_profile WHERE user_id=?1) AS emailLogin,
          (SELECT COUNT(*) FROM account WHERE userId=?1) AS accounts,
          (SELECT COUNT(*) FROM passkey WHERE userId=?1) AS passkeys,
          (SELECT COUNT(*) FROM identity_audit WHERE actor_id=?1) AS audits`).bind(member.userId).first();
        const before = await snapshot();
        await expect(createIdentityControlStore(env.AUTH_DB).read(lease.runId)).rejects.toThrow();
        await expect(createIdentityControlStore(env.AUTH_DB).reserve({
          runId:lease.runId,merchantId:lease.merchantId,provisioningId:lease.provisioningId,
          generation:lease.generation,targetId:lease.targetId,proofHash:lease.proofHash,
          controllerHash:lease.controllerHash,requestId:lease.requestId,payloadHash:lease.payloadHash,accountQuota:lease.accountQuota,
        })).rejects.toThrow();
        await expect(statements[mutation].run()).rejects.toThrow();
        expect(await snapshot()).toEqual(before);
      } finally {
        for (const name of retained) await env.AUTH_DB.prepare(triggerDDL(name)).run();
      }
    });
  test.each([
    ['account','insert removed'],['account','insert active'],['account','update OLD user'],['account','update NEW user'],['account','delete'],
    ['account and run','insert removed'],['account and run','insert active'],['account and run','update OLD user'],['account and run','update NEW user'],['account and run','delete'],
  ] as const)('FIX1 retained membership %s missing: %s refuses and preserves manual rows', async (missing,operation) => {
    const fixture=await corruptedMembershipFixture(missing,operation),before=await fixture.rows();
    await expect(env.AUTH_DB.batch(fixture.statements)).rejects.toThrow();
    expect(await fixture.rows()).toEqual(before);
  });
  test.each(['guarded role update','guarded delete'] as const)(
    'FIX1 retained membership missing account: %s cannot borrow its original live guard', async operation => {
      const fixture=await corruptedMembershipFixture('account',operation),before=await fixture.rows();
      await expect(withAuthBusinessWrite(env.AUTH_DB,runtime,fixture.lease.organizationId!,fixture.statements)).rejects.toThrow();
      expect(await fixture.rows()).toEqual(before);
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards WHERE run_id=?1').bind(fixture.lease.runId).first()).toEqual({ n:0 });
    });

  test.each(['session','user','run','merchant','issuedAt'] as const)
    ('a fixture issuance record rejects crossed %s while preserving exact stored rows', async changed => {
      const lease = await activeOrganization();
      const other = await activeOrganization();
      const first = await issuingAccount(lease);
      const sibling = await issuingAccount(lease,'sibling');
      const foreign = await issuingAccount(other);
      await first.insert.run();
      await sibling.insert.run();
      await foreign.insert.run();
      const values = { sessionId:first.sessionId,userId:first.userId,runId:lease.runId,
        merchantId:lease.merchantId,issuedAt:first.issuedAt };
      if (changed==='session') values.sessionId=foreign.sessionId;
      if (changed==='user') values.userId=sibling.userId;
      if (changed==='run') values.runId=other.runId;
      if (changed==='merchant') values.merchantId=other.merchantId;
      if (changed==='issuedAt') values.issuedAt++;
      const record = (input:typeof values) => env.AUTH_DB.prepare(`INSERT INTO e2e_fixture_sessions
        (session_id,user_id,run_id,merchant_id,issued_at,hard_expires_at)
        VALUES (?1,?2,?3,?4,?5,?6)`)
        .bind(input.sessionId,input.userId,input.runId,input.merchantId,input.issuedAt,input.issuedAt+900000);
      await expect(withControlWrite(env.AUTH_DB,runtime,lease,'provision',[record(values)])).rejects.toThrow();
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM e2e_fixture_sessions WHERE run_id IN (?1,?2)')
        .bind(lease.runId,other.runId).first()).toEqual({ n:0 });
      await withControlWrite(env.AUTH_DB,runtime,lease,'provision',[record({
        sessionId:first.sessionId,userId:first.userId,runId:lease.runId,merchantId:lease.merchantId,issuedAt:first.issuedAt,
      })]);
      expect(await env.AUTH_DB.prepare('SELECT user_id,run_id,merchant_id,issued_at,hard_expires_at FROM e2e_fixture_sessions WHERE session_id=?1')
        .bind(first.sessionId).first()).toEqual({ user_id:first.userId,run_id:lease.runId,merchant_id:lease.merchantId,
          issued_at:first.issuedAt,hard_expires_at:first.issuedAt+900000 });
    });

  test('a reserved issuance intent cannot create or refresh a session after fencing', async () => {
    const lease = await activeOrganization();
    const member = await issuingAccount(lease);
    const existing = await issuingAccount(lease,'existing');
    await existing.insert.run();
    const before = await env.AUTH_DB.prepare('SELECT * FROM session WHERE id=?1').bind(existing.sessionId).first();
    await createIdentityControlStore(env.AUTH_DB).advance(lease.runId,'active','fencing');
    await expect(member.insert.run()).rejects.toThrow();
    await expect(env.AUTH_DB.prepare('UPDATE session SET updatedAt=updatedAt+1 WHERE id=?1').bind(existing.sessionId).run()).rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT * FROM session WHERE id=?1').bind(existing.sessionId).first()).toEqual(before);
    await expect(account(lease,'late')).rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?1').bind(member.userId).first()).toEqual({ n:0 });
    expect(await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM identity_audit WHERE action='session.created' AND actor_id=?1")
      .bind(member.userId).first()).toEqual({ n:0 });
    expect(await env.AUTH_DB.prepare('SELECT state FROM e2e_control_accounts WHERE user_id=?1').bind(member.userId).first())
      .toEqual({ state:'issuing' });
  });
  test.each(['missing SID','wrong generation','not issuing','missing claim','wrong method','sliding expiry'] as const)(
    'actual session INSERT refuses %s issuance authority and creates no session or audit', async changed => {
      const lease=await activeOrganization();
      const member=await issuingAccount(lease);
      let statement=member.insert;
      if (changed==='wrong generation' || changed==='not issuing') {
        await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_account_immutable').run();
        try {
          await env.AUTH_DB.prepare(changed==='wrong generation'
            ? 'UPDATE e2e_control_accounts SET generation=?1 WHERE run_id=?2'
            : 'UPDATE e2e_control_accounts SET state=?1 WHERE run_id=?2')
            .bind(changed==='wrong generation' ? 'f'.repeat(40) : 'reserved',lease.runId).run();
        } finally { await env.AUTH_DB.prepare(triggerDDL('e2e_control_account_immutable')).run(); }
      } else if (changed==='missing claim') {
        await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_claim_retained').run();
        try { await env.AUTH_DB.prepare('DELETE FROM e2e_run_claims WHERE run_id=?1').bind(lease.runId).run(); }
        finally { await env.AUTH_DB.prepare(triggerDDL('e2e_control_claim_retained')).run(); }
      } else {
        statement=env.AUTH_DB.prepare(`INSERT INTO session
          (id,userId,token,createdAt,updatedAt,expiresAt,authenticationMethod,authenticatedAt,recoveryOnly)
          VALUES (?1,?2,?3,?4,?4,?5,?6,?4,0)`)
          .bind(changed==='missing SID' ? crypto.randomUUID() : member.sessionId,member.userId,crypto.randomUUID(),member.issuedAt,
            changed==='sliding expiry' ? lease.expiresAt+1 : lease.expiresAt,changed==='wrong method' ? 'magic-link' : 'e2e-fixture');
      }
      const before=await snapshot(lease);
      await expect(statement.run()).rejects.toThrow();
      expect(await snapshot(lease)).toEqual(before);
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?1').bind(member.userId).first()).toEqual({ n:0 });
    });
  test('a crossed membership UPDATE checks organization and retained user scopes before writing', async () => {
    const first=await activeOrganization(),second=await activeOrganization();
    const member=await account(first);
    const beforeFirst=await snapshot(first),beforeSecond=await snapshot(second);
    await expect(withAuthBusinessWrite(env.AUTH_DB,runtime,first.organizationId!,[
      env.AUTH_DB.prepare('UPDATE memberships SET organization_id=?1 WHERE id=?2').bind(second.organizationId,member.membershipId),
    ])).rejects.toThrow();
    expect(await snapshot(first)).toEqual(beforeFirst);
    expect(await snapshot(second)).toEqual(beforeSecond);
  });
  test.each(['missing','generation','target','disabled'] as const)('Auth real role mutation refuses %s runtime', async changed => {
    const lease=await activeOrganization(),member=await account(lease),before=await snapshot(lease);
    const incompatible=changed==='missing' ? undefined : { ...runtime,...(changed==='generation' ? { generation:'f'.repeat(40) }
      : changed==='target' ? { targetId:'f'.repeat(64) } : { enabled:false }) };
    await expect(createOrganizationService({ database:env.AUTH_DB,...(incompatible ? { controlRuntime:incompatible } : {}) })
      .changeMemberRole(rootPrincipal(lease),{ membershipId:member.membershipId,role:'operator',correlationId:'invalid-runtime' })).rejects.toThrow();
    expect(await snapshot(lease)).toEqual(before);
  });

  test('fixture session expiry and identity cannot slide and its created audit cannot replay', async () => {
    const lease = await activeOrganization();
    const member = await issuingAccount(lease);
    await member.insert.run();
    const before = await env.AUTH_DB.prepare('SELECT * FROM session WHERE id=?1').bind(member.sessionId).first();
    await expect(env.AUTH_DB.prepare('UPDATE session SET expiresAt=expiresAt+1 WHERE id=?1').bind(member.sessionId).run()).rejects.toThrow();
    await expect(env.AUTH_DB.prepare('UPDATE session SET token=?1 WHERE id=?2').bind('changed',member.sessionId).run()).rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT * FROM session WHERE id=?1').bind(member.sessionId).first()).toEqual(before);
    await expect(env.AUTH_DB.prepare(`INSERT INTO identity_audit
      (id,occurred_at,actor_kind,actor_id,merchant_id,action,target_type,target_id,outcome,correlation_id)
      VALUES (?1,?2,'member',?3,?4,'session.created','session',?5,'succeeded','replay')`)
      .bind(crypto.randomUUID(),member.issuedAt,member.userId,lease.merchantId,member.sessionId).run()).rejects.toThrow();
    expect(await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM identity_audit WHERE target_type='session' AND target_id=?1")
      .bind(member.sessionId).first()).toEqual({ n:1 });
  });

  test('issuing session authority refuses a membership role changed after its durable account reservation', async () => {
    const lease = await activeOrganization();
    const member = await issuingAccount(lease);
    await createOrganizationService({ database:env.AUTH_DB,controlRuntime:runtime }).changeMemberRole(rootPrincipal(lease),{
      membershipId:member.membershipId,role:'operator',correlationId:'changed-before-issuance',
    });
    await expect(member.insert.run()).rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM session WHERE userId=?1').bind(member.userId).first()).toEqual({ n:0 });
    expect(await env.AUTH_DB.prepare("SELECT COUNT(*) AS n FROM identity_audit WHERE action='session.created' AND actor_id=?1")
      .bind(member.userId).first()).toEqual({ n:0 });
  });

  test.each(['organization','provisioning','membership','user','profile'] as const)
    ('active account provision authority cannot mutate existing %s business identity', async entity => {
      const lease = await activeOrganization();
      const member = await account(lease);
      const before = await snapshot(lease);
      const statements = {
        organization:env.AUTH_DB.prepare("UPDATE organizations SET status='provisioning' WHERE id=?1").bind(lease.organizationId),
        provisioning:env.AUTH_DB.prepare("UPDATE client_provisionings SET current_step='reopened' WHERE provisioning_id=?1").bind(lease.provisioningId),
        membership:env.AUTH_DB.prepare("UPDATE memberships SET role='operator' WHERE id=?1").bind(member.membershipId),
        user:env.AUTH_DB.prepare("UPDATE user SET name='changed' WHERE id=?1").bind(member.userId),
        profile:env.AUTH_DB.prepare("UPDATE auth_profile SET status='disabled' WHERE user_id=?1").bind(member.userId),
      };
      await expect(withControlWrite(env.AUTH_DB,runtime,lease,'provision',[statements[entity]])).rejects.toThrow();
      expect(await snapshot(lease)).toEqual(before);
      expect(await env.AUTH_DB.prepare('SELECT status,email_login_enabled FROM auth_profile WHERE user_id=?1').bind(member.userId).first())
        .toEqual({ status:'active',email_login_enabled:0 });
    });

  test('final SQL-clock expiry rolls back membership role and audit in the same real Auth batch', async () => {
    const lease = await activeOrganization();
    const member = await account(lease);
    const recipient=`e2e+${lease.runId}_invited@e2e.invalid`;
    await withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare(`INSERT INTO invitations (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,?3,'viewer',?4,'pending','fixture-root',?5,0,0)`)
        .bind(crypto.randomUUID(),lease.organizationId,recipient,crypto.randomUUID(),Date.now()+600000),
    ]);
    const originalView = migrationText.match(/CREATE VIEW e2e_control_valid_write_guards AS[\s\S]*?;/)?.[0];
    if (!originalView) throw new Error('Missing guard view');
    const before = await snapshot(lease);
    await env.AUTH_DB.prepare('CREATE TABLE e2e_test_clock (now_ms INTEGER NOT NULL)').run();
    await env.AUTH_DB.prepare('INSERT INTO e2e_test_clock VALUES (?1)').bind(lease.issuedAt+1).run();
    try {
      await env.AUTH_DB.prepare('DROP VIEW e2e_control_valid_write_guards').run();
      await env.AUTH_DB.prepare(originalView.replaceAll("CAST(unixepoch('subsec') * 1000 AS INTEGER)",'(SELECT now_ms FROM e2e_test_clock)')).run();
      await expect(withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
        env.AUTH_DB.prepare("UPDATE memberships SET role='operator' WHERE id=?1").bind(member.membershipId),
        env.AUTH_DB.prepare(`INSERT INTO identity_audit
          (id,occurred_at,actor_kind,actor_id,merchant_id,action,target_type,target_id,outcome,correlation_id)
          VALUES (?1,0,'member',?2,?3,'membership.role_changed','membership',?4,'succeeded','clock')`)
          .bind(crypto.randomUUID(),member.userId,lease.merchantId,member.membershipId),
        env.AUTH_DB.prepare(`INSERT INTO local_email_capture (id,recipient,subject,text_body,created_at) VALUES (?1,?2,'Clock','Clock',0)`)
          .bind(crypto.randomUUID(),recipient),
        env.AUTH_DB.prepare('UPDATE e2e_test_clock SET now_ms=?1').bind(lease.expiresAt),
      ])).rejects.toThrow();
      expect(await snapshot(lease)).toEqual(before);
      expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM local_email_capture WHERE recipient=?1').bind(recipient).first()).toEqual({ n:0 });
      expect(await env.AUTH_DB.prepare('SELECT now_ms FROM e2e_test_clock').first()).toEqual({ now_ms:lease.issuedAt+1 });
    } finally {
      await env.AUTH_DB.prepare('DROP VIEW e2e_control_valid_write_guards').run();
      await env.AUTH_DB.prepare(originalView).run();
      await env.AUTH_DB.prepare('DROP TABLE e2e_test_clock').run();
    }
  });

  test('production SQL expiry refuses Auth role/session writes and bounded disabled cleanup preserves post-delete fencing', async () => {
    const lease = await activeOrganization();
    const member = await issuingAccount(lease);
    await env.AUTH_DB.prepare('DROP TRIGGER e2e_control_run_immutable').run();
    try {
      await env.AUTH_DB.prepare('UPDATE e2e_control_runs SET issued_at=0,expires_at=900000 WHERE run_id=?1').bind(lease.runId).run();
    } finally {
      await env.AUTH_DB.prepare(triggerDDL('e2e_control_run_immutable')).run();
    }
    expect(await env.AUTH_DB.prepare(`SELECT expires_at-issued_at AS lifetime,
      expires_at < CAST(unixepoch('subsec') * 1000 AS INTEGER) AS expired FROM e2e_control_runs WHERE run_id=?1`)
      .bind(lease.runId).first()).toEqual({ lifetime:900000,expired:1 });
    const store = createIdentityControlStore(env.AUTH_DB);
    const aged = (await store.read(lease.runId))!;
    const before = await snapshot(lease);
    await expect(createOrganizationService({ database:env.AUTH_DB,controlRuntime:runtime }).changeMemberRole(rootPrincipal(lease),{
      membershipId:member.membershipId,role:'operator',correlationId:'expired',
    })).rejects.toThrow();
    await expect(member.insert.run()).rejects.toThrow();
    expect(await snapshot(lease)).toEqual(before);
    const recovery = { ...runtime,enabled:false };
    const cleanup = await store.beginCleanup(lease.runId,lease.proofHash,recovery.generation,crypto.randomUUID());
    await withControlWrite(env.AUTH_DB,recovery,aged,'fence',[
      env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE run_id=?1").bind(lease.runId),
    ],cleanup);
    await withControlWrite(env.AUTH_DB,recovery,(await store.read(lease.runId))!,'dispose',[
      env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='disposing' WHERE run_id=?1").bind(lease.runId),
      env.AUTH_DB.prepare('DELETE FROM memberships WHERE organization_id=?1').bind(lease.organizationId),
      env.AUTH_DB.prepare('DELETE FROM user WHERE id=?1').bind(member.userId),
      env.AUTH_DB.prepare('DELETE FROM organizations WHERE id=?1').bind(lease.organizationId),
      env.AUTH_DB.prepare('DELETE FROM client_provisionings WHERE provisioning_id=?1').bind(lease.provisioningId),
      env.AUTH_DB.prepare("UPDATE e2e_control_runs SET phase='disposed' WHERE run_id=?1").bind(lease.runId),
    ],cleanup);
    expect(await env.AUTH_DB.prepare('SELECT id FROM organizations WHERE id=?1').bind(lease.organizationId).first()).toBeNull();
    expect(await env.AUTH_DB.prepare('SELECT id FROM user WHERE id=?1').bind(member.userId).first()).toBeNull();
    await expect(env.AUTH_DB.prepare(`INSERT INTO identity_audit
      (id,occurred_at,actor_kind,actor_id,action,target_type,target_id,outcome,correlation_id)
      VALUES (?1,0,'member',?2,'late.business','user',?2,'succeeded','deleted')`).bind(crypto.randomUUID(),member.userId).run()).rejects.toThrow();
    await expect(withAuthBusinessWrite(env.AUTH_DB,runtime,lease.organizationId!,[
      env.AUTH_DB.prepare(`INSERT INTO invitations
        (id,organization_id,email,role,token_hash,status,invited_by,expires_at,created_at,updated_at)
        VALUES (?1,?2,'late@example.test','viewer',?3,'pending','root',9999999999999,0,0)`)
        .bind(crypto.randomUUID(),lease.organizationId,crypto.randomUUID()),
    ])).rejects.toThrow();
    expect(await env.AUTH_DB.prepare('SELECT COUNT(*) AS n FROM identity_audit WHERE actor_id=?1').bind(member.userId).first()).toEqual({ n:0 });
    expect((await store.read(lease.runId))?.phase).toBe('disposed');
  });
});
