import { Hono, type Context } from 'hono';
import {
  type EvaluationResponse,
  type SignedEvaluationPayload,
} from '@incentives/contracts';
import type { Env } from '../env.js';

export interface InstalledShopRecord {
  shop_domain: string;
  access_token: string;
  tenant_id: string;
  tenant_signing_key: string;
  publishable_token?: string;
  secret_token?: string;
  status: string;
}

export const evaluateRoutes = new Hono<{ Bindings: Env }>();

/**
 * Computes HMAC-SHA256 hex digest using Web Crypto API.
 */
export async function computeHmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Handles storefront evaluation request:
 * 1. Authenticates request via Authorization: Bearer <publishable_token> or x-shopify-shop-domain header
 * 2. Queries D1 (shopify_installed_shops) for tenant context and tenant_signing_key
 * 3. Forwards request to Core API via Service Binding
 * 4. Signs evaluated payload with tenant_signing_key using Web Crypto HMAC-SHA256
 * 5. Returns EvaluationResponse with signedEvaluation attached
 */
export async function handleEvaluate(c: Context<{ Bindings: Env }>) {
  // 1. Authenticate request via Authorization: Bearer <publishable_token> or x-shopify-shop-domain header
  const authHeader = c.req.header('authorization');
  const shopDomainHeader =
    c.req.header('x-shopify-shop-domain') || c.req.header('x-shop-domain');

  let token: string | undefined;
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) {
      token = match[1].trim();
    }
  }

  if (!token && !shopDomainHeader) {
    return c.json(
      { error: 'Unauthorized: Missing credentials or shop domain' },
      401,
    );
  }

  // 2. Query D1 (shopify_installed_shops) to retrieve tenant_signing_key, tenant_id, and shop_domain
  let shopRecord: InstalledShopRecord | null = null;
  if (token) {
    shopRecord = await c.env.DB.prepare(
      `SELECT shop_domain, access_token, tenant_id, tenant_signing_key, publishable_token, secret_token, status
       FROM shopify_installed_shops
       WHERE (publishable_token = ? OR secret_token = ?) AND status = 'active'
       LIMIT 1`,
    )
      .bind(token, token)
      .first<InstalledShopRecord>();
  }

  if (!shopRecord && shopDomainHeader) {
    shopRecord = await c.env.DB.prepare(
      `SELECT shop_domain, access_token, tenant_id, tenant_signing_key, publishable_token, secret_token, status
       FROM shopify_installed_shops
       WHERE shop_domain = ? AND status = 'active'
       LIMIT 1`,
    )
      .bind(shopDomainHeader)
      .first<InstalledShopRecord>();
  }

  if (!shopRecord) {
    return c.json(
      { error: 'Unauthorized: Shop not found or inactive' },
      401,
    );
  }

  if (!shopRecord.tenant_signing_key) {
    return c.json(
      { error: 'Internal Server Error: Tenant signing key not configured' },
      500,
    );
  }

  // Parse incoming request body
  let body: Record<string, unknown> = {};
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Bad Request: Invalid JSON body' }, 400);
  }

  // Extract cartId for signing
  const cartId =
    body.cartId ??
    body.cart_id ??
    (body.context as Record<string, unknown> | undefined)?.cartId ??
    c.req.header('x-shopify-cart-id') ??
    c.req.header('x-cart-id') ??
    c.req.query('cartId') ??
    c.req.query('cart_id') ??
    'gid://shopify/Cart/default';

  // 3. Forward evaluation payload to c.env.CORE.fetch('/v1/evaluate', ...) via Service Binding with tenant context
  if (!c.env.CORE || typeof c.env.CORE.fetch !== 'function') {
    return c.json(
      { error: 'Service Unavailable: Core API service binding unreachable' },
      503,
    );
  }

  const { cartId: _extractedCartId, ...corePayload } = body;

  const headers = new Headers();
  const correlationId = c.req.header('x-correlation-id') || crypto.randomUUID();
  headers.set('x-correlation-id', correlationId);
  headers.set('x-tenant-id', shopRecord.tenant_id);
  headers.set('x-merchant-id', shopRecord.tenant_id);

  const forwardToken = shopRecord.publishable_token || token || shopRecord.secret_token;
  if (forwardToken) {
    headers.set('authorization', `Bearer ${forwardToken}`);
  }
  headers.set('content-type', 'application/json');

  let upstreamRes: Response;
  try {
    const targetUrl = new URL('/v1/evaluate', 'https://core.internal');
    upstreamRes = await c.env.CORE.fetch(
      new Request(targetUrl.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(corePayload),
      }),
    );
  } catch (err) {
    return c.json(
      { error: `Service Unavailable: ${(err as Error).message || 'Core API failure'}` },
      503,
    );
  }

  if (!upstreamRes.ok) {
    const contentType = upstreamRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errorJson = await upstreamRes.json();
      return c.json(errorJson, upstreamRes.status as any);
    }
    const errorText = await upstreamRes.text();
    return c.text(errorText, upstreamRes.status as any);
  }

  const evalResponse = (await upstreamRes.json()) as EvaluationResponse;

  // 4. Sign the evaluated result on the server using tenant_signing_key via Web Crypto HMAC-SHA256:
  // Message: `${evaluationId}:${cartId}:${subtotalMinorUnits}:${currency}:${discountMinorUnits}:${expiresAt}`
  const subtotalMinorUnits =
    evalResponse.priceBreakdown?.originalMerchandiseSubtotal ??
    (body.cart && typeof (body.cart as any).subtotal === 'number'
      ? (body.cart as any).subtotal
      : 0);
  const currency =
    evalResponse.priceBreakdown?.currency ??
    (body.cart && typeof (body.cart as any).currency === 'string'
      ? (body.cart as any).currency
      : 'USD');
  const discountMinorUnits = evalResponse.priceBreakdown?.totalDiscount ?? 0;
  const expiresAt = evalResponse.expiresAt ?? '';

  const message = `${evalResponse.evaluationId}:${cartId}:${subtotalMinorUnits}:${currency}:${discountMinorUnits}:${expiresAt}`;
  const signature = await computeHmacSha256(shopRecord.tenant_signing_key, message);

  // 5. Attach signedEvaluation to the response
  const signedEvaluation: SignedEvaluationPayload = {
    evaluationId: evalResponse.evaluationId,
    shopDomain: shopRecord.shop_domain,
    cartId: String(cartId),
    subtotalMinorUnits,
    currency,
    discountMinorUnits,
    target: 'order',
    expiresAt: evalResponse.expiresAt,
    signature,
  };

  return c.json({
    ...evalResponse,
    signedEvaluation,
  });
}

// Support both path patterns
evaluateRoutes.post('/', handleEvaluate);
evaluateRoutes.post('/v1/evaluate', handleEvaluate);
evaluateRoutes.post('/evaluate', handleEvaluate);
