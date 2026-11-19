import { Hono, type Context } from 'hono';
import { verifyShopifyWebhookRequest } from '@incentives/shopify-connector';
import type { Env } from '../env.js';
import {
  processOrderPaid,
  processOrderCancelled,
  processRefundCreated,
  processCustomerUpdate,
} from '../services/redemption-service.js';

export const webhookRoutes = new Hono<{ Bindings: Env }>();

// Webhook HMAC verification and payload extraction helper
async function verifyWebhookRequest(
  c: Context<{ Bindings: Env }>,
): Promise<{ verified: boolean; rawBody: string; shopDomain: string }> {
  const hmacHeader =
    c.req.header('x-shopify-hmac-sha256') ?? c.req.header('X-Shopify-Hmac-Sha256');

  if (!hmacHeader) {
    return { verified: false, rawBody: '', shopDomain: '' };
  }

  const rawBody = await c.req.text();
  const shopDomain =
    c.req.header('x-shopify-shop-domain') ??
    c.req.header('X-Shopify-Shop-Domain') ??
    c.req.query('shop') ??
    '';

  const verification = await verifyShopifyWebhookRequest(
    new Request(c.req.url, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: rawBody,
    }),
    c.env.SHOPIFY_CLIENT_SECRET,
  );

  return {
    verified: verification.verified,
    rawBody,
    shopDomain,
  };
}

webhookRoutes.post('/orders-paid', async c => {
  const { verified, rawBody, shopDomain } = await verifyWebhookRequest(c);
  if (!verified) {
    return c.text('Unauthorized: Invalid HMAC signature', 401);
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const result = await processOrderPaid(c.env, shopDomain, payload);
    return c.json(result, 200);
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 404) {
      return c.text((error as Error).message, 404);
    }
    throw error;
  }
});

webhookRoutes.post('/orders-cancelled', async c => {
  const { verified, rawBody, shopDomain } = await verifyWebhookRequest(c);
  if (!verified) {
    return c.text('Unauthorized: Invalid HMAC signature', 401);
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const result = await processOrderCancelled(c.env, shopDomain, payload);
  return c.json(result, 200);
});

webhookRoutes.post('/refunds-create', async c => {
  const { verified, rawBody, shopDomain } = await verifyWebhookRequest(c);
  if (!verified) {
    return c.text('Unauthorized: Invalid HMAC signature', 401);
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const result = await processRefundCreated(c.env, shopDomain, payload);
  return c.json(result, 200);
});

webhookRoutes.post('/customers-update', async c => {
  const { verified, rawBody, shopDomain } = await verifyWebhookRequest(c);
  if (!verified) {
    return c.text('Unauthorized: Invalid HMAC signature', 401);
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const result = await processCustomerUpdate(c.env, shopDomain, payload);
  return c.json(result, 200);
});
