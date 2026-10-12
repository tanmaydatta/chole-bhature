import {
  CleanupInvocationSchema, StoredControlLeaseSchema,
  type CleanupInvocation, type E2eControlLease, type StoredControlLease,
} from '@incentives/contracts';

const projection = `run_id AS runId, merchant_id AS merchantId, provisioning_id AS provisioningId,
 organization_id AS organizationId, generation, target_id AS targetId,
 issued_at AS issuedAt, expires_at AS expiresAt, phase, proof_hash AS proofHash,
 controller_hash AS controllerHash, request_id AS requestId, payload_hash AS payloadHash,
 account_quota AS accountQuota`;

/** Durable reservation only. Callers supply authenticated authority; no principal is manufactured. */
export function createIdentityControlStore(db: D1Database) {
  async function read(runId: string): Promise<StoredControlLease | null> {
    const row = await db.prepare(`SELECT ${projection} FROM e2e_control_runs WHERE run_id=?1`)
      .bind(runId).first<Record<string, unknown>>();
    if (!row) {
      const retained = await db.prepare(`SELECT 1 FROM e2e_run_claims WHERE run_id=?1 AND control_version=2
        UNION ALL SELECT 1 FROM organizations WHERE e2e_control_run_id=?1
        UNION ALL SELECT 1 FROM user WHERE e2e_control_run_id=?1
        UNION ALL SELECT 1 FROM e2e_control_accounts WHERE run_id=?1 LIMIT 1`).bind(runId).first();
      if (retained) throw new Error('E2E_CONTROL_CORRUPT');
      return null;
    }
    if (row.organizationId === null) delete row.organizationId;
    const lease = StoredControlLeaseSchema.parse(row);
    const claim = await db.prepare(`SELECT run_id FROM e2e_run_claims
      WHERE run_id=?1 AND merchant_id=?2 AND provisioning_id=?3 AND proof_hash=?4
        AND control_version=2`)
      .bind(lease.runId, lease.merchantId, lease.provisioningId, lease.proofHash).first();
    if (!claim) throw new Error('E2E_CONTROL_CORRUPT');
    return lease;
  }

  function sameReservation(existing: StoredControlLease, input: StoredControlLease, suppliedOrganization: string | undefined) {
    return existing.merchantId === input.merchantId && existing.provisioningId === input.provisioningId
      && (suppliedOrganization === undefined || existing.organizationId === suppliedOrganization)
      && existing.generation === input.generation && existing.targetId === input.targetId
      && existing.proofHash === input.proofHash && existing.controllerHash === input.controllerHash
      && existing.requestId === input.requestId && existing.payloadHash === input.payloadHash
      && existing.accountQuota === input.accountQuota
      ;
  }

  return {
    read,
    async reserve(raw: Omit<StoredControlLease, 'issuedAt' | 'expiresAt' | 'phase'>): Promise<StoredControlLease> {
      const input = StoredControlLeaseSchema.parse({ ...raw, organizationId: raw.organizationId ?? crypto.randomUUID(),
        issuedAt: 0, expiresAt: 900_000, phase: 'reserved' });
      const existing = await read(input.runId);
      if (existing) {
        if (!sameReservation(existing, input, raw.organizationId)) throw new Error('E2E_CONTROL_CONFLICT');
        return existing;
      }
      // Admission, ledger and immutable claim reservation commit together before any tenant I/O.
      await db.batch([
        db.prepare(`INSERT INTO e2e_control_runs
          (run_id,merchant_id,provisioning_id,organization_id,generation,target_id,
           issued_at,expires_at,phase,proof_hash,controller_hash,request_id,payload_hash,account_quota)
          VALUES (?1,?2,?3,?4,?5,?6,CAST(unixepoch('subsec') * 1000 AS INTEGER),CAST(unixepoch('subsec') * 1000 AS INTEGER)+900000,'reserved',?7,?8,?9,?10,?11)
          ON CONFLICT(run_id) DO NOTHING`)
          .bind(input.runId,input.merchantId,input.provisioningId,input.organizationId ?? null,
            input.generation,input.targetId,
            input.proofHash,input.controllerHash,input.requestId,input.payloadHash,input.accountQuota),
        db.prepare(`INSERT INTO e2e_run_claims
          (run_id,merchant_id,provisioning_id,proof_hash,status,created_at,control_version)
          SELECT run_id,merchant_id,provisioning_id,proof_hash,'active',issued_at,2
          FROM e2e_control_runs WHERE run_id=?1 ON CONFLICT(run_id) DO NOTHING`).bind(input.runId),
        db.prepare(`INSERT INTO e2e_control_requests
          (run_id,request_id,action,payload_hash,status)
          SELECT run_id,request_id,'bootstrap',payload_hash,'reserved' FROM e2e_control_runs
          WHERE run_id=?1 ON CONFLICT DO NOTHING`).bind(input.runId),
      ]);
      const recorded = await read(input.runId);
      if (!recorded || !sameReservation(recorded, input, raw.organizationId)) throw new Error('E2E_CONTROL_CONFLICT');
      return recorded;
    },
    async advance(runId: string, expectedPhase: E2eControlLease['phase'], nextPhase: E2eControlLease['phase']): Promise<StoredControlLease> {
      if (!await read(runId)) throw new Error('E2E_CONTROL_NOT_FOUND');
      const result = await db.prepare(`UPDATE e2e_control_runs SET phase=?1
        WHERE run_id=?2 AND phase=?3`).bind(nextPhase,runId,expectedPhase).run();
      if (result.meta.changes !== 1) throw new Error('E2E_CONTROL_CONFLICT');
      const recorded = await read(runId);
      if (!recorded) throw new Error('E2E_CONTROL_NOT_FOUND');
      return recorded;
    },
    async quarantine(runId: string): Promise<void> {
      if (!await read(runId)) throw new Error('E2E_CONTROL_NOT_FOUND');
      const result = await db.prepare(`UPDATE e2e_control_runs SET phase='quarantined'
        WHERE run_id=?1 AND phase<>'disposed'`).bind(runId).run();
      if (result.meta.changes !== 1) throw new Error('E2E_CONTROL_CONFLICT');
    },
    async beginCleanup(runId: string, proofHash: string, currentGeneration: string, requestId: string): Promise<CleanupInvocation> {
      const lease = await read(runId);
      if (!lease || lease.proofHash !== proofHash) throw new Error('E2E_CONTROL_FORBIDDEN');
      // The authoritative side allocates once; Core records this exact supplied invocation in its guarded batch.
      CleanupInvocationSchema.parse({ id: crypto.randomUUID(), runId, proofHash, currentGeneration, issuedAt: 0, expiresAt: 300_000 });
      await db.prepare(`INSERT INTO e2e_control_cleanup
        (id,run_id,proof_hash,current_generation,request_id,issued_at,expires_at)
        VALUES (?1,?2,?3,?4,?5,CAST(unixepoch('subsec') * 1000 AS INTEGER),CAST(unixepoch('subsec') * 1000 AS INTEGER)+300000)
        ON CONFLICT(run_id,request_id) DO NOTHING`)
        .bind(crypto.randomUUID(),runId,proofHash,currentGeneration,requestId).run();
      const row = await db.prepare(`SELECT id,run_id AS runId,proof_hash AS proofHash,
        current_generation AS currentGeneration,issued_at AS issuedAt,expires_at AS expiresAt
        FROM e2e_control_cleanup WHERE run_id=?1 AND request_id=?2`).bind(runId,requestId).first();
      const invocation = CleanupInvocationSchema.parse(row);
      if (invocation.proofHash !== proofHash || invocation.currentGeneration !== currentGeneration) {
        throw new Error('E2E_CONTROL_CONFLICT');
      }
      return invocation;
    },
  };
}
