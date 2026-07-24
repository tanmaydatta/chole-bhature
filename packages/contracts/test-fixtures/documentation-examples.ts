import type {
  ApiCredentialView,
  ApiError,
  AuditEntry,
  CustomerPatchRequest,
  CustomerSnapshot,
  EvaluationRequest,
  EvaluationResponse,
  IncentiveDecision,
  OperatorCallContext,
  OperatorPrincipal,
  ProgramLifecycle,
  ProgramRevision,
  PromoProgram,
  RedemptionRequest,
  RedemptionResponse,
  VariableDefinition,
} from '../src/index.js';

export const canonicalOperatorPrincipal = {
  userId: 'user-123',
  sessionId: 'session-123',
  authenticationMethods: ['magic-link'],
  authenticatedAt: '2026-07-19T09:00:00.000Z',
  organizationId: 'organization-123',
  merchantId: 'merchant-123',
  membershipId: 'membership-123',
  permissions: ['programs:read', 'programs:manage', 'programs:publish'],
} as const satisfies OperatorPrincipal;

export const canonicalOperatorCallContext = {
  correlationId: 'correlation-123',
  actorUserId: 'user-123',
  actorKind: 'member',
  merchantId: 'merchant-123',
  permission: 'programs:publish',
} as const satisfies OperatorCallContext;

export const canonicalApiCredentialView = {
  id: 'credential-123',
  name: 'Production checkout',
  merchantId: 'merchant-123',
  environment: 'production',
  kind: 'secret',
  scopes: ['schema:read', 'evaluations:write', 'redemptions:write'],
  expiresAt: '2027-07-19T09:00:00.000Z',
  createdAt: '2026-07-19T09:00:00.000Z',
  createdBy: 'user-123',
  status: 'active',
  suffix: 'A1B2C3',
} as const satisfies ApiCredentialView;

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
  codes: ['GATEC15', 'VIP20'],
  customerRef: 'customer-1',
  cart: {
    currency: 'GBP',
    subtotal: 12_500,
    items: [],
  },
  context: { channel: 'web' },
} as const satisfies EvaluationRequest;

export const canonicalDecision = {
  programRef: 'welcome-10',
  programRevision: 1,
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

export const canonicalProgramRevision = {
  programRef: 'gold-web-rewards',
  revision: 1,
  configuration: canonicalTwoTierPromo,
  createdAt: '2026-07-19T09:00:00.000Z',
  createdBy: 'user-123',
  publishedAt: '2026-07-19T09:30:00.000Z',
  publishedBy: 'user-123',
} as const satisfies ProgramRevision;

export const canonicalProgramLifecycle = {
  programRef: 'gold-web-rewards',
  status: 'active',
  activeRevision: 1,
  updatedAt: '2026-07-19T09:30:00.000Z',
} as const satisfies ProgramLifecycle;

export const canonicalAuditEntry = {
  id: 'audit-123',
  occurredAt: '2026-07-19T09:30:00.000Z',
  actorKind: 'member',
  actorId: 'user-123',
  merchantId: 'merchant-123',
  action: 'program.published',
  targetType: 'program',
  targetId: 'gold-web-rewards',
  outcome: 'succeeded',
  correlationId: 'correlation-123',
  metadata: { programRevision: 1, status: 'active' },
} as const satisfies AuditEntry;

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
    programRevision: 1,
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
    programRevision: 1,
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
  decisions: [],
} as const satisfies EvaluationResponse;

export const canonicalCodedEvaluationResponse = {
  evaluationId: 'evaluation-123',
  customerRef: 'customer-1',
  customerVersion: 1,
  schemaVersion: 1,
  expiresAt: '2026-07-24T15:05:00.000Z',
  decisions: [
    {
      programRef: 'vip-shipping',
      programRevision: 1,
      programType: 'promo',
      outcome: 'qualified',
      rewardRuleRef: 'free-shipping',
      effects: [{ type: 'free_shipping' }],
      reasonCodes: [],
      commitRequired: true,
      eligible: true,
    },
    {
      programRef: 'gate-c-15',
      programRevision: 1,
      programType: 'promo',
      outcome: 'qualified',
      rewardRuleRef: 'fifteen-percent',
      effects: [{
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 1_500,
      }],
      reasonCodes: [],
      commitRequired: true,
      eligible: true,
    },
  ],
  codeResults: [
    {
      code: 'GATEC15',
      normalizedCode: 'GATEC15',
      outcome: 'selected',
      programRef: 'gate-c-15',
      reasonCodes: [],
    },
    {
      code: 'VIP20',
      normalizedCode: 'VIP20',
      outcome: 'selected',
      programRef: 'vip-shipping',
      reasonCodes: [],
    },
  ],
} as const satisfies EvaluationResponse;

export const canonicalRedemptionRequest = {
  evaluationId: 'evaluation-123',
  externalOrderRef: 'order-456',
  idempotencyKey: 'checkout-789',
} as const satisfies RedemptionRequest;

export const canonicalCommittedRedemption = {
  redemptionId: 'redemption-123',
  evaluationId: 'evaluation-123',
  externalOrderRef: 'order-456',
  status: 'committed',
  entries: [
    {
      programRef: 'vip-shipping',
      programRevision: 1,
      rewardRuleRef: 'free-shipping',
      effects: [{ type: 'free_shipping' }],
    },
    {
      programRef: 'gate-c-15',
      programRevision: 1,
      rewardRuleRef: 'fifteen-percent',
      effects: [{
        type: 'order_discount',
        calculation: 'percent',
        basisPoints: 1_500,
      }],
    },
  ],
  idempotencyKey: 'checkout-789',
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
