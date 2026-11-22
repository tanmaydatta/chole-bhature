import { Hono, type Context } from 'hono';
import {
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  type EvaluationResponse,
  type SignedEvaluationPayload,
} from '@incentives/contracts';
import type { Env } from '../env.js';
import {
  shopifySessionMiddleware,
  type ShopifyAdminEnv,
} from '../middleware/shopify-session.js';
import { computeCartFingerprint } from '../services/cart-fingerprint.js';
import { createOperatorContext } from '../services/operator-context.js';
import { shopifyCheckoutCors } from '../middleware/cors.js';

const SHOPIFY_EVALUATION_TTL_SECONDS = 86_400;

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
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export const evaluateRoutes = new Hono<ShopifyAdminEnv>();

evaluateRoutes.use('*', shopifyCheckoutCors);

// Checkout UI extensions authenticate with a Shopify App Bridge / Session Token.
// There is deliberately no shop-domain-header or publishable-token fallback.
evaluateRoutes.use('*', shopifySessionMiddleware);

export async function handleEvaluate(c: Context<ShopifyAdminEnv>) {
  const session = c.get('shopifySession');
  const shopRecord = session.installedShop;

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Bad Request: Invalid JSON body' }, 400);
  }

  const body = rawBody as Record<string, unknown>;
  const checkoutToken =
    (typeof body['checkoutToken'] === 'string' ? body['checkoutToken'] : undefined) ??
    c.req.header('x-shopify-checkout-token') ??
    '';
  const customerRef =
    typeof session.jwtPayload['sub'] === 'string' ? session.jwtPayload['sub'] : undefined;

  const { checkoutToken: _checkoutToken, cartId: _cartId, ...evaluationBody } = body;

  let request;
  try {
    request = EvaluationRequestSchema.parse({
      ...evaluationBody,
      ...(customerRef === undefined || body['customerRef'] !== undefined
        ? {}
        : { customerRef }),
      context: {
        ...(typeof evaluationBody['context'] === 'object' && evaluationBody['context'] !== null
          ? (evaluationBody['context'] as Record<string, unknown>)
          : {}),
        channel: 'shopify_checkout',
      },
      ttlSeconds: SHOPIFY_EVALUATION_TTL_SECONDS,
      includeCandidateOffers: evaluationBody['includeCandidateOffers'] ?? true,
    });
  } catch (error) {
    return c.json(
      { error: `Bad Request: ${error instanceof Error ? error.message : 'Invalid evaluation request'}` },
      400,
    );
  }

  const operatorContext = createOperatorContext(
    shopRecord.tenant_id,
    'evaluations:run',
    c.req.header('x-correlation-id') || crypto.randomUUID(),
  );

  let upstream: EvaluationResponse;
  try {
    const result = await c.env.CORE.evaluate(operatorContext, request);
    if ('error' in result) {
      return c.json(result, result.error.retryable ? 503 : 400);
    }
    upstream = EvaluationResponseSchema.parse(result);
  } catch (error) {
    return c.json(
      { error: `Service Unavailable: ${(error as Error).message || 'Core API failure'}` },
      503,
    );
  }

  const cartFingerprint = await computeCartFingerprint(request.cart);
  const subtotalMinorUnits = request.cart.subtotal;
  const currency = request.cart.currency;
  const discountMinorUnits = Math.min(
    upstream.priceBreakdown.totalDiscount,
    subtotalMinorUnits,
  );
  const expiresAt = upstream.expiresAt;
  const checkoutRef = checkoutToken || `checkout:${upstream.evaluationId}`;

  // v2 signature:
  // v2:${evaluationId}:${shopDomain}:${checkoutToken}:${cartFingerprint}:${subtotal}:${currency}:${discount}:${leaseId}:${leaseExpiresAt}:${expiresAt}
  const message = [
    'v2',
    upstream.evaluationId,
    shopRecord.shop_domain,
    checkoutRef,
    cartFingerprint,
    subtotalMinorUnits,
    currency,
    discountMinorUnits,
    '',
    '',
    expiresAt,
  ].join(':');
  const signature = await computeHmacSha256(shopRecord.tenant_signing_key, message);

  const signedEvaluation: SignedEvaluationPayload = {
    evaluationId: upstream.evaluationId,
    shopDomain: shopRecord.shop_domain,
    cartId: checkoutRef,
    checkoutToken: checkoutRef,
    cartFingerprint,
    subtotalMinorUnits,
    currency,
    discountMinorUnits,
    target: 'order',
    expiresAt,
    signature,
  };

  return c.json({
    ...upstream,
    signedEvaluation,
  });
}

evaluateRoutes.post('/', handleEvaluate);
