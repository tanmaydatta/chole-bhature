import { Hono, type Context } from 'hono';
import {
  shopifySessionMiddleware,
  type ShopifyAdminEnv,
} from '../middleware/shopify-session.js';

export const adminRoutes = new Hono<ShopifyAdminEnv>();

// Apply Shopify App Bridge session token validation to all admin endpoints
adminRoutes.use('*', shopifySessionMiddleware);

/**
 * GET /admin/session
 * Returns authenticated merchant session context.
 */
adminRoutes.get('/session', c => {
  const session = c.get('shopifySession');
  return c.json({
    authenticated: true,
    shop: session.shopDomain,
    tenantId: session.tenantId,
    publishableToken: session.installedShop.publishable_token,
    status: session.installedShop.status,
  });
});

/**
 * GET /admin/dashboard/config
 * Returns configuration for the embedded operator dashboard.
 */
adminRoutes.get('/dashboard/config', c => {
  const session = c.get('shopifySession');
  return c.json({
    shop: session.shopDomain,
    tenantId: session.tenantId,
    publishableToken: session.installedShop.publishable_token,
    appUrl: c.env.SHOPIFY_APP_URL ?? 'https://shopify.incentives.dev',
    environment: c.env.APP_ENV ?? 'production',
  });
});

/**
 * Forwarding handler for Core API proxy.
 */
async function handleDashboardProxy(c: Context<ShopifyAdminEnv>) {
  const session = c.get('shopifySession');
  const subPath = c.req.path.replace(/^\/admin\/dashboard\/proxy/, '') || '/';
  const url = new URL(c.req.url);
  const targetUrl = new URL(`${subPath}${url.search}`, 'https://core.internal');

  const headers = new Headers();
  const correlationId = c.req.header('x-correlation-id') || crypto.randomUUID();
  headers.set('x-correlation-id', correlationId);
  headers.set('x-tenant-id', session.tenantId);
  headers.set('x-merchant-id', session.tenantId);

  if (session.installedShop.secret_token) {
    headers.set('authorization', `Bearer ${session.installedShop.secret_token}`);
  }

  const contentType = c.req.header('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }

  const method = c.req.method;
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await c.req.arrayBuffer();

  if (!c.env.CORE || typeof c.env.CORE.fetch !== 'function') {
    return c.json(
      { error: 'Service Unavailable: Core API service binding unreachable' },
      503,
    );
  }

  try {
    const upstreamRes = await c.env.CORE.fetch(
      new Request(targetUrl.toString(), {
        method,
        headers,
        ...(body ? { body } : {}),
      }),
    );

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: upstreamRes.headers,
    });
  } catch (err) {
    return c.json(
      { error: `Service Unavailable: ${(err as Error).message || 'Core API failure'}` },
      503,
    );
  }
}

/**
 * ALL /admin/dashboard/proxy/* and /admin/dashboard/proxy
 * Forwards requests to Core API via Service Binding with tenant context.
 */
adminRoutes.all('/dashboard/proxy', handleDashboardProxy);
adminRoutes.all('/dashboard/proxy/*', handleDashboardProxy);
