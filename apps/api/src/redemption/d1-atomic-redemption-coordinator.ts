import {
  RedemptionResponseSchema,
  type CommerceReward,
  type IncentiveDecision,
  type PromoProgram,
} from '@incentives/contracts';
import { z } from 'zod';

import type { Env } from '../env.js';
import { canonicalJson } from '../json.js';
import {
  createRepositories,
  redemptionEnvelope,
  redemptionTotals,
} from '../repositories/d1-repositories.js';
import type {
  ProgramCounterRecord,
  ProgramRecord,
  RedemptionBundleCreate,
} from '../repositories/types.js';
import {
  projectedDiscountMinorUnits,
  verifyDecisionIntegrity,
} from '../services/evaluation-service.js';
import {
  signRedemptionReceipt,
  verifyRedemptionReceipt,
} from '../services/redemption-receipt.js';
import { effectiveProgramStatus, programCurrency } from '../services/program-runtime.js';
import type {
  AtomicRedemptionCoordinator,
  CommitRedemptionBundleInput,
  CommitRedemptionBundleResult,
  TerminalRedemptionErrorCode,
} from './atomic-redemption-coordinator.js';

const SigningSecretSchema = z.string().min(16).max(4_096);
const DateTimeSchema = z.iso.datetime({ offset: true });
const RequestDigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const TerminalRedemptionErrorCodeSchema = z.enum([
  'NOTHING_TO_COMMIT',
  'DECISION_EXPIRED',
  'INVALID_DECISION',
  'PROGRAM_UNAVAILABLE',
  'USAGE_CAP_EXHAUSTED',
  'PER_CUSTOMER_CAP_EXHAUSTED',
  'BUDGET_EXHAUSTED',
]);

const ExhaustionReasonCodeSchema = z.enum([
  'USAGE_CAP_EXHAUSTED',
  'PER_CUSTOMER_CAP_EXHAUSTED',
  'BUDGET_EXHAUSTED',
]);

interface RedemptionOperationRow {
  merchantId: string;
  idempotencyKey: string;
  externalOrderRef: string;
  evaluationId: string;
  requestDigest: string;
  state: 'pending' | 'committed' | 'rejected';
  terminalErrorCode: string | null;
  retryable: number | null;
  redemptionId: string | null;
}

interface PreparedChild {
  position: number;
  decision: IncentiveDecision & { rewardRuleRef: string };
  program: ProgramRecord;
  counters: ProgramCounterRecord;
  discountMinorUnits: number;
  customerRef?: string;
  perCustomerCap?: number;
}

type PreparedChildrenResult =
  | { kind: 'ready'; children: PreparedChild[] }
  | { kind: 'terminal'; code: TerminalRedemptionErrorCode }
  | { kind: 'unavailable' };

function operationFromRow(row: Record<string, unknown>): RedemptionOperationRow {
  return {
    merchantId: z.string().min(1).parse(row.merchantId),
    idempotencyKey: z.string().min(1).parse(row.idempotencyKey),
    externalOrderRef: z.string().min(1).parse(row.externalOrderRef),
    evaluationId: z.string().min(1).parse(row.evaluationId),
    requestDigest: RequestDigestSchema.parse(row.requestDigest),
    state: z.enum(['pending', 'committed', 'rejected']).parse(row.state),
    terminalErrorCode: row.terminalErrorCode === null
      ? null
      : z.string().min(1).parse(row.terminalErrorCode),
    retryable: row.retryable === null
      ? null
      : z.number().int().min(0).max(1).parse(row.retryable),
    redemptionId: row.redemptionId === null
      ? null
      : z.string().min(1).parse(row.redemptionId),
  };
}

function rewardByRef(program: PromoProgram, rewardRuleRef: string): CommerceReward | null {
  const matches = [
    ...program.rewardRules
      .filter(rule => rule.id === rewardRuleRef)
      .map(rule => rule.reward),
    ...(program.fallbackReward?.id === rewardRuleRef
      ? [program.fallbackReward.reward]
      : []),
  ];
  return matches.length === 1 ? matches[0]! : null;
}

function selectedDecisions(input: CommitRedemptionBundleInput):
Array<IncentiveDecision & { rewardRuleRef: string }> | null {
  const selected = input.evaluation.decisions.filter(decision => (
    decision.outcome === 'qualified'
    && decision.commitRequired
    && decision.rewardRuleRef !== undefined
  ));
  if (
    selected.length !== input.evaluation.decisions.length
    || new Set(selected.map(decision => decision.programRef)).size !== selected.length
  ) return null;
  return selected.map(decision => ({ ...decision, rewardRuleRef: decision.rewardRuleRef! }));
}

function programIsEffective(
  program: ProgramRecord,
  committedAt: string,
): boolean {
  return effectiveProgramStatus(program.program, new Date(committedAt)) === 'active';
}

function countersMatchConfiguration(
  counters: ProgramCounterRecord,
  program: PromoProgram,
): boolean {
  if (
    counters.maxUses !== program.usageCap
    || counters.usageCount < 0
    || counters.committedSpend < 0
  ) return false;
  if (program.budget === undefined) {
    return counters.budgetRemaining === undefined;
  }
  return (
    counters.budgetRemaining !== undefined
    && counters.budgetRemaining >= 0
    && counters.budgetRemaining + counters.committedSpend === program.budget.minorUnits
  );
}

export function createD1AtomicRedemptionCoordinator(
  env: Env,
): AtomicRedemptionCoordinator {
  const repositories = createRepositories(env);

  async function loadOperationByKey(
    merchantId: string,
    idempotencyKey: string,
  ): Promise<RedemptionOperationRow | null> {
    const row = await env.DB.prepare(`
      SELECT merchant_id AS merchantId, idempotency_key AS idempotencyKey,
        external_order_ref AS externalOrderRef, evaluation_id AS evaluationId,
        request_digest AS requestDigest, state,
        terminal_error_code AS terminalErrorCode, retryable,
        redemption_id AS redemptionId
      FROM redemption_operations
      WHERE merchant_id = ?1 AND idempotency_key = ?2
    `).bind(merchantId, idempotencyKey).first<Record<string, unknown>>();
    return row === null ? null : operationFromRow(row);
  }

  async function loadOperationByOrder(
    merchantId: string,
    externalOrderRef: string,
  ): Promise<RedemptionOperationRow | null> {
    const row = await env.DB.prepare(`
      SELECT merchant_id AS merchantId, idempotency_key AS idempotencyKey,
        external_order_ref AS externalOrderRef, evaluation_id AS evaluationId,
        request_digest AS requestDigest, state,
        terminal_error_code AS terminalErrorCode, retryable,
        redemption_id AS redemptionId
      FROM redemption_operations
      WHERE merchant_id = ?1 AND external_order_ref = ?2
    `).bind(merchantId, externalOrderRef).first<Record<string, unknown>>();
    return row === null ? null : operationFromRow(row);
  }

  async function verifiedBundle(
    merchantId: string,
    idempotencyKey: string,
    signingSecret: string,
  ): Promise<RedemptionBundleCreate | null> {
    return repositories.redemptions.getByIdempotencyKey(
      merchantId,
      idempotencyKey,
      receipt => verifyRedemptionReceipt(receipt, signingSecret),
    );
  }

  async function hasOneSidedLegacyIdentifierCollision(
    input: CommitRedemptionBundleInput,
  ): Promise<boolean> {
    const row = await env.DB.prepare(`
      SELECT id
      FROM redemptions
      WHERE merchant_id = ?1
        AND (
          (external_order_ref = ?2 AND idempotency_key IS NULL)
          OR (idempotency_key = ?3 AND external_order_ref IS NULL)
        )
      LIMIT 1
    `).bind(
      input.merchantId,
      input.externalOrderRef,
      input.idempotencyKey,
    ).first<{ id: string }>();
    return row !== null;
  }

  function matchesOperation(
    operation: RedemptionOperationRow,
    input: CommitRedemptionBundleInput,
  ): boolean {
    return (
      operation.merchantId === input.merchantId
      && operation.idempotencyKey === input.idempotencyKey
      && operation.externalOrderRef === input.externalOrderRef
      && operation.evaluationId === input.evaluation.evaluationId
      && operation.requestDigest === input.requestDigest
    );
  }

  async function existingOperationResult(
    operation: RedemptionOperationRow,
    input: CommitRedemptionBundleInput,
    signingSecret: string,
  ): Promise<CommitRedemptionBundleResult | null> {
    if (!matchesOperation(operation, input)) return { kind: 'conflict' };
    if (operation.state === 'rejected') {
      return {
        kind: 'terminal_retry',
        code: TerminalRedemptionErrorCodeSchema.parse(operation.terminalErrorCode),
        retryable: false,
      };
    }
    const bundle = await verifiedBundle(input.merchantId, input.idempotencyKey, signingSecret);
    if (bundle !== null) {
      if (
        bundle.requestDigest !== input.requestDigest
        || bundle.externalOrderRef !== input.externalOrderRef
        || bundle.evaluationId !== input.evaluation.evaluationId
      ) return { kind: 'conflict' };
      if (operation.state === 'pending') {
        await env.DB.prepare(`
          UPDATE redemption_operations
          SET state = 'committed', redemption_id = ?1, updated_at = ?2
          WHERE merchant_id = ?3 AND idempotency_key = ?4
            AND state = 'pending' AND request_digest = ?5
        `).bind(
          bundle.redemptionId,
          input.committedAt,
          input.merchantId,
          input.idempotencyKey,
          input.requestDigest,
        ).run();
      }
      return { kind: 'exact_retry', bundle };
    }
    return operation.state === 'committed'
      ? { kind: 'unavailable', retryable: true }
      : null;
  }

  async function acquireOperation(
    input: CommitRedemptionBundleInput,
    signingSecret: string,
  ): Promise<CommitRedemptionBundleResult | null> {
    if (await hasOneSidedLegacyIdentifierCollision(input)) {
      return { kind: 'conflict' };
    }
    await env.DB.prepare(`
      INSERT INTO redemption_operations (
        merchant_id, idempotency_key, external_order_ref, evaluation_id,
        request_digest, state, terminal_error_code, retryable, redemption_id,
        created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', NULL, NULL, NULL, ?6, ?6)
      ON CONFLICT DO NOTHING
    `).bind(
      input.merchantId,
      input.idempotencyKey,
      input.externalOrderRef,
      input.evaluation.evaluationId,
      input.requestDigest,
      input.committedAt,
    ).run();

    const [byKey, byOrder] = await Promise.all([
      loadOperationByKey(input.merchantId, input.idempotencyKey),
      loadOperationByOrder(input.merchantId, input.externalOrderRef),
    ]);
    if (byKey !== null && !matchesOperation(byKey, input)) {
      return { kind: 'conflict' };
    }
    if (byOrder !== null && byOrder.idempotencyKey !== input.idempotencyKey) {
      return { kind: 'conflict' };
    }
    if (byKey === null || byOrder === null) {
      return { kind: 'unavailable', retryable: true };
    }
    if (byKey.idempotencyKey !== byOrder.idempotencyKey) return { kind: 'conflict' };
    return existingOperationResult(byKey, input, signingSecret);
  }

  async function persistTerminal(
    input: CommitRedemptionBundleInput,
    code: TerminalRedemptionErrorCode,
    signingSecret: string,
  ): Promise<CommitRedemptionBundleResult> {
    const persisted = await env.DB.prepare(`
      UPDATE redemption_operations
      SET state = 'rejected', terminal_error_code = ?1, retryable = 0,
        updated_at = ?2
      WHERE merchant_id = ?3 AND idempotency_key = ?4
        AND external_order_ref = ?5 AND evaluation_id = ?6
        AND request_digest = ?7 AND state = 'pending'
    `).bind(
      code,
      input.committedAt,
      input.merchantId,
      input.idempotencyKey,
      input.externalOrderRef,
      input.evaluation.evaluationId,
      input.requestDigest,
    ).run();
    const exhaustion = ExhaustionReasonCodeSchema.safeParse(code);
    if (persisted.meta.changes === 1 && exhaustion.success) {
      return { kind: 'exhausted', reasonCode: exhaustion.data };
    }
    const current = await loadOperationByKey(input.merchantId, input.idempotencyKey);
    if (current === null) return { kind: 'unavailable', retryable: true };
    const result = await existingOperationResult(current, input, signingSecret);
    return result ?? { kind: 'unavailable', retryable: true };
  }

  async function committedCount(
    merchantId: string,
    customerRef: string,
    programRef: string,
  ): Promise<number> {
    const row = await env.DB.prepare(`
      SELECT COUNT(DISTINCT entry.redemption_id) AS count
      FROM redemption_entries AS entry
      INNER JOIN redemptions AS redemption
        ON redemption.merchant_id = entry.merchant_id
        AND redemption.id = entry.redemption_id
      INNER JOIN evaluation_decisions AS decision
        ON decision.merchant_id = redemption.merchant_id
        AND decision.id = redemption.evaluation_id
      WHERE entry.merchant_id = ?1
        AND decision.customer_ref = ?2
        AND entry.program_ref = ?3
    `).bind(merchantId, customerRef, programRef).first<{ count: number }>();
    return z.number().int().nonnegative().parse(row?.count ?? 0);
  }

  async function prepareChildren(
    input: CommitRedemptionBundleInput,
    signingSecret: string,
  ): Promise<PreparedChildrenResult> {
    if (
      input.evaluation.merchantId !== input.merchantId
      || !(await verifyDecisionIntegrity(input.evaluation, signingSecret))
    ) return { kind: 'terminal', code: 'INVALID_DECISION' };
    if (Date.parse(input.evaluation.expiresAt) <= Date.now()) {
      return { kind: 'terminal', code: 'DECISION_EXPIRED' };
    }
    if (input.evaluation.decisions.length === 0) {
      return { kind: 'terminal', code: 'NOTHING_TO_COMMIT' };
    }
    const decisions = selectedDecisions(input);
    if (decisions === null) return { kind: 'terminal', code: 'INVALID_DECISION' };

    const children: PreparedChild[] = [];
    for (const [position, decision] of decisions.entries()) {
      const snapshotPrograms = input.evaluation.facts.programs.filter(
        candidate => candidate.programRef === decision.programRef,
      );
      if (snapshotPrograms.length !== 1) {
        return { kind: 'terminal', code: 'INVALID_DECISION' };
      }
      const snapshotReward = rewardByRef(
        snapshotPrograms[0]!.config,
        decision.rewardRuleRef,
      );
      if (
        snapshotReward === null
        || canonicalJson(decision.effects) !== canonicalJson([snapshotReward])
      ) return { kind: 'terminal', code: 'INVALID_DECISION' };

      const [program, revision, counters] = await Promise.all([
        repositories.programs.getActive(input.merchantId, decision.programRef),
        repositories.programs.getRevision(
          input.merchantId,
          decision.programRef,
          decision.programRevision,
        ),
        repositories.programs.getCounters(input.merchantId, decision.programRef),
      ]);
      if (program === null || revision === null || counters === null) {
        return { kind: 'terminal', code: 'PROGRAM_UNAVAILABLE' };
      }
      if (program.activeRevision !== decision.programRevision) {
        return { kind: 'terminal', code: 'INVALID_DECISION' };
      }
      if (!programIsEffective(program, input.committedAt) || revision.publishedAt === undefined) {
        return { kind: 'terminal', code: 'PROGRAM_UNAVAILABLE' };
      }

      const currentReward = rewardByRef(revision.configuration, decision.rewardRuleRef);
      if (
        currentReward === null
        || canonicalJson(decision.effects) !== canonicalJson([currentReward])
      ) return { kind: 'terminal', code: 'INVALID_DECISION' };
      const cartCurrency = input.evaluation.request.cart.currency;
      if (
        ('amount' in currentReward && currentReward.amount.currency !== cartCurrency)
        || (
          programCurrency(program.program) !== undefined
          && programCurrency(program.program) !== cartCurrency
        )
      ) return { kind: 'terminal', code: 'INVALID_DECISION' };
      if (!countersMatchConfiguration(counters, program.program)) {
        return { kind: 'unavailable' };
      }

      const discountMinorUnits = projectedDiscountMinorUnits(
        decision.effects,
        input.evaluation.request.cart,
      );
      if (
        program.program.usageCap !== undefined
        && counters.usageCount >= program.program.usageCap
      ) return { kind: 'terminal', code: 'USAGE_CAP_EXHAUSTED' };
      if (
        counters.budgetRemaining !== undefined
        && counters.budgetRemaining < discountMinorUnits
      ) return { kind: 'terminal', code: 'BUDGET_EXHAUSTED' };
      if (program.program.perCustomerCap !== undefined) {
        if (input.evaluation.customerRef === undefined) {
          return { kind: 'terminal', code: 'INVALID_DECISION' };
        }
        if (
          await committedCount(
            input.merchantId,
            input.evaluation.customerRef,
            decision.programRef,
          ) >= program.program.perCustomerCap
        ) return { kind: 'terminal', code: 'PER_CUSTOMER_CAP_EXHAUSTED' };
      }
      children.push({
        position,
        decision,
        program,
        counters,
        discountMinorUnits,
        ...(input.evaluation.customerRef === undefined
          ? {}
          : { customerRef: input.evaluation.customerRef }),
        ...(program.program.perCustomerCap === undefined
          ? {}
          : { perCustomerCap: program.program.perCustomerCap }),
      });
    }
    return { kind: 'ready', children };
  }

  async function diagnoseDeterministicFailure(
    input: CommitRedemptionBundleInput,
    children: readonly PreparedChild[],
  ): Promise<TerminalRedemptionErrorCode | null> {
    for (const child of children) {
      const [program, counters] = await Promise.all([
        repositories.programs.getActive(input.merchantId, child.decision.programRef),
        repositories.programs.getCounters(input.merchantId, child.decision.programRef),
      ]);
      if (program === null || counters === null) return 'PROGRAM_UNAVAILABLE';
      if (program.activeRevision !== child.decision.programRevision) {
        return 'INVALID_DECISION';
      }
      if (
        !programIsEffective(program, input.committedAt)
      ) return 'PROGRAM_UNAVAILABLE';
      if (
        program.program.usageCap !== undefined
        && counters.usageCount >= program.program.usageCap
      ) return 'USAGE_CAP_EXHAUSTED';
      if (
        child.perCustomerCap !== undefined
        && child.customerRef !== undefined
        && await committedCount(
          input.merchantId,
          child.customerRef,
          child.decision.programRef,
        ) >= child.perCustomerCap
      ) return 'PER_CUSTOMER_CAP_EXHAUSTED';
      if (
        counters.budgetRemaining !== undefined
        && counters.budgetRemaining < child.discountMinorUnits
      ) return 'BUDGET_EXHAUSTED';
    }
    return null;
  }

  async function commitPreparedBundle(
    input: CommitRedemptionBundleInput,
    children: readonly PreparedChild[],
    signingSecret: string,
  ): Promise<CommitRedemptionBundleResult> {
    const redemptionId = crypto.randomUUID();
    const result = RedemptionResponseSchema.parse({
      redemptionId,
      evaluationId: input.evaluation.evaluationId,
      externalOrderRef: input.externalOrderRef,
      idempotencyKey: input.idempotencyKey,
      status: 'committed',
      entries: children.map(child => ({
        programRef: child.decision.programRef,
        programRevision: child.decision.programRevision,
        rewardRuleRef: child.decision.rewardRuleRef,
        effects: child.decision.effects,
      })),
    });
    const unsigned: Omit<RedemptionBundleCreate, 'receiptIntegrityHash'> = {
      redemptionId,
      merchantId: input.merchantId,
      evaluationId: input.evaluation.evaluationId,
      externalOrderRef: input.externalOrderRef,
      idempotencyKey: input.idempotencyKey,
      requestDigest: input.requestDigest,
      result,
      entries: children.map(child => ({
        position: child.position,
        programRef: child.decision.programRef,
        programRevision: child.decision.programRevision,
        rewardRuleRef: child.decision.rewardRuleRef,
        effects: child.decision.effects,
        discountMinorUnits: child.discountMinorUnits,
        currency: input.evaluation.request.cart.currency,
      })),
      createdAt: input.committedAt,
    };
    const bundle: RedemptionBundleCreate = {
      ...unsigned,
      receiptIntegrityHash: await signRedemptionReceipt(unsigned, signingSecret),
    };
    const totals = redemptionTotals(bundle);
    const statements: Array<ReturnType<Env['DB']['prepare']>> = [];

    for (const child of children) {
      statements.push(
        env.DB.prepare(`
          UPDATE program_counters
          SET usage_count = usage_count + 1,
              committed_spend = committed_spend + ?1,
              budget_remaining = CASE
                WHEN budget_remaining IS NULL THEN NULL
                ELSE budget_remaining - ?1
              END
          WHERE merchant_id = ?2 AND program_id = ?3
            AND (
              (?4 IS NULL AND max_uses IS NULL)
              OR (?4 IS NOT NULL AND max_uses = ?4)
            )
            AND usage_count >= 0
            AND (?4 IS NULL OR usage_count < ?4)
            AND (
              (?5 IS NULL AND budget_remaining IS NULL)
              OR (
                ?5 IS NOT NULL AND budget_remaining IS NOT NULL
                AND budget_remaining >= ?1
                AND budget_remaining + committed_spend = ?5
              )
            )
            AND committed_spend >= 0
            AND EXISTS (
              SELECT 1 FROM programs AS logical
              INNER JOIN program_revisions AS active
                ON active.merchant_id = logical.merchant_id
                AND active.program_id = logical.id
                AND active.revision = logical.active_revision
              WHERE logical.merchant_id = ?2 AND logical.id = ?3
                AND logical.external_ref = ?6
                AND logical.active_revision = ?7
                AND logical.status IN ('active', 'scheduled')
                AND (
                  json_extract(active.config_json, '$.startDate') IS NULL
                  OR json_extract(active.config_json, '$.startDate') <= substr(?8, 1, 10)
                )
                AND (
                  json_extract(active.config_json, '$.endDate') IS NULL
                  OR json_extract(active.config_json, '$.endDate') >= substr(?8, 1, 10)
                )
            )
            AND (
              ?9 IS NULL OR (
                ?10 IS NOT NULL AND (
                  SELECT COUNT(DISTINCT prior_entry.redemption_id)
                  FROM redemption_entries AS prior_entry
                  INNER JOIN redemptions AS prior
                    ON prior.merchant_id = prior_entry.merchant_id
                    AND prior.id = prior_entry.redemption_id
                  INNER JOIN evaluation_decisions AS prior_decision
                    ON prior_decision.merchant_id = prior.merchant_id
                    AND prior_decision.id = prior.evaluation_id
                  WHERE prior_entry.merchant_id = ?2
                    AND prior_decision.customer_ref = ?10
                    AND prior_entry.program_ref = ?6
                ) < ?9
              )
            )
        `).bind(
          child.discountMinorUnits,
          input.merchantId,
          child.program.id,
          child.program.program.usageCap ?? null,
          child.program.program.budget?.minorUnits ?? null,
          child.decision.programRef,
          child.decision.programRevision,
          input.committedAt,
          child.perCustomerCap ?? null,
          child.customerRef ?? null,
        ),
        env.DB.prepare(`
          INSERT INTO redemption_commit_guards (
            redemption_id, position, changed_rows
          ) VALUES (?1, ?2, changes())
        `).bind(redemptionId, child.position * 2),
        env.DB.prepare(`
          UPDATE programs
          SET usage_count = (
                SELECT usage_count FROM program_counters
                WHERE merchant_id = ?1 AND program_id = ?2
              ),
              budget_remaining = (
                SELECT budget_remaining FROM program_counters
                WHERE merchant_id = ?1 AND program_id = ?2
              )
          WHERE merchant_id = ?1 AND id = ?2 AND external_ref = ?3
            AND active_revision = ?4 AND changes() = 1
        `).bind(
          input.merchantId,
          child.program.id,
          child.decision.programRef,
          child.decision.programRevision,
        ),
        env.DB.prepare(`
          INSERT INTO redemption_commit_guards (
            redemption_id, position, changed_rows
          ) VALUES (?1, ?2, changes())
        `).bind(redemptionId, child.position * 2 + 1),
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO redemptions (
          id, merchant_id, external_order_ref, idempotency_key, evaluation_id,
          result_json, discount_minor_units, currency, created_at, request_digest
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
      `).bind(
        bundle.redemptionId,
        bundle.merchantId,
        bundle.externalOrderRef,
        bundle.idempotencyKey,
        bundle.evaluationId,
        redemptionEnvelope(bundle),
        totals.discountMinorUnits,
        totals.currency,
        bundle.createdAt,
        bundle.requestDigest,
      ),
      ...bundle.entries.map(entry => env.DB.prepare(`
        INSERT INTO redemption_entries (
          merchant_id, redemption_id, position, program_ref, program_revision,
          reward_rule_ref, effects_json, discount_minor_units, currency
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      `).bind(
        bundle.merchantId,
        bundle.redemptionId,
        entry.position,
        entry.programRef,
        entry.programRevision,
        entry.rewardRuleRef ?? null,
        canonicalJson(entry.effects),
        entry.discountMinorUnits,
        entry.currency,
      )),
      env.DB.prepare(`
        UPDATE redemption_operations
        SET state = 'committed', redemption_id = ?1, updated_at = ?2
        WHERE merchant_id = ?3 AND idempotency_key = ?4
          AND external_order_ref = ?5 AND evaluation_id = ?6
          AND request_digest = ?7 AND state = 'pending'
      `).bind(
        bundle.redemptionId,
        input.committedAt,
        input.merchantId,
        input.idempotencyKey,
        input.externalOrderRef,
        input.evaluation.evaluationId,
        input.requestDigest,
      ),
      env.DB.prepare(`
        INSERT INTO redemption_commit_guards (
          redemption_id, position, changed_rows
        ) VALUES (?1, ?2, changes())
      `).bind(redemptionId, children.length * 2),
      env.DB.prepare(`
        DELETE FROM redemption_commit_guards WHERE redemption_id = ?1
      `).bind(redemptionId),
    );

    try {
      await env.DB.batch(statements);
    } catch {
      const operation = await loadOperationByKey(input.merchantId, input.idempotencyKey);
      if (operation !== null) {
        const reconciled = await existingOperationResult(operation, input, signingSecret);
        if (reconciled !== null) return reconciled;
      }
      const terminal = await diagnoseDeterministicFailure(input, children);
      if (terminal !== null) {
        return persistTerminal(input, terminal, signingSecret);
      }
      return { kind: 'unavailable', retryable: true };
    }
    const committed = await verifiedBundle(
      input.merchantId,
      input.idempotencyKey,
      signingSecret,
    );
    return committed === null
      ? { kind: 'unavailable', retryable: true }
      : { kind: 'committed', bundle: committed };
  }

  return {
    async commitBundle(rawInput) {
      try {
        const input: CommitRedemptionBundleInput = {
          merchantId: z.string().min(1).parse(rawInput.merchantId),
          evaluation: rawInput.evaluation,
          externalOrderRef: z.string().min(1).parse(rawInput.externalOrderRef),
          idempotencyKey: z.string().min(1).parse(rawInput.idempotencyKey),
          requestDigest: RequestDigestSchema.parse(rawInput.requestDigest),
          correlationId: z.string().min(1).max(200).parse(rawInput.correlationId),
          committedAt: DateTimeSchema.parse(rawInput.committedAt),
        };
        const signingSecret = SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET);
        const acquired = await acquireOperation(input, signingSecret);
        if (acquired !== null) return acquired;
        const prepared = await prepareChildren(input, signingSecret);
        if (prepared.kind === 'terminal') {
          return persistTerminal(input, prepared.code, signingSecret);
        }
        if (prepared.kind === 'unavailable') {
          return { kind: 'unavailable', retryable: true };
        }
        return commitPreparedBundle(input, prepared.children, signingSecret);
      } catch {
        return { kind: 'unavailable', retryable: true };
      }
    },

    async getBundle(input) {
      const signingSecret = SigningSecretSchema.parse(env.DECISION_SIGNING_SECRET);
      return verifiedBundle(
        z.string().min(1).parse(input.merchantId),
        z.string().min(1).parse(input.idempotencyKey),
        signingSecret,
      );
    },
  };
}
