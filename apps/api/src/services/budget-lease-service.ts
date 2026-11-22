import {
  BudgetLeaseReserveRequestSchema,
  BudgetLeaseReserveResponseSchema,
  type BudgetLeaseReserveResponse,
} from '@incentives/contracts';

import type { Env } from '../env.js';

const DEFAULT_TTL_SECONDS = 900;
const DEFAULT_TOLERANCE_BPS = 300;

interface ProgramBudget {
  budget_remaining: number | null;
  committed_spend: number;
}

function leaseId(): string {
  return `lease_${crypto.randomUUID()}`;
}

async function activeLeaseTotal(
  env: Env,
  merchantId: string,
  programRef: string,
  now: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total
     FROM budget_leases
     WHERE merchant_id = ? AND program_ref = ? AND expires_at > ?`,
  )
    .bind(merchantId, programRef, now)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

async function programBudget(
  env: Env,
  merchantId: string,
  programRef: string,
): Promise<ProgramBudget | null> {
  return env.DB.prepare(
    `SELECT counter.budget_remaining, counter.committed_spend
     FROM programs AS program
     INNER JOIN program_counters AS counter
       ON counter.merchant_id = program.merchant_id
       AND counter.program_id = program.id
     WHERE program.merchant_id = ? AND program.external_ref = ?
     LIMIT 1`,
  )
    .bind(merchantId, programRef)
    .first<ProgramBudget>();
}

export async function reserveBudgetLeases(
  env: Env,
  merchantId: string,
  input: unknown,
): Promise<BudgetLeaseReserveResponse> {
  const request = BudgetLeaseReserveRequestSchema.parse(input);
  const ttlSeconds = request.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const toleranceBps = request.toleranceBps ?? DEFAULT_TOLERANCE_BPS;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + ttlSeconds * 1000).toISOString();

  await releaseExpiredLeases(env, merchantId, now);

  const leases: BudgetLeaseReserveResponse['leases'] = [];
  for (const decision of request.decisions) {
    if (decision.amountMinor <= 0) continue;

    const existing = await env.DB.prepare(
      `SELECT lease_id, program_ref, amount_minor, expires_at
       FROM budget_leases
       WHERE merchant_id = ? AND evaluation_id = ? AND program_ref = ?
       LIMIT 1`,
    )
      .bind(merchantId, request.evaluationId, decision.programRef)
      .first<{
        lease_id: string;
        program_ref: string;
        amount_minor: number;
        expires_at: string;
      }>();

    if (existing) {
      if (existing.expires_at > now) {
        leases.push({
          leaseId: existing.lease_id,
          programRef: existing.program_ref,
          amountMinor: existing.amount_minor,
          expiresAt: existing.expires_at,
        });
        continue;
      }
      await env.DB.prepare(
        `DELETE FROM budget_leases WHERE merchant_id = ? AND lease_id = ?`,
      )
        .bind(merchantId, existing.lease_id)
        .run();
    }

    const budget = await programBudget(env, merchantId, decision.programRef);
    if (budget === null || budget.budget_remaining === null) {
      // No monetary budget on this program; no lease is required.
      continue;
    }

    const totalBudget = budget.budget_remaining + budget.committed_spend;
    const tolerance = Math.max(
      decision.amountMinor,
      Math.floor((totalBudget * toleranceBps) / 10_000),
    );
    const active = await activeLeaseTotal(env, merchantId, decision.programRef, now);
    if (decision.amountMinor > budget.budget_remaining + tolerance - active) {
      await releaseBudgetLeases(env, merchantId, request.evaluationId);
      return {
        accepted: false,
        leases: [],
        reason: `budget_exhausted:${decision.programRef}`,
      };
    }

    const id = leaseId();
    const inserted = await env.DB.prepare(
      `INSERT INTO budget_leases (
         lease_id, merchant_id, program_ref, amount_minor,
         evaluation_id, expires_at, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ? <= (
         ? + ? - COALESCE((
           SELECT SUM(amount_minor) FROM budget_leases
           WHERE merchant_id = ? AND program_ref = ? AND expires_at > ?
         ), 0)
       )`,
    )
      .bind(
        id,
        merchantId,
        decision.programRef,
        decision.amountMinor,
        request.evaluationId,
        expiresAt,
        now,
        decision.amountMinor,
        budget.budget_remaining,
        tolerance,
        merchantId,
        decision.programRef,
        now,
      )
      .run();

    if ((inserted.meta?.changes ?? 0) === 0) {
      await releaseBudgetLeases(env, merchantId, request.evaluationId);
      return {
        accepted: false,
        leases: [],
        reason: `budget_exhausted:${decision.programRef}`,
      };
    }

    leases.push({
      leaseId: id,
      programRef: decision.programRef,
      amountMinor: decision.amountMinor,
      expiresAt,
    });
  }

  return BudgetLeaseReserveResponseSchema.parse({
    accepted: true,
    leases,
  });
}

export async function releaseBudgetLeases(
  env: Env,
  merchantId: string,
  evaluationId: string,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM budget_leases WHERE merchant_id = ? AND evaluation_id = ?`,
  )
    .bind(merchantId, evaluationId)
    .run();
}

export async function releaseExpiredLeases(
  env: Env,
  merchantId: string,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM budget_leases WHERE merchant_id = ? AND expires_at <= ?`,
  )
    .bind(merchantId, now)
    .run();
}
