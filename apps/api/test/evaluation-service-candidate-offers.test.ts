import {
  EvaluationResponseSchema,
  normalizePromoCode,
  type CommerceReward,
  type EvaluationRequest,
  type PromoProgram,
  type VariableDefinition,
} from '@incentives/contracts';
import { SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createRepositories } from '../src/repositories/d1-repositories.js';
import { PUBLISHABLE_TEST_TOKEN, SEEDED_MERCHANT_ID } from './test-credentials.js';

const publishedAt = '2026-07-18T12:00:00.000Z';

const definitions = [
  {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'enum',
    required: false,
    enumValues: ['gold', 'silver'],
  },
] as const satisfies readonly VariableDefinition[];

function conditionalRule(reward: CommerceReward, id = 'default-reward') {
  return {
    id,
    name: id === 'default-reward' ? 'Default reward' : id,
    conditions: {
      match: 'ALL' as const,
      conditions: [{
        id: `${id}-positive-cart`,
        variable: 'cart.subtotal',
        operator: 'gte' as const,
        value: 0,
      }],
    },
    reward,
  };
}

async function seedPublishedSchema(): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO schema_versions (
      merchant_id, version, state, published_at, definitions_json
    ) VALUES (?1, 1, 'published', ?2, ?3)
  `).bind(SEEDED_MERCHANT_ID, publishedAt, JSON.stringify(definitions)).run();
}

async function seedProgram(program: PromoProgram): Promise<void> {
  const repositories = createRepositories({ DB: env.DB });
  const stored = await repositories.programs.create({
    merchantId: SEEDED_MERCHANT_ID,
    program,
    schema: await repositories.schemas.getLatestVersion(SEEDED_MERCHANT_ID, 'published'),
    createdAt: publishedAt,
  });
  if (!program.autoApply && program.status !== 'draft' && program.status !== 'ended') {
    const code = normalizePromoCode(program.code);
    await env.DB.prepare(`
      INSERT INTO promo_code_claims (
        id, merchant_id, program_id, program_ref, active_revision,
        display_code, normalized_code, starts_at, ends_at, created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    `).bind(
      crypto.randomUUID(),
      SEEDED_MERCHANT_ID,
      stored.id,
      stored.externalRef,
      stored.revision,
      code.display,
      code.normalized,
      program.startDate ?? null,
      program.endDate ?? null,
      publishedAt,
    ).run();
  }
}

async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemption_operations'),
    env.DB.prepare('DELETE FROM redemption_entries'),
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM promo_code_claims'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM variable_definitions'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare("DELETE FROM merchants WHERE id <> 'phase-0-merchant'"),
  ]);
  await seedPublishedSchema();
}

function evaluateRaw(body: unknown): Promise<Response> {
  return SELF.fetch('https://example.test/v1/evaluate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${PUBLISHABLE_TEST_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function evaluate(body: unknown) {
  const response = await evaluateRaw(body);
  const data = await response.json();
  if (response.status !== 200) {
    throw new Error(`Evaluation failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return EvaluationResponseSchema.parse(data);
}

describe('Evaluation Service - Candidate Offers & Discovery Updates', () => {
  beforeEach(async () => {
    await resetDb();
  });

  test('returns candidate offers with shortfall progress for public auto-apply promos', async () => {
    // Promo 1: Tier 10% - spend $50
    await seedProgram({
      id: 'tier-10',
      type: 'promo',
      name: '10% off carts over 50',
      status: 'active',
      autoApply: true,
      stackable: false,
      priority: 10,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'subtotal-50',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 5000,
        }],
      },
      rewardRules: [conditionalRule({
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 1000,
      }, 'reward-10')],
    });

    // Promo 2: Tier 20% - spend $100
    await seedProgram({
      id: 'tier-20',
      type: 'promo',
      name: '20% off large carts',
      status: 'active',
      autoApply: true,
      stackable: false,
      priority: 20,
      eligibility: {
        match: 'ALL',
        conditions: [{
          id: 'subtotal-100',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 10000,
        }],
      },
      rewardRules: [conditionalRule({
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 2000,
      }, 'reward-20')],
    });

    const res = await evaluate({
      cart: { currency: 'USD', subtotal: 8000, items: [] },
      includeCandidateOffers: true,
    });

    expect(res.candidateOffers).toBeDefined();
    expect(res.candidateOffers).toHaveLength(2);

    const offer1 = res.candidateOffers?.find(o => o.programRef === 'tier-10');
    expect(offer1).toBeDefined();
    expect(offer1?.qualified).toBe(true);
    expect(offer1?.estimatedDiscountMinorUnits).toBe(800); // 10% of 8000
    expect(offer1?.progress).toBeUndefined();

    const offer2 = res.candidateOffers?.find(o => o.programRef === 'tier-20');
    expect(offer2).toBeDefined();
    expect(offer2?.name).toBe('20% off large carts');
    expect(offer2?.qualified).toBe(false);
    expect(offer2?.estimatedDiscountMinorUnits).toBe(2000); // 20% of 10000
    expect(offer2?.progress).toEqual({
      current: 8000,
      target: 10000,
      shortfall: 2000,
    });
  });

  test('anti-leakage: does not enumerate secret, coded, or affiliate promos in candidateOffers', async () => {
    // Public auto-apply promo
    await seedProgram({
      id: 'public-promo',
      type: 'promo',
      name: 'Public Promo',
      status: 'active',
      autoApply: true,
      stackable: false,
      priority: 10,
      eligibility: { match: 'ALL', conditions: [] },
      rewardRules: [conditionalRule({
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'USD', minorUnits: 500 },
      }, 'r1')],
    });

    // Secret coded promo
    await seedProgram({
      id: 'secret-promo',
      type: 'promo',
      name: 'Secret Promo',
      status: 'active',
      autoApply: false,
      code: 'SECRET99',
      stackable: false,
      priority: 50,
      eligibility: { match: 'ALL', conditions: [] },
      rewardRules: [conditionalRule({
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'USD', minorUnits: 5000 },
      }, 'r2')],
    });

    const res = await evaluate({
      cart: { currency: 'USD', subtotal: 8000, items: [] },
      includeCandidateOffers: true,
    });

    expect(res.candidateOffers).toHaveLength(1);
    expect(res.candidateOffers?.[0]?.programRef).toBe('public-promo');
    expect(res.candidateOffers?.some(o => o.programRef === 'secret-promo')).toBe(false);
  });

  test('derives shortfall progress with gt operator', async () => {
    await seedProgram({
      id: 'tier-gt',
      type: 'promo',
      name: 'More than 10000',
      status: 'active',
      autoApply: true,
      stackable: false,
      priority: 10,
      eligibility: { match: 'ALL', conditions: [] },
      rewardRules: [{
        id: 'r-gt',
        name: 'Over 10000',
        conditions: {
          match: 'ALL',
          conditions: [{
            id: 'gt-subtotal',
            variable: 'cart.subtotal',
            operator: 'gt',
            value: 10000,
          }],
        },
        reward: {
          type: 'order_discount',
          calculation: 'fixed',
          amount: { currency: 'USD', minorUnits: 1500 },
        },
      }],
    });

    const res = await evaluate({
      cart: { currency: 'USD', subtotal: 8000, items: [] },
      includeCandidateOffers: true,
    });

    const offer = res.candidateOffers?.find(o => o.programRef === 'tier-gt');
    expect(offer).toBeDefined();
    expect(offer?.qualified).toBe(false);
    expect(offer?.progress).toEqual({
      current: 8000,
      target: 10001,
      shortfall: 2001,
    });
    expect(offer?.estimatedDiscountMinorUnits).toBe(1500);
  });

  test('supports configurable 24h evaluation TTL (86400 seconds)', async () => {
    const before = Date.now();
    const res = await evaluate({
      cart: { currency: 'USD', subtotal: 5000, items: [] },
      ttlSeconds: 86400,
    });
    const after = Date.now();

    const expiresAtMs = new Date(res.expiresAt).getTime();
    const expectedMin = before + 86400 * 1000 - 5000;
    const expectedMax = after + 86400 * 1000 + 5000;

    expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAtMs).toBeLessThanOrEqual(expectedMax);
  });

  test('evaluates un-synced checkout customer gracefully without throwing 404', async () => {
    const res = await evaluate({
      customerRef: 'unsynced-checkout-customer-42',
      cart: { currency: 'USD', subtotal: 5000, items: [] },
      includeCandidateOffers: true,
    });

    expect(res.customerRef).toBe('unsynced-checkout-customer-42');
    expect(res.customerVersion).toBe(1);
    expect(res.evaluationId).toBeDefined();
  });
});
