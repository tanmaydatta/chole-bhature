import { assertCiStack } from '../ci-stack.js';
import type { IdentityWorkerEnv } from '../staging-secrets.js';

import { E2eRunClaimSchema } from '@incentives/contracts';
import { z } from 'zod';

const IdentitySchema = E2eRunClaimSchema.extend({
  merchantId: z.string().min(1),
  provisioningId: z.string().min(1),
}).strict();
export type E2eTenantIdentity = z.infer<typeof IdentitySchema>;

interface Claim {
  runId: string;
  merchantId: string;
  provisioningId: string;
  proofHash: string;
  status: 'active' | 'disposing' | 'disposed';
}

export interface ProductE2eLifecycleClient {
  preview(input: E2eTenantIdentity): Promise<{ status: string; counts: Record<string, number> }>;
  dispose(input: E2eTenantIdentity, actorId: string, correlationId: string): Promise<{
    status: string; counts: Record<string, number>;
  }>;
}

interface Options {
  database: D1Database;
  ciEnv?: IdentityWorkerEnv | undefined;
  appEnv: string | undefined;
  localTestMode?: string | undefined;
  core: ProductE2eLifecycleClient;
}

function assertEnvironment(options: Options): void {
  if (options.ciEnv) {
    assertCiStack(options.ciEnv);
    if (options.ciEnv.APP_ENV !== options.appEnv
      || options.ciEnv.AUTH_DB !== options.database
      || options.ciEnv.E2E_LOCAL_TEST_MODE !== options.localTestMode) {
      throw new Error('Invalid CI stack: service configuration mismatch');
    }
  } else if (options.appEnv === 'ci') {
    throw new Error('Invalid CI stack: full service environment is required');
  }
}

function assertStaging(options: Options): void {
  assertEnvironment(options);
  if (options.appEnv !== 'ci' && options.appEnv !== 'staging'
    && !(options.appEnv === 'local' && options.localTestMode === '1')) {
    throw new Error('E2E lifecycle is staging-only outside explicit local test mode');
  }
}

async function exactClaim(db: D1Database, input: E2eTenantIdentity): Promise<Claim> {
  const result = await db.prepare(`
    SELECT run_id AS runId, merchant_id AS merchantId,
      provisioning_id AS provisioningId, proof_hash AS proofHash, status
    FROM e2e_run_claims WHERE run_id = ?1 OR merchant_id = ?2
  `).bind(input.runId, input.merchantId).all<Claim>();
  const claim = result.results[0];
  if (
    result.results.length !== 1 || !claim
    || claim.runId !== input.runId || claim.merchantId !== input.merchantId
    || claim.provisioningId !== input.provisioningId
    || claim.proofHash !== input.proofHash
  ) throw new Error('E2E Auth provenance mismatch');
  const row = await db.prepare(`
    SELECT client_provisionings.name AS provisioningName,
      organizations.id AS organizationId, organizations.name AS organizationName
    FROM client_provisionings
    LEFT JOIN organizations
      ON organizations.provisioning_id = client_provisionings.provisioning_id
    WHERE client_provisionings.provisioning_id = ?1
      AND client_provisionings.merchant_id = ?2
  `).bind(input.provisioningId, input.merchantId).first<{
    provisioningName: string; organizationId: string | null;
    organizationName: string | null;
  }>();
  if (claim.status !== 'disposed') {
    if (!row || !row.organizationId
      || !row.provisioningName.startsWith(`${input.runId}_merchant`)
      || row.organizationName !== row.provisioningName) {
      throw new Error('E2E Auth tenant provenance mismatch');
    }
  } else if (row) {
    throw new Error('Disposed E2E Auth tenant unexpectedly exists');
  }
  return claim;
}

async function tenantData(db: D1Database, input: E2eTenantIdentity) {
  const organization = await db.prepare(`
    SELECT id FROM organizations WHERE merchant_id = ?1 AND provisioning_id = ?2
  `).bind(input.merchantId, input.provisioningId).first<{ id: string }>();
  if (!organization) return { organizationId: null, userIds: [] as string[], counts: {
    client_provisionings: 0, organizations: 0, invitations: 0, memberships: 0,
    users: 0, fixture_sessions: 0, local_email_capture: 0,
  } };
  const prefix = `e2e+${input.runId}_`;
  const invitations = await db.prepare(`
    SELECT email FROM invitations WHERE organization_id = ?1
  `).bind(organization.id).all<{ email: string }>();
  if (invitations.results.some(item => !item.email.toLowerCase().startsWith(prefix))) {
    throw new Error('Invitation is outside the E2E run namespace');
  }
  const members = await db.prepare(`
    SELECT memberships.user_id AS userId, user.email,
      auth_profile.subject_kind AS subjectKind
    FROM memberships
    JOIN user ON user.id = memberships.user_id
    LEFT JOIN auth_profile ON auth_profile.user_id = user.id
    WHERE memberships.organization_id = ?1
  `).bind(organization.id).all<{ userId: string; email: string; subjectKind: string | null }>();
  if (members.results.some(item => !item.email.toLowerCase().startsWith(prefix)
    || item.subjectKind !== 'employee')) {
    throw new Error('Membership user is outside the E2E run namespace');
  }
  for (const member of members.results) {
    const foreign = await db.prepare(`
      SELECT COUNT(*) AS total FROM memberships
      WHERE user_id = ?1 AND organization_id <> ?2
    `).bind(member.userId, organization.id).first<{ total: number }>();
    if ((foreign?.total ?? 0) !== 0) throw new Error('E2E user has a foreign organization membership');
  }
  const fixtureSessions = await db.prepare(`
    SELECT user_id AS userId, merchant_id AS merchantId
    FROM e2e_fixture_sessions WHERE run_id = ?1
  `).bind(input.runId).all<{ userId: string; merchantId: string }>();
  const memberUserIds = new Set(members.results.map(item => item.userId));
  if (fixtureSessions.results.some(item => item.merchantId !== input.merchantId
    || !memberUserIds.has(item.userId))) {
    throw new Error('E2E fixture session is outside the run tenant');
  }
  const emailCapture = await db.prepare(`
    SELECT COUNT(*) AS total FROM local_email_capture
    WHERE substr(lower(recipient), 1, length(?1)) = ?1
  `).bind(prefix).first<{ total: number }>();
  return {
    organizationId: organization.id,
    userIds: members.results.map(item => item.userId),
    counts: {
      client_provisionings: 1,
      organizations: 1,
      invitations: invitations.results.length,
      memberships: members.results.length,
      users: members.results.length,
      fixture_sessions: fixtureSessions.results.length,
      local_email_capture: emailCapture?.total ?? 0,
    },
  };
}

export function createIdentityE2eLifecycle(options: Options) {
  const db = options.database;
  return {
    async preview(raw: E2eTenantIdentity) {
      assertStaging(options);
      const input = IdentitySchema.parse(raw);
      const claim = await exactClaim(db, input);
      const auth = await tenantData(db, input);
      const product = await options.core.preview(input);
      if (product.status !== 'active' && product.status !== 'disposed') {
        throw new Error('Product E2E provenance is unavailable');
      }
      return { runId: input.runId, merchantId: input.merchantId,
        status: claim.status, auth: auth.counts, product: product.counts,
        productStatus: product.status };
    },

    async dispose(raw: E2eTenantIdentity, actorId: string, correlationId: string) {
      assertStaging(options);
      const input = IdentitySchema.parse(raw);
      const claim = await exactClaim(db, input);
      if (claim.status === 'disposed') return this.preview(input);
      const auth = await tenantData(db, input);
      // Validate Product provenance before entering the irreversible phase.
      await options.core.preview(input);
      await db.prepare(`UPDATE e2e_run_claims SET status = 'disposing'
        WHERE run_id = ?1 AND merchant_id = ?2 AND proof_hash = ?3 AND status = 'active'`)
        .bind(input.runId, input.merchantId, input.proofHash).run();
      const product = await options.core.dispose(input, actorId, correlationId);
      if (product.status !== 'disposed' || Object.values(product.counts).some(value => value !== 0)) {
        throw new Error('Product E2E disposal did not finish');
      }
      // Recheck run-exclusive Auth ownership after the cross-Worker operation.
      const current = await tenantData(db, input);
      if (current.organizationId !== auth.organizationId) {
        throw new Error('E2E Auth organization changed during disposal');
      }
      const prefix = `e2e+${input.runId}_`;
      const now = Date.now();
      await db.batch([
        db.prepare('DELETE FROM invitations WHERE organization_id = ?1').bind(current.organizationId),
        db.prepare(`DELETE FROM local_email_capture
          WHERE substr(lower(recipient), 1, length(?1)) = ?1`).bind(prefix),
        db.prepare(`DELETE FROM verification
          WHERE substr(lower(identifier), 1, length(?1)) = ?1`).bind(prefix),
        db.prepare(`DELETE FROM user WHERE id IN
          (SELECT user_id FROM memberships WHERE organization_id = ?1)`).bind(current.organizationId),
        db.prepare('DELETE FROM memberships WHERE organization_id = ?1').bind(current.organizationId),
        db.prepare('DELETE FROM organizations WHERE id = ?1').bind(current.organizationId),
        db.prepare('DELETE FROM client_provisionings WHERE provisioning_id = ?1')
          .bind(input.provisioningId),
        db.prepare('DELETE FROM identity_audit WHERE merchant_id = ?1').bind(input.merchantId),
        db.prepare(`UPDATE e2e_run_claims SET status = 'disposed', disposed_at = ?1
          WHERE run_id = ?2 AND merchant_id = ?3 AND proof_hash = ?4 AND status = 'disposing'`)
          .bind(now, input.runId, input.merchantId, input.proofHash),
        db.prepare(`INSERT OR IGNORE INTO e2e_run_disposal_audit
          (run_id, merchant_id, actor_id, correlation_id, disposed_at)
          VALUES (?1, ?2, ?3, ?4, ?5)`)
          .bind(input.runId, input.merchantId, actorId, correlationId, now),
      ]);
      const after = await this.preview(input);
      if (Object.values(after.auth).some(value => value !== 0)) {
        throw new Error('Auth E2E disposal left tenant data behind');
      }
      return after;
    },
  };
}
