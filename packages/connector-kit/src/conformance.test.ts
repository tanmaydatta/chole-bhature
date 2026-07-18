import { describe, expect, test } from 'vitest';

import type {
  CartSnapshot,
  IncentiveDecision,
  OrderSnapshot,
} from '@incentives/contracts';

import type {
  CommerceConnector,
  ConnectorConformanceCode,
  ConnectorFixture,
} from './index.js';
import {
  ConnectorConformanceError,
  UnsupportedConnectorCapabilityError,
  runConnectorConformanceSuite,
} from './index.js';

interface FakeCustomer {
  id: string;
  attributes: Record<string, unknown>;
}

interface FakeCart {
  currency: string;
  subtotal: number;
  productId: string;
  variantId: string;
}

interface FakeOrder {
  id: string;
  idempotencyKey: string;
  currency: string;
  total: number;
  customerId: string;
  productId: string;
  variantId: string;
}

interface FakeAdjustment {
  effectType: string;
  calculation?: 'fixed' | 'percent';
}

const qualifiedDecision: IncentiveDecision = {
  programRef: 'promo-1',
  programType: 'promo',
  outcome: 'qualified',
  effects: [{
    type: 'order_discount',
    calculation: 'fixed',
    amount: { currency: 'GBP', minorUnits: 500 },
  }],
  reasonCodes: [],
  commitRequired: true,
  eligible: true,
};

function capabilities() {
  return {
    automaticDiscounts: true,
    discountCodes: true,
    lineItemAdjustments: false,
    checkoutBlocking: true,
    customerAttributes: true,
    orderWebhooks: true,
    walletRedemption: false,
  };
}

function canonicalCartFromFake(input: FakeCart): CartSnapshot {
  return {
    currency: input.currency,
    subtotal: input.subtotal,
    items: [{
      productRef: input.productId,
      variantRef: input.variantId,
      quantity: 1,
      unitPrice: input.subtotal,
    }],
  };
}

function canonicalOrderFromFake(input: FakeOrder): OrderSnapshot {
  return {
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
  };
}

function fakeAdjustmentsFromDecision(decision: IncentiveDecision): FakeAdjustment[] {
  const unsupported = decision.effects.find(effect => (
    effect.type === 'line_item_discount'
    || effect.type === 'wallet_debit'
    || effect.type === 'wallet_credit'
    || effect.type === 'points_credit'
    || effect.type === 'attribution'
  ));
  if (unsupported) {
    throw new UnsupportedConnectorCapabilityError(unsupported.type);
  }
  return mapAllEffects(decision);
}

function mapAllEffects(decision: IncentiveDecision): FakeAdjustment[] {
  return decision.effects.map(effect => ({
    effectType: effect.type,
    ...('calculation' in effect ? { calculation: effect.calculation } : {}),
  }));
}

function createHarness(): {
  connector: CommerceConnector<FakeCustomer, FakeCart, FakeOrder, FakeAdjustment[]>;
  fixture: ConnectorFixture<FakeCustomer, FakeCart, FakeOrder, FakeAdjustment[]>;
} {
  const trace: string[] = [];
  const connector: CommerceConnector<FakeCustomer, FakeCart, FakeOrder, FakeAdjustment[]> = {
    capabilities,
    normalizeCustomer: input => ({
      externalRef: input.id,
      attributes: input.attributes,
    }),
    normalizeCart: canonicalCartFromFake,
    normalizeOrder: canonicalOrderFromFake,
    mapDecision: fakeAdjustmentsFromDecision,
    async verifyIncomingRequest(request) {
      return { verified: request.headers.get('x-fake-signature') === 'valid' };
    },
  };

  return {
    connector,
    fixture: {
      customerInput: {
        id: ' Customer::001 ',
        attributes: { tier: 'gold', sentinel: 'customer-only::8e2ec7a4' },
      },
      cartInput: {
        currency: 'GBP',
        subtotal: 6_500,
        productId: ' Product::001 ',
        variantId: ' Variant::001 ',
      },
      orderInput: {
        id: ' Order::001 ',
        idempotencyKey: ' Idempotency::001 ',
        currency: 'GBP',
        total: 6_000,
        customerId: ' Customer::001 ',
        productId: ' Product::001 ',
        variantId: ' Variant::001 ',
      },
      expectedCustomerRef: ' Customer::001 ',
      expectedCustomerAttributes: {
        tier: 'gold',
        sentinel: 'customer-only::8e2ec7a4',
      },
      customerOnlyAttributeSentinels: ['customer-only::8e2ec7a4'],
      expectedOrderRef: ' Order::001 ',
      expectedOrderCustomerRef: ' Customer::001 ',
      expectedIdempotencyKey: ' Idempotency::001 ',
      expectedCartLineRefs: [{
        productRef: ' Product::001 ',
        variantRef: ' Variant::001 ',
      }],
      expectedOrderLineRefs: [{
        productRef: ' Product::001 ',
        variantRef: ' Variant::001 ',
      }],
      validRequest: new Request('https://fake.test/webhook', {
        headers: { 'x-fake-signature': 'valid' },
      }),
      invalidRequest: new Request('https://fake.test/webhook', {
        headers: { 'x-fake-signature': 'invalid' },
      }),
      trace,
      async evaluate() {
        return qualifiedDecision;
      },
      assertMappedDecision(decision, mappedDecision) {
        expect(mappedDecision).toEqual(decision.effects.map(effect => ({
          effectType: effect.type,
          ...('calculation' in effect ? { calculation: effect.calculation } : {}),
        })));
      },
      async apply(_mappedDecision) {},
      async commit(order) {
        expect(order.externalRef).toBe(' Order::001 ');
        expect(order.idempotencyKey).toBe(' Idempotency::001 ');
      },
      async capturePayment() {},
    },
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: ConnectorConformanceCode,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: 'ConnectorConformanceError',
    code,
  } satisfies Partial<ConnectorConformanceError>);
}

describe('runConnectorConformanceSuite', () => {
  test('fake connector passes canonical conformance', async () => {
    const { connector, fixture } = createHarness();

    await expect(runConnectorConformanceSuite(connector, fixture)).resolves.toEqual({
      passed: true,
    });
    expect(fixture.trace).toEqual(['evaluate', 'map', 'apply', 'commit', 'capture']);
  });

  test.each([
    ['fractional cart money', (harness: ReturnType<typeof createHarness>) => {
      harness.fixture.cartInput.subtotal = 65.5;
    }],
    ['lowercase order currency', (harness: ReturnType<typeof createHarness>) => {
      harness.fixture.orderInput.currency = 'gbp';
    }],
    ['negative order total', (harness: ReturnType<typeof createHarness>) => {
      harness.fixture.orderInput.total = -1;
    }],
  ] as const)('rejects invalid canonical money: %s', async (_name, mutate) => {
    const harness = createHarness();
    mutate(harness);

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'INVALID_CANONICAL_MONEY',
    );
  });

  test('rejects persistent customer data leaked into a cart', async () => {
    const harness = createHarness();
    harness.connector.normalizeCart = input => ({
      ...canonicalCartFromFake(input),
      customer: { attributes: { tier: 'gold' } },
    } as CartSnapshot);

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'CUSTOMER_DATA_IN_CART',
    );
  });

  test('rejects customer attributes dropped during supported normalization', async () => {
    const harness = createHarness();
    harness.connector.normalizeCustomer = input => ({
      externalRef: input.id,
      attributes: {},
    });

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'CUSTOMER_ATTRIBUTES_MUTATED',
    );
  });

  test.each([
    ['cart attributes', (cart: CartSnapshot) => ({
      ...cart,
      attributes: { tier: 'gold', sentinel: 'customer-only::8e2ec7a4' },
    })],
    ['line-item attributes', (cart: CartSnapshot) => ({
      ...cart,
      items: cart.items.map(item => ({
        ...item,
        attributes: { tier: 'gold', sentinel: 'customer-only::8e2ec7a4' },
      })),
    })],
  ] as const)('rejects a customer-only sentinel hidden in %s', async (_name, leak) => {
    const harness = createHarness();
    harness.connector.normalizeCart = input => leak(canonicalCartFromFake(input));

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'CUSTOMER_DATA_IN_CART',
    );
  });

  test('allows non-sentinel live attributes even when keys or values resemble customer data', async () => {
    const harness = createHarness();
    harness.connector.normalizeCart = input => {
      const cart = canonicalCartFromFake(input);
      return {
        ...cart,
        attributes: { tier: 'gold', customerRef: 'checkout-session' },
        items: cart.items.map(item => ({
          ...item,
          attributes: { tier: 'gold', customerAttributes: 'live-value' },
        })),
      };
    };

    await expect(runConnectorConformanceSuite(
      harness.connector,
      harness.fixture,
    )).resolves.toEqual({ passed: true });
  });

  test('rejects a fixture whose customer-only sentinel is absent from expected attributes', async () => {
    const harness = createHarness();
    harness.fixture.customerOnlyAttributeSentinels = ['missing-customer-only-sentinel'];

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'INVALID_CUSTOMER_SENTINEL',
    );
  });

  test('allows empty customer attributes and sentinels when the capability is absent', async () => {
    const harness = createHarness();
    harness.connector.capabilities = () => ({
      ...capabilities(),
      customerAttributes: false,
    });
    harness.connector.normalizeCustomer = input => ({
      externalRef: input.id,
      attributes: {},
    });
    harness.fixture.expectedCustomerAttributes = {};
    harness.fixture.customerOnlyAttributeSentinels = [];

    await expect(runConnectorConformanceSuite(
      harness.connector,
      harness.fixture,
    )).resolves.toEqual({ passed: true });
  });

  test('rejects unsupported effects that are silently accepted', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = mapAllEffects;

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'UNSUPPORTED_EFFECT_ACCEPTED',
    );
  });

  test('requires a typed unsupported-capability error', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = decision => {
      const effect = decision.effects[0];
      if (effect?.type === 'order_discount' || effect?.type === 'free_shipping') {
        return mapAllEffects(decision);
      }
      throw new Error('not supported');
    };

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'UNSUPPORTED_EFFECT_ERROR_INVALID',
    );
  });

  test('rejects source verification inversion', async () => {
    const harness = createHarness();
    harness.connector.verifyIncomingRequest = async request => ({
      verified: request.headers.get('x-fake-signature') !== 'valid',
    });

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'SOURCE_VERIFICATION_INVALID',
    );
  });

  test.each([
    ['customer', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeCustomer = input => ({
        externalRef: input.id.trim(),
        attributes: input.attributes,
      });
    }],
    ['order', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeOrder = input => ({
        ...canonicalOrderFromFake(input),
        externalRef: input.id.trim(),
      });
    }],
    ['order customer', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeOrder = input => ({
        ...canonicalOrderFromFake(input),
        customerRef: input.customerId.trim(),
      });
    }],
  ] as const)('rejects %s reference mutation', async (_name, mutate) => {
    const harness = createHarness();
    mutate(harness);

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'EXTERNAL_REF_MUTATED',
    );
  });

  test.each([
    ['cart product', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeCart = input => ({
        ...canonicalCartFromFake(input),
        items: [{
          ...canonicalCartFromFake(input).items[0]!,
          productRef: input.productId.trim(),
        }],
      });
    }],
    ['cart variant', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeCart = input => ({
        ...canonicalCartFromFake(input),
        items: [{
          ...canonicalCartFromFake(input).items[0]!,
          variantRef: input.variantId.trim(),
        }],
      });
    }],
    ['order product', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeOrder = input => ({
        ...canonicalOrderFromFake(input),
        items: [{
          ...canonicalOrderFromFake(input).items[0]!,
          productRef: input.productId.trim(),
        }],
      });
    }],
    ['order variant', (harness: ReturnType<typeof createHarness>) => {
      harness.connector.normalizeOrder = input => ({
        ...canonicalOrderFromFake(input),
        items: [{
          ...canonicalOrderFromFake(input).items[0]!,
          variantRef: input.variantId.trim(),
        }],
      });
    }],
  ] as const)('rejects %s reference mutation byte-for-byte', async (_name, mutate) => {
    const harness = createHarness();
    mutate(harness);

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'EXTERNAL_REF_MUTATED',
    );
  });

  test('rejects idempotency-key mutation', async () => {
    const harness = createHarness();
    harness.connector.normalizeOrder = input => ({
      ...canonicalOrderFromFake(input),
      idempotencyKey: input.idempotencyKey.trim(),
    });

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'IDEMPOTENCY_KEY_MUTATED',
    );
  });

  test('rejects payment capture before commit', async () => {
    const harness = createHarness();
    harness.fixture.commit = async () => {
      harness.fixture.trace.reverse();
    };

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'INVALID_OPERATION_SEQUENCE',
    );
  });

  test('rejects a non-canonical evaluated decision before mapping', async () => {
    const harness = createHarness();
    harness.fixture.evaluate = async () => ({
      ...qualifiedDecision,
      eligible: false,
    });

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'INVALID_DECISION',
    );
  });

  test('enforces the exact capability-to-effect mapping', async () => {
    const harness = createHarness();
    const calls: string[] = [];
    harness.connector.mapDecision = decision => {
      for (const effect of decision.effects) {
        calls.push(
          'calculation' in effect
            ? `${effect.type}:${effect.calculation}`
            : effect.type,
        );
      }
      const unsupported = decision.effects.find(effect => (
        effect.type === 'line_item_discount'
        || effect.type === 'wallet_debit'
        || effect.type === 'wallet_credit'
        || effect.type === 'points_credit'
        || effect.type === 'attribution'
      ));
      if (unsupported) {
        throw new UnsupportedConnectorCapabilityError(unsupported.type);
      }
      return mapAllEffects(decision);
    };

    await runConnectorConformanceSuite(harness.connector, harness.fixture);

    expect(new Set(calls)).toEqual(new Set([
      'order_discount:fixed',
      'order_discount:percent',
      'free_shipping',
      'line_item_discount:fixed',
      'line_item_discount:percent',
      'wallet_debit',
      'wallet_credit',
      'points_credit',
      'attribution',
    ]));
  });

  test('asks the fixture to prove every supported probe and final evaluated mapping', async () => {
    const harness = createHarness();
    const asserted: string[] = [];
    harness.fixture.assertMappedDecision = (decision, mappedDecision) => {
      const expected = decision.effects.map(effect => ({
        effectType: effect.type,
        ...('calculation' in effect ? { calculation: effect.calculation } : {}),
      }));
      expect(mappedDecision).toEqual(expected);
      asserted.push(decision.effects.map(effect => (
        'calculation' in effect
          ? `${effect.type}:${effect.calculation}`
          : effect.type
      )).join(','));
    };

    await runConnectorConformanceSuite(harness.connector, harness.fixture);

    expect(asserted).toEqual([
      'order_discount:fixed',
      'order_discount:percent',
      'free_shipping',
      'order_discount:fixed',
    ]);
  });

  test('rejects a mapper that silently drops supported effects', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = () => [];

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'MAPPED_DECISION_INVALID',
    );
  });

  test('rejects a connector that supports fixed order discounts but rejects percent variants', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = decision => {
      const percent = decision.effects.find(effect => (
        (effect.type === 'order_discount' || effect.type === 'line_item_discount')
        && effect.calculation === 'percent'
      ));
      if (percent) throw new UnsupportedConnectorCapabilityError(percent.type);
      return fakeAdjustmentsFromDecision(decision);
    };

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'SUPPORTED_EFFECT_REJECTED',
    );
  });

  test('rejects a connector that supports fixed line discounts but rejects percent variants', async () => {
    const harness = createHarness();
    harness.connector.capabilities = () => ({
      ...capabilities(),
      lineItemAdjustments: true,
    });
    harness.connector.mapDecision = decision => {
      const percentLine = decision.effects.find(effect => (
        effect.type === 'line_item_discount' && effect.calculation === 'percent'
      ));
      if (percentLine) {
        throw new UnsupportedConnectorCapabilityError(percentLine.type);
      }
      const unsupported = decision.effects.find(effect => (
        effect.type === 'wallet_debit'
        || effect.type === 'wallet_credit'
        || effect.type === 'points_credit'
        || effect.type === 'attribution'
      ));
      if (unsupported) {
        throw new UnsupportedConnectorCapabilityError(unsupported.type);
      }
      return mapAllEffects(decision);
    };

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'SUPPORTED_EFFECT_REJECTED',
    );
  });

  test('rejects a connector that silently accepts unsupported effects in a mixed decision', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = decision => (
      decision.effects.length > 1
        ? mapAllEffects(decision)
        : fakeAdjustmentsFromDecision(decision)
    );

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'UNSUPPORTED_EFFECT_ACCEPTED',
    );
  });

  test('requires a mixed-decision capability error to identify its unsupported effect', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = decision => {
      if (decision.effects.length > 1) {
        throw new UnsupportedConnectorCapabilityError('wallet_debit');
      }
      return fakeAdjustmentsFromDecision(decision);
    };

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'UNSUPPORTED_EFFECT_ERROR_INVALID',
    );
  });

  test('probes every unsupported effect in a mixed decision', async () => {
    const harness = createHarness();
    harness.connector.mapDecision = decision => {
      if (
        decision.effects.length > 1
        && decision.effects.some(effect => effect.type === 'wallet_credit')
      ) {
        return mapAllEffects(decision);
      }
      return fakeAdjustmentsFromDecision(decision);
    };

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'UNSUPPORTED_EFFECT_ACCEPTED',
    );
  });

  test.each([
    ['missing capability', () => ({
      automaticDiscounts: true,
      discountCodes: true,
      lineItemAdjustments: false,
      checkoutBlocking: true,
      customerAttributes: true,
      orderWebhooks: true,
    })],
    ['extra capability', () => ({ ...capabilities(), platformPayments: true })],
    ['non-boolean capability', () => ({ ...capabilities(), walletRedemption: 'no' })],
  ] as const)('rejects an invalid capability shape: %s', async (_name, invalid) => {
    const harness = createHarness();
    harness.connector.capabilities = invalid as typeof capabilities;

    await expectCode(
      runConnectorConformanceSuite(harness.connector, harness.fixture),
      'INVALID_CAPABILITIES',
    );
  });
});
