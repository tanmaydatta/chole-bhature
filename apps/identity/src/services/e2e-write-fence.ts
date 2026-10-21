import { StoredControlLeaseSchema, type CleanupInvocation, type E2eControlRuntime, type StoredControlLease } from '@incentives/contracts';
import { executeE2eControlWriteBatch } from '@incentives/worker-runtime';

export async function authOrganizationIsControlMarked(db: D1Database, organizationId: string): Promise<boolean> {
  // Recognize the pre-control schema positively. SQL errors and partial migrations
  // must never become an ordinary write, even with control disabled or absent.
  // Recheck per call so a later migration or schema failure is never cached away.
  const [objects, organizations, users, claims, migration] = await Promise.all([
    db.prepare("SELECT lower(name) AS name, type FROM sqlite_master WHERE lower(name) GLOB 'e2e_control_*'")
      .all<{ name: string; type: string }>(),
    db.prepare('PRAGMA table_info(organizations)').all<{ name: string }>(),
    db.prepare('PRAGMA table_info(user)').all<{ name: string }>(),
    db.prepare('PRAGMA table_info(e2e_run_claims)').all<{ name: string }>(),
    db.prepare("SELECT name FROM d1_migrations WHERE lower(name)='0007_e2e_control_leases.sql'").first(),
  ]);
  const hasColumn = (columns: { name: string }[], name: string) => columns.some(column => column.name.toLowerCase() === name);
  if (!hasColumn(organizations.results, 'id') || !hasColumn(users.results, 'id')
    || !hasColumn(claims.results, 'run_id')) throw new Error('E2E_CONTROL_INCOMPATIBLE');
  const markers = [hasColumn(organizations.results, 'e2e_control_run_id'),
    hasColumn(users.results, 'e2e_control_run_id'), hasColumn(claims.results, 'control_version')];
  if (!migration && objects.results.length === 0 && markers.every(marked => !marked)) return false;

  const required = {
    table: ['e2e_control_runs', 'e2e_control_accounts', 'e2e_control_cleanup', 'e2e_control_requests', 'e2e_control_write_guards'],
    view: ['e2e_control_valid_runs', 'e2e_control_valid_write_guards'],
    trigger: ['e2e_control_guard_insert', 'e2e_control_guard_final', 'e2e_control_session_insert', 'e2e_control_session_update',
      'e2e_control_fixture_session_tuple', 'e2e_control_account_reserve', 'e2e_control_membership_tuple',
      'e2e_control_organization_reservation', 'e2e_control_session_audit', 'e2e_control_organization_marker', 'e2e_control_user_marker'],
  };
  if (!migration || !markers.every(Boolean) || !Object.entries(required).every(([type, names]) =>
    names.every(name => objects.results.some(object => object.name === name && object.type === type)))) {
    throw new Error('E2E_CONTROL_INCOMPATIBLE');
  }
  return await db.prepare(`SELECT 1 FROM organizations WHERE id=?1 AND e2e_control_run_id IS NOT NULL
      UNION ALL SELECT 1 FROM e2e_control_runs WHERE organization_id=?1 LIMIT 1`)
    .bind(organizationId).first() !== null;
}

export async function withAuthBusinessWrite(
  db: D1Database, runtime: E2eControlRuntime | undefined, organizationId: string,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  const scopeId = organizationId;
  const marked = await authOrganizationIsControlMarked(db, scopeId);
  if (!marked) return db.batch(statements);
  if (!runtime) throw new Error('E2E_CONTROL_UNAVAILABLE');
  const row = await db.prepare(`SELECT run_id AS runId, merchant_id AS merchantId,
    provisioning_id AS provisioningId, organization_id AS organizationId, generation,
    target_id AS targetId, issued_at AS issuedAt, expires_at AS expiresAt, phase,
    proof_hash AS proofHash, controller_hash AS controllerHash, request_id AS requestId,
    payload_hash AS payloadHash, account_quota AS accountQuota
    FROM e2e_control_runs WHERE organization_id=?1`).bind(scopeId).first<Record<string, unknown>>();
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
