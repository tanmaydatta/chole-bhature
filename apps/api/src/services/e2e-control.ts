import { CoreControlCallSchema, E2eControlLeaseSchema, type CoreControlReply, type StoredControlLease } from '@incentives/contracts';
import type { Env } from '../env.js';
import { controlRuntime } from '../e2e-control-runtime.js';
import { createProductControlStore } from './e2e-control-store.js';
import { withControlWrite } from '../repositories/e2e-write-fence.js';
import { inspectProductE2eRun } from './e2e-inspection.js';

const tables = ['redemption_entries','redemption_operations','redemptions','evaluation_decisions','promo_code_claims',
  'program_counters','program_revisions','programs','api_credentials','customers','variable_definitions','schema_versions','product_audit'] as const;
const migrations = ['0008_e2e_tenant_lifecycle.sql','0009_e2e_control_leases.sql'];

async function ready(db: D1Database) {
  const markers = (await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results;
  const schema = (await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'e2e_control_%'").all<{ name: string }>()).results;
  if (!migrations.every(name => markers.some(row => row.name === name))
    || !['e2e_control_runs','e2e_control_requests','e2e_control_cleanup','e2e_control_write_guards',
      'e2e_control_valid_runs','e2e_control_valid_write_guards','e2e_control_merchant_scopes',
      'e2e_control_guard_insert','e2e_control_guard_final','e2e_control_merchant_reservation',
      'e2e_control_admission','e2e_control_run_immutable','e2e_control_claim_immutable'].every(name => schema.some(row => row.name === name))) {
    throw new Error('E2E_CONTROL_INCOMPATIBLE');
  }
}

function sameTuple(a: StoredControlLease, b: StoredControlLease) {
  return Object.entries(a).every(([key,value]) => key === 'phase' || value === Reflect.get(b,key));
}

function view(lease: StoredControlLease) {
  const { proofHash:_proof,controllerHash:_controller,requestId:_request,payloadHash:_payload,accountQuota:_quota,...publicLease } = lease;
  return E2eControlLeaseSchema.parse(publicLease);
}

export function createProductE2eControl(env: Env) {
  const db = env.DB, store = createProductControlStore(db);
  async function inventory(lease: StoredControlLease) {
    const counts: Record<string,number> = {};
    for (const table of tables) counts[table] = (await db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE merchant_id=?1').bind(lease.merchantId).first<{ n:number }>())?.n ?? 0;
    counts.merchants = (await db.prepare('SELECT COUNT(*) AS n FROM merchants WHERE id=?1 OR provisioning_id=?2').bind(lease.merchantId,lease.provisioningId).first<{ n:number }>())?.n ?? 0;
    counts.redemption_commit_guards = (await db.prepare(`SELECT COUNT(*) AS n FROM redemption_commit_guards WHERE merchant_id=?1
      OR redemption_id IN (SELECT id FROM redemptions WHERE merchant_id=?1)`).bind(lease.merchantId).first<{ n:number }>())?.n ?? 0;
    counts.credential_rate_limit_windows = (await db.prepare('SELECT COUNT(*) AS n FROM credential_rate_limit_windows WHERE credential_id IN (SELECT id FROM api_credentials WHERE merchant_id=?1)').bind(lease.merchantId).first<{ n:number }>())?.n ?? 0;
    return counts;
  }
  async function ownership(lease: StoredControlLease) {
    const merchants = (await db.prepare('SELECT id,provisioning_id AS provisioningId,e2e_control_run_id AS runId,name FROM merchants WHERE id=?1 OR provisioning_id=?2')
      .bind(lease.merchantId,lease.provisioningId).all<{ id:string; provisioningId:string; runId:string; name:string }>()).results;
    if (merchants.length > 1 || merchants.some(row => row.id !== lease.merchantId || row.provisioningId !== lease.provisioningId
      || row.runId !== lease.runId || row.name !== lease.runId+'_merchant')) throw new Error('E2E_CONTROL_QUARANTINED');
  }
  return { async execute(raw: unknown): Promise<CoreControlReply> {
    const parsed = CoreControlCallSchema.safeParse(raw);
    const id = parsed.success ? parsed.data.envelope.requestId : crypto.randomUUID();
    try {
      if (!parsed.success) throw new Error('E2E_CONTROL_INVALID_REQUEST');
      const call = parsed.data, runtime = controlRuntime(env);
      if (call.envelope.generation !== runtime.generation || call.envelope.targetId !== runtime.targetId) throw new Error('E2E_CONTROL_INCOMPATIBLE');
      await ready(db);
      if (call.operation === 'capabilities') return { protocol: 'incentives-e2e-control', version: 2,
        runtime: { environment: runtime.environment, generation: runtime.generation, targetId: runtime.targetId },
        product: 2, migrations, fencing: true, recovery: true };
      const recovering = (call.operation === 'fence' && call.cleanup !== undefined) || call.operation === 'dispose' || call.operation === 'status';
      if (call.reservation.targetId !== runtime.targetId || (call.reservation.generation !== runtime.generation
        && (!recovering || !runtime.cleanupGenerations.includes(call.reservation.generation)))) throw new Error('E2E_CONTROL_INCOMPATIBLE');
      if (!recovering && (!runtime.enabled || call.reservation.expiresAt <= Date.now())) throw new Error('E2E_CONTROL_EXPIRED');
      let lease = await store.read(call.reservation.runId);
      if (lease && !sameTuple(lease,call.reservation)) throw new Error('E2E_CONTROL_FORBIDDEN');
      await ownership(call.reservation);
      if (!lease) {
        if (call.operation === 'reserve') lease = await store.mirror(call.reservation);
        else if (recovering) {
          const counts = await inventory(call.reservation);
          if (Object.values(counts).some(n => n !== 0)) throw new Error('E2E_CONTROL_QUARANTINED');
          // Retain a fence even when cancellation beats the first Product reservation.
          // Expired reservations cannot be admitted by the SQL-clock admission trigger.
          if (call.operation === 'status') return { lease:view(call.reservation),product:counts };
          if (call.reservation.expiresAt > Date.now()) lease = await store.mirror({ ...call.reservation, phase: 'reserved' });
          else return { lease:view({ ...call.reservation,phase:call.operation === 'dispose' ? 'disposed' : 'fencing' }), product:counts };
        } else throw new Error('E2E_CONTROL_NOT_FOUND');
      }
      if (call.operation === 'provision') {
        if (lease.phase === 'reserved') {
          await withControlWrite(db,runtime,lease,'provision',[db.prepare(`INSERT INTO merchants
            (id,name,status,provisioning_id,created_at,e2e_control_run_id) VALUES (?1,?2,'pending',?3,?4,?5)`)
            .bind(lease.merchantId,lease.runId+'_merchant',lease.provisioningId,new Date(lease.issuedAt).toISOString(),lease.runId)]);
          lease = await store.advance(lease.runId,'reserved','product-provisioned');
        }
        if (!['product-provisioned','auth-provisioned','active'].includes(lease.phase)) throw new Error('E2E_CONTROL_EXPIRED');
      }
      if (call.operation === 'activate' && lease.phase !== 'active') {
        await withControlWrite(db,runtime,lease,'activate',[db.prepare("UPDATE merchants SET status='active' WHERE id=?1 AND e2e_control_run_id=?2")
          .bind(lease.merchantId,lease.runId)]);
        if (lease.phase === 'product-provisioned') lease = await store.advance(lease.runId,'product-provisioned','auth-provisioned');
        lease = await store.advance(lease.runId,'auth-provisioned','active');
      }
      if (call.operation === 'inspect') {
        if (lease.phase !== 'active') throw new Error('E2E_CONTROL_EXPIRED');
        return inspectProductE2eRun(env,{ runId:lease.runId,merchantId:lease.merchantId,provisioningId:lease.provisioningId,proofHash:lease.proofHash },call.query);
      }
      if (call.operation === 'fence' && !['fencing','disposing','disposed'].includes(lease.phase)) {
        await withControlWrite(db,runtime,lease,'fence',[db.prepare("UPDATE e2e_control_runs SET phase='fencing' WHERE run_id=?1").bind(lease.runId)],call.cleanup);
        lease = (await store.read(lease.runId))!;
      }
      if (call.operation === 'dispose' && lease.phase !== 'disposed') {
        if (lease.phase === 'fencing' || lease.phase === 'quarantined') lease = await store.advance(lease.runId,lease.phase,'disposing');
        if (lease.phase !== 'disposing') throw new Error('E2E_CONTROL_FORBIDDEN');
        const statements = [db.prepare('DELETE FROM redemption_commit_guards WHERE merchant_id=?1 OR redemption_id IN (SELECT id FROM redemptions WHERE merchant_id=?1)').bind(lease.merchantId),
          db.prepare('DELETE FROM credential_rate_limit_windows WHERE credential_id IN (SELECT id FROM api_credentials WHERE merchant_id=?1)').bind(lease.merchantId),
          ...tables.map(table => db.prepare('DELETE FROM '+table+' WHERE merchant_id=?1').bind(call.reservation.merchantId)),
          db.prepare('DELETE FROM merchants WHERE id=?1 AND e2e_control_run_id=?2').bind(lease.merchantId,lease.runId),
          db.prepare("UPDATE e2e_run_claims SET status='disposed',disposed_at=?1 WHERE run_id=?2").bind(new Date().toISOString(),lease.runId)];
        await withControlWrite(db,runtime,lease,'dispose',statements,call.cleanup);
        if (Object.values(await inventory(lease)).some(n => n !== 0)) throw new Error('E2E_CONTROL_QUARANTINED');
        lease = await store.advance(lease.runId,'disposing','disposed');
      }
      return { lease:view(lease), product:await inventory(lease) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      const code = reason === 'E2E_CONTROL_INVALID_REQUEST' ? 'INVALID_REQUEST' : reason.includes('QUARANTINED') || reason.includes('CORRUPT') ? 'QUARANTINED'
        : reason === 'E2E_CONTROL_NOT_FOUND' ? 'NOT_FOUND' : reason.includes('FORBIDDEN') ? 'FORBIDDEN' : reason.includes('EXPIRED') || reason.includes('FENCED') ? 'EXPIRED' : 'INCOMPATIBLE';
      return { error: { code, correlationId: id, retryable: false } };
    }
  } };
}
