import {
  CleanupInvocationSchema, E2eControlRuntimeSchema, StoredControlLeaseSchema,
  type CleanupInvocation, type E2eControlRuntime, type StoredControlLease,
} from '@incentives/contracts';

type Intent = 'business' | 'provision' | 'activate' | 'fence' | 'dispose';

export async function executeE2eControlWriteBatch(
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
