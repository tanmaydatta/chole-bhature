import { assertIdentityServiceEnvironment, type IdentityServiceAssociation } from '../ci-stack.js';

import { E2eTenantIdentitySchema, FixedOperatorRoleSchema, type E2eControlRuntime, type StoredControlLease, type E2eControlAccount } from '@incentives/contracts';
import { withControlWrite } from './e2e-write-fence.js';
import { z } from 'zod';

const AccountInputSchema = E2eTenantIdentitySchema.extend({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u),
  role: FixedOperatorRoleSchema,
}).strict();

type AccountInput = z.infer<typeof AccountInputSchema>;

interface Options extends IdentityServiceAssociation {
  appEnv: string | undefined;
  createSession(userId: string, runId: string, merchantId: string): Promise<{
    sessionId: string; cookieHeader: string;
  }>;
}

interface ExistingUser {
  userId: string;
  membershipId: string | null;
  organizationId: string | null;
  role: string | null;
  status: string | null;
  subjectKind: string | null;
  emailLoginEnabled: number | null;
}

async function assertClaim(database: D1Database, input: AccountInput): Promise<string> {
  const rows = await database.prepare(`
    SELECT e2e_run_claims.run_id AS runId,
      e2e_run_claims.merchant_id AS merchantId,
      e2e_run_claims.provisioning_id AS provisioningId,
      e2e_run_claims.proof_hash AS proofHash,
      e2e_run_claims.status AS claimStatus,
      organizations.id AS organizationId,
      organizations.status AS organizationStatus,
      organizations.name AS organizationName,
      client_provisionings.name AS provisioningName
    FROM e2e_run_claims
    JOIN organizations ON organizations.merchant_id = e2e_run_claims.merchant_id
      AND organizations.provisioning_id = e2e_run_claims.provisioning_id
    JOIN client_provisionings
      ON client_provisionings.provisioning_id = e2e_run_claims.provisioning_id
    WHERE e2e_run_claims.run_id = ?1 OR e2e_run_claims.merchant_id = ?2
  `).bind(input.runId, input.merchantId).all<{
    runId: string; merchantId: string; provisioningId: string; proofHash: string;
    claimStatus: string; organizationId: string; organizationStatus: string;
    organizationName: string; provisioningName: string;
  }>();
  const row = rows.results[0];
  if (rows.results.length !== 1 || !row || row.runId !== input.runId
    || row.merchantId !== input.merchantId || row.provisioningId !== input.provisioningId
    || row.proofHash !== input.proofHash || row.claimStatus !== 'active'
    || row.organizationStatus !== 'active'
    || row.organizationName !== row.provisioningName
    || !row.provisioningName.startsWith(`${input.runId}_merchant`)) {
    throw new Error('E2E fixture provenance mismatch');
  }
  return row.organizationId;
}

export function createIdentityE2eFixtures(options: Options) {
  const db = options.database;
  return {
    async createAccount(raw: AccountInput, actorId: string, correlationId: string) {
      assertIdentityServiceEnvironment(options);
      if (options.appEnv !== 'ci' && options.appEnv !== 'staging') throw new Error('E2E fixtures are staging-only');
      const input = AccountInputSchema.parse(raw);
      const organizationId = await assertClaim(db, input);
      // Synthetic, unverified addresses cannot receive normal sign-in email.
      const email = `e2e+${input.runId}_${input.slug}@e2e.invalid`;
      const existing = await db.prepare(`
        SELECT user.id AS userId, memberships.id AS membershipId,
          memberships.organization_id AS organizationId, memberships.role,
          memberships.status, auth_profile.subject_kind AS subjectKind,
          auth_profile.email_login_enabled AS emailLoginEnabled
        FROM user
        LEFT JOIN auth_profile ON auth_profile.user_id = user.id
        LEFT JOIN memberships ON memberships.user_id = user.id
        WHERE user.email = ?1
      `).bind(email).first<ExistingUser>();
      let userId: string;
      let membershipId: string;
      if (existing) {
        if (!existing.membershipId || existing.organizationId !== organizationId
          || existing.role !== input.role || existing.status !== 'active'
          || existing.subjectKind !== 'employee' || existing.emailLoginEnabled !== 0) {
          throw new Error('Existing identity is not owned by this E2E run');
        }
        userId = existing.userId;
        membershipId = existing.membershipId;
      } else {
        userId = crypto.randomUUID();
        membershipId = crypto.randomUUID();
        const now = Date.now();
        await db.batch([
          db.prepare(`INSERT INTO user
            (id, name, email, emailVerified, createdAt, updatedAt)
            SELECT ?1, ?2, ?3, 0, ?4, ?4
            WHERE EXISTS (SELECT 1 FROM e2e_run_claims
              WHERE run_id = ?5 AND merchant_id = ?6 AND proof_hash = ?7
                AND status = 'active')`)
            .bind(userId, `${input.runId}_${input.slug}`, email, now,
              input.runId, input.merchantId, input.proofHash),
          db.prepare(`INSERT INTO auth_profile
            (user_id, subject_kind, status, email_login_enabled)
            VALUES (?1, 'employee', 'active', 0)`).bind(userId),
          db.prepare(`INSERT INTO memberships
            (id, organization_id, user_id, role, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`)
            .bind(membershipId, organizationId, userId, input.role, now),
          db.prepare(`INSERT INTO identity_audit
            (id, occurred_at, actor_kind, actor_id, merchant_id, action,
             target_type, target_id, outcome, correlation_id, metadata_json)
            VALUES (?1, ?2, 'root', ?3, ?4, 'e2e_fixture.user_created',
              'user', ?5, 'succeeded', ?6, NULL)`)
            .bind(crypto.randomUUID(), now, actorId, input.merchantId,
              userId, correlationId),
        ]);
      }
      const session = await options.createSession(userId, input.runId, input.merchantId);
      return { runId: input.runId, merchantId: input.merchantId, organizationId,
        userId, membershipId, email, role: input.role,
        sessionId: session.sessionId, cookieHeader: session.cookieHeader };
    },
  };
}

/** One durable issuance attempt. No session or cookie is reconstructed on retry. */
export async function issueControlAccount(db: D1Database, runtime: E2eControlRuntime, lease: StoredControlLease,
  slug: string, role: 'admin' | 'operator' | 'viewer', requestId: string, payloadHash: string,
  createSession: (grant: Readonly<{ userId:string; sessionId:string; lease:StoredControlLease }>) => Promise<{
    sessionId:string; cookieHeader:string; cookieAttributes?:E2eControlAccount['cookieAttributes'];
  }>): Promise<E2eControlAccount> {
  const userId = crypto.randomUUID(), membershipId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  const email = `e2e+${lease.runId}_${slug}@e2e.invalid`, now = Date.now();
  await withControlWrite(db,runtime,lease,'provision',[
    db.prepare(`INSERT INTO e2e_control_requests (run_id,request_id,action,payload_hash,status)
      VALUES (?1,?2,?3,?4,'reserved')`).bind(lease.runId,requestId,'account:'+slug,payloadHash),
    db.prepare(`INSERT INTO e2e_control_accounts (run_id,slug,user_id,membership_id,generation,role,state)
      VALUES (?1,?2,?3,?4,?5,?6,'reserved')`).bind(lease.runId,slug,userId,membershipId,lease.generation,role),
    db.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,e2e_control_run_id)
      VALUES (?1,?2,?3,0,?4,?4,?5)`).bind(userId,lease.runId+'_'+slug,email,now,lease.runId),
    db.prepare("INSERT INTO auth_profile (user_id,subject_kind,status,email_login_enabled) VALUES (?1,'employee','active',0)").bind(userId),
    db.prepare(`INSERT INTO memberships (id,organization_id,user_id,role,status,created_at,updated_at)
      VALUES (?1,?2,?3,?4,'active',?5,?5)`).bind(membershipId,lease.organizationId,userId,role,now),
    db.prepare("UPDATE e2e_control_accounts SET state='issuing',session_id=?1 WHERE run_id=?2 AND slug=?3")
      .bind(sessionId,lease.runId,slug),
  ]);
  const session = await createSession(Object.freeze({ userId,sessionId,lease }));
  if (session.sessionId !== sessionId || !session.cookieAttributes) throw new Error('E2E_CONTROL_SESSION');
  await withControlWrite(db,runtime,lease,'provision',[
    db.prepare("UPDATE e2e_control_accounts SET state='issued' WHERE run_id=?1 AND slug=?2 AND state='issuing' AND session_id=?3")
      .bind(lease.runId,slug,sessionId),
    db.prepare("UPDATE e2e_control_requests SET status='completed' WHERE run_id=?1 AND request_id=?2 AND action=?3")
      .bind(lease.runId,requestId,'account:'+slug),
  ]);
  return { runId:lease.runId,merchantId:lease.merchantId,organizationId:lease.organizationId!,
    userId,membershipId,email,role,sessionId,cookieHeader:session.cookieHeader,cookieAttributes:session.cookieAttributes };
}
