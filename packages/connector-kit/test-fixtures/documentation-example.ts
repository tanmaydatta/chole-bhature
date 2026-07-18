import type {
  IncentiveDecision,
  OrderSnapshot,
} from '@incentives/contracts';
import type {
  CommerceConnector,
  ConnectorCapabilities,
  ConnectorFixture,
} from '../src/index.js';
import { UnsupportedConnectorCapabilityError } from '../src/index.js';

interface ExampleCustomer {
  id: string;
  attributes: Record<string, unknown>;
}

interface ExampleCart {
  currency: string;
  subtotal: number;
  productId: string;
  variantId: string;
}

interface ExampleOrder extends ExampleCart {
  id: string;
  customerId: string;
  idempotencyKey: string;
  total: number;
}

interface ExampleAdjustment {
  effectType: 'order_discount' | 'free_shipping';
}

export const exampleConnectorCapabilities = {
  automaticDiscounts: true,
  discountCodes: true,
  lineItemAdjustments: false,
  checkoutBlocking: true,
  customerAttributes: true,
  orderWebhooks: true,
  walletRedemption: false,
} as const satisfies ConnectorCapabilities;

const exampleDecision = {
  programRef: 'welcome-10',
  programType: 'promo',
  outcome: 'qualified',
  effects: [{
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 1_000 },
  }],
  reasonCodes: [],
  commitRequired: true,
  eligible: true,
} as const satisfies IncentiveDecision;

function mapDecision(decision: IncentiveDecision): ExampleAdjustment[] {
  const unsupportedEffect = decision.effects.find(effect => (
    effect.type !== 'order_discount' && effect.type !== 'free_shipping'
  ));
  if (unsupportedEffect !== undefined) {
    throw new UnsupportedConnectorCapabilityError(unsupportedEffect.type);
  }
  return decision.effects.map(effect => ({
    effectType: effect.type as ExampleAdjustment['effectType'],
  }));
}

export const exampleConformanceValues = {
  customerInput: {
    id: ' Customer::001 ',
    attributes: { tier: 'gold', sentinel: 'customer-only::docs-v1' },
  },
  cartInput: {
    currency: 'GBP',
    subtotal: 6_500,
    productId: ' Product::001 ',
    variantId: ' Variant::001 ',
  },
  orderInput: {
    id: ' Order::001 ',
    customerId: ' Customer::001 ',
    idempotencyKey: ' Idempotency::001 ',
    currency: 'GBP',
    subtotal: 6_500,
    total: 5_500,
    productId: ' Product::001 ',
    variantId: ' Variant::001 ',
  },
  customerSentinel: 'customer-only::docs-v1',
  orderRef: ' Order::001 ',
  idempotencyKey: ' Idempotency::001 ',
} as const;

export function createDocumentationConnector(): CommerceConnector<
  ExampleCustomer,
  ExampleCart,
  ExampleOrder,
  ExampleAdjustment[]
> {
  return {
    capabilities: () => exampleConnectorCapabilities,
    normalizeCustomer: input => ({
      externalRef: input.id,
      attributes: input.attributes,
    }),
    normalizeCart: input => ({
      currency: input.currency,
      subtotal: input.subtotal,
      items: [{
        productRef: input.productId,
        variantRef: input.variantId,
        quantity: 1,
        unitPrice: input.subtotal,
      }],
    }),
    normalizeOrder: input => ({
      externalRef: input.id,
      idempotencyKey: input.idempotencyKey,
      currency: input.currency,
      total: input.total,
      customerRef: input.customerId,
      items: [{
        productRef: input.productId,
        variantRef: input.variantId,
        quantity: 1,
        unitPrice: input.total,
      }],
    }),
    mapDecision,
    async verifyIncomingRequest(request) {
      return { verified: request.headers.get('x-example-signature') === 'valid' };
    },
  };
}

export function createDocumentationConnectorHarness(): {
  connector: CommerceConnector<ExampleCustomer, ExampleCart, ExampleOrder, ExampleAdjustment[]>;
  fixture: ConnectorFixture<ExampleCustomer, ExampleCart, ExampleOrder, ExampleAdjustment[]>;
} {
  const trace: string[] = [];
  const connector = createDocumentationConnector();

  const fixture: ConnectorFixture<
    ExampleCustomer,
    ExampleCart,
    ExampleOrder,
    ExampleAdjustment[]
  > = {
    customerInput: exampleConformanceValues.customerInput,
    cartInput: exampleConformanceValues.cartInput,
    orderInput: exampleConformanceValues.orderInput,
    expectedCustomerRef: exampleConformanceValues.customerInput.id,
    expectedCustomerAttributes: exampleConformanceValues.customerInput.attributes,
    customerOnlyAttributeSentinels: [exampleConformanceValues.customerSentinel],
    expectedOrderRef: exampleConformanceValues.orderRef,
    expectedOrderCustomerRef: exampleConformanceValues.orderInput.customerId,
    expectedIdempotencyKey: exampleConformanceValues.idempotencyKey,
    expectedCartLineRefs: [{
      productRef: ' Product::001 ',
      variantRef: ' Variant::001 ',
    }],
    expectedOrderLineRefs: [{
      productRef: ' Product::001 ',
      variantRef: ' Variant::001 ',
    }],
    validRequest: new Request('https://example.test/webhook', {
      headers: { 'x-example-signature': 'valid' },
    }),
    invalidRequest: new Request('https://example.test/webhook', {
      headers: { 'x-example-signature': 'invalid' },
    }),
    trace,
    async evaluate() {
      return exampleDecision;
    },
    async apply(_mappedDecision) {},
    async commit(order: OrderSnapshot) {
      if (order.idempotencyKey !== exampleConformanceValues.idempotencyKey) {
        throw new Error('Idempotency key changed before commit');
      }
    },
    async capturePayment() {},
  };

  return { connector, fixture };
}
