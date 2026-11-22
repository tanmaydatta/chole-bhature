import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { sign } from 'hono/jwt';
import { createApp } from '../src/app.js';
import type { Env, CoreServiceBinding } from '../src/env.js';
import {
  EvaluationResponseSchema,
  SignedEvaluationPayloadSchema,
  type EvaluationResponse,
} from '@incentives/contracts';
import { computeCartFingerprint } from '../src/services/cart-fingerprint.js';

class MockD1PreparedStatement {
  constructor(
    private db: MockD1Database,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new MockD1PreparedStatement(this.db, this.sql, params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const res = await this.all<T>();
    return res.results[0] ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.db.executeAll<T>(this.sql, this.params);
  }

  async run(): Promise<{ success: boolean; meta: Record<string, unknown> }> {
    return this.db.executeRun(this.sql, this.params);
  }
}

class MockD1Database {
  public rows: Map<string, Record<string, unknown>> = new Map();

  prepare(sql: string) {
    return new MockD1PreparedStatement(this, sql);
  }

  executeRun(): { success: boolean; meta: Record<string, unknown> } {
    return { success: true, meta: {} };
  }

  executeAll<T>(sql: string, params: unknown[]): { results: T[] } {
    if (sql.includes('shopify_installed_shops') && sql.toUpperCase().includes('SELECT')) {
      const param = params[0] as string | undefined;
      if (param && this.rows.has(param)) {
        return { results: [this.rows.get(param) as T] };
      }
      return { results: [] };
    }
    return { results: [] };
  }
}

describe('Storefront evaluation route', () => {
  const SHOP = 'quickstart-store.myshopify.com';
  const TENANT_ID = 'shop_quickstart_store_myshopify_com';
  const SIGNING_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const CLIENT_ID = 'client-id';
  const CLIENT_SECRET = 'client-secret';

  let mockDb: MockD1Database;
  let mockCore: CoreServiceBinding;
  let testEnv: Env;
  let app: ReturnType<typeof createApp>;

  const evaluationResponse: EvaluationResponse = {
    evaluationId: 'eval-server-e2e-001',
    schemaVersion: 1,
    expiresAt: '2026-11-23T14:30:00.000Z',
    decisions: [
      {
        programRef: 'prog_flash_sale',
        programRevision: 1,
        programType: 'promo',
        outcome: 'qualified',
        commitRequired: false,
        effects: [
          {
            type: 'order_discount',
            calculation: 'fixed',
            amount: { minorUnits: 1500, currency: 'USD' },
          },
        ],
        reasonCodes: ['PROMO_QUALIFIED'],
      },
    ],
    priceBreakdown: {
      currency: 'USD',
      originalMerchandiseSubtotal: 6000,
      discountAllocations: [
        {
          programRef: 'prog_flash_sale',
          programRevision: 1,
          rewardRuleRef: 'rule_1',
          discountMinorUnits: 1500,
        },
      ],
      totalDiscount: 1500,
      discountedMerchandiseSubtotal: 4500,
    },
    candidateOffers: [
      {
        programRef: 'prog_flash_sale',
        name: 'Flash Sale $15 Off',
        qualified: true,
        estimatedDiscountMinorUnits: 1500,
      },
    ],
  };

  const cart = {
    currency: 'USD',
    subtotal: 6000,
    items: [
      {
        lineRef: 'gid://shopify/CartLine/1',
        productRef: 'gid://shopify/Product/1',
        variantRef: 'gid://shopify/ProductVariant/1',
        quantity: 1,
        unitPrice: 6000,
      },
    ],
  };

  async function sessionToken(extra: Record<string, unknown> = {}): Promise<string> {
    return sign(
      {
        dest: `https://${SHOP}`,
        aud: CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300,
        ...extra,
      },
      CLIENT_SECRET,
    );
  }

  function request(body: Record<string, unknown>, token?: string, path = '/v1/evaluate') {
    return new Request(`https://shopify.incentives.dev${path}`, {
      method: 'POST',
      headers: {
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    mockDb = new MockD1Database();
    mockDb.rows.set(SHOP, {
      shop_domain: SHOP,
      access_token: 'shpat_test_access_token_12345',
      tenant_id: TENANT_ID,
      tenant_signing_key: SIGNING_KEY,
      publishable_token: 'pk_live_shopify_storefront_99999',
      secret_token: 'sk_live_shopify_backend_88888',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    mockCore = {
      evaluate: vi.fn().mockResolvedValue(evaluationResponse),
      provisionMerchant: vi.fn(),
      createCredential: vi.fn(),
      listSchemaDefinitions: vi.fn(),
      createSchemaDefinition: vi.fn(),
      publishSchema: vi.fn(),
      commitRedemption: vi.fn(),
    } as unknown as CoreServiceBinding;

    testEnv = {
      CORE: mockCore,
      DB: mockDb as unknown as D1Database,
      SHOPIFY_CLIENT_ID: CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
    };

    app = createApp();
  });

  it('authenticates with a Shopify session token, calls Core RPC, and signs v2 payload', async () => {
    const token = await sessionToken({ sub: 'gid://shopify/Customer/777' });
    const res = await app.fetch(
      request({ cart, codes: ['FLASH15'], includeCandidateOffers: true, checkoutToken: 'chk_123' }, token),
      testEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as EvaluationResponse;
    expect(EvaluationResponseSchema.safeParse(data).success).toBe(true);
    expect(SignedEvaluationPayloadSchema.safeParse(data.signedEvaluation).success).toBe(true);

    expect(mockCore.evaluate).toHaveBeenCalledTimes(1);
    const [, forwarded] = (mockCore.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(forwarded.customerRef).toBe('gid://shopify/Customer/777');
    expect(forwarded.ttlSeconds).toBe(86_400);
    expect(forwarded.includeCandidateOffers).toBe(true);
    expect(forwarded.context.channel).toBe('shopify_checkout');

    const signed = data.signedEvaluation!;
    expect(signed.shopDomain).toBe(SHOP);
    expect(signed.checkoutToken).toBe('chk_123');
    expect(signed.subtotalMinorUnits).toBe(6000);
    expect(signed.currency).toBe('USD');
    expect(signed.discountMinorUnits).toBe(1500);

    const fingerprint = await computeCartFingerprint({
      ...cart,
      items: cart.items.map(item => ({ ...item })),
    } as never);
    expect(signed.cartFingerprint).toBe(fingerprint);

    const expectedMessage = [
      'v2',
      signed.evaluationId,
      SHOP,
      'chk_123',
      fingerprint,
      6000,
      'USD',
      1500,
      '',
      '',
      signed.expiresAt,
    ].join(':');
    const expected = crypto.createHmac('sha256', SIGNING_KEY).update(expectedMessage).digest('hex');
    expect(signed.signature).toBe(expected);
  });

  it('works on the /evaluate alias and defaults checkout token to the evaluation id', async () => {
    const token = await sessionToken();
    const res = await app.fetch(request({ cart }, token, '/evaluate'), testEnv);

    expect(res.status).toBe(200);
    const data = (await res.json()) as EvaluationResponse;
    expect(data.signedEvaluation?.checkoutToken).toBe('checkout:eval-server-e2e-001');
  });

  it('rejects the removed x-shopify-shop-domain authentication path', async () => {
    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'POST',
        headers: {
          'x-shopify-shop-domain': SHOP,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cart }),
      }),
      testEnv,
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 without a session token', async () => {
    const res = await app.fetch(request({ cart }), testEnv);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = await sign(
      { dest: `https://${SHOP}`, aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300 },
      'wrong-secret',
    );
    const res = await app.fetch(request({ cart }, token), testEnv);
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token with the wrong audience', async () => {
    const token = await sessionToken({ aud: 'another-app' });
    const res = await app.fetch(request({ cart }, token), testEnv);
    expect(res.status).toBe(401);
  });

  it('returns 503 when the Core RPC fails', async () => {
    (mockCore.evaluate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Core timeout'));
    const token = await sessionToken();
    const res = await app.fetch(request({ cart }, token), testEnv);

    expect(res.status).toBe(503);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toMatch(/Service Unavailable/i);
  });

  it('answers the CORS preflight without authentication', async () => {
    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://extensions.shopifycdn.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      }),
      testEnv,
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('returns CORS headers on unauthorized responses', async () => {
    const res = await app.fetch(request({ cart }), testEnv);
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
