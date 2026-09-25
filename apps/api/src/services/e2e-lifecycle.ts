import { E2eRunClaimSchema } from '@incentives/contracts';
import { z } from 'zod';

import type { Env } from '../env.js';

const IdentitySchema = E2eRunClaimSchema.extend({
  merchantId: z.string().min(1),
  provisioningId: z.string().min(1),
}).strict();
export type ProductE2eIdentity = z.infer<typeof IdentitySchema>;

const merchantTables = [
  'redemption_entries', 'redemption_operations', 'redemptions',
  'evaluation_decisions', 'promo_code_claims', 'program_counters',
  'program_revisions', 'programs', 'api_credentials', 'customers',
  'variable_definitions', 'schema_versions', 'product_audit',
] as const;

interface Claim {
  runId: string;
  merchantId: string;
  provisioningId: string;
  proofHash: string;
  status: 'active' | 'disposed';
}

function assertStaging(env: Env): void {
  if (env.APP_ENV !== 'staging'
    && !(env.APP_ENV === 'local' && env.E2E_LOCAL_TEST_MODE === '1')) {
    throw new Error('E2E lifecycle is staging-only outside explicit local test mode');
  }
}

async function exactClaim(env: Env, input: ProductE2eIdentity): Promise<Claim> {
  const result = await env.DB.prepare(`
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
  ) throw new Error('E2E tenant provenance mismatch');
  const merchant = await env.DB.prepare(`
    SELECT name, provisioning_id AS provisioningId
    FROM merchants WHERE id = ?1
  `).bind(input.merchantId).first<{ name: string; provisioningId: string | null }>();
  if (claim.status === 'active') {
    if (
      !merchant || merchant.provisioningId !== input.provisioningId
      || !merchant.name.startsWith(`${input.runId}_merchant`)
    ) throw new Error('E2E merchant provenance mismatch');
  } else if (merchant) {
    throw new Error('Disposed E2E merchant unexpectedly exists');
  }
  return claim;
}

async function count(env: Env, sql: string, merchantId: string): Promise<number> {
  const value = await env.DB.prepare(sql).bind(merchantId).first<{ total: number }>();
  return value?.total ?? 0;
}

async function inventory(env: Env, merchantId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of merchantTables) {
    counts[table] = await count(env, `SELECT COUNT(*) AS total FROM ${table} WHERE merchant_id = ?1`, merchantId);
  }
  counts.redemption_commit_guards = await count(env, `
    SELECT COUNT(*) AS total FROM redemption_commit_guards
    WHERE redemption_id IN (SELECT id FROM redemptions WHERE merchant_id = ?1)
  `, merchantId);
  counts.credential_rate_limit_windows = await count(env, `
    SELECT COUNT(*) AS total FROM credential_rate_limit_windows
    WHERE credential_id IN (SELECT id FROM api_credentials WHERE merchant_id = ?1)
  `, merchantId);
  counts.merchants = await count(env, 'SELECT COUNT(*) AS total FROM merchants WHERE id = ?1', merchantId);
  return counts;
}

export function createProductE2eLifecycle(env: Env) {
  return {
    async preview(raw: ProductE2eIdentity) {
      assertStaging(env);
      const input = IdentitySchema.parse(raw);
      const claim = await exactClaim(env, input);
      return { runId: claim.runId, merchantId: claim.merchantId,
        status: claim.status, counts: await inventory(env, input.merchantId) };
    },

    async dispose(raw: ProductE2eIdentity, actorId = 'system', correlationId = 'e2e-dispose') {
      assertStaging(env);
      const input = IdentitySchema.parse(raw);
      const current = await this.preview(input);
      if (current.status === 'disposed') return current;
      const deleteStatements = [
        env.DB.prepare(`DELETE FROM redemption_commit_guards WHERE redemption_id IN
          (SELECT id FROM redemptions WHERE merchant_id = ?1)`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM redemption_entries WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM redemption_operations WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM redemptions WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM evaluation_decisions WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM promo_code_claims WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM program_counters WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM program_revisions WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM programs WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM credential_rate_limit_windows WHERE credential_id IN
          (SELECT id FROM api_credentials WHERE merchant_id = ?1)`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM api_credentials WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM customers WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM variable_definitions WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM schema_versions WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM product_audit WHERE merchant_id = ?1`).bind(input.merchantId),
        env.DB.prepare(`DELETE FROM merchants WHERE id = ?1`).bind(input.merchantId),
        env.DB.prepare(`UPDATE e2e_run_claims SET status = 'disposed', disposed_at = ?1
          WHERE run_id = ?2 AND merchant_id = ?3 AND proof_hash = ?4 AND status = 'active'`)
          .bind(new Date().toISOString(), input.runId, input.merchantId, input.proofHash),
        env.DB.prepare(`INSERT OR IGNORE INTO e2e_run_disposal_audit
          (run_id, merchant_id, actor_id, correlation_id, disposed_at)
          VALUES (?1, ?2, ?3, ?4, ?5)`)
          .bind(input.runId, input.merchantId, actorId, correlationId, new Date().toISOString()),
      ];
      await env.DB.batch(deleteStatements);
      const after = await this.preview(input);
      if (Object.values(after.counts).some(value => value !== 0)) {
        throw new Error('Product E2E disposal left merchant data behind');
      }
      return after;
    },
  };
}
