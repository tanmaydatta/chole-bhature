import type {
  CartLineItem,
  CartSnapshot,
  CustomerSnapshot,
  Effect,
  IncentiveDecision,
  OrderSnapshot,
} from '@incentives/contracts';
import type {
  CommerceConnector,
  ConnectorCapabilities,
  VerificationResult,
} from '@incentives/connector-kit';
import { UnsupportedConnectorCapabilityError } from '@incentives/connector-kit';

import type {
  ShopifyCart,
  ShopifyCartLine,
  ShopifyCustomer,
  ShopifyDecision,
  ShopifyDiscount,
  ShopifyOrder,
  ShopifyOrderLine,
  ShopifyConnectorOptions,
} from './types.js';

export const SHOPIFY_CONNECTOR_CAPABILITIES: ConnectorCapabilities = {
  automaticDiscounts: true,
  discountCodes: true,
  lineItemAdjustments: true,
  checkoutBlocking: true,
  customerAttributes: true,
  orderWebhooks: true,
  walletRedemption: false,
} as const;

export function parseMoneyToMinorUnits(value: number | string | undefined, defaultVal = 0): number {
  if (value === undefined || value === null) {
    return defaultVal;
  }
  if (typeof value === 'number') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultVal;
  }
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    const whole = parseInt(parts[0] || '0', 10);
    const frac = (parts[1] || '').padEnd(2, '0').slice(0, 2);
    const sign = whole < 0 || trimmed.startsWith('-') ? -1 : 1;
    return Math.abs(whole) * 100 + parseInt(frac, 10) * sign;
  }
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? defaultVal : parsed;
}

function normalizeAttributes(
  attributes:
    | Readonly<Record<string, unknown>>
    | readonly { readonly key: string; readonly value: unknown }[]
    | undefined,
): Record<string, unknown> | undefined {
  if (attributes === undefined) {
    return undefined;
  }
  if (Array.isArray(attributes)) {
    const record: Record<string, unknown> = {};
    for (const attr of attributes) {
      if (attr && typeof attr.key === 'string') {
        record[attr.key] = attr.value;
      }
    }
    return record;
  }
  return { ...attributes };
}

export function normalizeCustomer(input: ShopifyCustomer): CustomerSnapshot {
  const attributes: Record<string, unknown> = {
    ...input.attributes,
  };
  if (input.tags !== undefined && !('tags' in attributes)) {
    attributes.tags = input.tags;
  }
  if (input.email !== undefined && !('email' in attributes)) {
    attributes.email = input.email;
  }
  if (input.firstName !== undefined && !('firstName' in attributes)) {
    attributes.firstName = input.firstName;
  }
  if (input.lastName !== undefined && !('lastName' in attributes)) {
    attributes.lastName = input.lastName;
  }
  if (input.ordersCount !== undefined && !('ordersCount' in attributes)) {
    attributes.ordersCount = input.ordersCount;
  }
  if (input.totalSpent !== undefined && !('totalSpent' in attributes)) {
    attributes.totalSpent = input.totalSpent;
  }

  return {
    externalRef: input.id,
    attributes,
  };
}

function normalizeCartLine(
  line: ShopifyCartLine,
  index: number,
  fallbackSubtotal: number,
  lineCount: number,
): CartLineItem {
  const lineRef = line.lineRef
    ?? line.lineId
    ?? (line.id !== undefined ? String(line.id) : `line_${index + 1}`);

  const productRef = line.productRef
    ?? line.productId
    ?? line.merchandise?.product?.id
    ?? `product_${index + 1}`;

  const variantRef = line.variantRef
    ?? line.variantId
    ?? line.merchandise?.id;

  const quantity = line.quantity ?? 1;

  const rawUnitPrice = line.unitPrice
    ?? line.price
    ?? line.cost?.amountPerQuantity?.amount
    ?? (line.cost?.subtotalAmount?.amount !== undefined
      ? parseMoneyToMinorUnits(line.cost.subtotalAmount.amount) / quantity
      : lineCount === 1 && fallbackSubtotal > 0
        ? fallbackSubtotal / quantity
        : 0);

  const unitPrice = parseMoneyToMinorUnits(rawUnitPrice);
  const lineAttributes = normalizeAttributes(line.attributes);

  return {
    lineRef,
    productRef,
    ...(variantRef !== undefined ? { variantRef } : {}),
    quantity,
    unitPrice,
    ...(lineAttributes !== undefined && Object.keys(lineAttributes).length > 0
      ? { attributes: lineAttributes }
      : {}),
  };
}

export function normalizeCart(input: ShopifyCart): CartSnapshot {
  const currency = input.currency
    ?? input.currencyCode
    ?? input.cost?.subtotalAmount?.currencyCode
    ?? input.cost?.totalAmount?.currencyCode
    ?? 'USD';

  const rawSubtotal = input.subtotal
    ?? input.subtotalAmount
    ?? input.cost?.subtotalAmount?.amount
    ?? input.cost?.totalAmount?.amount
    ?? 0;

  const subtotal = parseMoneyToMinorUnits(rawSubtotal);
  const rawLines = input.lines ?? input.items ?? [];
  const items = rawLines.map((line, index) =>
    normalizeCartLine(line, index, subtotal, rawLines.length),
  );

  const cartAttributes = normalizeAttributes(input.attributes);

  return {
    currency,
    subtotal,
    items,
    ...(cartAttributes !== undefined && Object.keys(cartAttributes).length > 0
      ? { attributes: cartAttributes }
      : {}),
  };
}

function normalizeOrderLine(
  line: ShopifyOrderLine,
  index: number,
  fallbackTotal: number,
  lineCount: number,
): CartLineItem {
  const lineRef = line.lineRef
    ?? line.lineId
    ?? (line.id !== undefined ? String(line.id) : `line_${index + 1}`);

  const productRef = line.productRef
    ?? line.productId
    ?? (line.product_id !== undefined ? String(line.product_id) : undefined)
    ?? line.merchandise?.product?.id
    ?? `product_${index + 1}`;

  const variantRef = line.variantRef
    ?? line.variantId
    ?? (line.variant_id !== undefined ? String(line.variant_id) : undefined)
    ?? line.merchandise?.id;

  const quantity = line.quantity ?? 1;

  const rawUnitPrice = line.unitPrice
    ?? line.price
    ?? line.cost?.amountPerQuantity?.amount
    ?? (line.cost?.subtotalAmount?.amount !== undefined
      ? parseMoneyToMinorUnits(line.cost.subtotalAmount.amount) / quantity
      : lineCount === 1 && fallbackTotal > 0
        ? fallbackTotal / quantity
        : 0);

  const unitPrice = parseMoneyToMinorUnits(rawUnitPrice);
  const lineAttributes = normalizeAttributes(line.attributes);

  return {
    lineRef,
    productRef,
    ...(variantRef !== undefined ? { variantRef } : {}),
    quantity,
    unitPrice,
    ...(lineAttributes !== undefined && Object.keys(lineAttributes).length > 0
      ? { attributes: lineAttributes }
      : {}),
  };
}

export function normalizeOrder(input: ShopifyOrder): OrderSnapshot {
  const externalRef = input.externalRef
    ?? input.orderRef
    ?? (input.admin_graphql_api_id !== undefined ? String(input.admin_graphql_api_id) : undefined)
    ?? (input.id !== undefined ? String(input.id) : '');

  const idempotencyKey = input.idempotencyKey
    ?? (input.id !== undefined ? `shopify_${input.id}` : externalRef);

  const currency = input.currency
    ?? input.currencyCode
    ?? input.totalPriceSet?.shopMoney?.currencyCode
    ?? input.cost?.totalAmount?.currencyCode
    ?? 'USD';

  const rawTotal = input.total
    ?? input.totalPrice
    ?? input.total_price
    ?? input.cost?.totalAmount?.amount
    ?? input.totalPriceSet?.shopMoney?.amount
    ?? 0;

  const total = parseMoneyToMinorUnits(rawTotal);

  const customerRef = input.customerRef
    ?? (input.customerId !== undefined ? String(input.customerId) : undefined)
    ?? (input.customer?.admin_graphql_api_id !== undefined
      ? String(input.customer.admin_graphql_api_id)
      : undefined)
    ?? (input.customer?.id !== undefined ? String(input.customer.id) : undefined);

  const rawLines = input.items ?? input.line_items ?? input.lines ?? [];
  const items = rawLines.map((line, index) =>
    normalizeOrderLine(line, index, total, rawLines.length),
  );

  return {
    externalRef,
    idempotencyKey,
    currency,
    total,
    ...(customerRef !== undefined ? { customerRef } : {}),
    items,
  };
}

export function mapDecision(decision: IncentiveDecision): ShopifyDecision {
  for (const effect of decision.effects) {
    if (
      effect.type !== 'order_discount'
      && effect.type !== 'line_item_discount'
      && effect.type !== 'free_shipping'
    ) {
      throw new UnsupportedConnectorCapabilityError(effect.type);
    }
  }

  const discounts: ShopifyDiscount[] = decision.effects.map((effect): ShopifyDiscount => {
    switch (effect.type) {
      case 'order_discount':
        if (effect.calculation === 'fixed') {
          return {
            type: 'order_discount',
            calculation: 'fixed',
            amount: {
              currency: effect.amount.currency,
              minorUnits: effect.amount.minorUnits,
            },
          };
        }
        return {
          type: 'order_discount',
          calculation: 'percent',
          basisPoints: effect.basisPoints,
          ...(effect.maximumDiscountAmount !== undefined
            ? {
                maximumDiscountAmount: {
                  currency: effect.maximumDiscountAmount.currency,
                  minorUnits: effect.maximumDiscountAmount.minorUnits,
                },
              }
            : {}),
        };
      case 'line_item_discount':
        if (effect.calculation === 'fixed') {
          return {
            type: 'line_item_discount',
            productRef: effect.productRef,
            calculation: 'fixed',
            amount: {
              currency: effect.amount.currency,
              minorUnits: effect.amount.minorUnits,
            },
          };
        }
        return {
          type: 'line_item_discount',
          productRef: effect.productRef,
          calculation: 'percent',
          basisPoints: effect.basisPoints,
          ...(effect.maximumDiscountAmount !== undefined
            ? {
                maximumDiscountAmount: {
                  currency: effect.maximumDiscountAmount.currency,
                  minorUnits: effect.maximumDiscountAmount.minorUnits,
                },
              }
            : {}),
        };
      case 'free_shipping':
        return {
          type: 'free_shipping',
        };
      default:
        throw new UnsupportedConnectorCapabilityError((effect as Effect).type);
    }
  });

  return {
    programRef: decision.programRef,
    outcome: decision.outcome,
    discounts,
  };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function computeShopifyHmac(
  secret: string,
  body: string | ArrayBuffer | Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  let bodyBuffer: BufferSource;
  if (typeof body === 'string') {
    bodyBuffer = encoder.encode(body);
  } else if (body instanceof ArrayBuffer) {
    bodyBuffer = body;
  } else {
    bodyBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }
  const signature = await crypto.subtle.sign('HMAC', key, bodyBuffer);
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function verifyShopifyWebhookRequest(
  request: Request,
  secret: string,
): Promise<VerificationResult> {
  try {
    const hmacHeader = request.headers.get('x-shopify-hmac-sha256')
      ?? request.headers.get('X-Shopify-Hmac-Sha256');
    if (!hmacHeader) {
      return { verified: false };
    }

    const cloned = request.clone();
    const bodyBuffer = await cloned.arrayBuffer();
    const expectedBase64 = await computeShopifyHmac(secret, bodyBuffer);

    if (timingSafeEqual(hmacHeader, expectedBase64)) {
      return { verified: true };
    }

    // Also support hex encoding in case of non-standard webhook client signature
    const keyData = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, bodyBuffer);
    const hexDigest = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (timingSafeEqual(hmacHeader.toLowerCase(), hexDigest.toLowerCase())) {
      return { verified: true };
    }

    return { verified: false };
  } catch {
    return { verified: false };
  }
}

export function createShopifyConnector(
  options: ShopifyConnectorOptions = {},
): CommerceConnector<ShopifyCustomer, ShopifyCart, ShopifyOrder, ShopifyDecision> {
  const envSecret = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.['SHOPIFY_CLIENT_SECRET'];
  const secret = options.secret ?? envSecret ?? 'shopify-connector-secret';

  return {
    capabilities() {
      return SHOPIFY_CONNECTOR_CAPABILITIES;
    },
    normalizeCustomer,
    normalizeCart,
    normalizeOrder,
    mapDecision,
    async verifyIncomingRequest(request: Request) {
      return verifyShopifyWebhookRequest(request, secret);
    },
  };
}
