import type { EvaluationDecisionRecord } from '../src/repositories/types.js';
import { canonicalJson } from '../src/json.js';
import {
  decisionSnapshot,
  signDecisionSnapshot,
  verifyDecisionIntegrity,
} from '../src/services/evaluation-service.js';
import { describe, expect, test } from 'vitest';

const signingSecret = 'evaluation-integrity-test-secret';
const encoder = new TextEncoder();

const record: EvaluationDecisionRecord = {
  evaluationId: 'evaluation-v2',
  merchantId: 'merchant-a',
  mode: 'coded',
  submittedCodes: ['vip20', 'missing'],
  codeResults: [{
    code: 'vip20',
    normalizedCode: 'VIP20',
    outcome: 'selected',
    programRef: 'welcome-10',
    reasonCodes: [],
  }, {
    code: 'missing',
    normalizedCode: 'MISSING',
    outcome: 'invalid_code',
    reasonCodes: ['INVALID_PROMO_CODE'],
  }],
  requestDigest: 'a'.repeat(64),
  correlationId: 'correlation-v2',
  customerRef: 'customer-a',
  customerVersion: 1,
  schemaVersion: 1,
  request: {
    customerRef: 'customer-a',
    codes: ['vip20', 'missing'],
    cart: { currency: 'GBP', subtotal: 5_000, items: [] },
  },
  facts: {
    scalar: { 'cart.subtotal': 5_000 },
    lineItems: [],
    programs: [],
  },
  decisions: [{
    programRef: 'welcome-10',
    programRevision: 1,
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef: 'default-reward',
    effects: [{
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    }],
    reasonCodes: ['QUALIFIED'],
    commitRequired: true,
  }],
  integrityHash: '',
  expiresAt: '2026-07-18T12:05:00.000Z',
  createdAt: '2026-07-18T12:00:00.000Z',
};

async function hmac(payload: unknown): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return [...new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(canonicalJson(payload)),
  ))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('evaluation decision integrity', () => {
  test('v2 signatures bind mode, ordered code diagnostics, digest, and correlation', async () => {
    const signed = structuredClone(record);
    signed.integrityHash = await signDecisionSnapshot(signed, signingSecret);

    await expect(verifyDecisionIntegrity(signed, signingSecret)).resolves.toBe(true);

    const tampered = [
      { ...structuredClone(signed), mode: 'automatic' as const },
      { ...structuredClone(signed), submittedCodes: [...signed.submittedCodes].reverse() },
      { ...structuredClone(signed), codeResults: [...signed.codeResults].reverse() },
      { ...structuredClone(signed), requestDigest: 'b'.repeat(64) },
      { ...structuredClone(signed), correlationId: 'different-correlation' },
    ];
    for (const candidate of tampered) {
      await expect(verifyDecisionIntegrity(candidate, signingSecret)).resolves.toBe(false);
    }
    expect(decisionSnapshot(signed)).toMatchObject({
      mode: 'coded',
      submittedCodes: ['vip20', 'missing'],
      codeResults: signed.codeResults,
      requestDigest: 'a'.repeat(64),
      correlationId: 'correlation-v2',
    });
  });

  test('v1 verification is restricted to exact migration markers and automatic diagnostics', async () => {
    const legacy: EvaluationDecisionRecord = {
      ...structuredClone(record),
      evaluationId: 'legacy-evaluation',
      mode: 'automatic',
      submittedCodes: [],
      codeResults: [],
      requestDigest: 'legacy:legacy-evaluation',
      correlationId: 'migration:legacy-evaluation',
      request: {
        customerRef: 'customer-a',
        cart: { currency: 'GBP', subtotal: 5_000, items: [] },
      },
    };
    legacy.integrityHash = await hmac({
      merchantId: legacy.merchantId,
      evaluationId: legacy.evaluationId,
      snapshot: {
        customerRef: legacy.customerRef,
        customerVersion: legacy.customerVersion,
        schemaVersion: legacy.schemaVersion,
        request: legacy.request,
        facts: legacy.facts,
        decisions: legacy.decisions,
      },
      expiresAt: legacy.expiresAt,
    });

    await expect(verifyDecisionIntegrity(legacy, signingSecret)).resolves.toBe(true);
    await expect(verifyDecisionIntegrity({
      ...legacy,
      correlationId: 'runtime-correlation',
    }, signingSecret)).resolves.toBe(false);
    await expect(verifyDecisionIntegrity({
      ...legacy,
      mode: 'coded',
    }, signingSecret)).resolves.toBe(false);
  });
});
