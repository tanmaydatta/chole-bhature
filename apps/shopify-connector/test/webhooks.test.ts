import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import type { Env, CoreServiceBinding } from '../src/env.js';

export function computeShopifyWebhookHmac(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

function computeSignedEvaluation(
  payload: Record<string, unknown>,
  secret: string,
): Record<string, unknown> {
  const checkoutToken = String(payload['checkoutToken'] ?? payload['cartId'] ?? '');
  const message = [
    'v2',
    String(payload['evaluationId'] ?? ''),
    String(payload['shopDomain'] ?? ''),
    checkoutToken,
    String(payload['cartFingerprint'] ?? ''),
    String(payload['subtotalMinorUnits'] ?? 0),
    String(payload['currency'] ?? ''),
    String(payload['discountMinorUnits'] ?? 0),
    String(payload['leaseId'] ?? ''),
    String(payload['leaseExpiresAt'] ?? ''),
    String(payload['expiresAt'] ?? ''),
  ].join(':');
  return {
    ...payload,
    signature: crypto.createHmac('sha256', secret).update(message).digest('hex'),
  };
}

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
      const shopDomain = params[0] as string | undefined;
      if (shopDomain) {
        if (this.rows.has(shopDomain)) {
          return { results: [this.rows.get(shopDomain) as T] };
        }
        return { results: [] };
      }
      return { results: Array.from(this.rows.values()) as T[] };
    }
    return { results: [] };
  }
}

describe('Shopify Webhooks Handler & Post-Capture Reconciliation', () => {
  const CLIENT_ID = 'test-client-id';
  const CLIENT_SECRET = 'test-client-secret-super-secure';
  const SHOP = 'quickstart-store.myshopify.com';
  const TENANT_ID = 'shop_quickstart_store_myshopify_com';
  const TENANT_SIGNING_KEY = 'tenantsigningkey1234567890abcdef12345678';

  let mockDb: MockD1Database;
  let mockCore: CoreServiceBinding;
  let testEnv: Env;

  beforeEach(() => {
    mockDb = new MockD1Database();
    // Seed installed store
    mockDb.rows.set(SHOP, {
      shop_domain: SHOP,
      access_token: 'shpat_test_token',
      tenant_id: TENANT_ID,
      tenant_signing_key: TENANT_SIGNING_KEY,
      publishable_token: 'pk_test_123',
      secret_token: 'sk_test_123',
      status: 'active',
      created_at: '2026-11-19T00:00:00Z',
      updated_at: '2026-11-19T00:00:00Z',
    });

    mockCore = {
      provisionMerchant: vi.fn(),
      createCredential: vi.fn(),
      commitRedemption: vi.fn(async (input: any) => ({
        redemptionId: 'redemption-123',
        evaluationId: input.evaluationId,
        externalOrderRef: input.externalOrderRef,
        idempotencyKey: input.idempotencyKey,
        status: 'committed',
        entries: [],
        priceBreakdown: {
          subtotalMinorUnits: 5000,
          totalDiscountMinorUnits: 1000,
          netMinorUnits: 4000,
          lines: [],
        },
      })),
      reverseRedemption: vi.fn(async () => ({
        reversed: true,
      })),
      upsertCustomer: vi.fn(async () => ({
        customerRef: '123456',
        attributes: {},
      })),
    };

    testEnv = {
      CORE: mockCore,
      DB: mockDb as unknown as D1Database,
      SHOPIFY_CLIENT_ID: CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
      SHOPIFY_APP_URL: 'https://shopify.incentives.dev',
    };
  });

  function validEval(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return computeSignedEvaluation(
      {
        evaluationId: 'eval-cart-uuid-001',
        shopDomain: SHOP,
        checkoutToken: 'chk-webhook-001',
        cartFingerprint: 'a'.repeat(64),
        subtotalMinorUnits: 5000,
        currency: 'USD',
        discountMinorUnits: 1000,
        target: 'order',
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        ...overrides,
      },
      TENANT_SIGNING_KEY,
    );
  }

  function paidOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 9001,
      admin_graphql_api_id: 'gid://shopify/Order/9001',
      checkout_token: 'chk-webhook-001',
      currency: 'USD',
      subtotal_price: '50.00',
      total_discounts: '10.00',
      note_attributes: [
        { name: '_incentives_eval', value: JSON.stringify(validEval()) },
      ],
      ...overrides,
    };
  }

  describe('HMAC Security & Authentication', () => {
    it('returns 401 when X-Shopify-Hmac-Sha256 header is missing', async () => {
      const app = createApp();
      const body = JSON.stringify({ id: 12345 });

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain('HMAC');
    });

    it('returns 401 when X-Shopify-Hmac-Sha256 signature is invalid', async () => {
      const app = createApp();
      const body = JSON.stringify({ id: 12345 });

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': 'invalid-base64-signature',
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('accepts valid HMAC signature computed with client secret', async () => {
      const app = createApp();
      const body = JSON.stringify({
        id: 12345,
        note_attributes: [],
      });
      const hmac = computeShopifyWebhookHmac(body, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
    });
  });

  describe('POST /webhooks/orders-paid', () => {
    it('parses a signed _incentives_eval and commits redemption idempotently', async () => {
      const app = createApp();
      const orderPayload = paidOrder({
        id: 987654321,
        admin_graphql_api_id: 'gid://shopify/Order/987654321',
        note_attributes: [
          { name: 'irrelevant_note', value: 'hello' },
          { name: '_incentives_eval', value: JSON.stringify(validEval()) },
        ],
      });
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.received).toBe(true);

      // Verify Core commitRedemption call
      expect(mockCore.commitRedemption).toHaveBeenCalledTimes(1);
      const redemptionCall = (mockCore.commitRedemption as any).mock.calls[0][0];
      expect(redemptionCall).toEqual(expect.objectContaining({
        evaluationId: 'eval-cart-uuid-001',
        externalOrderRef: 'gid://shopify/Order/987654321',
        idempotencyKey: 'shopify_987654321',
        postCaptureReconciliation: true,
      }));
    });

    it('rejects a raw evaluation ID string instead of a signed payload', async () => {
      const app = createApp();
      const orderPayload = paidOrder({
        id: 987654322,
        admin_graphql_api_id: 'gid://shopify/Order/987654322',
        note_attributes: [
          { name: '_incentives_eval', value: 'eval-direct-string-002' },
        ],
      });
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        received: true,
        skipped: true,
        reason: 'no_incentives_eval',
      });
      expect(mockCore.commitRedemption).not.toHaveBeenCalled();
    });

    it('gracefully skips orders without _incentives_eval note attribute', async () => {
      const app = createApp();
      const orderPayload = {
        id: 987654323,
        admin_graphql_api_id: 'gid://shopify/Order/987654323',
        note_attributes: [{ name: 'gift_wrap', value: 'yes' }],
      };
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.received).toBe(true);
      expect(data.skipped).toBe(true);
      expect(mockCore.commitRedemption).not.toHaveBeenCalled();
    });

    it('reconciles post-capture overspend when Core returns POST_CAPTURE_OVERSPEND warning without failing', async () => {
      const app = createApp();
      (mockCore.commitRedemption as any).mockResolvedValueOnce({
        redemptionId: 'redemption-reconciled-001',
        evaluationId: 'eval-exhausted-001',
        externalOrderRef: 'gid://shopify/Order/987654324',
        idempotencyKey: 'shopify_987654324',
        status: 'committed',
        entries: [],
        priceBreakdown: {
          subtotalMinorUnits: 10000,
          totalDiscountMinorUnits: 2000,
          netMinorUnits: 8000,
          lines: [],
        },
        reconciliationWarning: 'POST_CAPTURE_OVERSPEND',
      });

      const orderPayload = paidOrder({
        id: 987654324,
        admin_graphql_api_id: 'gid://shopify/Order/987654324',
        note_attributes: [
          {
            name: '_incentives_eval',
            value: JSON.stringify(validEval({ evaluationId: 'eval-exhausted-001' })),
          },
        ],
      });
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.received).toBe(true);
      expect(data.status).toBe('committed');
      expect(data.reconciliationWarning).toBe('POST_CAPTURE_OVERSPEND');
    });

    it('handles idempotent retries cleanly with identical idempotencyKey', async () => {
      const app = createApp();
      const orderPayload = paidOrder({
        id: 987654325,
        admin_graphql_api_id: 'gid://shopify/Order/987654325',
        note_attributes: [
          {
            name: '_incentives_eval',
            value: JSON.stringify(validEval({ evaluationId: 'eval-retry-001' })),
          },
        ],
      });
      const rawBody = JSON.stringify(orderPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      // First webhook delivery
      const res1 = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );
      expect(res1.status).toBe(200);

      // Second webhook delivery (Shopify retry)
      const res2 = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );
      expect(res2.status).toBe(200);

      expect(mockCore.commitRedemption).toHaveBeenCalledTimes(2);
      const call1 = (mockCore.commitRedemption as any).mock.calls[0][0];
      const call2 = (mockCore.commitRedemption as any).mock.calls[1][0];
      expect(call1.idempotencyKey).toBe('shopify_987654325');
      expect(call2.idempotencyKey).toBe('shopify_987654325');
    });

    it('returns 200 skipped when shop domain is not recognized in D1', async () => {
      const app = createApp();
      const body = JSON.stringify({
        id: 111,
        note_attributes: [
          { name: '_incentives_eval', value: JSON.stringify(validEval()) },
        ],
      });
      const hmac = computeShopifyWebhookHmac(body, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': 'unknown-shop.myshopify.com',
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ received: true, skipped: true, reason: 'shop_not_installed' });
      expect(mockCore.commitRedemption).not.toHaveBeenCalled();
    });

    it('returns 400 when request body contains malformed JSON', async () => {
      const app = createApp();
      const rawBody = '{ malformed: json, ';
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-paid',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Malformed JSON');
    });
  });

  describe('POST /webhooks/orders-cancelled', () => {
    it('returns 401 when HMAC is invalid', async () => {
      const app = createApp();
      const body = JSON.stringify({ id: 987654321 });

      const res = await app.request(
        '/webhooks/orders-cancelled',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': 'bad-hmac',
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('handles cancellation and calls reversal authority', async () => {
      const app = createApp();
      const cancelPayload = {
        id: 987654321,
        admin_graphql_api_id: 'gid://shopify/Order/987654321',
        cancelled_at: '2026-11-19T10:00:00Z',
        cancel_reason: 'customer',
        note_attributes: [
          {
            name: '_incentives_eval',
            value: JSON.stringify({ evaluationId: 'eval-cancelled-001' }),
          },
        ],
      };
      const rawBody = JSON.stringify(cancelPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-cancelled',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.received).toBe(true);
      expect(data.cancelled).toBe(true);
      expect(data.orderId).toBe(987654321);

      expect(mockCore.reverseRedemption).toHaveBeenCalledTimes(1);
      const reverseCall = (mockCore.reverseRedemption as any).mock.calls[0][0];
      expect(reverseCall).toEqual(expect.objectContaining({
        orderId: 987654321,
        idempotencyKey: 'shopify_cancel_987654321',
      }));
    });

    it('returns 400 when request body contains malformed JSON', async () => {
      const app = createApp();
      const rawBody = '{ bad: json';
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/orders-cancelled',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Malformed JSON');
    });
  });

  describe('POST /webhooks/refunds-create', () => {
    it('returns 401 when HMAC is invalid', async () => {
      const app = createApp();
      const body = JSON.stringify({ id: 555, order_id: 987654321 });

      const res = await app.request(
        '/webhooks/refunds-create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': 'bad-hmac',
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('processes refund event successfully', async () => {
      const app = createApp();
      const refundPayload = {
        id: 777666,
        order_id: 987654321,
        created_at: '2026-11-19T10:15:00Z',
        refund_line_items: [
          { line_item_id: 111, quantity: 1, subtotal: '20.00' },
        ],
      };
      const rawBody = JSON.stringify(refundPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/refunds-create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.received).toBe(true);
      expect(data.refunded).toBe(true);
      expect(data.refundId).toBe(777666);
    });

    it('returns 400 when request body contains malformed JSON', async () => {
      const app = createApp();
      const rawBody = '{ bad: json';
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/refunds-create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Malformed JSON');
    });
  });

  describe('POST /webhooks/customers-update', () => {
    it('returns 401 when HMAC is invalid', async () => {
      const app = createApp();
      const body = JSON.stringify({ id: 112233 });

      const res = await app.request(
        '/webhooks/customers-update',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': 'bad-hmac',
          },
          body,
        },
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('syncs customer profile and tags to Core', async () => {
      const app = createApp();
      const customerPayload = {
        id: 888999,
        email: 'vip.shopper@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
        tags: 'vip, holiday2026',
        orders_count: 7,
        total_spent: '650.00',
      };
      const rawBody = JSON.stringify(customerPayload);
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/customers-update',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.received).toBe(true);
      expect(data.synced).toBe(true);

      expect(mockCore.upsertCustomer).toHaveBeenCalledTimes(1);
      const upsertCall = (mockCore.upsertCustomer as any).mock.calls[0];
      // Check customer context, ref, and attributes
      expect(upsertCall[0].permission).toBe('customers:manage');
      expect(upsertCall[1]).toBe('gid://shopify/Customer/888999');
      expect(upsertCall[2]).toEqual(expect.objectContaining({
        attributes: expect.objectContaining({
          email: 'vip.shopper@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          tags: 'vip, holiday2026',
          ordersCount: 7,
        }),
      }));
    });

    it('returns 400 when request body contains malformed JSON', async () => {
      const app = createApp();
      const rawBody = '{ bad: json';
      const hmac = computeShopifyWebhookHmac(rawBody, CLIENT_SECRET);

      const res = await app.request(
        '/webhooks/customers-update',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Shop-Domain': SHOP,
            'X-Shopify-Hmac-Sha256': hmac,
          },
          body: rawBody,
        },
        testEnv,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Malformed JSON');
    });
  });
});
