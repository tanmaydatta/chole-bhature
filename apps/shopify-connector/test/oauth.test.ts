import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { provisionStore } from '../src/services/store-provisioning.js';
import type { Env, CoreServiceBinding } from '../src/env.js';

export function computeShopifyOAuthHmac(params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params)
    .filter(k => k !== 'hmac' && k !== 'signature')
    .sort();
  const message = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
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
        // params: shop, accessToken, merchantId, tenantSigningKey, publishableToken, secretToken, now, now
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
      if (shopDomain && this.rows.has(shopDomain)) {
        return { results: [this.rows.get(shopDomain) as T] };
      }
      return { results: Array.from(this.rows.values()) as T[] };
    }
    return { results: [] };
  }
}

describe('Shopify OAuth & Store Provisioning', () => {
  const CLIENT_ID = 'test-client-id';
  const CLIENT_SECRET = 'test-client-secret-super-secure';
  const APP_URL = 'https://shopify.incentives.dev';
  const SHOP = 'quickstart-store.myshopify.com';

  let mockDb: MockD1Database;
  let mockCore: CoreServiceBinding;
  let testEnv: Env;
  let capturedFetches: { url: string; options?: RequestInit }[] = [];

  beforeEach(() => {
    mockDb = new MockD1Database();
    capturedFetches = [];

    mockCore = {
      provisionMerchant: vi.fn(async (context, input) => {
        return {
          ok: true,
          value: {
            id: input.id,
            name: input.name,
            provisioningId: input.provisioningId,
            status: 'active' as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      }),
      createCredential: vi.fn(async (context, input) => {
        const isPub = input.kind === 'publishable';
        return {
          credential: {
            id: `cred_${input.kind}_123`,
            name: input.name,
            merchantId: context.merchantId,
            environment: 'production' as const,
            scopes: input.scopes,
            createdAt: new Date().toISOString(),
            createdBy: context.actorUserId,
            status: 'active' as const,
            suffix: isPub ? 'pk1234' : 'sk1234',
            ...(isPub
              ? {
                  kind: 'publishable' as const,
                  allowedOrigins: input.allowedOrigins ?? [],
                  requestsPerMinute: 60,
                }
              : { kind: 'secret' as const }),
          },
          token: isPub ? 'pk_live_shopify_pub_token_1234567890' : 'sk_live_shopify_sec_token_1234567890',
        };
      }),
    };

    testEnv = {
      CORE: mockCore,
      DB: mockDb as unknown as D1Database,
      SHOPIFY_CLIENT_ID: CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
      SHOPIFY_APP_URL: APP_URL,
      SHOPIFY_DISCOUNT_FUNCTION_ID: '01912345-6789-7abc-def0-123456789abc',
    };

    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      capturedFetches.push({ url, options: init });

      // Shopify access token exchange
      if (url.includes('/admin/oauth/access_token')) {
        return new Response(
          JSON.stringify({
            access_token: 'shpat_permanent_access_token_xyz',
            scope: 'read_orders,write_discounts,read_customers,write_customers',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Shopify GraphQL Admin API
      if (url.includes('/graphql.json')) {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const query = body.query || '';

        if (query.includes('metafieldsSet')) {
          return new Response(
            JSON.stringify({
              data: {
                metafieldsSet: {
                  metafields: [
                    {
                      id: 'gid://shopify/Metafield/1',
                      namespace: '$app:incentives',
                      key: 'publishable_token',
                      value: 'pk_live_shopify_pub_token_1234567890',
                    },
                  ],
                  userErrors: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (query.includes('discountAutomaticAppCreate')) {
          return new Response(
            JSON.stringify({
              data: {
                discountAutomaticAppCreate: {
                  automaticAppDiscount: {
                    discountId: 'gid://shopify/DiscountAutomaticApp/1',
                    title: 'Incentives Automatic Discounts',
                    status: 'ACTIVE',
                  },
                  userErrors: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (query.includes('discountCodeAppCreate')) {
          return new Response(
            JSON.stringify({
              data: {
                discountCodeAppCreate: {
                  codeAppDiscount: {
                    discountId: 'gid://shopify/DiscountCodeApp/1',
                    title: 'Incentives Exclusive Codes',
                    status: 'ACTIVE',
                  },
                  userErrors: [],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        return new Response(
          JSON.stringify({ data: {}, userErrors: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not Found', { status: 404 });
    });
  });

  describe('GET /auth/shopify', () => {
    it('returns 400 if shop parameter is missing', async () => {
      const app = createApp();
      const res = await app.request('/auth/shopify', {}, testEnv);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Missing or invalid shop parameter');
    });

    it('returns 400 if shop parameter is invalid format', async () => {
      const app = createApp();
      const res = await app.request('/auth/shopify?shop=invalid-domain.com', {}, testEnv);
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain('Missing or invalid shop parameter');
    });

    it('redirects to Shopify OAuth authorize URL with correct query params and state cookie', async () => {
      const app = createApp();
      const res = await app.request(`/auth/shopify?shop=${SHOP}`, {}, testEnv);

      expect(res.status).toBe(302);
      const location = res.headers.get('Location');
      expect(location).toBeDefined();

      const url = new URL(location!);
      expect(url.hostname).toBe(SHOP);
      expect(url.pathname).toBe('/admin/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('scope')).toBe(
        'read_orders,write_discounts,read_customers,write_customers',
      );
      expect(url.searchParams.get('redirect_uri')).toBe(`${APP_URL}/auth/callback`);

      const state = url.searchParams.get('state');
      expect(state).toBeTruthy();

      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('shopify_oauth_state');
    });
  });

  describe('GET /auth/callback', () => {
    it('returns 400 when required query parameters are missing', async () => {
      const app = createApp();
      const res = await app.request('/auth/callback?shop=test.myshopify.com', {}, testEnv);
      expect(res.status).toBe(400);
    });

    it('returns 401 when HMAC signature is invalid', async () => {
      const app = createApp();
      const res = await app.request(
        `/auth/callback?shop=${SHOP}&code=code123&state=state123&hmac=badhmac`,
        {},
        testEnv,
      );
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain('Invalid HMAC');
    });

    it('returns 403 when state parameter does not match cookie', async () => {
      const app = createApp();
      const queryParams: Record<string, string> = {
        shop: SHOP,
        code: 'code123',
        state: 'tampered-state',
        timestamp: '1234567890',
      };
      const hmac = computeShopifyOAuthHmac(queryParams, CLIENT_SECRET);
      const search = new URLSearchParams({ ...queryParams, hmac }).toString();

      const res = await app.request(
        `/auth/callback?${search}`,
        {
          headers: {
            Cookie: 'shopify_oauth_state=original-state',
          },
        },
        testEnv,
      );
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).toContain('Invalid state');
    });

    it('successfully processes callback: exchanges token, provisions store, sets up metafield and discounts', async () => {
      const app = createApp();

      // First initiate oauth to get valid state & cookie
      const authRes = await app.request(`/auth/shopify?shop=${SHOP}`, {}, testEnv);
      const location = authRes.headers.get('Location')!;
      const state = new URL(location).searchParams.get('state')!;
      const cookieHeader = authRes.headers.get('Set-Cookie')!;
      const stateCookieMatch = cookieHeader.match(/shopify_oauth_state=([^;]+)/);
      const stateCookieVal = stateCookieMatch ? stateCookieMatch[1] : state;

      // Construct valid callback query
      const callbackParams: Record<string, string> = {
        code: 'shopify_auth_code_987',
        shop: SHOP,
        state,
        timestamp: Math.floor(Date.now() / 1000).toString(),
      };
      const hmac = computeShopifyOAuthHmac(callbackParams, CLIENT_SECRET);
      const search = new URLSearchParams({ ...callbackParams, hmac }).toString();

      const callbackRes = await app.request(
        `/auth/callback?${search}`,
        {
          headers: {
            Cookie: `shopify_oauth_state=${stateCookieVal}`,
          },
        },
        testEnv,
      );

      // Verify response redirects to embedded admin app
      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.get('Location')).toContain(`https://${SHOP}/admin/apps/${CLIENT_ID}`);

      // Verify token exchange fetch
      const tokenFetch = capturedFetches.find(f => f.url.includes('/admin/oauth/access_token'));
      expect(tokenFetch).toBeDefined();
      expect(tokenFetch!.options?.method).toBe('POST');
      const tokenBody = JSON.parse(tokenFetch!.options?.body as string);
      expect(tokenBody.client_id).toBe(CLIENT_ID);
      expect(tokenBody.client_secret).toBe(CLIENT_SECRET);
      expect(tokenBody.code).toBe('shopify_auth_code_987');

      // Verify Core tenant provisioning
      expect(mockCore.provisionMerchant).toHaveBeenCalledTimes(1);
      const [provContext, provInput] = (mockCore.provisionMerchant as any).mock.calls[0];
      expect(provContext.actorKind).toBe('root');
      expect(provContext.permission).toBe('credentials:manage');
      expect(provInput.name).toBe(SHOP);
      expect(provInput.id).toBe(provContext.merchantId);

      // Verify Core credential creation (publishable + secret)
      expect(mockCore.createCredential).toHaveBeenCalledTimes(2);
      const credCalls = (mockCore.createCredential as any).mock.calls;
      const pubCall = credCalls.find((c: any) => c[1].kind === 'publishable');
      const secCall = credCalls.find((c: any) => c[1].kind === 'secret');
      expect(pubCall).toBeDefined();
      expect(pubCall[1].allowedOrigins).toContain(`https://${SHOP}`);
      expect(secCall).toBeDefined();

      // Verify D1 shop record persistence
      const storeRecord = await mockDb
        .prepare('SELECT * FROM shopify_installed_shops WHERE shop_domain = ?')
        .bind(SHOP)
        .first();
      expect(storeRecord).toBeDefined();
      expect(storeRecord?.shop_domain).toBe(SHOP);
      expect(storeRecord?.access_token).toBe('shpat_permanent_access_token_xyz');
      expect(storeRecord?.tenant_id).toBe(provContext.merchantId);
      expect(storeRecord?.tenant_signing_key).toBeDefined();
      expect(typeof storeRecord?.tenant_signing_key).toBe('string');
      expect((storeRecord?.tenant_signing_key as string).length).toBe(64);
      expect(storeRecord?.publishable_token).toBe('pk_live_shopify_pub_token_1234567890');
      expect(storeRecord?.secret_token).toBe('sk_live_shopify_sec_token_1234567890');
      expect(storeRecord?.status).toBe('active');

      // Verify Shopify GraphQL calls
      const metafieldFetch = capturedFetches.find(f => {
        const body = typeof f.options?.body === 'string' ? f.options.body : '';
        return body.includes('metafieldsSet');
      });
      expect(metafieldFetch).toBeDefined();
      expect(metafieldFetch!.options?.headers).toMatchObject({
        'X-Shopify-Access-Token': 'shpat_permanent_access_token_xyz',
      });
      const metafieldBody = JSON.parse(metafieldFetch!.options?.body as string);
      expect(metafieldBody.variables.metafields[0].namespace).toBe('$app:incentives');
      expect(metafieldBody.variables.metafields[0].key).toBe('publishable_token');
      expect(metafieldBody.variables.metafields[0].value).toBe('pk_live_shopify_pub_token_1234567890');

      // Automatic discount registration
      const autoDiscountFetch = capturedFetches.find(f => {
        const body = typeof f.options?.body === 'string' ? f.options.body : '';
        return body.includes('discountAutomaticAppCreate');
      });
      expect(autoDiscountFetch).toBeDefined();
      const autoDiscountBody = JSON.parse(autoDiscountFetch!.options?.body as string);
      expect(autoDiscountBody.variables.automaticAppDiscount.metafields[0].key).toBe('signing-secret');
      expect(autoDiscountBody.variables.automaticAppDiscount.metafields[0].value).toBe(
        storeRecord?.tenant_signing_key,
      );

      // Code discount registration
      const codeDiscountFetch = capturedFetches.find(f => {
        const body = typeof f.options?.body === 'string' ? f.options.body : '';
        return body.includes('discountCodeAppCreate');
      });
      expect(codeDiscountFetch).toBeDefined();
      const codeDiscountBody = JSON.parse(codeDiscountFetch!.options?.body as string);
      expect(codeDiscountBody.variables.codeAppDiscount.code).toBe('INCENTIVES_APPLIED');
      expect(codeDiscountBody.variables.codeAppDiscount.metafields[0].key).toBe('signing-secret');
      expect(codeDiscountBody.variables.codeAppDiscount.metafields[0].value).toBe(
        storeRecord?.tenant_signing_key,
      );
    });
  });

  describe('provisionStore service function', () => {
    it('creates tenant, credentials, D1 record, and Shopify GraphQL configurations directly', async () => {
      const result = await provisionStore(testEnv, {
        shop: SHOP,
        accessToken: 'shpat_direct_provision_token',
      });

      expect(result.shop).toBe(SHOP);
      expect(result.merchantId).toMatch(/^shop_/);
      expect(result.publishableToken).toBe('pk_live_shopify_pub_token_1234567890');
      expect(result.secretToken).toBe('sk_live_shopify_sec_token_1234567890');
      expect(result.tenantSigningKey).toHaveLength(64);

      // Verify persisted in DB
      const dbRow = await mockDb
        .prepare('SELECT * FROM shopify_installed_shops WHERE shop_domain = ?')
        .bind(SHOP)
        .first();
      expect(dbRow?.access_token).toBe('shpat_direct_provision_token');
      expect(dbRow?.tenant_id).toBe(result.merchantId);
      expect(dbRow?.tenant_signing_key).toBe(result.tenantSigningKey);
    });
  });
});
