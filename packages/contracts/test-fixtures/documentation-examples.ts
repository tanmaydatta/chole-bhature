import type {
  CustomerSnapshot,
  EvaluationRequest,
  IncentiveDecision,
  VariableDefinition,
} from '../src/index.js';

export const canonicalVariableDefinitions = [
  {
    key: 'customer.tier',
    label: 'Customer tier',
    source: 'customer',
    type: 'enum',
    required: true,
    enumValues: ['bronze', 'silver', 'gold'],
  },
  {
    key: 'context.channel',
    label: 'Sales channel',
    source: 'context',
    type: 'enum',
    required: true,
    enumValues: ['web', 'mobile'],
  },
  {
    key: 'cart.delivery_country',
    label: 'Delivery country',
    source: 'cart',
    type: 'string',
    required: false,
  },
  {
    key: 'line_item.category',
    label: 'Product category',
    source: 'line_item',
    type: 'string',
    required: false,
  },
] as const satisfies readonly VariableDefinition[];

export const canonicalCustomer = {
  externalRef: 'customer-123',
  attributes: {
    tier: 'gold',
    first_purchase: false,
  },
} as const satisfies CustomerSnapshot;

export const canonicalEvaluationRequest = {
  customerRef: 'customer-123',
  code: 'WELCOME10',
  cart: {
    currency: 'GBP',
    subtotal: 6_500,
    items: [{
      productRef: 'product-456',
      variantRef: 'variant-789',
      quantity: 1,
      unitPrice: 6_500,
      attributes: { category: 'shoes' },
    }],
    attributes: { delivery_country: 'GB' },
  },
  context: { channel: 'web' },
} as const satisfies EvaluationRequest;

export const canonicalDecision = {
  programRef: 'welcome-10',
  programType: 'promo',
  outcome: 'qualified',
  effects: [{
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 1_000 },
  }],
  reasonCodes: [],
  message: 'You received GBP 10.00 off',
  commitRequired: true,
  eligible: true,
} as const satisfies IncentiveDecision;
