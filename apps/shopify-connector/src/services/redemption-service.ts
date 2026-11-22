import { timingSafeEqual } from '@incentives/shopify-connector';
import type { Env } from '../env.js';
import { computeHmacSha256Hex, paymentMinorUnits } from './hmac.js';
import { decryptToken } from './token-crypto.js';

export interface InstalledShopRecord {
  shop_domain: string;
  access_token: string;
  tenant_id: string;
  tenant_signing_key: string;
  publishable_token?: string;
  secret_token?: string;
  status: string;
  automatic_discount_id?: string;
  function_handle?: string;
  schema_version?: number;
}

export async function findInstalledShop(
  db: D1Database,
  shopDomain: string,
  env?: Env,
): Promise<InstalledShopRecord | null> {
  const query = `
    SELECT shop_domain, access_token, tenant_id, tenant_signing_key, publishable_token,
           secret_token, status, automatic_discount_id, function_handle, schema_version
    FROM shopify_installed_shops
    WHERE shop_domain = ? AND status = 'active'
    LIMIT 1
  `;
  const result = await db.prepare(query).bind(shopDomain).first<InstalledShopRecord>();
  if (!result) return null;
  if (!env) return result;

  return {
    ...result,
    access_token: await decryptToken(env, result.access_token),
    tenant_signing_key: await decryptToken(env, result.tenant_signing_key),
    ...(result.publishable_token
      ? { publishable_token: await decryptToken(env, result.publishable_token) }
      : {}),
    ...(result.secret_token
      ? { secret_token: await decryptToken(env, result.secret_token) }
      : {}),
  };
}

export interface IncentivesEvalPayload {
  evaluationId: string;
  cartId?: string;
  checkoutToken?: string;
  cartFingerprint?: string;
  shopDomain?: string;
  subtotalMinorUnits?: number;
  currency?: string;
  discountMinorUnits?: number;
  leaseId?: string;
  leaseExpiresAt?: string;
  expiresAt?: string;
  signature?: string;
  target?: string;
  [key: string]: unknown;
}

export function extractIncentivesEval(
  noteAttributes?: unknown,
): { evaluationId: string; raw: IncentivesEvalPayload } | null {
  if (!noteAttributes || !Array.isArray(noteAttributes)) {
    return null;
  }

  for (const attr of noteAttributes) {
    if (!attr || typeof attr !== 'object') continue;
    const name = (attr as { name?: string; key?: string }).name ?? (attr as { key?: string }).key;
    if (name === '_incentives_eval') {
      const rawVal = (attr as { value?: unknown }).value;
      if (typeof rawVal !== 'string') return null;
      const trimmed = rawVal.trim();
      if (!trimmed.startsWith('{')) return null;
      try {
        const parsed = JSON.parse(trimmed) as IncentivesEvalPayload;
        if (!parsed.evaluationId) return null;
        return { evaluationId: parsed.evaluationId, raw: parsed };
      } catch {
        return null;
      }
    }
  }

  return null;
}

export interface OrderPaidResult {
  received: boolean;
  skipped?: boolean;
  reason?: string;
  status?: string;
  reconciliationWarning?: string;
  redemptionId?: string;
  [key: string]: unknown;
}

interface SignedEvaluationCheck {
  ok: boolean;
  reason?: string;
}

function signedEvaluationMessage(payload: IncentivesEvalPayload): string {
  const checkoutToken = payload.checkoutToken ?? payload.cartId ?? '';
  return [
    'v2',
    payload.evaluationId,
    payload.shopDomain ?? '',
    checkoutToken,
    payload.cartFingerprint ?? '',
    payload.subtotalMinorUnits ?? 0,
    payload.currency ?? '',
    payload.discountMinorUnits ?? 0,
    payload.leaseId ?? '',
    payload.leaseExpiresAt ?? '',
    payload.expiresAt ?? '',
  ].join(':');
}

async function verifySignedEvaluation(
  payload: IncentivesEvalPayload,
  store: InstalledShopRecord,
  shopDomain: string,
  order: Record<string, unknown>,
): Promise<SignedEvaluationCheck> {
  if (
    payload.signature === undefined
    || payload.cartFingerprint === undefined
    || payload.expiresAt === undefined
    || payload.subtotalMinorUnits === undefined
    || payload.currency === undefined
    || payload.discountMinorUnits === undefined
  ) {
    return { ok: false, reason: 'invalid_signed_payload' };
  }

  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return { ok: false, reason: 'evaluation_expired' };
  }
  if (payload.shopDomain !== shopDomain) {
    return { ok: false, reason: 'shop_domain_mismatch' };
  }

  const expected = await computeHmacSha256Hex(
    store.tenant_signing_key,
    signedEvaluationMessage(payload),
  );
  if (!timingSafeEqual(expected, payload.signature.toLowerCase())) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const orderCurrency = order['currency'];
  if (typeof orderCurrency === 'string' && orderCurrency !== payload.currency) {
    return { ok: false, reason: 'currency_mismatch' };
  }

  const orderCheckoutToken = order['checkout_token'];
  if (
    typeof orderCheckoutToken === 'string'
    && !payload.checkoutToken?.startsWith('checkout:')
    && payload.checkoutToken !== orderCheckoutToken
  ) {
    return { ok: false, reason: 'checkout_token_mismatch' };
  }

  const orderSubtotal = paymentMinorUnits(
    order['current_subtotal_price'] ?? order['subtotal_price'],
  );
  if (orderSubtotal !== null && orderSubtotal !== payload.subtotalMinorUnits) {
    return { ok: false, reason: 'subtotal_mismatch' };
  }

  const totalDiscounts = paymentMinorUnits(order['total_discounts']);
  if (totalDiscounts !== null && totalDiscounts < payload.discountMinorUnits) {
    return { ok: false, reason: 'discount_not_applied' };
  }

  const applications = order['discount_applications'];
  if (Array.isArray(applications)) {
    const applied = applications.some(application => {
      if (!application || typeof application !== 'object') return false;
      const title = (application as { title?: unknown }).title;
      return title === 'Incentives Automatic Discounts'
        || title === 'Incentives Discount';
    });
    if (!applied) {
      return { ok: false, reason: 'discount_not_applied' };
    }
  }

  return { ok: true };
}

export async function processOrderPaid(
  env: Env,
  shopDomain: string,
  order: Record<string, unknown>,
): Promise<OrderPaidResult> {
  const extracted = extractIncentivesEval(order['note_attributes']);
  if (!extracted) {
    return {
      received: true,
      skipped: true,
      reason: 'no_incentives_eval',
    };
  }

  const store = await findInstalledShop(env.DB, shopDomain, env);
  if (!store) {
    return {
      received: true,
      skipped: true,
      reason: 'shop_not_installed',
    };
  }

  const verification = await verifySignedEvaluation(extracted.raw, store, shopDomain, order);
  if (!verification.ok) {
    return {
      received: true,
      skipped: true,
      reason: verification.reason ?? 'invalid_signed_payload',
    };
  }

  const orderId = order['id'] != null ? String(order['id']) : undefined;
  const adminGraphqlApiId = (order['admin_graphql_api_id'] as string | undefined) ?? orderId;
  const idempotencyKey = `shopify_${orderId ?? crypto.randomUUID()}`;

  const redemptionInput = {
    merchantId: store.tenant_id,
    evaluationId: extracted.evaluationId,
    externalOrderRef: adminGraphqlApiId ?? idempotencyKey,
    idempotencyKey,
    postCaptureReconciliation: true,
  };

  if (typeof env.CORE?.commitRedemption === 'function') {
    const result = (await env.CORE.commitRedemption(redemptionInput)) as Record<string, unknown>;
    return {
      received: true,
      ...result,
    };
  }

  return {
    received: true,
    status: 'committed',
    idempotencyKey,
  };
}

export interface OrderCancelledResult {
  received: boolean;
  cancelled: boolean;
  orderId?: number | string;
  [key: string]: unknown;
}

export async function processOrderCancelled(
  env: Env,
  shopDomain: string,
  order: Record<string, unknown>,
): Promise<OrderCancelledResult> {
  const store = await findInstalledShop(env.DB, shopDomain, env);
  const orderId = order['id'] as number | string | undefined;
  const idempotencyKey = `shopify_cancel_${orderId ?? crypto.randomUUID()}`;

  if (typeof (env.CORE as Record<string, unknown>)?.['reverseRedemption'] === 'function') {
    await ((env.CORE as Record<string, unknown>)['reverseRedemption'] as (arg: unknown) => Promise<unknown>)({
      orderId,
      idempotencyKey,
      merchantId: store?.tenant_id,
      cancelledAt: order['cancelled_at'],
      cancelReason: order['cancel_reason'],
    });
  } else if (typeof (env.CORE as Record<string, unknown>)?.['cancelRedemption'] === 'function') {
    await ((env.CORE as Record<string, unknown>)['cancelRedemption'] as (arg: unknown) => Promise<unknown>)({
      orderId,
      idempotencyKey,
      merchantId: store?.tenant_id,
    });
  }

  return {
    received: true,
    cancelled: true,
    ...(orderId !== undefined ? { orderId } : {}),
  };
}

export interface RefundCreateResult {
  received: boolean;
  refunded: boolean;
  refundId?: number | string;
  [key: string]: unknown;
}

export async function processRefundCreated(
  env: Env,
  shopDomain: string,
  refund: Record<string, unknown>,
): Promise<RefundCreateResult> {
  const store = await findInstalledShop(env.DB, shopDomain, env);
  const refundId = refund['id'] as number | string | undefined;
  const orderId = refund['order_id'] as number | string | undefined;

  if (typeof (env.CORE as Record<string, unknown>)?.['refundRedemption'] === 'function') {
    await ((env.CORE as Record<string, unknown>)['refundRedemption'] as (arg: unknown) => Promise<unknown>)({
      refundId,
      orderId,
      merchantId: store?.tenant_id,
      refundLineItems: refund['refund_line_items'],
    });
  }

  return {
    received: true,
    refunded: true,
    ...(refundId !== undefined ? { refundId } : {}),
  };
}

export interface AppUninstalledResult {
  received: boolean;
  deactivated: boolean;
  shopDomain?: string;
}

export async function processAppUninstalled(
  env: Env,
  shopDomain: string,
): Promise<AppUninstalledResult> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE shopify_installed_shops
     SET status = 'uninstalled', uninstalled_at = ?, updated_at = ?
     WHERE shop_domain = ?`,
  )
    .bind(now, now, shopDomain)
    .run();

  return {
    received: true,
    deactivated: true,
    ...(shopDomain ? { shopDomain } : {}),
  };
}


export interface CustomerUpdateResult {
  received: boolean;
  synced: boolean;
  customerRef?: string;
  [key: string]: unknown;
}

export async function processCustomerUpdate(
  env: Env,
  shopDomain: string,
  customer: Record<string, unknown>,
): Promise<CustomerUpdateResult> {
  const store = await findInstalledShop(env.DB, shopDomain, env);
  const customerGid =
    typeof customer['admin_graphql_api_id'] === 'string'
      ? customer['admin_graphql_api_id']
      : customer['id'] != null
        ? `gid://shopify/Customer/${String(customer['id'])}`
        : (customer['email'] as string | undefined);
  const customerRef = customerGid ?? 'unknown';

  if (typeof (env.CORE as Record<string, unknown>)?.['upsertCustomer'] === 'function') {
    const operatorContext = {
      correlationId: crypto.randomUUID(),
      actorUserId: 'system:shopify-connector',
      actorKind: 'root' as const,
      merchantId: store?.tenant_id ?? `shop_${shopDomain.replace(/[^a-zA-Z0-9]/g, '_')}`,
      permission: 'customers:manage' as const,
    };

    const customerPatch = {
      attributes: {
        email: customer['email'],
        firstName: customer['first_name'],
        lastName: customer['last_name'],
        tags: customer['tags'],
        ordersCount: customer['orders_count'],
        totalSpent: customer['total_spent'],
      },
    };

    await ((env.CORE as Record<string, unknown>)['upsertCustomer'] as (
      ctx: unknown,
      ref: string,
      patch: unknown,
    ) => Promise<unknown>)(operatorContext, customerRef, customerPatch);
  }

  return {
    received: true,
    synced: true,
    ...(customerRef !== undefined ? { customerRef } : {}),
  };
}
