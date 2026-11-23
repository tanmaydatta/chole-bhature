import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import type { Env } from '../env.js';
import { decryptToken } from '../services/token-crypto.js';

export interface ShopifyInstalledShopRecord {
  shop_domain: string;
  access_token: string;
  tenant_id: string;
  tenant_signing_key: string;
  publishable_token?: string;
  secret_token?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ShopifySession {
  shopDomain: string;
  tenantId: string;
  installedShop: ShopifyInstalledShopRecord;
  jwtPayload: Record<string, unknown>;
}

export type ShopifyAdminEnv = {
  Bindings: Env;
  Variables: {
    shopifySession: ShopifySession;
  };
};

/**
 * Normalizes a shop domain from Shopify App Bridge dest or iss claims.
 * Examples:
 *   "https://quickstart-store.myshopify.com" -> "quickstart-store.myshopify.com"
 *   "https://quickstart-store.myshopify.com/admin" -> "quickstart-store.myshopify.com"
 *   "quickstart-store.myshopify.com" -> "quickstart-store.myshopify.com"
 */
export function extractShopDomain(destOrIss: string): string {
  if (!destOrIss) return '';
  try {
    const url = new URL(destOrIss.startsWith('http') ? destOrIss : `https://${destOrIss}`);
    return url.hostname.toLowerCase();
  } catch {
    return destOrIss.replace(/^https?:\/\//i, '').replace(/[/:].*$/, '').toLowerCase();
  }
}

/**
 * Middleware validating Shopify App Bridge session tokens (Authorization: Bearer <jwt>).
 * Requires zero cookies for 100% iframe and Safari ITP safety.
 */
export const shopifySessionMiddleware: MiddlewareHandler<ShopifyAdminEnv> = async (c, next) => {
  if (!c.env.SHOPIFY_CLIENT_ID || !c.env.SHOPIFY_CLIENT_SECRET) {
    return c.json({ error: 'Server configuration error: Missing Shopify credentials' }, 500);
  }

  const authHeader = c.req.header('authorization') ?? c.req.header('Authorization');
  if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
    return c.json({ error: 'Unauthorized: Missing or malformed Authorization header' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return c.json({ error: 'Unauthorized: Empty session token' }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    // Shopify App Bridge and checkout session tokens are HS256 JWTs signed
    // with the app's client secret. Do not accept externally-sourced JWKS keys.
    payload = (await verify(token, c.env.SHOPIFY_CLIENT_SECRET, {
      alg: 'HS256',
      aud: c.env.SHOPIFY_CLIENT_ID,
    })) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }

  const destDomain = typeof payload.dest === 'string' ? extractShopDomain(payload.dest) : '';
  const issDomain = typeof payload.iss === 'string' ? extractShopDomain(payload.iss) : '';
  if (destDomain && issDomain && destDomain !== issDomain) {
    return c.json({ error: 'Unauthorized: Destination and Issuer domain mismatch' }, 401);
  }
  const shopDomain = destDomain || issDomain;
  if (!shopDomain) {
    return c.json({ error: 'Unauthorized: Missing shop domain in session token' }, 401);
  }

  // Look up store installation record in D1
  const shopRecord = await c.env.DB.prepare(
    'SELECT * FROM shopify_installed_shops WHERE shop_domain = ?',
  )
    .bind(shopDomain)
    .first<ShopifyInstalledShopRecord>();

  if (!shopRecord || shopRecord.status !== 'active') {
    return c.json({ error: 'Shop not installed or active' }, 401);
  }

  const decryptedShopRecord: ShopifyInstalledShopRecord = {
    ...shopRecord,
    access_token: await decryptToken(c.env, shopRecord.access_token),
    tenant_signing_key: await decryptToken(c.env, shopRecord.tenant_signing_key),
    ...(shopRecord.publishable_token
      ? { publishable_token: await decryptToken(c.env, shopRecord.publishable_token) }
      : {}),
    ...(shopRecord.secret_token
      ? { secret_token: await decryptToken(c.env, shopRecord.secret_token) }
      : {}),
  };

  c.set('shopifySession', {
    shopDomain,
    tenantId: shopRecord.tenant_id,
    installedShop: decryptedShopRecord,
    jwtPayload: payload,
  });

  await next();
};
