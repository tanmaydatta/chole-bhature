import { Hono, type Context } from 'hono';
import {
  EvaluationRequestSchema,
  EvaluationResponseSchema,
  type EvaluationResponse,
  type SignedEvaluationPayload,
} from '@incentives/contracts';
import {
  shopifySessionMiddleware,
  type ShopifyAdminEnv,
} from '../middleware/shopify-session.js';
import { computeCartFingerprint } from '../services/cart-fingerprint.js';
import { computeHmacSha256Hex } from '../services/hmac.js';
import { createOperatorContext } from '../services/operator-context.js';
import { shopifyCheckoutCors } from '../middleware/cors.js';

const SHOPIFY_EVALUATION_TTL_SECONDS = 900;

export async function computeHmacSha256(secret: string, message: string): Promise<string> {
  return computeHmacSha256Hex(secret, message);
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
  const jwtSub = session.jwtPayload['sub'];
  const customerRef =
    typeof jwtSub === 'string' && jwtSub.startsWith('gid://shopify/Customer/')
      ? jwtSub
      : undefined;

  const {
    checkoutToken: _checkoutToken,
    cartId: _cartId,
    customerRef: _bodyCustomerRef,
    previousEvaluationId: rawPreviousEvaluationId,
    ...evaluationBody
  } = body;
  const previousEvaluationId = typeof rawPreviousEvaluationId === 'string'
    ? rawPreviousEvaluationId
    : undefined;

  let request;
  try {
    request = EvaluationRequestSchema.parse({
      ...evaluationBody,
      ...(customerRef === undefined ? {} : { customerRef }),
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
  const redemptionContext = createOperatorContext(
    shopRecord.tenant_id,
    'redemptions:commit',
    operatorContext.correlationId,
  );

  if (
    previousEvaluationId !== undefined
    && typeof c.env.CORE.releaseBudgetLeases === 'function'
  ) {
    try {
      await c.env.CORE.releaseBudgetLeases(redemptionContext, {
        evaluationId: previousEvaluationId,
      });
    } catch {
      // Expired leases are cleaned up lazily; a failed release must not block checkout.
    }
  }

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
  const upstreamExpiresAt = upstream.expiresAt;
  const checkoutRef = checkoutToken || `checkout:${upstream.evaluationId}`;

  const leaseDecisions = upstream.priceBreakdown.discountAllocations
    .filter(allocation => allocation.discountMinorUnits > 0)
    .map(allocation => ({
      programRef: allocation.programRef,
      amountMinor: allocation.discountMinorUnits,
    }));

  let leaseId = '';
  let leaseExpiresAt = '';
  if (
    leaseDecisions.length > 0
    && typeof c.env.CORE.reserveBudgetLeases === 'function'
  ) {
    const reserved = await c.env.CORE.reserveBudgetLeases(redemptionContext, {
      evaluationId: upstream.evaluationId,
      decisions: leaseDecisions,
      ttlSeconds: 900,
      toleranceBps: 300,
    }).catch(() => null);
    if (reserved === null) {
      return c.json({ error: 'lease_unavailable' }, 503);
    }
    if (!reserved.accepted) {
      return c.json(
        {
          error: 'budget_exhausted',
          reason: reserved.reason ?? 'budget_exhausted',
        },
        409,
      );
    }
    leaseId = upstream.evaluationId;
    leaseExpiresAt = reserved.leases.reduce(
      (earliest, lease) => (
        earliest === '' || lease.expiresAt < earliest ? lease.expiresAt : earliest
      ),
      '',
    );
  }
  const expiresAt = leaseExpiresAt || upstreamExpiresAt;

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
    leaseId,
    leaseExpiresAt,
    expiresAt,
  ].join(':');
  const signature = await computeHmacSha256Hex(shopRecord.tenant_signing_key, message);

  const signedEvaluation: SignedEvaluationPayload = {
    evaluationId: upstream.evaluationId,
    shopDomain: shopRecord.shop_domain,
    cartId: checkoutRef,
    checkoutToken: checkoutRef,
    cartFingerprint,
    subtotalMinorUnits,
    currency,
    discountMinorUnits,
    ...(leaseId === '' ? {} : { leaseId }),
    ...(leaseExpiresAt === '' ? {} : { leaseExpiresAt }),
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
