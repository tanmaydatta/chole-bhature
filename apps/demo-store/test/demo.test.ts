import { describe, expect, it } from 'vitest';
import { EvaluationResponseSchema, RedemptionResponseSchema } from '@incentives/contracts';
import {
  DEMO_CUSTOMERS,
  cartFromItems,
  deliveryFeeMinor,
  evaluateDemo,
  type DemoCustomerMode,
} from '../src/shared/demo.js';
import { createDemoApp } from '../worker/index.js';
import { formatINR } from '../src/lib/format.js';

function cart(...ids: string[]) {
  return cartFromItems(ids.map(itemId => ({ itemId, quantity: 1 })));
}

function evaluate(mode: DemoCustomerMode, itemIds: string[], codes: string[] = []) {
  return evaluateDemo({ cart: cart(...itemIds), customer: DEMO_CUSTOMERS[mode], codes });
}

describe('demo evaluator', () => {
  it('unlocks the 20% offer at ₹499 with a progress offer below it', () => {
    const small = evaluate('new', ['chole-bhature', 'paneer-tikka']);
    expect(small.candidateOffers?.find(offer => offer.programRef === 'feast-20')?.progress).toMatchObject({
      current: 39_800,
      target: 49_900,
      shortfall: 10_100,
    });

    const large = evaluate('new', ['chole-bhature', 'paneer-tikka', 'dal-makhani']);
    expect(large.decisions.some(decision => decision.programRef === 'feast-20')).toBe(true);
    expect(large.priceBreakdown.totalDiscount).toBeGreaterThan(0);
    expect(EvaluationResponseSchema.safeParse(large).success).toBe(true);
  });

  it('applies WELCOME50 only for a new customer', () => {
    const newCustomer = evaluate('new', ['chole-bhature'], ['welcome50']);
    expect(newCustomer.codeResults?.[0]?.outcome).toBe('selected');
    expect(newCustomer.decisions.some(decision => decision.programRef === 'welcome-50')).toBe(true);

    const regular = evaluate('regular', ['chole-bhature'], ['WELCOME50']);
    expect(regular.codeResults?.[0]?.outcome).toBe('not_qualified');
    expect(regular.decisions.some(decision => decision.programRef === 'welcome-50')).toBe(false);
  });

  it('applies the VIP offer only to VIP customers', () => {
    const vip = evaluate('vip', ['chole-bhature']);
    expect(vip.decisions.some(decision => decision.programRef === 'vip-15')).toBe(true);
    const regular = evaluate('regular', ['chole-bhature']);
    expect(regular.decisions.some(decision => decision.programRef === 'vip-15')).toBe(false);
  });

  it('applies the line-item Paneer offer', () => {
    const paneer = evaluate('new', ['paneer-tikka']);
    const lineDecision = paneer.decisions.find(decision => decision.programRef === 'paneer-15');
    expect(lineDecision?.effects[0]).toMatchObject({
      type: 'line_item_discount',
      productRef: 'paneer-tikka',
    });
    expect(paneer.priceBreakdown.totalDiscount).toBe(3_735);
  });

  it('unlocks free delivery above ₹199 and waives the fee', () => {
    const below = evaluate('new', ['chole-bhature']);
    expect(deliveryFeeMinor(cart('chole-bhature'), below)).toBe(3_900);
    const above = evaluate('new', ['chole-bhature', 'butter-naan', 'masala-chai']);
    expect(deliveryFeeMinor(cart('chole-bhature', 'butter-naan', 'masala-chai'), above)).toBe(0);
  });

  it('rejects an unknown code', () => {
    const response = evaluate('new', ['chole-bhature'], ['NOPE']);
    expect(response.codeResults?.[0]?.outcome).toBe('invalid_code');
  });

  it('formats INR amounts', () => {
    expect(formatINR(14_900)).toContain('149');
  });
});

describe('demo BFF', () => {
  const env = { DEMO_USE_CORE: 'false' };
  const app = createDemoApp();

  async function post(path: string, body: unknown) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, env);
  }

  it('evaluates a cart', async () => {
    const res = await post('/api/evaluate', {
      items: [{ itemId: 'chole-bhature', quantity: 1 }],
      customerMode: 'new',
      codes: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { evaluation: unknown; deliveryFeeMinor: number };
    expect(EvaluationResponseSchema.safeParse(body.evaluation).success).toBe(true);
    expect(body.deliveryFeeMinor).toBe(3_900);
  });

  it('places a demo order and returns a valid redemption', async () => {
    const res = await post('/api/checkout', {
      items: [{ itemId: 'chole-bhature', quantity: 2 }],
      customerMode: 'new',
      codes: [],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { orderId: string; redemption: unknown };
    expect(body.orderId).toMatch(/^demo_order_/u);
    expect(RedemptionResponseSchema.safeParse(body.redemption).success).toBe(true);
  });

  it('rejects an empty cart', async () => {
    const res = await post('/api/evaluate', { items: [], customerMode: 'new' });
    expect(res.status).toBe(400);
  });
});

