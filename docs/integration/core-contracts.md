# Integration-Ready Core Contracts

**Notion mirror:** https://app.notion.com/p/Integration-Ready-Core-Contracts-3a1e5c7c2b8e81e4afe0ef82709f8d13

**Mirror state:** Repository and Notion copies synchronized and read back successfully on 2026-07-19.

The foundation exposes platform-neutral TypeScript and Zod contracts for typed data, evaluation, decisions, modules, and connectors. It is deliberately independent of Shopify, a custom checkout, HTTP framework, database, and UI.

## Stored customer data is not evaluation context

Customer attributes and live facts have different lifecycles:

- `customer.*` is persistent merchant-scoped data. The runtime API stores it independently and evaluation loads it by `customerRef`.
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
```

## Global eligibility and ordered rewards

A Promo has one global `eligibility` condition group and an ordered `rewardRules` array. Global eligibility answers whether the customer and transaction may enter the program at all. Only after it passes does the Promo module evaluate each reward rule's own `conditions` in array order. The first matching rule wins; later matching rules are not combined or considered. If no rule matches, `fallbackReward` is selected when present. Without a fallback, the decision is `not_qualified`, has no effects or `rewardRuleRef`, and carries `NO_REWARD_RULE_MATCHED`.

Each selected rule or fallback has a stable `id`. Qualified evaluation and committed redemption responses expose that identifier as `rewardRuleRef`, binding the returned effects to the selected configured reward. At evaluation and again during redemption, caps and remaining monetary budget are checked against the selected reward. The projected charge is the selected fixed or percent discount applied to the evaluated cart, capped by the applicable order or line value; a successful commit consumes one use and that projected amount atomically. Retries return the original redemption without consuming either again.

The schema-validated `canonicalTwoTierPromo` fixture demonstrates two ordered rules plus a fallback. The runtime guide reproduces that fixture and validated first-match, fallback, no-match, and committed-redemption examples.

## Redemption idempotency identifiers

`RedemptionRequest` structurally requires at least one idempotency identifier: `externalOrderRef` or `idempotencyKey`. A client may send either identifier alone or both together. Sending neither is invalid. `RedemptionResponse` follows the same rule and echoes at least one identifier, so a client can correlate a committed result using the mode it supplied.

The generated OpenAPI components model these alternatives as structural variants rather than documenting an invariant that runtime validation cannot prove. Plan 2 persistence therefore stores both references as nullable, enforces a database check that at least one is present, and applies independent merchant-scoped uniqueness constraints to each non-null identifier.

## Module seam and dependency rule

Clients integrate with one canonical contract; modules are an internal extension point. `IncentiveModule<TConfig>` has a required pure `evaluate(context, config)` method and optional `commit(context, decision)` and `handleEvent(event, config)` methods. A `ModuleDecision` adds integer `priority`, boolean `stackable`, and optional `stackingGroup` for central conflict resolution.

Dependencies point inward: `contracts` has validation dependencies only; `engine` depends on contracts; `module-kit` depends on contracts and engine; production modules may depend on those three. Core packages must not import React, HTTP frameworks, Cloudflare bindings, persistence, or connector implementations.

## Supported now and deferred

The foundation includes canonical schemas/OpenAPI generation, typed fact assembly and conditions, deterministic conflict resolution, the module contract/conformance suite, a pure Promo module, and the connector contract/conformance suite. Promo can produce fixed/percent order or line-item discounts and free shipping from parsed configuration.

The Runtime is implemented and verified: D1 persistence, HTTP routes, static merchant/auth boundaries, customer storage, schema publication, Promo configuration, structured signed decision snapshots, mutable caps, and atomic/idempotent redemption are available through the platform-neutral API. Commerce-platform effect application, event processing, production Shopify/manual connectors, and the Operator UI remain deferred.

`AffiliateProgram`, `ReferralProgram`, and `LoyaltyProgram` are concrete future configuration contracts published in OpenAPI for integration planning only. They are not accepted by the live `/v1/programs` routes and have no evaluation, persistence, or redemption runtime. Wallet, points, attribution, affiliate, referral, and loyalty shapes likewise reserve shared semantics without claiming runtime support. In Loyalty configuration, `assetRef` is an opaque identifier that must be preserved exactly; the Wallet Asset Catalog that will define and resolve those identifiers is explicitly deferred.

## Executable checks

From the repository root:

```bash
pnpm --filter @incentives/contracts test -- src/documentation-examples.test.ts
pnpm --filter @incentives/contracts test
pnpm --filter @incentives/api test:full-flow
pnpm --filter @incentives/api db:check
pnpm -r test
pnpm run verify:clean-tests
pnpm -r build
pnpm -r lint
```

Consumer package test scripts build their internal workspace dependencies in lifecycle hooks, so the focused commands work from a clean checkout where no `dist/` directories exist. `verify:clean-tests` archives committed `HEAD` into a validated temporary directory, performs a frozen install, and runs the recursive and filtered no-`dist` regression gates, including the API as an independent consumer.

The authoritative fixture is `packages/contracts/test-fixtures/documentation-examples.ts`; `packages/contracts/src/documentation-examples.test.ts` parses it exclusively through public contract exports.
