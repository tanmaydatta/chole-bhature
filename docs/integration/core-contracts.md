# Integration-Ready Core Contracts

**Notion mirror:** https://app.notion.com/p/Integration-Ready-Core-Contracts-3a1e5c7c2b8e81e4afe0ef82709f8d13

**Mirror state:** Repository updated for GAP-030/031 on 2026-09-25; Notion synchronization pending.

The foundation exposes platform-neutral TypeScript and Zod contracts for typed data, evaluation, decisions, modules, and connectors. It is deliberately independent of Shopify, a custom checkout, HTTP framework, database, and UI.

## Stored customer data is not evaluation context

Customer attributes and live facts have different lifecycles:

- `customer.*` is persistent merchant-scoped data. The runtime API stores it independently and evaluation loads it by `customerRef`.
- `context.*`, `cart.*`, and `line_item.*` arrive with the live evaluation request.
- `event.*` belongs to a commerce event, while `system.*` is read-only engine state.

`EvaluationRequestSchema` accepts `customerRef`, optional `codes`, `cart`, and optional `context`. Omitting `codes` or sending `codes: []` selects automatic mode; a non-empty array selects coded mode. It never accepts customer attributes as an override. A request containing a top-level `customer` property or the removed singular `code` field is rejected.

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

Canonical customer, evaluation, cart, line-item, order, response, and redemption objects are strict: undeclared envelope properties fail parsing. External references are non-empty opaque strings and must not be normalized or trimmed by connectors. Every cart/order item requires a stable `lineRef`; it must be unique within a cart even when several distinct lines share the same `productRef`.

All money uses an uppercase three-letter currency and integer minor units. Cart/order schemas additionally require non-negative `subtotal`, `unitPrice`, and `total`; monetary effects use `{ currency, minorUnits }`. Floating-point major-unit values such as `10.50` are not canonical.

These independently executable examples are copied from the fixtures. The stored customer shape contains attributes; the live coded-evaluation shape contains only a customer reference and transaction facts.

```ts
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
    items: [
      { lineRef: 'line-1', productRef: 'product-1', quantity: 1, unitPrice: 5_000 },
      { lineRef: 'line-2', productRef: 'product-1', quantity: 1, unitPrice: 7_500 },
    ],
  },
  context: { channel: 'web' },
} as const satisfies EvaluationRequest;
```

## Structured decisions

`outcome` is authoritative. Its exact values are `qualified`, `not_qualified`, `unavailable`, `invalid_code`, `exhausted`, and `conflict`. The optional `eligible` field is only a convenience and, when present, must equal `outcome === 'qualified'`.

Every decision carries a program reference/type, effects, stable reason codes, and `commitRequired`; it may also carry a customer-facing message. The exact effect union is:

| Effect | Required payload |
|---|---|
| `order_discount` | `fixed` + `amount`, or `percent` + integer `basisPoints` from 1–10,000 and optional exact-currency `maximumDiscountAmount` |
| `line_item_discount` | `productRef` plus the same fixed/percent calculation variants and optional percentage maximum |
| `free_shipping` | no additional payload |
| `wallet_debit` / `wallet_credit` | canonical `amount` |
| `points_credit` | positive integer `points` |
| `attribution` | non-empty `subjectRef` |

The executable qualified decision is:

```ts
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
```

## Global eligibility and ordered rewards

A Promo has one global `eligibility` condition group and an ordered `rewardRules` array. Global eligibility answers whether the customer and transaction may enter the program at all. Only after it passes does the Promo module evaluate each reward rule's own `conditions` in array order. The first matching rule wins; later matching rules are not combined or considered. If no rule matches, `fallbackReward` is selected when present. Without a fallback, the decision is `not_qualified`, has no effects or `rewardRuleRef`, and carries `NO_REWARD_RULE_MATCHED`.

Each selected rule or fallback has a stable `id`. Qualified evaluation and committed redemption responses expose that identifier as `rewardRuleRef`, binding the returned effects to the selected configured reward. At evaluation and again during redemption, caps and remaining monetary budget are checked against the selected reward's authoritative allocation. A successful commit consumes one use and that exact amount atomically. Retries return the original redemption and price breakdown without consuming either again.

## Authoritative merchandise pricing

`EvaluationResponse.priceBreakdown` and `RedemptionResponse.priceBreakdown` carry the same signed result: currency, original merchandise subtotal, ordered per-Promo/reward allocation, optional stable line allocations, total discount, and discounted merchandise subtotal. This is merchandise pricing only; it does not claim a final tax, shipping, or payment total. Free shipping contributes no monetary amount until an authoritative shipping-cost flow exists.

One pure calculator defines the arithmetic for evaluation, budget checks, signed evidence, redemption, and persisted ledger amounts. It processes decisions in authoritative response order and effects in configured order. Percentage integer division floors to minor units before an optional exact-currency maximum is applied. Fixed order amounts are capped by the original subtotal. Fixed line amounts multiply by quantity and cap at the line's extended value. Duplicate-product lines allocate in request order using `lineRef`. Each stacked line allocation is bounded by that line's remaining value, and every allocation is bounded by remaining merchandise, so line discounts cannot consume unrelated merchandise and the subtotal never falls below zero.

The schema-validated `canonicalTwoTierPromo` fixture demonstrates two ordered rules plus a fallback. The runtime guide reproduces that fixture and validated first-match, fallback, no-match, and committed-redemption examples.

## Promo selection and code privacy

Automatic evaluation considers only automatic Promos in private priority order and returns zero or one qualified decision. A failed higher-priority candidate permits the next eligible automatic Promo to win; no rejected automatic candidate is exposed.

Coded evaluation suppresses automatic Promos and resolves only submitted distinct normalized codes. Codes are trimmed, uppercased with locale-independent Unicode default case conversion, deduplicated by normalized value while preserving the first display value, and limited to ten distinct values. `codeResults` remains in first-submitted order and reports `selected`, `invalid_code`, `not_qualified`, `unavailable`, `exhausted`, or `combination_rejected` with stable reason codes. It never reveals a code or program that the caller did not submit.

One qualified non-stackable coded Promo is valid. Several qualified Promos combine only when all are stackable. Otherwise the response contains no decisions, and every otherwise-qualified member is marked `combination_rejected` with `CODE_COMBINATION_NOT_ALLOWED`. Selected decisions are ordered by descending priority, then immutable `programRef` ascending; input code order controls neither application order nor the later bundle-entry order.

## Atomic bundle redemption and idempotency

`RedemptionRequest` requires exactly the evaluation identity plus both client-owned identifiers:

```ts
export const canonicalRedemptionRequest = {
  evaluationId: 'evaluation-123',
  externalOrderRef: 'order-456',
  idempotencyKey: 'checkout-789',
} as const satisfies RedemptionRequest;
```

Redemption commits every selected committable decision in its signed order or commits none. `RedemptionResponse.entries` preserves that authoritative bundle order and records each `programRef`, `programRevision`, optional `rewardRuleRef`, and effects; `priceBreakdown` repeats the signed merchandise result. The initial D1 coordinator makes the header, ordered entries, per-Promo discount amounts, counters, budget changes, and version-3 result envelope one atomic database operation. Historical version-2 envelopes remain readable and are hydrated from their signed evaluation evidence on exact retry.

An exact retry returns the original committed bundle without consuming caps or budget again. Reusing an idempotency key or external order reference for a different evaluation, order, key, or bundle digest returns `409 VERSION_CONFLICT`. A stable non-retryable rejection such as `BUDGET_EXHAUSTED` is also replayed for an exact retry. A retryable `503 REDEMPTION_UNAVAILABLE` means the coordinator could not safely determine or finish the result: retry the identical request and never mint new identifiers merely because a response was lost.

## Module seam and dependency rule

Clients integrate with one canonical contract; modules are an internal extension point. `IncentiveModule<TConfig>` has a required pure `evaluate(context, config)` method and optional `commit(context, decision)` and `handleEvent(event, config)` methods. Selection receives integer `priority` and boolean `stackable` from strict Promo configuration. The historical `stackingGroup` field has been removed; current requests and configurations containing it are rejected.

Dependencies point inward: `contracts` has validation dependencies only; `engine` depends on contracts; `module-kit` depends on contracts and engine; production modules may depend on those three. Core packages must not import React, HTTP frameworks, Cloudflare bindings, persistence, or connector implementations.

## Supported now and deferred

The foundation includes canonical schemas/OpenAPI generation, typed fact assembly and conditions, deterministic conflict resolution, the module contract/conformance suite, a pure Promo module, and the connector contract/conformance suite. Promo can produce fixed/percent order or line-item discounts and free shipping from parsed configuration.

The Runtime is implemented and locally verified: D1 persistence, HTTP routes, credential-derived merchant boundaries, customer storage, schema publication, immutable Promo revisions, private automatic/coded selection, structured signed decision snapshots, mutable caps, and atomic/idempotent bundle redemption are available through the platform-neutral API. The production Operator UI supports the current schema, customer, and Promo workflows. Commerce-platform effect application, event processing, and production Shopify/manual connectors remain deferred.

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
