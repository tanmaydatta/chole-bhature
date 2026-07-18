# Commerce Connector Conformance

The canonical HTTP/domain contract is the public integration boundary. `@incentives/connector-kit` is the reusable TypeScript boundary for managed Shopify, custom, or future commerce adapters. A connector normalizes platform inputs, maps canonical decisions back to platform actions, and verifies incoming requests; the incentives core never imports a connector.

## Interface

```ts
interface CommerceConnector<TCustomer, TCart, TOrder, TDecision> {
  capabilities(): ConnectorCapabilities;
  normalizeCustomer(input: TCustomer): CustomerSnapshot;
  normalizeCart(input: TCart): CartSnapshot;
  normalizeOrder(input: TOrder): OrderSnapshot;
  mapDecision(decision: IncentiveDecision): TDecision;
  verifyIncomingRequest(request: Request): Promise<VerificationResult>;
}
```

Normalization must preserve opaque customer, product, variant, order, and idempotency references byte-for-byte. Money must be uppercase-currency integer minor units. Customer normalization preserves stored attributes when supported; cart normalization must never leak them into live cart or line-item attributes. Request verification must return `{ verified: true }` for an authentic source and `{ verified: false }` for an invalid source.

This is the exact executable example connector; its `mapDecision` helper is shown below:

```ts
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
```

## Exact capability profile

A connector returns exactly these seven booleans—no missing or additional keys. This profile is copied from the executable example:

```ts
export const exampleConnectorCapabilities = {
  automaticDiscounts: true,
  discountCodes: true,
  lineItemAdjustments: false,
  checkoutBlocking: true,
  customerAttributes: true,
  orderWebhooks: true,
  walletRedemption: false,
} as const satisfies ConnectorCapabilities;
```

Effect mapping is validated against the profile as follows:

| Canonical effect | Capability required | Example profile |
|---|---|---|
| Fixed or percent `order_discount` | `automaticDiscounts` or `discountCodes` | supported |
| `free_shipping` | `automaticDiscounts` or `discountCodes` | supported |
| Fixed or percent `line_item_discount` | `lineItemAdjustments` | unsupported |
| `wallet_debit` | `walletRedemption` | unsupported |
| `wallet_credit` | no current connector capability | unsupported |
| `points_credit` | no current connector capability | unsupported |
| `attribution` | no current connector capability | unsupported |

`checkoutBlocking`, `customerAttributes`, and `orderWebhooks` declare integration behavior rather than effect representation. `customerAttributes: true` additionally activates lossless attribute and customer-only sentinel checks.

## Mapping and typed unsupported errors

The example connector maps only its declared effects. This is the exact executable mapper:

```ts
function mapDecision(decision: IncentiveDecision): ExampleAdjustment[] {
  const unsupportedEffect = decision.effects.find(effect => (
    effect.type !== 'order_discount' && effect.type !== 'free_shipping'
  ));
  if (unsupportedEffect !== undefined) {
    throw new UnsupportedConnectorCapabilityError(unsupportedEffect.type);
  }
  return decision.effects.map(effect => ({
    effectType: effect.type as ExampleAdjustment['effectType'],
    ...('calculation' in effect ? { calculation: effect.calculation } : {}),
  }));
}
```

Unsupported effects must throw `UnsupportedConnectorCapabilityError`, whose stable `code` is `UNSUPPORTED_CONNECTOR_CAPABILITY` and whose `effectType` identifies the exact rejected effect. Silent drops, generic errors, and accepting only the supported portion of a mixed decision all fail conformance.

Capability acceptance alone is insufficient: a mapper could return an empty or lossy platform payload without throwing. Every fixture therefore implements the strongly typed `assertMappedDecision(decision, mappedDecision)` hook. The runner invokes it for each declared-supported fixed, percent, and free-shipping probe and for the final evaluated mapping. Assertion failures are wrapped as `ConnectorConformanceError` with stable code `MAPPED_DECISION_INVALID`.

The runner itself throws `ConnectorConformanceError` with a stable typed `code`. Codes cover invalid capabilities/snapshots/money, customer leakage or mutation, external/idempotency reference mutation, effect capability mismatches, invalid mapped decisions, source verification, invalid evaluation decisions, operation failures, and sequence violations. Consumers should branch on `code`, not message text.

## Sentinel-based conformance fixture

When `customerAttributes` is supported, the fixture must provide unique customer-only sentinel values that occur in `expectedCustomerAttributes`. The runner proves each sentinel survives customer normalization and does not appear anywhere in normalized cart or line-item attributes. This detects value leakage without rejecting legitimate live fields merely because they have customer-shaped names. A `customerAttributes: false` profile may instead use empty expected attributes and an empty sentinel list.

The executable fixture uses this exact named value set:

```ts
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
```

The intentional spaces in the opaque references are sentinel-like proof that an adapter does not trim or reinterpret platform IDs.

## Integration recipe

The application orchestration order is:

```text
evaluate canonical request
  → map the canonical decision and apply it on the platform
  → commit the canonical decision/redemption idempotently
  → capture payment
```

`CommerceConnector` intentionally has no payment or persistence methods. The conformance `ConnectorFixture` supplies fake `evaluate`, `assertMappedDecision`, `apply`, `commit`, and `capturePayment` hooks; the runner records and verifies `['evaluate', 'map', 'apply', 'commit', 'capture']`. Mapping assertions are validation hooks and do not add an operation marker. A production application owns that orchestration around the connector.

## Run conformance

From the repository root, run the exact documentation fixture, the complete connector suite, or the full workspace gate:

```bash
pnpm --filter @incentives/connector-kit test -- src/documentation-example.test.ts
pnpm --filter @incentives/connector-kit test
pnpm install --frozen-lockfile
pnpm -r test
pnpm run verify:clean-tests
pnpm -r build
pnpm -r lint
git diff --check
```

The authoritative fixture is `packages/connector-kit/test-fixtures/documentation-example.ts`. It uses only public connector/contracts APIs, and `packages/connector-kit/src/documentation-example.test.ts` passes it to `runConnectorConformanceSuite()`.
