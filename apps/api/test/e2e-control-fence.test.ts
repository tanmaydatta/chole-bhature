import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, test } from 'vitest';
import type { E2eControlRuntime, PromoProgram, StoredControlLease } from '@incentives/contracts';

import { createProductControlStore } from '../src/services/e2e-control-store.js';
import { withControlWrite, withProductBusinessWrite } from '../src/repositories/e2e-write-fence.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import { createEvaluationService } from '../src/services/evaluation-service.js';
import { createD1AtomicRedemptionCoordinator } from '../src/redemption/d1-atomic-redemption-coordinator.js';
import type { CommitRedemptionBundleInput } from '../src/redemption/atomic-redemption-coordinator.js';
import { signRedemptionReceipt } from '../src/services/redemption-receipt.js';
import type { AuditEntry, VariableDefinition } from '@incentives/contracts';
import { createProductE2eLifecycle } from '../src/services/e2e-lifecycle.js';

const migrationText = (env as typeof env & { E2E_CONTROL_MIGRATION_TEXT:string }).E2E_CONTROL_MIGRATION_TEXT;
const sqlClock = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";
const signingSecret = 'disposable-test-decision-signing-secret';
const occurredAt = '2026-10-12T00:00:00.000Z';

function audit(merchantId:string,action:string,targetType:string,targetId:string):AuditEntry {
  return { id:crypto.randomUUID(),occurredAt,actorKind:'root',actorId:'fixture-root',
    merchantId,action,targetType,targetId,outcome:'succeeded',correlationId:'fence-matrix' };
}

function pausedDatabase(matches:(sql:string)=>boolean,transform?:(sql:string,values:unknown[])=>unknown[]) {
  const queries = new WeakMap<D1PreparedStatement,string>();
  let reached!:()=>void,release!:()=>void;
  const atBoundary = new Promise<void>(resolve=>{ reached=resolve; });
  const resume = new Promise<void>(resolve=>{ release=resolve; });
  let paused=false;
  const db = new Proxy(env.DB,{
    get(target,key) {
      if (key==='prepare') return (sql:string) => {
        const statement = target.prepare(sql);
        const tracked = new Proxy(statement,{
          get(prepared,property) {
            if (property==='bind') return (...values:unknown[]) => {
              const bound = prepared.bind(...(transform?.(sql,values) ?? values));
              queries.set(bound,sql);
              return bound;
            };
            const value:unknown = Reflect.get(prepared,property,prepared);
            return typeof value==='function' ? value.bind(prepared) : value;
          },
        });
        queries.set(tracked,sql);
        return tracked;
      };
      if (key==='batch') return async (statements:D1PreparedStatement[]) => {
        if (!paused && statements.some(statement=>matches(queries.get(statement) ?? ''))) {
          paused=true;
          reached();
          await resume;
        }
        return target.batch(statements);
      };
      const value:unknown = Reflect.get(target,key,target);
      return typeof value==='function' ? value.bind(target) : value;
    },
  });
  return { db,atBoundary,release,didPause:()=>paused };
}

function promo(id = 'fixture-promo', status:PromoProgram['status'] = 'active'): PromoProgram {
  return { id,type:'promo',name:'Fixture promo',status,eligibility:{ match:'ALL',conditions:[] },
    rewardRules:[{ id:'discount',name:'Discount',conditions:{ match:'ALL',
      conditions:[{ id:'subtotal',variable:'cart.subtotal',operator:'gte',value:0 }] },
      reward:{ type:'order_discount',calculation:'fixed',amount:{ currency:'GBP',minorUnits:1_000 } } }],
    budget:{ currency:'GBP',minorUnits:10_000 },usageCap:10,priority:1,autoApply:true,stackable:false };
}

async function seedBusiness(lease:StoredControlLease) {
  const repositories = createRepositories({ DB:env.DB },runtime);
  const schema = { merchantId:lease.merchantId,version:1,state:'published' as const,
    publishedAt:'2026-10-12T00:00:00.000Z',definitions:[] };
  await withProductBusinessWrite(env.DB,runtime,lease.merchantId,[
    env.DB.prepare("INSERT INTO schema_versions (merchant_id,version,state,published_at,definitions_json) VALUES (?1,1,'published',?2,'[]')")
      .bind(lease.merchantId,schema.publishedAt),
  ]);
  const program = await repositories.programs.create({ merchantId:lease.merchantId,program:promo(),schema });
  const credentialId = crypto.randomUUID();
  await withProductBusinessWrite(env.DB,runtime,lease.merchantId,[
    env.DB.prepare(`INSERT INTO api_credentials
      (id,merchant_id,name,environment,kind,scopes_json,allowed_origins_json,requests_per_minute,digest,suffix,status,created_at,created_by)
      VALUES (?1,?2,'Fixture','local','publishable','["evaluations:write"]','[]',10,?3,'suffix','active','2026-10-12T00:00:00.000Z','fixture')`)
      .bind(credentialId,lease.merchantId,crypto.randomUUID().replaceAll('-','').repeat(2)),
  ]);
  return { repositories,program,credentialId,schema };
}

async function snapshot(merchantId:string) {
  const rows:Record<string,unknown> = {};
  for (const table of ['customers','programs','program_counters','program_revisions','promo_code_claims','variable_definitions','schema_versions','redemptions','redemption_entries','redemption_operations','evaluation_decisions','product_audit','api_credentials']) {
    rows[table] = (await env.DB.prepare('SELECT * FROM '+table+' WHERE merchant_id=?1 ORDER BY rowid').bind(merchantId).all()).results;
  }
  rows.rateWindows = (await env.DB.prepare(`SELECT w.* FROM credential_rate_limit_windows w
    JOIN api_credentials c ON c.id=w.credential_id WHERE c.merchant_id=?1 ORDER BY w.credential_id`).bind(merchantId).all()).results;
  rows.commitGuards = (await env.DB.prepare('SELECT * FROM redemption_commit_guards WHERE merchant_id=?1').bind(merchantId).all()).results;
  return rows;
}

async function redemptionInput(lease:StoredControlLease,empty=false):Promise<CommitRedemptionBundleInput> {
  const repositories = createRepositories({ DB:env.DB },runtime);
  if (empty) await withProductBusinessWrite(env.DB,runtime,lease.merchantId,[
    env.DB.prepare("UPDATE programs SET status='paused' WHERE merchant_id=?1").bind(lease.merchantId),
  ]);
  const evaluation = await createEvaluationService(repositories,{ DB:env.DB,DECISION_SIGNING_SECRET:signingSecret })
    .evaluate(lease.merchantId,{ customerRef:'buyer',cart:{ currency:'GBP',subtotal:6500,items:[] } },'fence-evaluation');
  const decision = await repositories.decisions.get(lease.merchantId,evaluation.evaluationId);
  if (!decision) throw new Error('Actual persisted decision missing');
  return { merchantId:lease.merchantId,evaluation:decision,externalOrderRef:crypto.randomUUID(),
    idempotencyKey:crypto.randomUUID(),requestDigest:'f'.repeat(64),correlationId:'fence-redemption',
    committedAt:new Date().toISOString() };
}

const runtime: E2eControlRuntime = {
  environment: 'local', generation: 'a'.repeat(40), targetId: 'b'.repeat(64),
  enabled: true, accountQuota: 3, cleanupGenerations: ['a'.repeat(40)],
};

function lease(): StoredControlLease {
  const issuedAt = Math.floor(Date.now() / 1000) * 1000;
  return {
    runId: `e2e_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
    merchantId: crypto.randomUUID(), provisioningId: crypto.randomUUID(),
    organizationId: crypto.randomUUID(), generation: runtime.generation,
    targetId: runtime.targetId, issuedAt, expiresAt: issuedAt + 900_000,
    phase: 'reserved', proofHash: 'c'.repeat(64), controllerHash: 'd'.repeat(64),
    requestId: crypto.randomUUID(), payloadHash: 'e'.repeat(64), accountQuota: 3,
  };
}

async function seed(): Promise<StoredControlLease> {
  const reserved = await createProductControlStore(env.DB).mirror(lease());
  await withControlWrite(env.DB, runtime, reserved, 'provision', [
    env.DB.prepare(`INSERT INTO merchants
      (id, name, status, provisioning_id, created_at, e2e_control_run_id)
      VALUES (?1, ?4, 'active', ?2, '2026-10-12T00:00:00.000Z', ?3)`)
      .bind(reserved.merchantId, reserved.provisioningId, reserved.runId, `${reserved.runId}_merchant`),
  ]);
  const store = createProductControlStore(env.DB);
  await store.advance(reserved.runId, 'reserved', 'product-provisioned');
  await store.advance(reserved.runId, 'product-provisioned', 'auth-provisioned');
  await store.advance(reserved.runId, 'auth-provisioned', 'active');
  await withProductBusinessWrite(env.DB, runtime, reserved.merchantId, [env.DB.prepare(`INSERT INTO customers
    (id, merchant_id, external_ref, attributes_json, version, updated_at)
    VALUES (?1, ?2, 'buyer', '{}', 1, '2026-10-12T00:00:00.000Z')`)
    .bind(crypto.randomUUID(), reserved.merchantId)]);
  return { ...reserved, phase: 'active' };
}

async function ageLease(runId:string):Promise<StoredControlLease> {
  const immutable = migrationText.match(/CREATE TRIGGER e2e_control_run_immutable[\s\S]*?\nEND;/)?.[0];
  if (!immutable) throw new Error('Missing immutable lease trigger');
  await env.DB.prepare('DROP TRIGGER e2e_control_run_immutable').run();
  try {
    await env.DB.prepare('UPDATE e2e_control_runs SET issued_at=0,expires_at=900000 WHERE run_id=?1').bind(runId).run();
  } finally {
    await env.DB.prepare(immutable).run();
  }
  const aged = await createProductControlStore(env.DB).read(runId);
  if (!aged) throw new Error('Missing aged fixture lease');
  expect(await env.DB.prepare(`SELECT expires_at-issued_at AS lifetime,
    expires_at < CAST(unixepoch('subsec') * 1000 AS INTEGER) AS expired
    FROM e2e_control_runs WHERE run_id=?1`).bind(runId).first()).toEqual({ lifetime:900000,expired:1 });
  return aged;
}

describe('execution-time Product lease fencing in migrated D1', () => {
  afterEach(async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE phase IN ('reserved','product-provisioned','auth-provisioned','active','quarantined')"),
      env.DB.prepare("UPDATE e2e_control_runs SET phase='disposing' WHERE phase='fencing'"),
      env.DB.prepare("UPDATE e2e_control_runs SET phase='disposed' WHERE phase='disposing'"),
    ]);
  });
  test('real coordinator commits counters and signed ledger once and returns the exact retry', async () => {
    const active = await seed();
    await seedBusiness(active);
    const input = await redemptionInput(active);
    const coordinator = createD1AtomicRedemptionCoordinator({ DB:env.DB,DECISION_SIGNING_SECRET:signingSecret },runtime);
    expect(await coordinator.commitBundle(input)).toMatchObject({ kind:'committed' });
    const before = await snapshot(active.merchantId);
    expect(await coordinator.commitBundle(input)).toMatchObject({ kind:'exact_retry' });
    expect(await snapshot(active.merchantId)).toEqual(before);
    expect(await env.DB.prepare('SELECT usage_count,budget_remaining,committed_spend FROM program_counters WHERE merchant_id=?1')
      .bind(active.merchantId).first()).toEqual({ usage_count:1,budget_remaining:9000,committed_spend:1000 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM redemption_entries WHERE merchant_id=?1').bind(active.merchantId).first()).toEqual({ n:1 });
  });

  test.each(['acquisition','commit','terminal rejection','pending repair'] as const)(
    'real coordinator %s is paused at its actual D1 batch and cannot write after fencing', async boundary => {
      const active = await seed();
      await seedBusiness(active);
      const input = await redemptionInput(active,boundary==='terminal rejection');
      if (boundary==='pending repair') {
        const first = await createD1AtomicRedemptionCoordinator({ DB:env.DB,DECISION_SIGNING_SECRET:signingSecret },runtime).commitBundle(input);
        expect(first).toMatchObject({ kind:'committed' });
        await withProductBusinessWrite(env.DB,runtime,active.merchantId,[
          env.DB.prepare("UPDATE redemption_operations SET state='pending',redemption_id=NULL WHERE merchant_id=?1 AND idempotency_key=?2")
            .bind(active.merchantId,input.idempotencyKey),
        ]);
      }
      const paused = pausedDatabase(sql => boundary==='acquisition' ? /INSERT INTO redemption_operations/u.test(sql)
        : boundary==='commit' ? /INSERT INTO redemptions/u.test(sql)
          : boundary==='terminal rejection' ? /SET state = 'rejected'/u.test(sql) : /SET state = 'committed', redemption_id/u.test(sql));
      const operation = createD1AtomicRedemptionCoordinator({ DB:paused.db,DECISION_SIGNING_SECRET:signingSecret },runtime).commitBundle(input)
        .then(result=>({ result }),error=>({ error:error as unknown }));
      try {
        expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
        expect(paused.didPause()).toBe(true);
        const before = await snapshot(active.merchantId);
        if (boundary!=='acquisition') expect(await env.DB.prepare('SELECT state FROM redemption_operations WHERE merchant_id=?1 AND idempotency_key=?2')
          .bind(active.merchantId,input.idempotencyKey).first()).toEqual({ state:'pending' });
        await createProductControlStore(env.DB).advance(active.runId,'active','fencing');
        paused.release();
        if (boundary==='terminal rejection') expect(await operation).toHaveProperty('error');
        else expect(await operation).toEqual({ result:{ kind:'unavailable',retryable:true } });
        expect(await snapshot(active.merchantId)).toEqual(before);
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n:0 });
      } finally {
        paused.release();
        await operation;
      }
    });

  test.each(['missing','foreign','missing after fence'] as const)(
    'actual coordinator batch rejects %s redemption-guard merchant and rolls earlier counters back', async scope => {
      const active = await seed();
      await seedBusiness(active);
      const input = await redemptionInput(active);
      let changed=0;
      const paused = pausedDatabase(sql=> /INSERT INTO redemptions/u.test(sql),(sql,values)=> {
        if (!/INSERT INTO redemption_commit_guards/u.test(sql)) return values;
        changed++;
        return [values[0],values[1],scope==='foreign' ? 'phase-0-merchant' : null];
      });
      const operation = createD1AtomicRedemptionCoordinator({ DB:paused.db,DECISION_SIGNING_SECRET:signingSecret },runtime).commitBundle(input);
      try {
        expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
        expect(changed).toBe(3);
        const before = await snapshot(active.merchantId);
        if (scope==='missing after fence') await createProductControlStore(env.DB).advance(active.runId,'active','fencing');
        paused.release();
        expect(await operation).toEqual({ kind:'unavailable',retryable:true });
        expect(await snapshot(active.merchantId)).toEqual(before);
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM redemption_commit_guards').first()).toEqual({ n:0 });
      } finally { paused.release(); await operation; }
    });

  test('ordinary v1 Product disposal reaches SQL but cannot mutate a v2 tenant', async () => {
    const active = await seed();
    await seedBusiness(active);
    const before = await snapshot(active.merchantId);
    const identity={ runId:active.runId,merchantId:active.merchantId,provisioningId:active.provisioningId,proofHash:active.proofHash };
    const lifecycle=createProductE2eLifecycle({ DB:env.DB,APP_ENV:'staging' });
    expect(await lifecycle.preview(identity)).toMatchObject({ status:'active',counts:{ merchants:1,customers:1 } });
    await expect(lifecycle.dispose(identity)).rejects.toThrow(/E2E_CONTROL/u);
    expect(await snapshot(active.merchantId)).toEqual(before);
    expect(await env.DB.prepare('SELECT status,control_version FROM e2e_run_claims WHERE run_id=?1').bind(active.runId).first()).toEqual({ status:'active',control_version:2 });
  });
  test('ordinary ROOT Product provision and activation cannot write a reserved v2 merchant', async () => {
    const reserved=await createProductControlStore(env.DB).mirror(lease());
    await withControlWrite(env.DB,runtime,reserved,'provision',[
      env.DB.prepare(`INSERT INTO merchants (id,name,status,provisioning_id,created_at,e2e_control_run_id)
        VALUES (?1,?2,'provisioning',?3,?4,?5)`).bind(reserved.merchantId,reserved.runId+'_merchant',reserved.provisioningId,occurredAt,reserved.runId),
    ]);
    await createProductControlStore(env.DB).advance(reserved.runId,'reserved','product-provisioned');
    const before=await env.DB.prepare('SELECT * FROM merchants WHERE id=?1').bind(reserved.merchantId).first();
    const repositories=createRepositories({ DB:env.DB,APP_ENV:'staging' });
    await expect(repositories.merchants.activate({ id:reserved.merchantId,provisioningId:reserved.provisioningId },occurredAt)).rejects.toThrow(/E2E_CONTROL/u);
    await expect(repositories.merchants.provision({ id:reserved.merchantId,provisioningId:reserved.provisioningId,name:reserved.runId+'_merchant',
      e2eRun:{ runId:reserved.runId,proofHash:reserved.proofHash } })).rejects.toThrow(/E2E_CONTROL/u);
    expect(await env.DB.prepare('SELECT * FROM merchants WHERE id=?1').bind(reserved.merchantId).first()).toEqual(before);
  });

  test('ordinary manual and v1 Product source provisioning, business and disposal keep legacy behavior', async () => {
    const repositories=createRepositories({ DB:env.DB,APP_ENV:'staging' });
    for (const v1 of [false,true]) {
      const identity=lease();
      const provisioned=await repositories.merchants.provision({ id:identity.merchantId,provisioningId:identity.provisioningId,
        name:identity.runId+'_merchant',...(v1 ? { e2eRun:{ runId:identity.runId,proofHash:identity.proofHash } } : {}) });
      expect(provisioned.status).toBe('provisioning');
      expect(await repositories.merchants.activate({ id:identity.merchantId,provisioningId:identity.provisioningId },occurredAt)).toMatchObject({ status:'active' });
      await repositories.customers.create(identity.merchantId,{ externalRef:'legacy-buyer',attributes:{ tier:'gold' } });
      await repositories.customers.upsertWithAudit({ merchantId:identity.merchantId,externalRef:'legacy-buyer',expectedVersion:1,attributes:{ tier:'silver' } },
        audit(identity.merchantId,'customer.upserted','customer','legacy-buyer'));
      expect(await repositories.customers.get(identity.merchantId,'legacy-buyer')).toMatchObject({ version:2,attributes:{ tier:'silver' } });
      expect(await env.DB.prepare('SELECT e2e_control_run_id FROM merchants WHERE id=?1').bind(identity.merchantId).first()).toEqual({ e2e_control_run_id:null });
      if (v1) {
        expect(await env.DB.prepare('SELECT control_version FROM e2e_run_claims WHERE run_id=?1').bind(identity.runId).first()).toEqual({ control_version:1 });
        const disposed=await createProductE2eLifecycle({ DB:env.DB,APP_ENV:'staging' }).dispose({ runId:identity.runId,
          merchantId:identity.merchantId,provisioningId:identity.provisioningId,proofHash:identity.proofHash });
        expect(disposed.status).toBe('disposed');
        expect(Object.values(disposed.counts).every(n=>n===0)).toBe(true);
      }
    }
  });
  test.each(['live same tuple','live fresh tenant IDs','disposed same tuple','disposed fresh tenant IDs'] as const)(
    'FIX1 v1 collision: Product %s refuses before any durable v2 reservation', async scenario => {
      const original=lease(),repositories=createRepositories({ DB:env.DB,APP_ENV:'staging' });
      await repositories.merchants.provision({ id:original.merchantId,provisioningId:original.provisioningId,name:original.runId+'_merchant',
        e2eRun:{ runId:original.runId,proofHash:original.proofHash } });
      await repositories.merchants.activate({ id:original.merchantId,provisioningId:original.provisioningId },occurredAt);
      await repositories.customers.create(original.merchantId,{ externalRef:'legacy-buyer',attributes:{ tier:'gold' } });
      const identity={ runId:original.runId,merchantId:original.merchantId,provisioningId:original.provisioningId,proofHash:original.proofHash };
      const lifecycle=createProductE2eLifecycle({ DB:env.DB,APP_ENV:'staging' });
      if (scenario.startsWith('disposed')) expect((await lifecycle.dispose(identity)).status).toBe('disposed');
      const before=await snapshot(original.merchantId);
      const claim=await env.DB.prepare('SELECT * FROM e2e_run_claims WHERE run_id=?1').bind(original.runId).first();
      const proposed=scenario.endsWith('fresh tenant IDs') ? { ...original,merchantId:crypto.randomUUID(),provisioningId:crypto.randomUUID() } : original;
      await expect(createProductControlStore(env.DB).mirror(proposed)).rejects.toThrow();
      expect(await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM e2e_control_runs WHERE run_id=?1 OR merchant_id=?2 OR provisioning_id=?3) AS runs,
        (SELECT COUNT(*) FROM e2e_control_requests WHERE run_id=?1) AS requests,
        (SELECT COUNT(*) FROM e2e_run_claims WHERE run_id=?1) AS claims`)
        .bind(original.runId,proposed.merchantId,proposed.provisioningId).first()).toEqual({ runs:0,requests:0,claims:1 });
      expect(await env.DB.prepare('SELECT * FROM e2e_run_claims WHERE run_id=?1').bind(original.runId).first()).toEqual(claim);
      expect(await snapshot(original.merchantId)).toEqual(before);
      if (scenario.endsWith('fresh tenant IDs')) expect(await repositories.merchants.get(proposed.merchantId)).toBeNull();
      if (scenario.startsWith('disposed')) expect(await repositories.merchants.get(original.merchantId)).toBeNull();
      else expect(await repositories.merchants.get(original.merchantId)).toMatchObject({ id:original.merchantId,status:'active',name:original.runId+'_merchant' });
      if (scenario.startsWith('live')) {
        await repositories.customers.upsert({ merchantId:original.merchantId,externalRef:'legacy-buyer',expectedVersion:1,attributes:{ tier:'silver' } });
        expect(await repositories.customers.get(original.merchantId,'legacy-buyer')).toMatchObject({ version:2,attributes:{ tier:'silver' } });
      }
      const disposed=await lifecycle.dispose(identity);
      expect(disposed.status).toBe('disposed'); expect(Object.values(disposed.counts).every(n=>n===0)).toBe(true);
    });

  test.each(['last-used credential','rate-limit window','customer Drizzle insert','customer optimistic audit'] as const)(
    'real %s mutation reaches its batch before a fence and rolls back', async boundary => {
      const active = await seed();
      const { credentialId } = await seedBusiness(active);
      const paused = pausedDatabase(sql => boundary==='last-used credential' ? /UPDATE api_credentials SET last_used_at/u.test(sql)
        : boundary==='rate-limit window' ? /INSERT INTO credential_rate_limit_windows/u.test(sql)
          : boundary==='customer Drizzle insert' ? /insert into "customers"/u.test(sql) : /UPDATE customers/u.test(sql));
      const repositories = createRepositories({ DB:paused.db },runtime);
      const operation = (boundary==='last-used credential' ? repositories.credentials.markUsed(credentialId,occurredAt)
        : boundary==='rate-limit window' ? repositories.credentials.consumePublishableRateLimit(credentialId,10,60000)
          : boundary==='customer Drizzle insert' ? repositories.customers.create(active.merchantId,{ externalRef:'paused-new',attributes:{} })
            : repositories.customers.upsertWithAudit({ merchantId:active.merchantId,externalRef:'buyer',expectedVersion:1,attributes:{ changed:true } },
              audit(active.merchantId,'customer.upserted','customer','buyer'))).then(value=>({ value }),error=>({ error: error as unknown }));
      try {
        expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
        expect(paused.didPause()).toBe(true);
        const before = await snapshot(active.merchantId);
        await createProductControlStore(env.DB).advance(active.runId,'active','fencing');
        paused.release();
        expect(await operation).toHaveProperty('error');
        expect(await snapshot(active.merchantId)).toEqual(before);
      } finally { paused.release(); await operation; }
    });
  test('the real repository can create and update an active fixture through its guard', async () => {
    const active = await seed();
    const repositories = createRepositories({ DB: env.DB }, runtime);
    const created = await repositories.customers.create(active.merchantId, { externalRef: 'new', attributes: { amount: 10 } });
    expect(created).toMatchObject({ externalRef: 'new', attributes: { amount: 10 }, version: 1 });
    await repositories.customers.upsert({ merchantId: active.merchantId, externalRef: 'new',
      expectedVersion: 1, attributes: { amount: 20 } });
    expect(await env.DB.prepare('SELECT version, attributes_json FROM customers WHERE merchant_id=?1 AND external_ref=?2')
      .bind(active.merchantId, 'new').first()).toEqual({ version: 2, attributes_json: '{"amount":20}' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n: 0 });
  });
  test.each([
    'credential create audit','credential revoke audit','schema next draft','schema definition create',
    'schema definition update','schema definition delete','schema publish','schema deprecate single','schema deprecate draft',
    'customer upsert insert','customer upsert update','customer audit insert','program create','program initial draft update',
    'program replacement create','program replacement update','program publish automatic','program publish code',
    'program lifecycle','decision Drizzle insert','redemption repository bundle','audit Drizzle insert',
  ])('actual repository boundary: %s cannot mutate a fenced fixture', async boundary => {
    const active = await seed();
    const business = await seedBusiness(active);
    const repositories = business.repositories;
    const paused = pausedDatabase(sql=> !sql.includes('e2e_control_') && /\b(?:INSERT|UPDATE|DELETE)\b/iu.test(sql));
    const late = createRepositories({ DB:paused.db },runtime);
    let invoke!:()=>Promise<unknown>;
    const definition:VariableDefinition = { key:'customer.tier',label:'Tier',source:'customer',type:'enum',required:false,enumValues:['gold','silver'] };
    if (boundary==='credential create audit') {
      const id = crypto.randomUUID();
      invoke=()=>late.credentials.createWithAudit({ id,merchantId:active.merchantId,name:'New',environment:'local',kind:'publishable',
        scopes:['evaluations:write'],requestsPerMinute:10,digest:crypto.randomUUID().replaceAll('-','').repeat(2),suffix:'suffix',createdBy:'fixture-root' },
      audit(active.merchantId,'credential.created','credential',id));
    } else if (boundary==='credential revoke audit') {
      invoke=()=>late.credentials.revokeWithAudit(active.merchantId,business.credentialId,occurredAt,'fixture-root',
        audit(active.merchantId,'credential.revoked','credential',business.credentialId));
    } else if (boundary.startsWith('schema')) {
      if (boundary==='schema next draft') invoke=()=>late.schemas.createNextDraft(active.merchantId);
      else {
        const draft = await repositories.schemas.createNextDraft(active.merchantId);
        expect(draft).toMatchObject({ version:2,state:'draft' });
        const id = crypto.randomUUID();
        if (boundary==='schema definition create') invoke=()=>late.schemas.createDraftDefinition({ id,merchantId:active.merchantId,
          schemaVersion:2,state:'draft',definition },[],[definition]);
        else {
          await repositories.schemas.createDraftDefinition({ id,merchantId:active.merchantId,schemaVersion:2,state:'draft',definition },[],[definition]);
          if (boundary==='schema definition update') invoke=()=>late.schemas.updateDraftDefinition(active.merchantId,id,2,{ ...definition,label:'Changed' },[definition]);
          else if (boundary==='schema definition delete') invoke=()=>late.schemas.deleteDraftDefinition(active.merchantId,id,2,[definition]);
          else if (boundary==='schema publish') invoke=()=>late.schemas.publishDraft(active.merchantId,2,[definition],occurredAt);
          else {
            expect(await repositories.schemas.publishDraft(active.merchantId,2,[definition],occurredAt)).toMatchObject({ state:'published' });
            if (boundary==='schema deprecate draft') {
              expect(await repositories.schemas.createNextDraft(active.merchantId)).toMatchObject({ version:3,definitions:[definition] });
            }
            invoke=()=>late.schemas.deprecateDefinition({ merchantId:active.merchantId,id,schemaVersion:2,deprecatedAt:occurredAt,deprecatedBy:'fixture-root' });
          }
        }
      }
    } else if (boundary==='customer upsert insert') invoke=()=>late.customers.upsert({ merchantId:active.merchantId,externalRef:'upsert-new',attributes:{ tier:'gold' } });
    else if (boundary==='customer upsert update') invoke=()=>late.customers.upsert({ merchantId:active.merchantId,externalRef:'buyer',expectedVersion:1,attributes:{ tier:'gold' } });
    else if (boundary==='customer audit insert') invoke=()=>late.customers.upsertWithAudit({ merchantId:active.merchantId,externalRef:'audit-new',attributes:{ tier:'gold' } },
      audit(active.merchantId,'customer.upserted','customer','audit-new'));
    else if (boundary==='program create') invoke=()=>late.programs.create({ merchantId:active.merchantId,program:promo('new-promo','draft'),schema:business.schema });
    else if (boundary.startsWith('program')) {
      if (boundary==='program lifecycle') invoke=()=>late.programs.updateLifecycle({ merchantId:active.merchantId,externalRef:business.program.externalRef,
        expectedStatus:'active',status:'paused',updatedAt:occurredAt });
      else {
        let current = business.program;
        if (boundary==='program initial draft update' || boundary.startsWith('program publish')) {
          const candidate = promo('draft-promo','draft');
          if (boundary==='program publish code') { candidate.autoApply=false; candidate.code='FENCE10'; }
          current = await repositories.programs.create({ merchantId:active.merchantId,program:candidate,schema:business.schema });
        } else if (boundary==='program replacement update') {
          current = await repositories.programs.updateDraft({ merchantId:active.merchantId,externalRef:current.externalRef,
            program:{ ...current.program,status:'draft',name:'Replacement' },expectedProgram:current.program,expectedUpdatedAt:current.updatedAt,schema:business.schema });
        }
        if (boundary.startsWith('program publish')) {
          const codeClaim = boundary==='program publish code' ? { merchantId:active.merchantId,programId:current.id,programRef:current.externalRef,
            activeRevision:current.draftRevision!,displayCode:'FENCE10',normalizedCode:'FENCE10',claimedAt:occurredAt } : undefined;
          invoke=()=>late.programs.publishDraftWithCodeClaim({ merchantId:active.merchantId,externalRef:current.externalRef,
            expectedDraftRevision:current.draftRevision!,publishedAt:occurredAt,publishedBy:'fixture-root',...(codeClaim ? { codeClaim } : {}) });
        } else invoke=()=>late.programs.updateDraft({ merchantId:active.merchantId,externalRef:current.externalRef,
          program:{ ...current.program,status:'draft',name:'Changed' },expectedProgram:current.program,expectedUpdatedAt:current.updatedAt,schema:business.schema });
      }
    } else if (boundary==='decision Drizzle insert') {
      const input = await redemptionInput(active);
      invoke=()=>late.decisions.create({ ...input.evaluation,evaluationId:crypto.randomUUID() });
    } else if (boundary==='redemption repository bundle') {
      const result = await createD1AtomicRedemptionCoordinator({ DB:env.DB,DECISION_SIGNING_SECRET:signingSecret },runtime).commitBundle(await redemptionInput(active));
      if (result.kind!=='committed') throw new Error('Expected actual committed fixture');
      const bundle = { ...result.bundle,redemptionId:crypto.randomUUID(),externalOrderRef:crypto.randomUUID(),idempotencyKey:crypto.randomUUID() };
      bundle.result = { ...bundle.result,redemptionId:bundle.redemptionId,externalOrderRef:bundle.externalOrderRef,idempotencyKey:bundle.idempotencyKey };
      bundle.receiptIntegrityHash = await signRedemptionReceipt(bundle,signingSecret);
      invoke=()=>late.redemptions.create(bundle);
    } else invoke=()=>late.audit.append(audit(active.merchantId,'fixture.updated','merchant',active.merchantId));
    const operation = invoke().then(value=>({ value }),error=>({ error:error as unknown }));
    try {
      expect(await Promise.race([paused.atBoundary.then(()=> 'boundary'),operation.then(()=> 'returned')])).toBe('boundary');
      expect(paused.didPause()).toBe(true);
      const before = await snapshot(active.merchantId);
      await createProductControlStore(env.DB).advance(active.runId,'active','fencing');
      paused.release();
      expect(await operation).toHaveProperty('error');
      expect(await snapshot(active.merchantId)).toEqual(before);
    } finally { paused.release(); await operation; }
  });
  // Removing the SQL guard would permit the destructive statement below.
  test('a fenced run rejects deletion without changing actual customer rows', async () => {
    const active = await seed();
    await env.DB.prepare("UPDATE e2e_control_runs SET phase = 'fencing' WHERE run_id = ?1")
      .bind(active.runId).run();
    const before = (await env.DB.prepare('SELECT * FROM customers WHERE merchant_id = ?1')
      .bind(active.merchantId).all()).results;
    await expect(withProductBusinessWrite(env.DB, runtime, active.merchantId, [
      env.DB.prepare('DELETE FROM customers WHERE merchant_id = ?1').bind(active.merchantId),
    ])).rejects.toThrow();
    expect((await env.DB.prepare('SELECT * FROM customers WHERE merchant_id = ?1')
      .bind(active.merchantId).all()).results).toEqual(before);
  });

  test('missing runtime refuses a marked tenant while manual writes still work', async () => {
    const active = await seed();
    await expect(withProductBusinessWrite(env.DB, undefined, active.merchantId, [
      env.DB.prepare('DELETE FROM customers WHERE merchant_id = ?1').bind(active.merchantId),
    ])).rejects.toThrow();
    const id = crypto.randomUUID();
    await withProductBusinessWrite(env.DB, undefined, 'phase-0-merchant', [
      env.DB.prepare(`INSERT INTO customers
        (id, merchant_id, external_ref, attributes_json, version, updated_at)
        VALUES (?1, 'phase-0-merchant', ?1, '{}', 1, '2026-10-12T00:00:00.000Z')`).bind(id),
    ]);
    expect(await env.DB.prepare('SELECT id FROM customers WHERE id = ?1').bind(id).first())
      .toEqual({ id });
  });

  test('a crossed v2 merchant scope rolls the first write back', async () => {
    const first = await seed();
    const second = await seed();
    await expect(withProductBusinessWrite(env.DB, runtime, first.merchantId, [
      env.DB.prepare("UPDATE customers SET attributes_json = '{\"changed\":true}' WHERE merchant_id = ?1")
        .bind(first.merchantId),
      env.DB.prepare('DELETE FROM customers WHERE merchant_id = ?1').bind(second.merchantId),
    ])).rejects.toThrow();
    expect(await env.DB.prepare('SELECT attributes_json FROM customers WHERE merchant_id = ?1')
      .bind(first.merchantId).first()).toEqual({ attributes_json: '{}' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers WHERE merchant_id = ?1')
      .bind(second.merchantId).first()).toEqual({ n: 1 });
  });
  test('changing a customer from one v2 merchant to another checks both OLD and NEW scopes', async () => {
    const first=await seed(),second=await seed();
    const beforeFirst=await snapshot(first.merchantId),beforeSecond=await snapshot(second.merchantId);
    await expect(withProductBusinessWrite(env.DB,runtime,first.merchantId,[
      env.DB.prepare('UPDATE customers SET merchant_id=?1,external_ref=?2 WHERE merchant_id=?3')
        .bind(second.merchantId,'crossed',first.merchantId),
    ])).rejects.toThrow();
    expect(await snapshot(first.merchantId)).toEqual(beforeFirst);
    expect(await snapshot(second.merchantId)).toEqual(beforeSecond);
  });
  test.each(['missing','corrupt'] as const)('permanent Product marker refuses a %s ledger and cannot renew its tuple', async state => {
    const active=await seed();
    const store=createProductControlStore(env.DB);
    const before=await snapshot(active.merchantId);
    const names=state==='missing' ? ['e2e_control_run_retained','e2e_control_request_retained'] : ['e2e_control_claim_immutable'];
    const definitions=names.map(name=> {
      const ddl=migrationText.match(new RegExp('CREATE TRIGGER '+name+'\\b[\\s\\S]*?\\n(?:BEGIN[^\\n]*END;|END;)'))?.[0];
      if (!ddl) throw new Error('Missing trigger '+name);
      return ddl;
    });
    for (const name of names) await env.DB.prepare('DROP TRIGGER '+name).run();
    try {
      if (state==='missing') await env.DB.batch([
        env.DB.prepare('DELETE FROM e2e_control_requests WHERE run_id=?1').bind(active.runId),
        env.DB.prepare('DELETE FROM e2e_control_runs WHERE run_id=?1').bind(active.runId),
      ]);
      else await env.DB.prepare('UPDATE e2e_run_claims SET proof_hash=?1 WHERE run_id=?2').bind('f'.repeat(64),active.runId).run();
    } finally { for (const ddl of definitions) await env.DB.prepare(ddl).run(); }
    await expect(store.read(active.runId)).rejects.toThrow();
    await expect(store.mirror({ ...active,phase:'reserved' })).rejects.toThrow();
    await expect(createRepositories({ DB:env.DB },runtime).customers.upsert({ merchantId:active.merchantId,
      externalRef:'buyer',expectedVersion:1,attributes:{ corrupt:true } })).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
    expect(await env.DB.prepare('SELECT e2e_control_run_id FROM merchants WHERE id=?1').bind(active.merchantId).first()).toEqual({ e2e_control_run_id:active.runId });
  });
  test.each(['generation','target','disabled'] as const)('Product creation eligibility refuses %s runtime without row changes', async changed => {
    const active=await seed(),before=await snapshot(active.merchantId);
    const incompatible={ ...runtime,...(changed==='generation' ? { generation:'f'.repeat(40) } : changed==='target' ? { targetId:'f'.repeat(64) } : { enabled:false }) };
    await expect(createRepositories({ DB:env.DB },incompatible).customers.create(active.merchantId,{ externalRef:'ineligible',attributes:{} })).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
  });

  test('cleanup disposal cannot insert customer data even with a live exact invocation', async () => {
    const active = await seed();
    const store = createProductControlStore(env.DB);
    await store.advance(active.runId,'active','fencing');
    const disposing = await store.advance(active.runId,'fencing','disposing');
    const cleanup = await store.beginCleanup(active.runId,active.proofHash,runtime.generation,crypto.randomUUID());
    await expect(withControlWrite(env.DB,runtime,disposing,'dispose',[
      env.DB.prepare(`INSERT INTO customers (id,merchant_id,external_ref,attributes_json,version,updated_at)
        VALUES (?1,?2,'late-cleanup','{}',1,'2026-10-12T00:00:00.000Z')`).bind(crypto.randomUUID(),active.merchantId),
    ],cleanup)).rejects.toThrow();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM customers WHERE merchant_id=?1').bind(active.merchantId).first())
      .toEqual({ n:1 });
  });

  test('a control batch rejects altered immutable reservation metadata before merchant creation', async () => {
    const reserved = await createProductControlStore(env.DB).mirror(lease());
    await expect(withControlWrite(env.DB,runtime,{ ...reserved,controllerHash:'f'.repeat(64) },'provision',[
      env.DB.prepare(`INSERT INTO merchants (id,name,status,provisioning_id,created_at,e2e_control_run_id)
        VALUES (?1,'altered','active',?2,'2026-10-12T00:00:00.000Z',?3)`)
        .bind(reserved.merchantId,reserved.provisioningId,reserved.runId),
    ])).rejects.toThrow();
    expect(await env.DB.prepare('SELECT id FROM merchants WHERE id=?1').bind(reserved.merchantId).first()).toBeNull();
  });

  test('a NULL-merchant audit cannot bypass a fenced owned merchant target', async () => {
    const active = await seed();
    await createProductControlStore(env.DB).advance(active.runId,'active','fencing');
    const before = await snapshot(active.merchantId);
    await expect(createRepositories({ DB:env.DB },runtime).audit.append({
      id:crypto.randomUUID(),occurredAt:'2026-10-12T00:00:00.000Z',actorKind:'root',actorId:'root',
      action:'merchant.late',targetType:'merchant',targetId:active.merchantId,outcome:'succeeded',correlationId:'late',
    })).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM product_audit WHERE target_type='merchant' AND target_id=?1")
      .bind(active.merchantId).first()).toEqual({ n:0 });
  });

  test('final SQL-clock expiry rolls back customer, budget, ledger, audit and rate-window mutations', async () => {
    const active = await seed();
    const seeded = await seedBusiness(active);
    const originalView = migrationText.match(/CREATE VIEW e2e_control_valid_write_guards AS[\s\S]*?;/)?.[0];
    if (!originalView) throw new Error('Missing guard view');
    const before = await snapshot(active.merchantId);
    await env.DB.prepare('CREATE TABLE e2e_test_clock (now_ms INTEGER NOT NULL)').run();
    await env.DB.prepare('INSERT INTO e2e_test_clock VALUES (?1)').bind(active.issuedAt+1).run();
    try {
      await env.DB.prepare('DROP VIEW e2e_control_valid_write_guards').run();
      await env.DB.prepare(originalView.replaceAll(sqlClock,'(SELECT now_ms FROM e2e_test_clock)')).run();
      await expect(withProductBusinessWrite(env.DB,runtime,active.merchantId,[
        env.DB.prepare('DELETE FROM customers WHERE merchant_id=?1').bind(active.merchantId),
        env.DB.prepare('UPDATE program_counters SET budget_remaining=9000,committed_spend=1000,usage_count=1 WHERE merchant_id=?1')
          .bind(active.merchantId),
        env.DB.prepare(`INSERT INTO redemption_operations
          (merchant_id,idempotency_key,external_order_ref,evaluation_id,request_digest,state,created_at,updated_at)
          VALUES (?1,'late-key','late-order','late-evaluation',?2,'pending',?3,?3)`)
          .bind(active.merchantId,'f'.repeat(64),'2026-10-12T00:00:00.000Z'),
        env.DB.prepare(`INSERT INTO product_audit
          (id,occurred_at,actor_kind,actor_id,merchant_id,action,target_type,target_id,outcome,correlation_id)
          VALUES (?1,?2,'member','fixture',?3,'late.write','customer','buyer','succeeded','clock')`)
          .bind(crypto.randomUUID(),'2026-10-12T00:00:00.000Z',active.merchantId),
        env.DB.prepare('INSERT INTO credential_rate_limit_windows (credential_id,window_started_at,request_count) VALUES (?1,0,1)')
          .bind(seeded.credentialId),
        env.DB.prepare('UPDATE e2e_test_clock SET now_ms=?1').bind(active.expiresAt),
      ])).rejects.toThrow();
      expect(await snapshot(active.merchantId)).toEqual(before);
      expect(await env.DB.prepare('SELECT now_ms FROM e2e_test_clock').first()).toEqual({ now_ms:active.issuedAt+1 });
      expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM e2e_control_write_guards').first()).toEqual({ n:0 });
    } finally {
      await env.DB.prepare('DROP VIEW e2e_control_valid_write_guards').run();
      await env.DB.prepare(originalView).run();
      await env.DB.prepare('DROP TABLE e2e_test_clock').run();
    }
  });

  test('production SQL-clock expiry refuses business writes with the original deadline constraint restored', async () => {
    const active = await seed();
    await ageLease(active.runId);
    const before = await snapshot(active.merchantId);
    await expect(withProductBusinessWrite(env.DB,runtime,active.merchantId,[
      env.DB.prepare('DELETE FROM customers WHERE merchant_id=?1').bind(active.merchantId),
    ])).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
  });

  test('compatible bounded cleanup works after expiry and creation disablement, then tombstones fence deleted scope', async () => {
    const active = await seed();
    const aged = await ageLease(active.runId);
    const recoveryRuntime = { ...runtime,enabled:false,generation:'f'.repeat(40),cleanupGenerations:[runtime.generation] };
    const store = createProductControlStore(env.DB);
    const cleanup = await store.beginCleanup(active.runId,active.proofHash,recoveryRuntime.generation,crypto.randomUUID());
    const retry = await store.beginCleanup(active.runId,active.proofHash,recoveryRuntime.generation,
      (await env.DB.prepare('SELECT request_id FROM e2e_control_cleanup WHERE id=?1').bind(cleanup.id).first<{request_id:string}>())!.request_id);
    expect(retry).toEqual(cleanup);
    expect(cleanup.expiresAt-cleanup.issuedAt).toBe(300000);
    await expect(withControlWrite(env.DB,{ ...recoveryRuntime,cleanupGenerations:[] },aged,'fence',[
      env.DB.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE run_id=?1").bind(active.runId),
    ],cleanup)).rejects.toThrow();
    await withControlWrite(env.DB,recoveryRuntime,aged,'fence',[
      env.DB.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE run_id=?1").bind(active.runId),
    ],cleanup);
    const fencing = await store.read(active.runId);
    await withControlWrite(env.DB,recoveryRuntime,fencing!,'dispose',[
      env.DB.prepare("UPDATE e2e_control_runs SET phase='disposing' WHERE run_id=?1").bind(active.runId),
      env.DB.prepare('DELETE FROM customers WHERE merchant_id=?1').bind(active.merchantId),
      env.DB.prepare('DELETE FROM merchants WHERE id=?1').bind(active.merchantId),
      env.DB.prepare("UPDATE e2e_control_runs SET phase='disposed' WHERE run_id=?1").bind(active.runId),
    ],cleanup);
    expect(await env.DB.prepare('SELECT id FROM merchants WHERE id=?1').bind(active.merchantId).first()).toBeNull();
    const before = await snapshot(active.merchantId);
    await expect(withProductBusinessWrite(env.DB,runtime,active.merchantId,[
      env.DB.prepare(`INSERT INTO customers (id,merchant_id,external_ref,attributes_json,version,updated_at)
        VALUES (?1,?2,'late','{}',1,'2026-10-12T00:00:00.000Z')`).bind(crypto.randomUUID(),active.merchantId),
    ])).rejects.toThrow();
    await expect(createRepositories({ DB:env.DB },runtime).audit.append({
      id:crypto.randomUUID(),occurredAt:'2026-10-12T00:00:00.000Z',actorKind:'root',actorId:'root',
      action:'merchant.late',targetType:'merchant',targetId:active.merchantId,outcome:'succeeded',correlationId:'disposed',
    })).rejects.toThrow();
    await expect(env.DB.prepare('INSERT INTO credential_rate_limit_windows (credential_id,window_started_at,request_count) VALUES (?1,0,1)')
      .bind('deleted-credential-'+active.runId).run()).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
    expect(await env.DB.prepare('SELECT control_version FROM e2e_run_claims WHERE run_id=?1').bind(active.runId).first())
      .toEqual({ control_version:2 });
    await expect(store.advance(active.runId,'disposed','active')).rejects.toThrow();
  });

  test.each(['merchant','provisioning','organization','generation','target','deadlines','proof','controller','request','payload','quota'] as const)
    ('the durable reservation keeps %s immutable with actual row equality', async field => {
      const reserved = await createProductControlStore(env.DB).mirror(lease());
      const mutations = {
        merchant: ['merchant_id=?1',crypto.randomUUID()],provisioning:['provisioning_id=?1',crypto.randomUUID()],
        organization:['organization_id=?1',crypto.randomUUID()],generation:['generation=?1','f'.repeat(40)],
        target:['target_id=?1','f'.repeat(64)],deadlines:['issued_at=issued_at+1,expires_at=expires_at+1',0],
        proof:['proof_hash=?1','f'.repeat(64)],controller:['controller_hash=?1','f'.repeat(64)],
        request:['request_id=?1',crypto.randomUUID()],payload:['payload_hash=?1','f'.repeat(64)],quota:['account_quota=?1',4],
      } as const;
      const [set,value] = mutations[field];
      const before = await createProductControlStore(env.DB).read(reserved.runId);
      const statement = field==='deadlines'
        ? env.DB.prepare('UPDATE e2e_control_runs SET '+set+' WHERE run_id=?1').bind(reserved.runId)
        : env.DB.prepare('UPDATE e2e_control_runs SET '+set+' WHERE run_id=?2').bind(value,reserved.runId);
      await expect(statement.run()).rejects.toThrow();
      expect(await createProductControlStore(env.DB).read(reserved.runId)).toEqual(before);
    });

  test('both phase CAS and quarantine are monotonic and cannot reopen creation', async () => {
    const store = createProductControlStore(env.DB);
    const reserved = await store.mirror(lease());
    await expect(store.advance(reserved.runId,'active','fencing')).rejects.toThrow();
    await store.advance(reserved.runId,'reserved','product-provisioned');
    await expect(store.advance(reserved.runId,'product-provisioned','reserved')).rejects.toThrow();
    await store.quarantine(reserved.runId);
    await expect(store.advance(reserved.runId,'quarantined','active')).rejects.toThrow();
    expect((await store.read(reserved.runId))?.phase).toBe('quarantined');
    await expect(withControlWrite(env.DB,runtime,(await store.read(reserved.runId))!,'provision',[
      env.DB.prepare("INSERT INTO merchants (id,name,status,created_at) VALUES (?1,'forbidden','active','2026-10-12T00:00:00.000Z')")
        .bind(reserved.merchantId),
    ])).rejects.toThrow();
    expect(await env.DB.prepare('SELECT id FROM merchants WHERE id=?1').bind(reserved.merchantId).first()).toBeNull();
  });

  test('Product mirror atomically refuses a ninth lease with no partial claims or request rows', async () => {
    const targetId = '9'.repeat(64);
    const outcomes = await Promise.allSettled(Array.from({length:9},()=>createProductControlStore(env.DB).mirror({ ...lease(),targetId })));
    expect(outcomes.filter(outcome=>outcome.status==='fulfilled')).toHaveLength(8);
    expect(await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM e2e_control_runs WHERE target_id=?1) AS runs,
      (SELECT COUNT(*) FROM e2e_run_claims c JOIN e2e_control_runs r ON r.run_id=c.run_id WHERE r.target_id=?1) AS claims,
      (SELECT COUNT(*) FROM e2e_control_requests q JOIN e2e_control_runs r ON r.run_id=q.run_id WHERE r.target_id=?1) AS requests`)
      .bind(targetId).first()).toEqual({ runs:8,claims:8,requests:8 });
  });
  test('Product mirror retry preserves the full supplied tuple and rejects an omitted recorded organization', async () => {
    const store=createProductControlStore(env.DB),input=lease(),recorded=await store.mirror(input);
    expect(await store.mirror(input)).toEqual(recorded);
    const { organizationId:_organizationId,...omitted }=input;
    await expect(store.mirror(omitted)).rejects.toThrow();
    expect(await store.read(recorded.runId)).toEqual(recorded);
  });

  test('a supplied cleanup invocation is mirrored exactly and altered deadlines cannot authorize deletion', async () => {
    const active = await seed();
    const issuedAt = (await env.DB.prepare("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS n").first<{n:number}>())!.n;
    const cleanup = { id:crypto.randomUUID(),runId:active.runId,proofHash:active.proofHash,currentGeneration:runtime.generation,
      issuedAt,expiresAt:issuedAt+300000 };
    await withControlWrite(env.DB,runtime,active,'fence',[
      env.DB.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE run_id=?1").bind(active.runId),
    ],cleanup);
    const recorded = await env.DB.prepare(`SELECT id,run_id AS runId,proof_hash AS proofHash,current_generation AS currentGeneration,
      issued_at AS issuedAt,expires_at AS expiresAt FROM e2e_control_cleanup WHERE id=?1`).bind(cleanup.id).first();
    expect(recorded).toEqual(cleanup);
    const fencing = (await createProductControlStore(env.DB).read(active.runId))!;
    const before = await snapshot(active.merchantId);
    await expect(withControlWrite(env.DB,runtime,fencing,'dispose',[
      env.DB.prepare('DELETE FROM customers WHERE merchant_id=?1').bind(active.merchantId),
    ],{ ...cleanup,issuedAt:issuedAt+1,expiresAt:issuedAt+300001 })).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
    expect(await env.DB.prepare('SELECT issued_at,expires_at FROM e2e_control_cleanup WHERE id=?1').bind(cleanup.id).first())
      .toEqual({ issued_at:issuedAt,expires_at:issuedAt+300000 });
  });
  test('expired cleanup cannot delete and identical cleanup retry never renews its deadline', async () => {
    const active=await seed(),store=createProductControlStore(env.DB);
    const requestId=crypto.randomUUID();
    const cleanup=await store.beginCleanup(active.runId,active.proofHash,runtime.generation,requestId);
    expect(await store.beginCleanup(active.runId,active.proofHash,runtime.generation,requestId)).toEqual(cleanup);
    await expect(store.beginCleanup(active.runId,'f'.repeat(64),runtime.generation,requestId)).rejects.toThrow();
    await store.advance(active.runId,'active','fencing');
    const ddl=migrationText.match(/CREATE TRIGGER e2e_control_cleanup_immutable[\s\S]*?\nBEGIN[^\n]*END;/)?.[0];
    if (!ddl) throw new Error('Missing cleanup trigger');
    await env.DB.prepare('DROP TRIGGER e2e_control_cleanup_immutable').run();
    try { await env.DB.prepare('UPDATE e2e_control_cleanup SET issued_at=0,expires_at=300000 WHERE id=?1').bind(cleanup.id).run(); }
    finally { await env.DB.prepare(ddl).run(); }
    const aged=await store.beginCleanup(active.runId,active.proofHash,runtime.generation,requestId);
    expect(aged).toEqual({ ...cleanup,issuedAt:0,expiresAt:300000 });
    const before=await snapshot(active.merchantId);
    await expect(withControlWrite(env.DB,runtime,(await store.read(active.runId))!,'dispose',[
      env.DB.prepare('DELETE FROM customers WHERE merchant_id=?1').bind(active.merchantId),
    ],aged)).rejects.toThrow();
    expect(await snapshot(active.merchantId)).toEqual(before);
  });
});
