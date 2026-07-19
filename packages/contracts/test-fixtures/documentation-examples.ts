import type {
  ApiError,
  CustomerPatchRequest,
  CustomerSnapshot,
  EvaluationRequest,
  EvaluationResponse,
  IncentiveDecision,
  PromoProgram,
  RedemptionRequest,
  RedemptionResponse,
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
  rewardRuleRef: 'default-reward',
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

export const canonicalCustomerPatch = {
  attributes: { tier: 'gold' },
} as const satisfies CustomerPatchRequest;

export const canonicalVersionedCustomerPatch = {
  attributes: { tier: 'silver' },
  expectedVersion: 1,
} as const satisfies CustomerPatchRequest;

export const canonicalTwoTierPromo = {
  id: 'gold-web-rewards',
  type: 'promo',
  name: 'Gold web rewards',
  status: 'active',
  eligibility: {
    match: 'ALL',
    conditions: [
      {
        id: 'gold-tier',
        variable: 'customer.tier',
        operator: 'eq',
        value: 'gold',
      },
      {
        id: 'web-channel',
        variable: 'context.channel',
        operator: 'eq',
        value: 'web',
      },
    ],
  },
  rewardRules: [
    {
      id: 'large-cart-20-percent',
      name: 'Twenty percent off large carts',
      conditions: {
        match: 'ALL',
        conditions: [{
          id: 'cart-at-least-100',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 10_000,
        }],
      },
      reward: {
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 2_000,
      },
    },
    {
      id: 'medium-cart-10-off',
      name: 'Ten pounds off medium carts',
      conditions: {
        match: 'ALL',
        conditions: [{
          id: 'cart-at-least-50',
          variable: 'cart.subtotal',
          operator: 'gte',
          value: 5_000,
        }],
      },
      reward: {
        type: 'order_discount',
        calculation: 'fixed',
        amount: { currency: 'GBP', minorUnits: 1_000 },
      },
    },
  ],
  fallbackReward: {
    id: 'fallback-5-off',
    name: 'Fallback five pounds off',
    reward: {
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    },
  },
  budget: { currency: 'GBP', minorUnits: 100_000 },
  usageCap: 100,
  perCustomerCap: 1,
  stackable: false,
  priority: 10,
  autoApply: true,
} as const satisfies PromoProgram;

export const canonicalTwoTierEvaluationRequest = {
  customerRef: 'customer-123',
  cart: {
    currency: 'GBP',
    subtotal: 12_500,
    items: [],
  },
  context: { channel: 'web' },
} as const satisfies EvaluationRequest;

const canonicalEvaluationResponseBase = {
  evaluationId: 'evaluation-789',
  customerRef: 'customer-123',
  customerVersion: 1,
  schemaVersion: 1,
  expiresAt: '2026-07-19T10:05:00.000Z',
} as const;

export const canonicalFirstMatchResponse = {
  ...canonicalEvaluationResponseBase,
  decisions: [{
    programRef: 'gold-web-rewards',
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef: 'large-cart-20-percent',
    effects: [{
      type: 'order_discount',
      calculation: 'percent',
      basisPoints: 2_000,
    }],
    reasonCodes: [],
    message: 'You received 20% off.',
    commitRequired: true,
    eligible: true,
  }],
} as const satisfies EvaluationResponse;

export const canonicalFallbackResponse = {
  ...canonicalEvaluationResponseBase,
  decisions: [{
    programRef: 'gold-web-rewards',
    programType: 'promo',
    outcome: 'qualified',
    rewardRuleRef: 'fallback-5-off',
    effects: [{
      type: 'order_discount',
      calculation: 'fixed',
      amount: { currency: 'GBP', minorUnits: 500 },
    }],
    reasonCodes: [],
    message: 'You received GBP 5.00 off.',
    commitRequired: true,
    eligible: true,
  }],
} as const satisfies EvaluationResponse;

export const canonicalNoMatchResponse = {
  ...canonicalEvaluationResponseBase,
  decisions: [{
    programRef: 'gold-web-rewards-no-fallback',
    programType: 'promo',
    outcome: 'not_qualified',
    effects: [],
    reasonCodes: ['NO_REWARD_RULE_MATCHED'],
    message: 'No reward rule matched.',
    commitRequired: false,
    eligible: false,
  }],
} as const satisfies EvaluationResponse;

export const canonicalRedemptionRequest = {
  evaluationId: 'evaluation-789',
  programRef: 'gold-web-rewards',
  externalOrderRef: 'order-456',
  idempotencyKey: 'checkout-attempt-abc',
} as const satisfies RedemptionRequest;

export const canonicalCommittedRedemption = {
  redemptionId: 'redemption-123',
  evaluationId: 'evaluation-789',
  programRef: 'gold-web-rewards',
  rewardRuleRef: 'large-cart-20-percent',
  externalOrderRef: 'order-456',
  idempotencyKey: 'checkout-attempt-abc',
  status: 'committed',
  effects: [{
    type: 'order_discount',
    calculation: 'percent',
    basisPoints: 2_000,
  }],
} as const satisfies RedemptionResponse;

export const canonicalApiError = {
  error: {
    code: 'CONTEXT_VALIDATION_FAILED',
    message: 'The request context failed validation',
    correlationId: 'correlation-123',
    retryable: false,
    fields: [{
      path: 'context.channel',
      code: 'invalid_value',
      message: 'Expected one of: web, mobile',
    }],
  },
} as const satisfies ApiError;
