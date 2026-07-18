# Integration-Ready Core Contracts

The foundation exposes platform-neutral TypeScript and Zod contracts for typed data, evaluation, decisions, modules, and connectors. It is deliberately independent of Shopify, a custom checkout, HTTP framework, database, and UI.

## Stored customer data is not evaluation context

Customer attributes and live facts have different lifecycles:

- `customer.*` is persistent merchant-scoped data. A future runtime API stores it independently and evaluation loads it by `customerRef`.
- `context.*`, `cart.*`, and `line_item.*` arrive with the live evaluation request.
- `event.*` belongs to a commerce event, while `system.*` is read-only engine state.

`EvaluationRequestSchema` accepts `customerRef`, optional `code`, `cart`, and optional `context`. It never accepts customer attributes as an override. A request containing a top-level `customer` property is rejected.

The schema registry supports `string`, `number`, `boolean`, `enum`, and ISO-date definitions. Keys must use their source namespace, such as `customer.tier` with `source: 'customer'`. Enum definitions require non-empty `enumValues`; other types forbid them. `buildPublishedEvaluationJsonSchema()` emits only live context, cart-attribute, and line-item-attribute extensions. Its generated objects reject unknown fields.

The following definitions are copied from the executable `canonicalVariableDefinitions` fixture:

```ts
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
```

## Strict canonical envelope and money

Canonical customer, evaluation, cart, line-item, order, response, and redemption objects are strict: undeclared envelope properties fail parsing. External references are non-empty opaque strings and must not be normalized or trimmed by connectors.

All money uses an uppercase three-letter currency and integer minor units. Cart/order schemas additionally require non-negative `subtotal`, `unitPrice`, and `total`; monetary effects use `{ currency, minorUnits }`. Floating-point major-unit values such as `10.50` are not canonical.

These complete examples are copied from the executable fixtures. Notice that the stored customer has attributes, while the live request has only its reference and transaction facts.

```ts
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
```

## Structured decisions

`outcome` is authoritative. Its exact values are `qualified`, `not_qualified`, `unavailable`, `invalid_code`, `exhausted`, and `conflict`. The optional `eligible` field is only a convenience and, when present, must equal `outcome === 'qualified'`.

Every decision carries a program reference/type, effects, stable reason codes, and `commitRequired`; it may also carry a customer-facing message. The exact effect union is:

| Effect | Required payload |
|---|---|
| `order_discount` | `fixed` + `amount`, or `percent` + integer `basisPoints` from 1–10,000 |
| `line_item_discount` | `productRef` plus the same fixed/percent calculation variants |
| `free_shipping` | no additional payload |
| `wallet_debit` / `wallet_credit` | canonical `amount` |
| `points_credit` | positive integer `points` |
| `attribution` | non-empty `subjectRef` |

The executable qualified decision is:

```ts
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
```

## Module seam and dependency rule

Clients integrate with one canonical contract; modules are an internal extension point. `IncentiveModule<TConfig>` has a required pure `evaluate(context, config)` method and optional `commit(context, decision)` and `handleEvent(event, config)` methods. A `ModuleDecision` adds integer `priority`, boolean `stackable`, and optional `stackingGroup` for central conflict resolution.

Dependencies point inward: `contracts` has validation dependencies only; `engine` depends on contracts; `module-kit` depends on contracts and engine; production modules may depend on those three. Core packages must not import React, HTTP frameworks, Cloudflare bindings, persistence, or connector implementations.

## Supported now and deferred

The foundation currently includes canonical schemas/OpenAPI generation, typed fact assembly and conditions, deterministic conflict resolution, the module contract/conformance suite, a pure Promo module, and the connector contract/conformance suite. Promo can produce fixed/percent order or line-item discounts and free shipping from parsed configuration.

Persistence, HTTP routes, merchant/auth boundaries, customer storage, schema publication state, decision snapshots, caps, atomic/idempotent redemption, effect application, event processing, and production Shopify/manual connectors are deferred to later plans. Wallet, points, attribution, affiliate, referral, and loyalty shapes are reserved shared semantics; their production runtimes are not implemented yet.

## Executable checks

From the repository root:

```bash
pnpm --filter @incentives/contracts exec vitest run src/documentation-examples.test.ts
pnpm --filter @incentives/contracts test
pnpm -r test
pnpm -r build
pnpm -r lint
```

The authoritative fixture is `packages/contracts/test-fixtures/documentation-examples.ts`; `packages/contracts/src/documentation-examples.test.ts` parses it exclusively through public contract exports.
