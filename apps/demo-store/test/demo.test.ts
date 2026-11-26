import { describe, expect, it } from 'vitest';
import {
  EvaluationResponseSchema,
  RedemptionResponseSchema,
  type EvaluationResponse,
} from '@incentives/contracts';
import {
  DEMO_CUSTOMERS,
  InvalidCartError,
  MAX_LINE_QUANTITY,
  cartFromItems,
  deliveryFeeMinor,
  evaluateDemo,
  type CartLineInput,
  type DemoCustomerMode,
} from '../src/shared/demo.js';
import { createDemoApp, type DemoEnv } from '../worker/index.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

function cart(...items: CartLineInput[]) {
  return cartFromItems(items);
}

function single(itemId: string, quantity = 1): CartLineInput {
  return { itemId, quantity };
}

function evaluate(mode: DemoCustomerMode, items: CartLineInput[], codes: string[] = []) {
  return evaluateDemo({
    cart: cart(...items),
    customer: DEMO_CUSTOMERS[mode],
    codes,
  });
}

describe('demo cart validation', () => {
  it('rejects empty carts', () => {
    expect(() => cart()).toThrow(InvalidCartError);
  });

  it('rejects unknown menu items', () => {
    expect(() => cart(single('nope'))).toThrow(/Unknown menu item/u);
  });

  it('rejects duplicate line items', () => {
    expect(() => cart(single('chole-bhature'), single('chole-bhature', 2)))
      .toThrow(/Duplicate menu item/u);
  });

  it('rejects quantities above the server cap', () => {
    expect(() => cart(single('chole-bhature', MAX_LINE_QUANTITY + 1)))
      .toThrow(/Invalid quantity/u);
  });
});

describe('demo evaluator matches Core selection semantics', () => {
  it('applies exactly one auto offer, highest priority first', () => {
    const response = evaluate('new', [
      single('chole-bhature'),
      single('paneer-tikka'),
      single('dal-makhani'),
    ]);
    expect(response.decisions).toHaveLength(1);
    expect(response.decisions[0]?.programRef).toBe('feast-20');
    expect(response.priceBreakdown.totalDiscount).toBe(11_940);
    expect(EvaluationResponseSchema.safeParse(response).success).toBe(true);
  });

  it('prefers the fixed big-basket offer once it beats the percentage cap', () => {
    const response = evaluate('new', [single('paneer-tikka', 5)]);
    expect(response.decisions.map(decision => decision.programRef)).toEqual(['big-basket']);
    expect(response.priceBreakdown.totalDiscount).toBe(20_000);
  });

  it('shows tier progress for a cart below the threshold', () => {
    const response = evaluate('new', [single('chole-bhature'), single('paneer-tikka')]);
    const feast = response.candidateOffers?.find(offer => offer.programRef === 'feast-20');
    expect(feast?.progress).toEqual({ current: 39_800, target: 49_900, shortfall: 10_100 });
  });

  it('only applies the VIP offer to VIP customers', () => {
    const vip = evaluate('vip', [single('chole-bhature')]);
    expect(vip.decisions.map(decision => decision.programRef)).toEqual(['vip-15']);
    expect(vip.priceBreakdown.totalDiscount).toBe(2_235);

    const regular = evaluate('regular', [single('chole-bhature')]);
    expect(regular.decisions).toHaveLength(0);
  });

  it('applies the line-item Paneer offer when it wins', () => {
    const response = evaluate('new', [single('paneer-tikka')]);
    expect(response.decisions[0]?.effects[0]).toMatchObject({
      type: 'line_item_discount',
      productRef: 'paneer-tikka',
    });
    expect(response.priceBreakdown.totalDiscount).toBe(3_735);
  });
});

describe('demo codes', () => {
  it('applies WELCOME50 only for a new customer and pauses auto offers', () => {
    const newCustomer = evaluate('new', [single('chole-bhature')], ['welcome50']);
    expect(newCustomer.codeResults?.[0]?.outcome).toBe('selected');
    expect(newCustomer.decisions.map(decision => decision.programRef)).toEqual(['welcome-50']);
    expect(newCustomer.priceBreakdown.totalDiscount).toBe(5_000);

    const regular = evaluate('regular', [single('chole-bhature')], ['WELCOME50']);
    expect(regular.codeResults?.[0]?.outcome).toBe('not_qualified');
    expect(regular.decisions).toHaveLength(0);
  });

  it('replaces auto offers with the code instead of stacking them', () => {
    const response = evaluate(
      'new',
      [single('chole-bhature'), single('butter-naan'), single('masala-chai')],
      ['FEAST10'],
    );
    expect(response.decisions.map(decision => decision.programRef)).toEqual(['feast-10-code']);
    expect(response.priceBreakdown.totalDiscount).toBe(2_370);
    expect(deliveryFeeMinor(response)).toBe(3_900);
  });

  it('stacks stackable codes', () => {
    const response = evaluate('new', [single('chole-bhature')], ['WELCOME50', 'FEAST10']);
    expect(response.decisions).toHaveLength(2);
    expect(response.codeResults?.every(result => result.outcome === 'selected')).toBe(true);
    expect(response.priceBreakdown.totalDiscount).toBe(6_490);
  });

  it('rejects an unknown code without applying auto offers', () => {
    const response = evaluate('new', [single('chole-bhature')], ['NOPE']);
    expect(response.codeResults?.[0]?.outcome).toBe('invalid_code');
    expect(response.decisions).toHaveLength(0);
  });
});

describe('demo delivery fee', () => {
  it('waives the fee only when a free_shipping decision is applied', () => {
    const free = evaluate('new', [
      single('chole-bhature'),
      single('butter-naan'),
      single('masala-chai'),
    ]);
    expect(free.decisions[0]?.programRef).toBe('free-delivery');
    expect(deliveryFeeMinor(free)).toBe(0);
  });

  it('charges the demo fee when another offer outranks free delivery', () => {
    const paneer = evaluate('new', [single('paneer-tikka')]);
    expect(paneer.decisions[0]?.programRef).toBe('paneer-15');
    expect(deliveryFeeMinor(paneer)).toBe(3_900);
  });
});

function localEvaluation(): EvaluationResponse {
  return evaluateDemo({
    cart: cart(single('chole-bhature')),
    customer: DEMO_CUSTOMERS.new,
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

describe('demo BFF (local evaluator)', () => {
  const app = createDemoApp();
  const env: DemoEnv = { DEMO_MODE: 'local' };

  async function post(path: string, body: unknown, bindings: DemoEnv = env) {
    return app.request(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }, bindings);
  }

  it('evaluates a cart', async () => {
    const response = await post('/api/evaluate', {
      items: [single('chole-bhature')],
      customerMode: 'new',
      codes: [],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { evaluation: unknown; deliveryFeeMinor: number; mode: string };
    expect(body.mode).toBe('local');
    expect(EvaluationResponseSchema.safeParse(body.evaluation).success).toBe(true);
    expect(body.deliveryFeeMinor).toBe(3_900);
  });

  it('places a demo order and returns a valid redemption', async () => {
    const response = await post('/api/checkout', {
      items: [single('chole-bhature', 2)],
      customerMode: 'new',
      codes: [],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { orderId: string; redemption: unknown };
    expect(body.orderId).toMatch(/^demo_order_/u);
    expect(RedemptionResponseSchema.safeParse(body.redemption).success).toBe(true);
  });

  it('rejects unknown menu items before committing anything', async () => {
    const response = await post('/api/checkout', {
      items: [single('nope')],
      customerMode: 'new',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_CART' });
  });

  it('rejects duplicate and oversized lines', async () => {
    for (const items of [
      [single('chole-bhature'), single('chole-bhature', 2)],
      [single('chole-bhature', MAX_LINE_QUANTITY + 1)],
    ]) {
      const response = await post('/api/evaluate', { items, customerMode: 'new' });
      expect(response.status).toBe(400);
    }
  });

  it('rejects empty carts', async () => {
    const response = await post('/api/evaluate', { items: [], customerMode: 'new' });
    expect(response.status).toBe(400);
  });

  it('honours DEMO_CHECKOUT_ENABLED=false', async () => {
    const response = await post('/api/checkout', {
      items: [single('chole-bhature')],
      customerMode: 'new',
    }, { DEMO_MODE: 'local', DEMO_CHECKOUT_ENABLED: 'false' });
    expect(response.status).toBe(403);
  });
});

describe('demo BFF (core mode)', () => {
  interface Call {
    url: string;
    authorization: string | null;
    body: Record<string, unknown>;
  }

  function coreApp(handlers: {
    evaluate?: () => Response;
    redeem?: () => Response;
  } = {}) {
    const calls: Call[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('authorization'),
        body,
      });
      if (url.endsWith('/v1/evaluate')) {
        return handlers.evaluate?.() ?? jsonResponse(localEvaluation());
      }
      if (url.endsWith('/v1/redemptions')) {
        return handlers.redeem?.() ?? jsonResponse({
          redemptionId: 'demo_redemption_core',
          evaluationId: body.evaluationId,
          externalOrderRef: body.externalOrderRef,
          status: 'committed',
          entries: [],
          priceBreakdown: localEvaluation().priceBreakdown,
          idempotencyKey: body.idempotencyKey,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { app: createDemoApp({ fetchImpl }), calls };
  }

  const env: DemoEnv = {
    DEMO_MODE: 'core',
    DEMO_CORE_URL: 'https://core.test',
    CORE_PUBLISHABLE_KEY: 'pk_test',
    CORE_SECRET_KEY: 'sk_test',
  };

  async function evaluateCore(
    app: ReturnType<typeof createDemoApp>,
    bindings: DemoEnv = env,
  ) {
    return app.request('/api/evaluate', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        items: [single('chole-bhature')],
        customerMode: 'new',
        codes: [],
      }),
    }, bindings);
  }

  it('evaluates against Core with the publishable credential', async () => {
    const { app, calls } = coreApp();
    const response = await evaluateCore(app);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'core' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://core.test/v1/evaluate');
    expect(calls[0]?.authorization).toBe('Bearer pk_test');
    expect(calls[0]?.body).toMatchObject({
      customerRef: 'demo_customer_new',
      includeCandidateOffers: true,
    });
  });

  it('commits the redemption with the secret credential', async () => {
    const { app, calls } = coreApp();
    const response = await app.request('/api/checkout', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        items: [single('chole-bhature')],
        customerMode: 'new',
        codes: [],
      }),
    }, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'core' });
    expect(calls.map(call => call.url)).toEqual([
      'https://core.test/v1/evaluate',
      'https://core.test/v1/redemptions',
    ]);
    expect(calls[1]?.authorization).toBe('Bearer sk_test');
  });

  it('fails closed when core configuration is incomplete', async () => {
    const { app, calls } = coreApp();
    const response = await evaluateCore(app, {
      DEMO_MODE: 'core',
      DEMO_CORE_URL: 'https://core.test',
      CORE_PUBLISHABLE_KEY: 'pk_test',
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'CORE_NOT_CONFIGURED' });
    expect(calls).toHaveLength(0);
  });

  it('reports missing core configuration in bootstrap', async () => {
    const { app } = coreApp();
    const response = await app.request('/api/bootstrap', {}, { DEMO_MODE: 'core' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: 'core',
      coreReady: false,
    });
  });

  it('does not fabricate a redemption when Core rejects the commit', async () => {
    const { app } = coreApp({
      redeem: () => new Response(JSON.stringify({ error: { code: 'NOPE' } }), {
        status: 409,
        headers: JSON_HEADERS,
      }),
    });
    const response = await app.request('/api/checkout', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        items: [single('chole-bhature')],
        customerMode: 'new',
        codes: [],
      }),
    }, env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'CORE_REQUEST_FAILED' });
  });

  it('rejects a Core response that does not match the contract', async () => {
    const { app } = coreApp({
      evaluate: () => jsonResponse({ evaluationId: 'not-a-real-response' }),
    });
    const response = await evaluateCore(app);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'CORE_INVALID_RESPONSE' });
  });
});
