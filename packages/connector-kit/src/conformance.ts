import {
  CartSnapshotSchema,
  CustomerSnapshotSchema,
  IncentiveDecisionSchema,
  OrderSnapshotSchema,
} from '@incentives/contracts';

import type {
  Effect,
  IncentiveDecision,
  OrderSnapshot,
} from '@incentives/contracts';
import type {
  CommerceConnector,
  ConnectorCapabilities,
} from './connector.js';
import { UnsupportedConnectorCapabilityError } from './connector.js';

export type ConnectorConformanceCode =
  | 'INVALID_CAPABILITIES'
  | 'INVALID_CUSTOMER_SNAPSHOT'
  | 'INVALID_CART_SNAPSHOT'
  | 'INVALID_ORDER_SNAPSHOT'
  | 'INVALID_CANONICAL_MONEY'
  | 'CUSTOMER_DATA_IN_CART'
  | 'INVALID_CUSTOMER_SENTINEL'
  | 'CUSTOMER_ATTRIBUTES_MUTATED'
  | 'EXTERNAL_REF_MUTATED'
  | 'IDEMPOTENCY_KEY_MUTATED'
  | 'UNSUPPORTED_EFFECT_ACCEPTED'
  | 'UNSUPPORTED_EFFECT_ERROR_INVALID'
  | 'SUPPORTED_EFFECT_REJECTED'
  | 'SOURCE_VERIFICATION_INVALID'
  | 'EVALUATION_FAILED'
  | 'INVALID_DECISION'
  | 'DECISION_MAPPING_FAILED'
  | 'APPLICATION_FAILED'
  | 'COMMIT_FAILED'
  | 'PAYMENT_CAPTURE_FAILED'
  | 'INVALID_OPERATION_SEQUENCE';

export class ConnectorConformanceError extends Error {
  constructor(
    readonly code: ConnectorConformanceCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConnectorConformanceError';
  }
}

export interface ConnectorFixture<TCustomer, TCart, TOrder, TDecision> {
  customerInput: TCustomer;
  cartInput: TCart;
  orderInput: TOrder;
  expectedCustomerRef: string;
  expectedCustomerAttributes: Readonly<Record<string, unknown>>;
  customerOnlyAttributeSentinels: readonly unknown[];
  expectedOrderRef: string;
  expectedOrderCustomerRef?: string;
  expectedIdempotencyKey: string;
  expectedCartLineRefs: readonly ConnectorLineReference[];
  expectedOrderLineRefs: readonly ConnectorLineReference[];
  validRequest: Request;
  invalidRequest: Request;
  trace: string[];
  evaluate(): Promise<IncentiveDecision>;
  apply(mappedDecision: TDecision): Promise<void>;
  commit(order: OrderSnapshot): Promise<void>;
  capturePayment(): Promise<void>;
}

export interface ConnectorLineReference {
  readonly productRef: string;
  readonly variantRef?: string | undefined;
}

export interface ConnectorConformanceResult {
  passed: true;
}

const CAPABILITY_KEYS = [
  'automaticDiscounts',
  'discountCodes',
  'lineItemAdjustments',
  'checkoutBlocking',
  'customerAttributes',
  'orderWebhooks',
  'walletRedemption',
] as const satisfies readonly (keyof ConnectorCapabilities)[];

function failure(
  code: ConnectorConformanceCode,
  message: string,
  cause?: unknown,
): ConnectorConformanceError {
  return new ConnectorConformanceError(code, message, cause === undefined ? undefined : { cause });
}

function readCapabilities(value: unknown): ConnectorCapabilities {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw failure('INVALID_CAPABILITIES', 'Connector capabilities must be an object');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [...CAPABILITY_KEYS].sort();
  if (
    keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])
    || CAPABILITY_KEYS.some(key => typeof record[key] !== 'boolean')
  ) {
    throw failure(
      'INVALID_CAPABILITIES',
      'Connector must declare exactly the seven boolean capabilities',
    );
  }

  return value as ConnectorCapabilities;
}

function containsTopLevelCustomerData(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['customer', 'customerRef', 'customerAttributes'].some(key => key in value);
}

function lineReferencesMatch(
  items: readonly ConnectorLineReference[],
  expected: readonly ConnectorLineReference[],
): boolean {
  return items.length === expected.length && items.every((item, index) => {
    const reference = expected[index];
    return reference !== undefined
      && item.productRef === reference.productRef
      && item.variantRef === reference.variantRef;
  });
}

function valuesEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null
    || right === null
    || typeof left !== 'object'
    || typeof right !== 'object'
  ) return false;

  const knownRight = seen.get(left);
  if (knownRight !== undefined) return knownRight === right;
  seen.set(left, right);

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => valuesEqual(entry, right[index], seen));
  }
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date
      && right instanceof Date
      && left.getTime() === right.getTime();
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && valuesEqual(leftRecord[key], rightRecord[key], seen)
    ));
}

function treeContainsValue(
  tree: unknown,
  target: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (valuesEqual(tree, target)) return true;
  if (tree === null || typeof tree !== 'object' || seen.has(tree)) return false;
  seen.add(tree);
  return Object.values(tree).some(value => treeContainsValue(value, target, seen));
}

function assertCustomerSentinels(
  sentinels: readonly unknown[],
  expectedAttributes: Readonly<Record<string, unknown>>,
  normalizedAttributes: Readonly<Record<string, unknown>>,
): void {
  if (
    sentinels.length === 0
    || sentinels.some((sentinel, index) => (
      !treeContainsValue(expectedAttributes, sentinel)
      || sentinels.some((other, otherIndex) => (
        otherIndex < index && valuesEqual(other, sentinel)
      ))
    ))
  ) {
    throw failure(
      'INVALID_CUSTOMER_SENTINEL',
      'Fixture customer-only sentinels must be unique and present in expected customer attributes',
    );
  }

  if (sentinels.some(sentinel => !treeContainsValue(normalizedAttributes, sentinel))) {
    throw failure(
      'CUSTOMER_ATTRIBUTES_MUTATED',
      'Customer-only sentinel was dropped or mutated during normalization',
    );
  }
}

function cartContainsSentinel(
  cart: { attributes?: Readonly<Record<string, unknown>> | undefined; items: readonly {
    attributes?: Readonly<Record<string, unknown>> | undefined;
  }[] },
  sentinels: readonly unknown[],
): boolean {
  return sentinels.some(sentinel => (
    treeContainsValue(cart.attributes, sentinel)
    || cart.items.some(item => treeContainsValue(item.attributes, sentinel))
  ));
}

function isMoneyIssue(path: readonly PropertyKey[]): boolean {
  return path.some(segment => (
    segment === 'currency'
    || segment === 'subtotal'
    || segment === 'total'
    || segment === 'unitPrice'
  ));
}

function decisionFor(effects: readonly Effect[]): IncentiveDecision {
  return IncentiveDecisionSchema.parse({
    programRef: 'connector-conformance',
    programType: 'promo',
    outcome: 'qualified',
    effects,
    reasonCodes: [],
    commitRequired: true,
    eligible: true,
  });
}

const CONFORMANCE_EFFECTS: readonly Effect[] = [
  {
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 100 },
  },
  {
    type: 'order_discount',
    calculation: 'percent',
    basisPoints: 1_000,
  },
  { type: 'free_shipping' },
  {
    type: 'line_item_discount',
    productRef: 'connector-conformance-product',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 100 },
  },
  {
    type: 'line_item_discount',
    productRef: 'connector-conformance-product',
    calculation: 'percent',
    basisPoints: 1_000,
  },
  {
    type: 'wallet_debit',
    amount: { currency: 'GBP', minorUnits: 100 },
  },
  {
    type: 'wallet_credit',
    amount: { currency: 'GBP', minorUnits: 100 },
  },
  { type: 'points_credit', points: 100 },
  { type: 'attribution', subjectRef: 'connector-conformance-subject' },
];

function supportsEffect(
  capabilities: ConnectorCapabilities,
  effect: Effect,
): boolean {
  switch (effect.type) {
    case 'order_discount':
    case 'free_shipping':
      return capabilities.automaticDiscounts || capabilities.discountCodes;
    case 'line_item_discount':
      return capabilities.lineItemAdjustments;
    case 'wallet_debit':
      return capabilities.walletRedemption;
    case 'wallet_credit':
    case 'points_credit':
    case 'attribution':
      return false;
  }
}

function assertCapabilityMapping<TCustomer, TCart, TOrder, TDecision>(
  connector: CommerceConnector<TCustomer, TCart, TOrder, TDecision>,
  capabilities: ConnectorCapabilities,
): void {
  const probes = CONFORMANCE_EFFECTS.map(effect => ({
    effects: [effect] as readonly Effect[],
    unsupportedEffect: supportsEffect(capabilities, effect) ? undefined : effect.type,
  }));
  const supportedEffect = CONFORMANCE_EFFECTS.find(effect => supportsEffect(capabilities, effect));
  if (supportedEffect !== undefined) {
    for (const unsupportedEffect of CONFORMANCE_EFFECTS.filter(
      effect => !supportsEffect(capabilities, effect),
    )) {
      probes.push({
        effects: [supportedEffect, unsupportedEffect],
        unsupportedEffect: unsupportedEffect.type,
      });
    }
  }

  for (const probe of probes) {
    try {
      connector.mapDecision(decisionFor(probe.effects));
      if (probe.unsupportedEffect !== undefined) {
        throw failure(
          'UNSUPPORTED_EFFECT_ACCEPTED',
          `Connector silently accepted unsupported effect: ${probe.unsupportedEffect}`,
        );
      }
    } catch (error) {
      if (error instanceof ConnectorConformanceError) throw error;
      if (probe.unsupportedEffect === undefined) {
        throw failure(
          'SUPPORTED_EFFECT_REJECTED',
          `Connector rejected a declared supported decision containing ${probe.effects[0]?.type}`,
          error,
        );
      }
      if (
        !(error instanceof UnsupportedConnectorCapabilityError)
        || error.effectType !== probe.unsupportedEffect
      ) {
        throw failure(
          'UNSUPPORTED_EFFECT_ERROR_INVALID',
          `Unsupported effect ${probe.unsupportedEffect} must throw its typed capability error`,
          error,
        );
      }
    }
  }
}

async function assertSourceVerification<TCustomer, TCart, TOrder, TDecision>(
  connector: CommerceConnector<TCustomer, TCart, TOrder, TDecision>,
  validRequest: Request,
  invalidRequest: Request,
): Promise<void> {
  try {
    const valid = await connector.verifyIncomingRequest(validRequest);
    const invalid = await connector.verifyIncomingRequest(invalidRequest);
    if (valid.verified !== true || invalid.verified !== false) {
      throw failure(
        'SOURCE_VERIFICATION_INVALID',
        'Source verification must accept the valid request and reject the invalid request',
      );
    }
  } catch (error) {
    if (error instanceof ConnectorConformanceError) throw error;
    throw failure('SOURCE_VERIFICATION_INVALID', 'Source verification failed', error);
  }
}

export async function runConnectorConformanceSuite<
  TCustomer,
  TCart,
  TOrder,
  TDecision,
>(
  connector: CommerceConnector<TCustomer, TCart, TOrder, TDecision>,
  fixture: ConnectorFixture<TCustomer, TCart, TOrder, TDecision>,
): Promise<ConnectorConformanceResult> {
  let capabilities: ConnectorCapabilities;
  try {
    capabilities = readCapabilities(connector.capabilities());
  } catch (error) {
    if (error instanceof ConnectorConformanceError) throw error;
    throw failure('INVALID_CAPABILITIES', 'Connector capabilities could not be read', error);
  }

  let customerValue: unknown;
  try {
    customerValue = connector.normalizeCustomer(fixture.customerInput);
  } catch (error) {
    throw failure('INVALID_CUSTOMER_SNAPSHOT', 'Customer normalization failed', error);
  }
  const customer = CustomerSnapshotSchema.safeParse(customerValue);
  if (!customer.success) {
    throw failure(
      'INVALID_CUSTOMER_SNAPSHOT',
      'Customer normalization did not return a strict canonical snapshot',
      customer.error,
    );
  }
  if (customer.data.externalRef !== fixture.expectedCustomerRef) {
    throw failure('EXTERNAL_REF_MUTATED', 'Customer external reference was mutated');
  }
  if (capabilities.customerAttributes) {
    if (!valuesEqual(customer.data.attributes, fixture.expectedCustomerAttributes)) {
      throw failure(
        'CUSTOMER_ATTRIBUTES_MUTATED',
        'Customer attributes were dropped or mutated during normalization',
      );
    }
    assertCustomerSentinels(
      fixture.customerOnlyAttributeSentinels,
      fixture.expectedCustomerAttributes,
      customer.data.attributes,
    );
  }

  let cartValue: unknown;
  try {
    cartValue = connector.normalizeCart(fixture.cartInput);
  } catch (error) {
    throw failure('INVALID_CART_SNAPSHOT', 'Cart normalization failed', error);
  }
  if (containsTopLevelCustomerData(cartValue)) {
    throw failure('CUSTOMER_DATA_IN_CART', 'Persistent customer data must not appear in a cart');
  }
  const cart = CartSnapshotSchema.safeParse(cartValue);
  if (!cart.success) {
    const invalidMoney = cart.error.issues.some(issue => isMoneyIssue(issue.path));
    throw failure(
      invalidMoney ? 'INVALID_CANONICAL_MONEY' : 'INVALID_CART_SNAPSHOT',
      'Cart normalization did not return a strict canonical snapshot',
      cart.error,
    );
  }
  if (cartContainsSentinel(cart.data, fixture.customerOnlyAttributeSentinels)) {
    throw failure(
      'CUSTOMER_DATA_IN_CART',
      'Customer-only attribute sentinel must not appear in cart or line-item attributes',
    );
  }
  if (!lineReferencesMatch(cart.data.items, fixture.expectedCartLineRefs)) {
    throw failure('EXTERNAL_REF_MUTATED', 'Cart product or variant reference was mutated');
  }

  let orderValue: unknown;
  try {
    orderValue = connector.normalizeOrder(fixture.orderInput);
  } catch (error) {
    throw failure('INVALID_ORDER_SNAPSHOT', 'Order normalization failed', error);
  }
  const order = OrderSnapshotSchema.safeParse(orderValue);
  if (!order.success) {
    const invalidMoney = order.error.issues.some(issue => isMoneyIssue(issue.path));
    throw failure(
      invalidMoney ? 'INVALID_CANONICAL_MONEY' : 'INVALID_ORDER_SNAPSHOT',
      'Order normalization did not return a strict canonical snapshot',
      order.error,
    );
  }
  if (
    order.data.externalRef !== fixture.expectedOrderRef
    || order.data.customerRef !== fixture.expectedOrderCustomerRef
  ) {
    throw failure('EXTERNAL_REF_MUTATED', 'Order external reference was mutated');
  }
  if (order.data.idempotencyKey !== fixture.expectedIdempotencyKey) {
    throw failure('IDEMPOTENCY_KEY_MUTATED', 'Order idempotency key was mutated');
  }
  if (!lineReferencesMatch(order.data.items, fixture.expectedOrderLineRefs)) {
    throw failure('EXTERNAL_REF_MUTATED', 'Order product or variant reference was mutated');
  }

  assertCapabilityMapping(connector, capabilities);
  await assertSourceVerification(connector, fixture.validRequest, fixture.invalidRequest);

  fixture.trace.length = 0;
  fixture.trace.push('evaluate');
  let decisionValue: unknown;
  try {
    decisionValue = await fixture.evaluate();
  } catch (error) {
    throw failure('EVALUATION_FAILED', 'Fixture evaluation failed', error);
  }
  const decision = IncentiveDecisionSchema.safeParse(decisionValue);
  if (!decision.success) {
    throw failure(
      'INVALID_DECISION',
      'Fixture evaluation did not return a canonical incentive decision',
      decision.error,
    );
  }

  let mappedDecision: TDecision;
  fixture.trace.push('map');
  try {
    mappedDecision = connector.mapDecision(decision.data);
  } catch (error) {
    throw failure('DECISION_MAPPING_FAILED', 'Connector could not map the evaluated decision', error);
  }

  fixture.trace.push('apply');
  try {
    await fixture.apply(mappedDecision);
  } catch (error) {
    throw failure('APPLICATION_FAILED', 'Fixture could not apply the mapped decision', error);
  }
  fixture.trace.push('commit');
  try {
    await fixture.commit(order.data);
  } catch (error) {
    throw failure('COMMIT_FAILED', 'Fixture could not commit the decision', error);
  }
  fixture.trace.push('capture');
  try {
    await fixture.capturePayment();
  } catch (error) {
    throw failure('PAYMENT_CAPTURE_FAILED', 'Fixture could not capture payment', error);
  }

  const expectedTrace = ['evaluate', 'map', 'apply', 'commit', 'capture'];
  if (
    fixture.trace.length !== expectedTrace.length
    || fixture.trace.some((entry, index) => entry !== expectedTrace[index])
  ) {
    throw failure(
      'INVALID_OPERATION_SEQUENCE',
      'Connector flow must be evaluate → map/apply → commit → capture',
    );
  }

  return { passed: true };
}
