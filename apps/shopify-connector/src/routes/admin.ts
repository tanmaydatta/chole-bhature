import { Hono } from 'hono';
import {
  shopifySessionMiddleware,
  type ShopifyAdminEnv,
} from '../middleware/shopify-session.js';

export const adminRoutes = new Hono<ShopifyAdminEnv>();

// Apply Shopify App Bridge session token validation to all admin endpoints.
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
 * Returns configuration for the embedded operator dashboard shell.
 *
 * Campaign management is intentionally a link-out to the external operator
 * dashboard. There is no generic secret-token proxy: forwarding the merchant's
 * backend credential to arbitrary paths would be a tenant-isolation risk.
 */
adminRoutes.get('/dashboard/config', c => {
  const session = c.get('shopifySession');
  return c.json({
    shop: session.shopDomain,
    tenantId: session.tenantId,
    publishableToken: session.installedShop.publishable_token,
    appUrl: c.env.SHOPIFY_APP_URL ?? 'https://shopify.incentives.dev',
    dashboardUrl: c.env.OPERATOR_DASHBOARD_URL,
    environment: c.env.APP_ENV ?? 'production',
  });
});
