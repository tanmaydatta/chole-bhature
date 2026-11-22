import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env.js';
import {
  releaseBudgetLeases,
  reserveBudgetLeases,
} from '../src/services/budget-lease-service.js';

class LeaseDb {
  constructor(
    private budgetRemaining: number | null,
    private insertChanges = 1,
    private programMissing = false,
  ) {}

  prepare(sql: string) {
    const statement = {
      bind: (...params: unknown[]) => ({
        first: async <T>() => {
          if (sql.includes('COALESCE(SUM(amount_minor)')) return { total: 0 } as T;
          if (sql.includes('FROM programs')) {
            if (this.programMissing) return null;
            return {
              budget_remaining: this.budgetRemaining,
              committed_spend: 0,
            } as T;
          }
          return null;
        },
        run: async () => ({
          success: true,
          meta: { changes: sql.includes('INSERT INTO budget_leases') ? this.insertChanges : 0 },
        }),
        all: async () => ({ results: [] }),
      }),
      first: async <T>() => null as T,
      run: async () => ({ success: true, meta: { changes: 0 } }),
      all: async () => ({ results: [] }),
    };
    return statement;
  }
}

function envWith(db: LeaseDb): Env {
  return { DB: db, APP_ENV: 'local' } as unknown as Env;
}

describe('budget lease service', () => {
  it('accepts a lease inside the budget plus tolerance', async () => {
    const result = await reserveBudgetLeases(
      envWith(new LeaseDb(1_000)),
      'merchant-1',
      {
        evaluationId: 'eval-1',
        decisions: [{ programRef: 'promo-1', amountMinor: 100 }],
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.leases).toHaveLength(1);
    expect(result.leases[0]).toMatchObject({
      programRef: 'promo-1',
      amountMinor: 100,
    });
  });

  it('rejects when the conditional insert loses the budget race', async () => {
    const result = await reserveBudgetLeases(
      envWith(new LeaseDb(0, 0)),
      'merchant-1',
      {
        evaluationId: 'eval-1',
        decisions: [{ programRef: 'promo-1', amountMinor: 100 }],
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('budget_exhausted');
  });

  it('does not require a lease for a program without a monetary budget', async () => {
    const result = await reserveBudgetLeases(
      envWith(new LeaseDb(null)),
      'merchant-1',
      {
        evaluationId: 'eval-1',
        decisions: [{ programRef: 'promo-1', amountMinor: 100 }],
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.leases).toEqual([]);
  });

  it('fails closed when the program row is missing', async () => {
    const result = await reserveBudgetLeases(
      envWith(new LeaseDb(null, 1, true)),
      'merchant-1',
      {
        evaluationId: 'eval-1',
        decisions: [{ programRef: 'missing-program', amountMinor: 100 }],
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('program_not_found');
  });

  it('releases leases for an evaluation', async () => {
    await expect(
      releaseBudgetLeases(envWith(new LeaseDb(1_000)), 'merchant-1', 'eval-1'),
    ).resolves.toBeUndefined();
  });
});
