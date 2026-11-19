import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sign } from 'hono/jwt';
import { createApp } from '../src/app.js';
import type { Env, CoreServiceBinding } from '../src/env.js';

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

describe('Embedded Operator Dashboard Admin Bridge & Session Tokens', () => {
  const CLIENT_ID = 'test-shopify-client-id';
  const CLIENT_SECRET = 'test-shopify-client-secret-super-secure';
  const SHOP = 'quickstart-store.myshopify.com';
  const TENANT_ID = 'shop_quickstart_store_myshopify_com';
  const PUBLISHABLE_TOKEN = 'pk_live_shopify_12345';
  const SECRET_TOKEN = 'sk_live_shopify_67890';
  const APP_URL = 'https://shopify.incentives.dev';

  let mockDb: MockD1Database;
  let mockCore: CoreServiceBinding;
  let testEnv: Env;
  let app: ReturnType<typeof createApp>;

  async function createSessionToken(
    overrides: Record<string, unknown> = {},
    secret = CLIENT_SECRET,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: `https://${SHOP}/admin`,
      dest: `https://${SHOP}`,
      aud: CLIENT_ID,
      sub: 'operator_merchant_user_1',
      exp: now + 3600,
      nbf: now - 30,
      iat: now - 30,
      jti: crypto.randomUUID(),
      ...overrides,
    };
    return sign(payload, secret, 'HS256');
  }

  beforeEach(() => {
    mockDb = new MockD1Database();
    // Seed active installed store
    mockDb.rows.set(SHOP, {
      shop_domain: SHOP,
      access_token: 'shpat_test_access_token_12345',
      tenant_id: TENANT_ID,
      tenant_signing_key: 'signing_key_secret_abc123',
      publishable_token: PUBLISHABLE_TOKEN,
      secret_token: SECRET_TOKEN,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    mockCore = {
      provisionMerchant: vi.fn(),
      createCredential: vi.fn(),
      fetch: vi.fn().mockImplementation(async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === '/v1/programs') {
          return new Response(
            JSON.stringify({
              programs: [{ id: 'prog_1', name: 'VIP Tier Discount' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (url.pathname === '/v1/campaigns' && request.method === 'POST') {
          const body = await request.clone().json();
          return new Response(
            JSON.stringify({
              created: true,
              data: body,
            }),
            {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    };

    testEnv = {
      CORE: mockCore,
      DB: mockDb as unknown as D1Database,
      SHOPIFY_CLIENT_ID: CLIENT_ID,
      SHOPIFY_CLIENT_SECRET: CLIENT_SECRET,
      SHOPIFY_APP_URL: APP_URL,
      APP_ENV: 'test',
    };

    app = createApp();
  });

  describe('Session Authentication & Context Resolution', () => {
    it('valid session JWT resolves tenant context and returns session info', async () => {
      const token = await createSessionToken();
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json.shop).toBe(SHOP);
      expect(json.tenantId).toBe(TENANT_ID);
      expect(json.publishableToken).toBe(PUBLISHABLE_TOKEN);
    });

    it('returns dashboard configuration for embedded App Bridge', async () => {
      const token = await createSessionToken();
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/dashboard/config', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json.shop).toBe(SHOP);
      expect(json.tenantId).toBe(TENANT_ID);
      expect(json.publishableToken).toBe(PUBLISHABLE_TOKEN);
      expect(json.appUrl).toBe(APP_URL);
    });

    it('zero cookies required: authenticates successfully without Cookie header (Safari ITP safe)', async () => {
      const token = await createSessionToken();
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            // Explicitly no Cookie header
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Site': 'cross-site',
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  });

  describe('Session Token Validation Failures (HTTP 401 / 404)', () => {
    it('missing Authorization header returns HTTP 401', async () => {
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('malformed Authorization header returns HTTP 401', async () => {
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: 'Basic invalid-credentials',
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('invalid JWT format returns HTTP 401', async () => {
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer invalid.jwt.string',
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('expired JWT returns HTTP 401', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await createSessionToken({
        exp: now - 120, // expired 2 minutes ago
      });

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${expiredToken}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('wrong secret / invalid signature returns HTTP 401', async () => {
      const forgedToken = await createSessionToken({}, 'wrong-attacker-secret-key-12345');

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${forgedToken}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('audience mismatch (aud != SHOPIFY_CLIENT_ID) returns HTTP 401', async () => {
      const mismatchedAudToken = await createSessionToken({
        aud: 'foreign-shopify-app-client-id',
      });

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${mismatchedAudToken}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
    });

    it('uninstalled shop in D1 returns HTTP 401/404', async () => {
      const uninstalledToken = await createSessionToken({
        dest: 'https://uninstalled-store.myshopify.com',
        iss: 'https://uninstalled-store.myshopify.com/admin',
      });

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${uninstalledToken}`,
          },
        }),
        testEnv,
      );

      expect([401, 404]).toContain(res.status);
    });

    it('inactive shop in D1 returns HTTP 401/404', async () => {
      mockDb.rows.set('inactive-store.myshopify.com', {
        shop_domain: 'inactive-store.myshopify.com',
        access_token: 'shpat_test_inactive',
        tenant_id: 'shop_inactive',
        tenant_signing_key: 'inactive_key',
        status: 'uninstalled',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const inactiveToken = await createSessionToken({
        dest: 'https://inactive-store.myshopify.com',
        iss: 'https://inactive-store.myshopify.com/admin',
      });

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${inactiveToken}`,
          },
        }),
        testEnv,
      );

      expect([401, 404]).toContain(res.status);
    });
  });

  describe('Core API Service Binding Proxy (/dashboard/proxy/*)', () => {
    it('forwards GET request to Core API via Service Binding with tenant context', async () => {
      const token = await createSessionToken();
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/dashboard/proxy/v1/programs?active=true', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Correlation-ID': 'test-corr-id-123',
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toEqual({
        programs: [{ id: 'prog_1', name: 'VIP Tier Discount' }],
      });

      expect(mockCore.fetch).toHaveBeenCalledTimes(1);
      const forwardedReq = (mockCore.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Request;
      const forwardedUrl = new URL(forwardedReq.url);
      expect(forwardedUrl.pathname).toBe('/v1/programs');
      expect(forwardedUrl.search).toBe('?active=true');
      expect(forwardedReq.headers.get('x-tenant-id')).toBe(TENANT_ID);
      expect(forwardedReq.headers.get('x-merchant-id')).toBe(TENANT_ID);
      expect(forwardedReq.headers.get('authorization')).toBe(`Bearer ${SECRET_TOKEN}`);
      expect(forwardedReq.headers.get('x-correlation-id')).toBe('test-corr-id-123');
    });

    it('forwards POST request with body to Core API via Service Binding', async () => {
      const token = await createSessionToken();
      const payload = { name: 'Holiday Sale', discountBasisPoints: 1500 };

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/dashboard/proxy/v1/campaigns', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }),
        testEnv,
      );

      expect(res.status).toBe(201);
      const json = await res.json() as { created: boolean; data: typeof payload };
      expect(json.created).toBe(true);
      expect(json.data).toEqual(payload);

      expect(mockCore.fetch).toHaveBeenCalledTimes(1);
      const forwardedReq = (mockCore.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as Request;
      expect(forwardedReq.method).toBe('POST');
      expect(forwardedReq.headers.get('x-tenant-id')).toBe(TENANT_ID);
      const forwardedBody = await forwardedReq.json();
      expect(forwardedBody).toEqual(payload);
    });

    it('returns HTTP 503 if Core API service binding is missing or fails', async () => {
      const token = await createSessionToken();
      const envWithoutCore = {
        ...testEnv,
        CORE: {
          ...mockCore,
          fetch: vi.fn().mockRejectedValue(new Error('Core API service binding down')),
        },
      };

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/dashboard/proxy/v1/programs', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        envWithoutCore,
      );

      expect(res.status).toBe(503);
    });

    it('proxies HTTP 204 No Content response from Core API without error', async () => {
      const token = await createSessionToken();
      const envWith204 = {
        ...testEnv,
        CORE: {
          ...mockCore,
          fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
        },
      };

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/dashboard/proxy/v1/programs/123', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        envWith204,
      );

      expect(res.status).toBe(204);
      expect(res.body).toBeNull();
    });

    it('case-insensitive bearer prefix authenticates successfully', async () => {
      const token = await createSessionToken();
      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            authorization: `bearer ${token}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(200);
    });

    it('divergent dest and iss domains returns HTTP 401', async () => {
      const token = await createSessionToken({
        dest: 'https://attacker.myshopify.com',
        iss: 'https://victim.myshopify.com/admin',
      });

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        testEnv,
      );

      expect(res.status).toBe(401);
      const json = await res.json() as Record<string, unknown>;
      expect(json.error).toMatch(/mismatch/i);
    });

    it('missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET returns HTTP 500', async () => {
      const token = await createSessionToken();
      const misconfiguredEnv = {
        ...testEnv,
        SHOPIFY_CLIENT_ID: '',
      };

      const res = await app.fetch(
        new Request('https://shopify.incentives.dev/admin/session', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        misconfiguredEnv,
      );

      expect(res.status).toBe(500);
      const json = await res.json() as Record<string, unknown>;
      expect(json.error).toMatch(/Missing Shopify credentials/i);
    });
  });
});
