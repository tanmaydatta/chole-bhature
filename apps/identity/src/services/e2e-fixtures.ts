import { assertCiStack } from '../ci-stack.js';
import type { IdentityWorkerEnv } from '../staging-secrets.js';

import { E2eTenantIdentitySchema, FixedOperatorRoleSchema } from '@incentives/contracts';
import { z } from 'zod';

const AccountInputSchema = E2eTenantIdentitySchema.extend({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u),
  role: FixedOperatorRoleSchema,
}).strict();

type AccountInput = z.infer<typeof AccountInputSchema>;

interface Options {
  database: D1Database;
  ciEnv?: IdentityWorkerEnv | undefined;
  appEnv: string | undefined;
  localTestMode?: string | undefined;
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

export function createIdentityE2eFixtures(options: Options) {
  const db = options.database;
  return {
    async createAccount(raw: AccountInput, actorId: string, correlationId: string) {
      assertEnvironment(options);
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
