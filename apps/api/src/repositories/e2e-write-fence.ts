import {
  CleanupInvocationSchema, E2eControlRuntimeSchema, StoredControlLeaseSchema,
  type CleanupInvocation, type E2eControlRuntime, type StoredControlLease,
} from '@incentives/contracts';

type Intent = 'business' | 'provision' | 'activate' | 'fence' | 'dispose';

async function guardedBatch(
  db: D1Database, runtime: E2eControlRuntime, lease: StoredControlLease,
  intent: Intent, statements: D1PreparedStatement[], cleanup?: CleanupInvocation,
): Promise<D1Result[]> {
  E2eControlRuntimeSchema.parse(runtime);
  StoredControlLeaseSchema.parse(lease);
  if (runtime.targetId !== lease.targetId) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  const recovering = cleanup !== undefined && (intent === 'fence' || intent === 'dispose');
  if (!recovering && (!runtime.enabled || runtime.generation !== lease.generation)) {
    throw new Error('E2E_CONTROL_INCOMPATIBLE');
  }
  if (intent === 'dispose' && !cleanup) throw new Error('E2E_CONTROL_FORBIDDEN');
  if (cleanup && !recovering) throw new Error('E2E_CONTROL_FORBIDDEN');
  const statementsBefore: D1PreparedStatement[] = [];
  if (cleanup) {
    CleanupInvocationSchema.parse(cleanup);
    if (cleanup.runId !== lease.runId || cleanup.proofHash !== lease.proofHash
      || cleanup.currentGeneration !== runtime.generation
      || (lease.generation !== runtime.generation && !runtime.cleanupGenerations.includes(lease.generation))) {
      throw new Error('E2E_CONTROL_FORBIDDEN');
    }
    // Auth's supplied ID and deadlines are mirrored exactly; no second clock/allocation.
    statementsBefore.push(db.prepare(`INSERT INTO e2e_control_cleanup
      (id,run_id,proof_hash,current_generation,request_id,issued_at,expires_at)
      VALUES (?1,?2,?3,?4,?1,?5,?6) ON CONFLICT DO NOTHING`)
      .bind(cleanup.id,cleanup.runId,cleanup.proofHash,cleanup.currentGeneration,cleanup.issuedAt,cleanup.expiresAt));
  }
  const id = crypto.randomUUID();
  statementsBefore.push(db.prepare(`INSERT INTO e2e_control_write_guards
    (id,run_id,merchant_id,provisioning_id,organization_id,generation,target_id,
     proof_hash,intent,current_generation,cleanup_id,cleanup_issued_at,cleanup_expires_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13
    WHERE EXISTS(SELECT 1 FROM e2e_control_runs r WHERE r.run_id=?2
      AND r.controller_hash=?14 AND r.request_id=?15 AND r.payload_hash=?16
      AND r.account_quota=?17 AND r.issued_at=?18 AND r.expires_at=?19 AND r.phase=?20)`)
    .bind(id,lease.runId,lease.merchantId,lease.provisioningId,lease.organizationId ?? null,
      lease.generation,lease.targetId,lease.proofHash,intent,runtime.generation,
      cleanup?.id ?? null,cleanup?.issuedAt ?? null,cleanup?.expiresAt ?? null,
      lease.controllerHash,lease.requestId,lease.payloadHash,lease.accountQuota,lease.issuedAt,lease.expiresAt,lease.phase));
  const results = await db.batch([
    ...statementsBefore, ...statements,
    // This trigger rechecks the SQL clock and current phase after ALL business writes.
    db.prepare('UPDATE e2e_control_write_guards SET checked=1 WHERE id=?1').bind(id),
    db.prepare(`SELECT json_extract(CASE WHEN changes()=1 THEN 'null'
      ELSE 'e2e-final-guard-missing' END,'$')`),
    db.prepare('DELETE FROM e2e_control_write_guards WHERE id=?1').bind(id),
  ]);
  return results.slice(statementsBefore.length, statementsBefore.length + statements.length);
}

export async function withProductBusinessWrite(
  db: D1Database, runtime: E2eControlRuntime | undefined, merchantId: string,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  const scopeId = merchantId;
  const marked = await db.prepare(`SELECT 1 FROM merchants WHERE id=?1 AND e2e_control_run_id IS NOT NULL
      UNION ALL SELECT 1 FROM e2e_run_claims WHERE merchant_id=?1 AND control_version=2
      UNION ALL SELECT 1 FROM e2e_control_runs WHERE merchant_id=?1 LIMIT 1`)
    .bind(scopeId).first();
  if (!marked) return db.batch(statements);
  if (!runtime) throw new Error('E2E_CONTROL_UNAVAILABLE');
  const row = await db.prepare(`SELECT run_id AS runId, merchant_id AS merchantId,
    provisioning_id AS provisioningId, organization_id AS organizationId, generation,
    target_id AS targetId, issued_at AS issuedAt, expires_at AS expiresAt, phase,
    proof_hash AS proofHash, controller_hash AS controllerHash, request_id AS requestId,
    payload_hash AS payloadHash, account_quota AS accountQuota
    FROM e2e_control_runs WHERE merchant_id=?1`).bind(scopeId).first<Record<string, unknown>>();
  if (!row) throw new Error('E2E_CONTROL_CORRUPT');
  if (row.organizationId === null) delete row.organizationId;
  return guardedBatch(db,runtime,StoredControlLeaseSchema.parse(row),'business',statements);
}

export async function withControlWrite(
  db: D1Database, runtime: E2eControlRuntime, lease: StoredControlLease,
  intent: 'provision' | 'activate' | 'fence' | 'dispose',
  statements: D1PreparedStatement[], cleanup?: CleanupInvocation,
): Promise<D1Result[]> {
  return guardedBatch(db,runtime,lease,intent,statements,cleanup);
}
