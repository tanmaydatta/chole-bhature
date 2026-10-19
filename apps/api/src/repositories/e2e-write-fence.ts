import { StoredControlLeaseSchema, type CleanupInvocation, type E2eControlRuntime, type StoredControlLease } from '@incentives/contracts';
import { executeE2eControlWriteBatch } from '@incentives/worker-runtime';

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
  return executeE2eControlWriteBatch(db,runtime,StoredControlLeaseSchema.parse(row),'business',statements);
}

export async function withControlWrite(
  db: D1Database, runtime: E2eControlRuntime, lease: StoredControlLease,
  intent: 'provision' | 'activate' | 'fence' | 'dispose',
  statements: D1PreparedStatement[], cleanup?: CleanupInvocation,
): Promise<D1Result[]> {
  return executeE2eControlWriteBatch(db,runtime,lease,intent,statements,cleanup);
}
