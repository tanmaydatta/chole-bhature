import { type OperatorCallContext, type PermissionKey, type PromoProgram } from '@incentives/contracts';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Env } from '../src/env.js';
import { createRepositories } from '../src/repositories/d1-repositories.js';
import { verifyDecisionIntegrity } from '../src/services/evaluation-service.js';
import { CoreOperatorService } from '../src/worker.js';
import { SEEDED_MERCHANT_ID } from './test-credentials.js';

const context = (permission: PermissionKey = 'evaluations:run'): OperatorCallContext => ({
  actorUserId: 'member-evaluator', actorKind: 'member', merchantId: SEEDED_MERCHANT_ID,
  correlationId: 'operator-evaluation-correlation', permission,
});
const request = { cart: { currency: 'GBP', subtotal: 10_000, items: [
  { lineRef: 'line-a', productRef: 'product-a', quantity: 2, unitPrice: 5_000 },
] }, context: { channel: 'web' } };
const promo: PromoProgram = {
  id: 'capped-offer', name: 'Capped offer', type: 'promo', status: 'draft',
  eligibility: { match: 'ALL', conditions: [] },
  rewardRules: [{ id: 'basket-reward', name: 'Basket reward',
    conditions: { match: 'ALL', conditions: [{ id: 'positive-basket', variable: 'cart.subtotal', operator: 'gte', value: 0 }] }, reward: {
      type: 'order_discount', calculation: 'percent', basisPoints: 2_500,
      maximumDiscountAmount: { currency: 'GBP', minorUnits: 1_500 },
    } }], autoApply: true, stackable: false, priority: 1,
  budget: { currency: 'GBP', minorUnits: 50_000 }, usageCap: 20,
};
let service: CoreOperatorService;

beforeEach(async () => {
  service = new CoreOperatorService(createExecutionContext(), env as Env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM redemptions'),
    env.DB.prepare('DELETE FROM evaluation_decisions'),
    env.DB.prepare('DELETE FROM promo_code_claims'),
    env.DB.prepare('DELETE FROM program_counters'),
    env.DB.prepare('DELETE FROM program_revisions'),
    env.DB.prepare('DELETE FROM programs'),
    env.DB.prepare('DELETE FROM customers'),
    env.DB.prepare('DELETE FROM schema_versions'),
    env.DB.prepare('DELETE FROM variable_definitions'),
  ]);
});

async function publish(coded = false) {
  await service.createSchemaDefinition(context('schemas:manage'), {
    key: 'context.channel', label: 'Channel', source: 'context', type: 'enum',
    enumValues: ['web', 'store'], required: true,
  });
  await service.publishSchema(context('schemas:publish'));
  await service.createProgramDraft(context('programs:manage'), {
    ...promo, ...(coded ? { autoApply: false, code: 'CAP25' } : {}),
  });
  await service.publishProgram(context('programs:publish'), promo.id);
}

describe('private operator evaluation RPC', () => {
  // Break caught: bypassing the existing evaluation service loses exact signed pricing or spends counters.
  test('member evaluation returns exact capped pricing and persists a signed snapshot without spending', async () => {
    await publish();
    const repositories = createRepositories(env as Env);
    const before = await repositories.programs.getCounters(SEEDED_MERCHANT_ID, promo.id);
    const result = await service.evaluate(context(), request);
    if ('error' in result) throw new Error('Expected evaluation success');
    expect(result).toMatchObject({ schemaVersion: 1, decisions: [{
      programRef: 'capped-offer', programRevision: 1, outcome: 'qualified',
      rewardRuleRef: 'basket-reward', reasonCodes: [],
    }], priceBreakdown: {
      currency: 'GBP', originalMerchandiseSubtotal: 10_000,
      discountAllocations: [{ programRef: 'capped-offer', programRevision: 1,
        rewardRuleRef: 'basket-reward', discountMinorUnits: 1_500 }],
      totalDiscount: 1_500, discountedMerchandiseSubtotal: 8_500,
    } });
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const saved = await repositories.decisions.get(SEEDED_MERCHANT_ID, result.evaluationId);
    expect(saved).toMatchObject({ mode: 'automatic', correlationId: 'operator-evaluation-correlation',
      priceBreakdown: { totalDiscount: 1_500, discountedMerchandiseSubtotal: 8_500 } });
    expect(await verifyDecisionIntegrity(saved!, 'decision-signing-test-secret')).toBe(true);
    expect(await repositories.decisions.get('foreign-merchant', result.evaluationId)).toBeNull();
    expect(await repositories.programs.getCounters(SEEDED_MERCHANT_ID, promo.id)).toEqual(before);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM redemptions').first('n')).toBe(0);
  });

  test('resolves the stored customer version internally and returns input-aligned code diagnostics', async () => {
    await publish(true);
    await service.upsertCustomer(context('customers:manage'), 'stored-customer', { attributes: {} });
    const result = await service.evaluate(context(), {
      ...request, customerRef: 'stored-customer', codes: [' cap25 ', 'MISSING'],
    });
    if ('error' in result) throw new Error('Expected evaluation success');
    expect(result).toMatchObject({ customerRef: 'stored-customer', customerVersion: 1,
      codeResults: [
        { code: 'cap25', normalizedCode: 'CAP25', outcome: 'selected', programRef: 'capped-offer' },
        { code: 'MISSING', normalizedCode: 'MISSING', outcome: 'invalid_code', reasonCodes: ['INVALID_PROMO_CODE'] },
      ], priceBreakdown: { totalDiscount: 1_500 } });
    expect(result).not.toHaveProperty('attributes');
  });

  test('refuses the wrong permission before persisting a snapshot', async () => {
    await publish();
    await expect(service.evaluate(context('programs:read'), request)).rejects.toMatchObject({ name: 'ForbiddenError' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_decisions').first('n')).toBe(0);
  });

  test('rejects malformed authority and browser-supplied authority or customer attributes', async () => {
    await publish();
    await expect(service.evaluate({ ...context(), actorUserId: '' }, request)).rejects.toMatchObject({ name: 'ZodError' });
    for (const injected of [{ merchantId: 'foreign' }, { actorKind: 'root' }, { customer: { tier: 'gold' } }]) {
      await expect(service.evaluate(context(), { ...request, ...injected })).rejects.toMatchObject({ name: 'ZodError' });
    }
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_decisions').first('n')).toBe(0);
  });

  test('enforces published types and missing schema/customer prerequisites', async () => {
    await expect(service.evaluate(context(), request)).resolves.toEqual({ error: { code: 'NOT_FOUND',
      message: 'The requested resource was not found', correlationId: 'operator-evaluation-correlation', retryable: false } });
    await publish();
    await expect(service.evaluate(context(), { ...request, context: { channel: 'foreign' } })).resolves.toMatchObject({ error: { code: 'INVALID_REQUEST', message: 'Request validation failed' } });
    await expect(service.evaluate(context(), { ...request, customerRef: 'missing-customer' })).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
    await expect(service.evaluate({ ...context(), merchantId: 'foreign-merchant' }, request)).resolves.toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_decisions').first('n')).toBe(0);
  });

  test('returns a canonical missing-schema envelope across the private published-schema boundary', async () => {
    await expect(service.getPublishedSchema(context('schemas:read'))).resolves.toEqual({ error: {
      code: 'NOT_FOUND', message: 'The requested resource was not found',
      correlationId: 'operator-evaluation-correlation', retryable: false,
    } });
    await expect(service.getPublishedSchema(context())).rejects.toMatchObject({ name: 'ForbiddenError' });
  });

  test('returns only a safe retryable envelope when snapshot signing is unavailable', async () => {
    await publish();
    const unavailable = new CoreOperatorService(createExecutionContext(), { ...env, DECISION_SIGNING_SECRET: '' } as Env);
    await expect(unavailable.evaluate(context(), request)).resolves.toEqual({ error: {
      code: 'CORE_UNAVAILABLE', message: 'Core is temporarily unavailable',
      correlationId: 'operator-evaluation-correlation', retryable: true,
    } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM evaluation_decisions').first('n')).toBe(0);
  });
});
