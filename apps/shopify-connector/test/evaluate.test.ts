import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import type { Env, CoreServiceBinding } from '../src/env.js';
import {
  EvaluationResponseSchema,
  SignedEvaluationPayloadSchema,
  type EvaluationResponse,
} from '@incentives/contracts';

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

  executeRun(sql: string, params: unknown[]): { success: boolean; meta: Record<string, unknown> } {
    if (sql.includes('shopify_installed_shops')) {
      if (sql.toUpperCase().includes('INSERT') || sql.toUpperCase().includes('REPLACE')) {
        const [
          shopDomain,
          accessToken,
          tenantId,
          tenantSigningKey,
          publishableToken,
          secretToken,
          createdAt,
          updatedAt,
        ] = params as string[];

        this.rows.set(shopDomain, {
          shop_domain: shopDomain,
          access_token: accessToken,
          tenant_id: tenantId,
          tenant_signing_key: tenantSigningKey,
          publishable_token: publishableToken,
          secret_token: secretToken,
          status: 'active',
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }
    }
    return { success: true, meta: {} };
  }

  executeAll<T>(sql: string, params: unknown[]): { results: T[] } {
    if (sql.includes('shopify_installed_shops') && sql.toUpperCase().includes('SELECT')) {
      const param = params[0] as string | undefined;
      if (param) {
        if (this.rows.has(param)) {
          return { results: [this.rows.get(param) as T] };
        }
        for (const row of this.rows.values()) {
          if (row.publishable_token === param || row.secret_token === param) {
            return { results: [row as T] };
          }
        }
        return { results: [] };
      }
      return { results: Array.from(this.rows.values()) as T[] };
    }
    return { results: [] };
  }
}

describe('Storefront Server-Side Evaluation & Signing Routes (/v1/evaluate & /evaluate)', () => {
  const SHOP = 'quickstart-store.myshopify.com';
  const TENANT_ID = 'shop_quickstart_store_myshopify_com';
  const PUBLISHABLE_TOKEN = 'pk_live_shopify_storefront_99999';
  const SECRET_TOKEN = 'sk_live_shopify_backend_88888';
  const SIGNING_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  let mockDb: MockD1Database;
  let mockCore: CoreServiceBinding;
  let testEnv: Env;
  let app: ReturnType<typeof createApp>;

  const mockCoreEvaluationResponse: EvaluationResponse = {
    evaluationId: 'eval-server-e2e-001',
    schemaVersion: 1,
    expiresAt: '2026-11-19T14:30:00.000Z',
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

  beforeEach(() => {
    mockDb = new MockD1Database();
    mockDb.rows.set(SHOP, {
      shop_domain: SHOP,
      access_token: 'shpat_test_access_token_12345',
      tenant_id: TENANT_ID,
      tenant_signing_key: SIGNING_KEY,
      publishable_token: PUBLISHABLE_TOKEN,
      secret_token: SECRET_TOKEN,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    mockCore = {
      provisionMerchant: vi.fn(),
      createCredential: vi.fn(),
      fetch: vi.fn().mockImplementation(async (req: Request) => {
        return new Response(JSON.stringify(mockCoreEvaluationResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    };

    testEnv = {
      CORE: mockCore,
      DB: mockDb as unknown as D1Database,
      SHOPIFY_CLIENT_ID: 'client-id',
      SHOPIFY_CLIENT_SECRET: 'client-secret',
    };

    app = createApp();
  });

  it('POST /v1/evaluate authenticates via publishable token and signs response with tenant signing key', async () => {
    const cartId = 'gid://shopify/Cart/c1-buyer-test';
    const requestPayload = {
      cart: {
        currency: 'USD',
        subtotal: 6000,
        items: [{ lineRef: 'line-1', productRef: 'p-1', quantity: 1, unitPrice: 6000 }],
      },
      cartId,
      codes: ['FLASH15'],
      includeCandidateOffers: true,
    };

    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PUBLISHABLE_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Correlation-ID': 'test-corr-eval-001',
        },
        body: JSON.stringify(requestPayload),
      }),
      testEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as EvaluationResponse;

    // Conforms to EvaluationResponseSchema
    const parseResult = EvaluationResponseSchema.safeParse(data);
    expect(parseResult.success).toBe(true);

    // Verify Core service binding was invoked with tenant context
    expect(mockCore.fetch).toHaveBeenCalledTimes(1);
    const forwardedReq = (mockCore.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Request;
    expect(forwardedReq.method).toBe('POST');
    const forwardedUrl = new URL(forwardedReq.url);
    expect(forwardedUrl.pathname).toBe('/v1/evaluate');
    expect(forwardedReq.headers.get('x-tenant-id')).toBe(TENANT_ID);
    expect(forwardedReq.headers.get('x-merchant-id')).toBe(TENANT_ID);
    expect(forwardedReq.headers.get('authorization')).toBe(`Bearer ${PUBLISHABLE_TOKEN}`);
    expect(forwardedReq.headers.get('x-correlation-id')).toBe('test-corr-eval-001');

    // Verify signedEvaluation was attached and signed correctly
    expect(data.signedEvaluation).toBeDefined();
    const signed = data.signedEvaluation!;
    expect(SignedEvaluationPayloadSchema.safeParse(signed).success).toBe(true);

    expect(signed.evaluationId).toBe('eval-server-e2e-001');
    expect(signed.shopDomain).toBe(SHOP);
    expect(signed.cartId).toBe(cartId);
    expect(signed.subtotalMinorUnits).toBe(6000);
    expect(signed.currency).toBe('USD');
    expect(signed.discountMinorUnits).toBe(1500);
    expect(signed.target).toBe('order');
    expect(signed.expiresAt).toBe('2026-11-19T14:30:00.000Z');

    // Verify HMAC-SHA256 signature using node:crypto
    const expectedMessage = `${signed.evaluationId}:${signed.cartId}:${signed.subtotalMinorUnits}:${signed.currency}:${signed.discountMinorUnits}:${signed.expiresAt ?? ''}`;
    const expectedSig = crypto.createHmac('sha256', SIGNING_KEY).update(expectedMessage).digest('hex');
    expect(signed.signature).toBe(expectedSig);
  });

  it('POST /evaluate route alias works identically', async () => {
    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/evaluate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PUBLISHABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cart: {
            currency: 'USD',
            subtotal: 6000,
            items: [{ lineRef: 'line-1', productRef: 'p-1', quantity: 1, unitPrice: 6000 }],
          },
        }),
      }),
      testEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as EvaluationResponse;
    expect(data.signedEvaluation).toBeDefined();
    expect(data.signedEvaluation?.shopDomain).toBe(SHOP);
    expect(data.signedEvaluation?.cartId).toBe('gid://shopify/Cart/default');
  });

  it('authenticates via x-shopify-shop-domain header when Authorization is omitted', async () => {
    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'POST',
        headers: {
          'x-shopify-shop-domain': SHOP,
          'x-shopify-cart-id': 'gid://shopify/Cart/c-domain-header',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cart: {
            currency: 'USD',
            subtotal: 6000,
            items: [{ lineRef: 'line-1', productRef: 'p-1', quantity: 1, unitPrice: 6000 }],
          },
        }),
      }),
      testEnv,
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as EvaluationResponse;
    expect(data.signedEvaluation).toBeDefined();
    expect(data.signedEvaluation?.cartId).toBe('gid://shopify/Cart/c-domain-header');
    expect(data.signedEvaluation?.shopDomain).toBe(SHOP);
  });

  it('returns HTTP 401 when both Authorization and shop domain headers are missing', async () => {
    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: { currency: 'USD', subtotal: 1000, items: [] } }),
      }),
      testEnv,
    );

    expect(res.status).toBe(401);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns HTTP 401 when token is not recognized in D1', async () => {
    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer pk_unknown_token_value',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cart: { currency: 'USD', subtotal: 1000, items: [] } }),
      }),
      testEnv,
    );

    expect(res.status).toBe(401);
  });

  it('returns HTTP 503 when CORE service binding is unavailable or throws', async () => {
    const envWithFailingCore = {
      ...testEnv,
      CORE: {
        ...mockCore,
        fetch: vi.fn().mockRejectedValue(new Error('Downstream Core network timeout')),
      },
    };

    const res = await app.fetch(
      new Request('https://shopify.incentives.dev/v1/evaluate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PUBLISHABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cart: { currency: 'USD', subtotal: 1000, items: [] } }),
      }),
      envWithFailingCore,
    );

    expect(res.status).toBe(503);
    const data = await res.json() as Record<string, unknown>;
    expect(data.error).toMatch(/Service Unavailable/i);
  });
});
