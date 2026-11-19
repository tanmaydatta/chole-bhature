import { describe, expect, it } from 'vitest';
import type { IncentiveDecision, OrderSnapshot } from '@incentives/contracts';
import {
  type ConnectorFixture,
  UnsupportedConnectorCapabilityError,
  runConnectorConformanceSuite,
} from '@incentives/connector-kit';

import {
  type ShopifyCart,
  type ShopifyCustomer,
  type ShopifyDecision,
  type ShopifyDiscount,
  type ShopifyOrder,
  computeShopifyHmac,
  createShopifyConnector,
} from './index.js';

const TEST_SECRET = 'shopify_test_app_secret_abc123';

const evaluatedDecision: IncentiveDecision = {
  programRef: 'shopify-welcome-promo',
  programRevision: 1,
  programType: 'promo',
  outcome: 'qualified',
  rewardRuleRef: 'welcome-discount-rule',
  effects: [
    {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'USD', minorUnits: 2000 },
    },
  ],
  reasonCodes: [],
  commitRequired: true,
  eligible: true,
};

function mapExpectedDiscounts(decision: IncentiveDecision): ShopifyDiscount[] {
  return decision.effects.map((effect): ShopifyDiscount => {
    switch (effect.type) {
      case 'order_discount':
        return effect.calculation === 'fixed'
          ? {
              type: 'order_discount',
              calculation: 'fixed',
              amount: {
                currency: effect.amount.currency,
                minorUnits: effect.amount.minorUnits,
              },
            }
          : {
              type: 'order_discount',
              calculation: 'percent',
              basisPoints: effect.basisPoints,
            };
      case 'line_item_discount':
        return effect.calculation === 'fixed'
          ? {
              type: 'line_item_discount',
              productRef: effect.productRef,
              calculation: 'fixed',
              amount: {
                currency: effect.amount.currency,
                minorUnits: effect.amount.minorUnits,
              },
            }
          : {
              type: 'line_item_discount',
              productRef: effect.productRef,
              calculation: 'percent',
              basisPoints: effect.basisPoints,
            };
      case 'free_shipping':
        return { type: 'free_shipping' };
      default:
        throw new Error(`Unsupported effect in test fixture: ${(effect as { type: string }).type}`);
    }
  });
}

async function createShopifyFixture(): Promise<{
  connector: ReturnType<typeof createShopifyConnector>;
  fixture: ConnectorFixture<ShopifyCustomer, ShopifyCart, ShopifyOrder, ShopifyDecision>;
}> {
  const connector = createShopifyConnector({ secret: TEST_SECRET });
  const trace: string[] = [];

  const rawValidBody = JSON.stringify({ event: 'orders/paid', shop: 'quickstart.myshopify.com' });
  const validSignature = await computeShopifyHmac(TEST_SECRET, rawValidBody);

  const fixture: ConnectorFixture<ShopifyCustomer, ShopifyCart, ShopifyOrder, ShopifyDecision> = {
    customerInput: {
      id: 'gid://shopify/Customer/12345678',
      attributes: {
        tier: 'vip_gold',
        sentinel: 'shopify-customer-sentinel-8f92a1',
      },
    },
    cartInput: {
      currency: 'USD',
      subtotal: 12000,
      lines: [
        {
          id: 'gid://shopify/CartLine/1',
          lineRef: 'gid://shopify/CartLine/1',
          productRef: 'gid://shopify/Product/999',
          variantRef: 'gid://shopify/ProductVariant/888',
          quantity: 2,
          unitPrice: 6000,
        },
      ],
    },
    orderInput: {
      id: 'gid://shopify/Order/777',
      externalRef: 'gid://shopify/Order/777',
      idempotencyKey: 'shopify_order_777',
      currency: 'USD',
      total: 10000,
      customerRef: 'gid://shopify/Customer/12345678',
      items: [
        {
          id: 'gid://shopify/LineItem/1',
          lineRef: 'gid://shopify/LineItem/1',
          productRef: 'gid://shopify/Product/999',
          variantRef: 'gid://shopify/ProductVariant/888',
          quantity: 2,
          unitPrice: 5000,
        },
      ],
    },
    expectedCustomerRef: 'gid://shopify/Customer/12345678',
    expectedCustomerAttributes: {
      tier: 'vip_gold',
      sentinel: 'shopify-customer-sentinel-8f92a1',
    },
    customerOnlyAttributeSentinels: ['shopify-customer-sentinel-8f92a1'],
    expectedOrderRef: 'gid://shopify/Order/777',
    expectedOrderCustomerRef: 'gid://shopify/Customer/12345678',
    expectedIdempotencyKey: 'shopify_order_777',
    expectedCartLineRefs: [
      {
        lineRef: 'gid://shopify/CartLine/1',
        productRef: 'gid://shopify/Product/999',
        variantRef: 'gid://shopify/ProductVariant/888',
      },
    ],
    expectedOrderLineRefs: [
      {
        lineRef: 'gid://shopify/LineItem/1',
        productRef: 'gid://shopify/Product/999',
        variantRef: 'gid://shopify/ProductVariant/888',
      },
    ],
    validRequest: new Request('https://quickstart.myshopify.com/webhooks/orders-paid', {
      method: 'POST',
      headers: {
        'x-shopify-hmac-sha256': validSignature,
        'content-type': 'application/json',
      },
      body: rawValidBody,
    }),
    invalidRequest: new Request('https://quickstart.myshopify.com/webhooks/orders-paid', {
      method: 'POST',
      headers: {
        'x-shopify-hmac-sha256': 'd3JvbmdfaG1hY19zaWduYXR1cmVfZm9yX3Rlc3Q=',
        'content-type': 'application/json',
      },
      body: rawValidBody,
    }),
    trace,
    async evaluate() {
      return evaluatedDecision;
    },
    assertMappedDecision(decision, mappedDecision) {
      expect(mappedDecision).toEqual({
        programRef: decision.programRef,
        outcome: decision.outcome,
        discounts: mapExpectedDiscounts(decision),
      });
    },
    async apply(_mappedDecision) {},
    async commit(order: OrderSnapshot) {
      expect(order.externalRef).toBe('gid://shopify/Order/777');
      expect(order.idempotencyKey).toBe('shopify_order_777');
    },
    async capturePayment() {},
  };

  return { connector, fixture };
}

describe('Shopify Connector Conformance Suite', () => {
  it('passes the strict connector conformance suite', async () => {
    const { connector, fixture } = await createShopifyFixture();

    const result = await runConnectorConformanceSuite(connector, fixture);
    expect(result).toEqual({ passed: true });
    expect(fixture.trace).toEqual(['evaluate', 'map', 'apply', 'commit', 'capture']);
  });

  it('declares exact Shopify Plus capabilities', () => {
    const connector = createShopifyConnector({ secret: TEST_SECRET });
    expect(connector.capabilities()).toEqual({
      automaticDiscounts: true,
      discountCodes: true,
      lineItemAdjustments: true,
      checkoutBlocking: true,
      customerAttributes: true,
      orderWebhooks: true,
      walletRedemption: false,
    });
  });

  describe('normalizeCustomer', () => {
    it('normalizes customer tags and attributes into CustomerSnapshot', () => {
      const connector = createShopifyConnector();
      const snapshot = connector.normalizeCustomer({
        id: 'gid://shopify/Customer/999',
        tags: ['vip', 'repeat-buyer'],
        email: 'shopper@example.com',
        ordersCount: 5,
        totalSpent: '499.50',
      });

      expect(snapshot).toEqual({
        externalRef: 'gid://shopify/Customer/999',
        attributes: {
          tags: ['vip', 'repeat-buyer'],
          email: 'shopper@example.com',
          ordersCount: 5,
          totalSpent: '499.50',
        },
      });
    });
  });

  describe('normalizeCart', () => {
    it('normalizes Shopify Storefront GraphQL cart format with line items', () => {
      const connector = createShopifyConnector();
      const snapshot = connector.normalizeCart({
        id: 'gid://shopify/Cart/c1-12345',
        cost: {
          subtotalAmount: {
            amount: '120.00',
            currencyCode: 'USD',
          },
        },
        lines: [
          {
            id: 'gid://shopify/CartLine/1',
            quantity: 2,
            cost: {
              amountPerQuantity: {
                amount: '60.00',
                currencyCode: 'USD',
              },
            },
            merchandise: {
              id: 'gid://shopify/ProductVariant/888',
              product: {
                id: 'gid://shopify/Product/999',
              },
            },
          },
        ],
      });

      expect(snapshot).toEqual({
        currency: 'USD',
        subtotal: 12000,
        items: [
          {
            lineRef: 'gid://shopify/CartLine/1',
            productRef: 'gid://shopify/Product/999',
            variantRef: 'gid://shopify/ProductVariant/888',
            quantity: 2,
            unitPrice: 6000,
          },
        ],
      });
    });
  });

  describe('normalizeOrder', () => {
    it('normalizes Shopify webhook orders/paid payload format', () => {
      const connector = createShopifyConnector();
      const snapshot = connector.normalizeOrder({
        id: 555666777,
        admin_graphql_api_id: 'gid://shopify/Order/555666777',
        currency: 'USD',
        total_price: '150.00',
        customer: {
          id: 111222,
          admin_graphql_api_id: 'gid://shopify/Customer/111222',
        },
        line_items: [
          {
            id: 98765,
            product_id: 456,
            variant_id: 789,
            quantity: 3,
            price: '50.00',
          },
        ],
      });

      expect(snapshot).toEqual({
        externalRef: 'gid://shopify/Order/555666777',
        idempotencyKey: 'shopify_555666777',
        currency: 'USD',
        total: 15000,
        customerRef: 'gid://shopify/Customer/111222',
        items: [
          {
            lineRef: '98765',
            productRef: '456',
            variantRef: '789',
            quantity: 3,
            unitPrice: 5000,
          },
        ],
      });
    });
  });

  describe('mapDecision', () => {
    it('throws UnsupportedConnectorCapabilityError on wallet debit/credit', () => {
      const connector = createShopifyConnector();

      expect(() =>
        connector.mapDecision({
          ...evaluatedDecision,
          effects: [
            {
              type: 'wallet_debit',
              amount: { currency: 'USD', minorUnits: 500 },
            },
          ],
        }),
      ).toThrow(UnsupportedConnectorCapabilityError);
    });
  });

  describe('verifyIncomingRequest', () => {
    it('rejects missing signature header', async () => {
      const connector = createShopifyConnector({ secret: TEST_SECRET });
      const request = new Request('https://quickstart.myshopify.com/webhooks/orders-paid', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
      });

      const result = await connector.verifyIncomingRequest(request);
      expect(result.verified).toBe(false);
    });

    it('rejects forged signature', async () => {
      const connector = createShopifyConnector({ secret: TEST_SECRET });
      const request = new Request('https://quickstart.myshopify.com/webhooks/orders-paid', {
        method: 'POST',
        headers: {
          'x-shopify-hmac-sha256': 'invalid_signature_base64',
        },
        body: JSON.stringify({ test: true }),
      });

      const result = await connector.verifyIncomingRequest(request);
      expect(result.verified).toBe(false);
    });
  });
});
