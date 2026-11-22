import type { MiddlewareHandler } from 'hono';

/**
 * Checkout UI extensions run in a Web Worker whose origin can change.
 * Shopify requires `Access-Control-Allow-Origin: *` for extension fetches.
 */
export const shopifyCheckoutCors: MiddlewareHandler = async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Correlation-Id');
  c.header('Access-Control-Max-Age', '600');
  c.header('Vary', 'Origin');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
  c.header('Access-Control-Allow-Origin', '*');
};
