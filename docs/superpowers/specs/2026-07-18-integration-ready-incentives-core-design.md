# Integration-Ready Incentives Core — Design Spec

**Date:** 2026-07-18

**Status:** Foundation and Runtime implemented and verified locally; Operator UI planned; Runtime Notion sync pending

**Purpose:** Build a client-usable, platform-neutral incentives foundation before the first client's commerce platform is known.

**Relationship to existing plans:** This design does not change the four-module MVP vision. It refines the work that should precede any Shopify, manual, or other commerce integration and requires the Phase 0 tickets to be replanned before implementation.

**Notion mirror:** https://app.notion.com/p/Integration-Ready-Incentives-Core-Design-Spec-3a1e5c7c2b8e8150bdcdde92990e114a

**Mirror state:** Repository Runtime updates are authoritative locally but have not yet been written to and read back from Notion in this session.

---

## 1. Problem and outcome

The existing React demo validates the product concept but has no backend, authentication, or persistence. We want to begin production-oriented work before finding the first client, without betting on Shopify, a custom checkout, or another platform.

The first build will be an **integration-ready promo core**:

- Clients define typed customer and live-context data in a focused dashboard UI.
- Clients update persistent customer attributes independently of checkout evaluation.
- Commerce integrations send only a customer reference plus live cart/context data at evaluation time.
- The service evaluates configured promos, returns structured platform-neutral decisions, and commits redemptions idempotently with atomic caps.
- Manual integrations and future platform connectors use the same canonical HTTP contract.
- Future affiliate, referral, loyalty, and cashback modules plug into the same engine and public integration flow.

This is more than a type library but less than a turnkey Shopify app. A custom/headless client can integrate it directly; a platform-specific client will still need an adapter.

## 2. Chosen approach

We considered three approaches:

1. **Canonical contract + adapter kit** — chosen. Maximum reuse across unknown integrations while still supporting a client-usable promo slice.
2. **Existing Phase 0 vertical slice first** — faster visual E2E, but commits early to storefront, authentication, and checkout assumptions.
3. **Generic plugin framework first** — structurally flexible, but too abstract without a real module and integration flow.

The primary integration boundary is a **versioned HTTP/domain contract**, not merely a TypeScript interface. A manual integration may never run our connector code, while a Shopify or other managed connector will.

## 3. Architectural boundaries

```text
Dashboard schema/configuration
             |
             v
      Schema Registry
             |
Customer API ---> Customer Store
             |
             v
Evaluation API ---> Decision Service ---> Incentive Modules
        |                  |                  `- Promo first
        |                  v
        |             Rules Engine
        v
Structured decisions
        |
Commerce adapter applies effects
        |
        v
Redemption API ---> Atomic caps + redemption ledger
```

Target monorepo boundaries:

```text
apps/api                         HTTP API and D1 repository adapters
apps/dashboard                   Existing demo, minimally wired for schemas + promo config
packages/contracts               Canonical types, Zod schemas, OpenAPI generation
packages/engine                  Pure conditions, messages, stacking, effect calculation
packages/module-kit              Internal IncentiveModule contract
packages/modules/promo           First production module
packages/connector-kit           CommerceConnector contract + conformance suite
```

Each unit has one purpose and depends inward:

- `contracts` has no application dependencies.
- `engine` depends only on `contracts` and stays free of React, HTTP, Cloudflare, and persistence.
- incentive modules depend on `contracts`, `engine`, and `module-kit`.
- `api` orchestrates modules and persistence behind repository interfaces.
- connectors translate commerce-platform data to and from the canonical contract; the core never imports a connector.

## 4. Canonical commerce envelope

We own a stable envelope that every integration must produce. Clients may extend it through typed definitions, but cannot redefine its core semantics.

```ts
interface EvaluationRequest {
  customerRef?: string;
  code?: string;
  cart: {
    currency: string;
    subtotal: number; // integer minor units
    items: Array<{
      productRef: string;
      variantRef?: string;
      quantity: number;
      unitPrice: number; // integer minor units
      attributes?: Record<string, unknown>;
    }>;
    attributes?: Record<string, unknown>;
  };
  context?: Record<string, unknown>;
}
```

Canonical rules:

- Money is represented as integer minor units plus an ISO currency code.
- External customer, product, variant, order, and event references are opaque strings.
- Canonical keys such as currency, subtotal, quantity, and price are immutable and reserved.
- Persistent customer attributes are not accepted as evaluation overrides.
- Live transactional facts remain request/event data; they are not stored as customer attributes.

## 5. Schema registry and configuration UI

The existing Variables concept becomes a real schema registry. The focused UI exposes four areas:

1. **Customer attributes** — persistent data stored by us.
2. **Evaluation context** — request, cart, and line-item extensions sent live.
3. **Event definitions** — typed payloads for future event-driven modules.
4. **System variables** — built-in, read-only engine state.

```ts
interface VariableDefinition {
  key: string;
  label: string;
  source: 'customer' | 'context' | 'cart' | 'line_item' | 'event' | 'system';
  type: 'string' | 'number' | 'boolean' | 'enum' | 'date';
  required: boolean;
  enumValues?: string[];
  description?: string;
  defaultErrorMessage?: string;
}
```

Examples include `customer.tier`, `customer.first_purchase`, `context.channel`, `cart.delivery_country`, `line_item.category`, and read-only `system.budget_remaining`.

Schema behaviour:

- Customer writes, evaluations, and events are validated against the merchant's published definitions.
- The condition builder only exposes defined fields and derives operators/value controls from their types.
- Unknown fields are rejected by default so spelling mistakes cannot silently change targeting.
- Missing required fields fail request validation; they are not ordinary program ineligibility.
- Field keys, sources, and types become immutable once referenced by any program.
- A referenced field cannot be deleted; breaking changes require a replacement field.
- Additive optional fields are allowed.
- Canonical and system fields cannot be edited.
- Each published schema has a version; evaluations record the version used.
- The UI/API can emit JSON Schema, a sample request, and the currently published version. Downloadable generated language types are deferred.

The first build wires the existing dashboard's Variables and Promo configuration surfaces to real APIs. This is a focused operator UI, not production dashboard completion: login, billing, analytics, and general onboarding remain deferred.

## 6. Customer data lifecycle

Clients update persistent attributes separately from evaluation:

```http
PATCH /v1/customers/{customerRef}
```

```json
{
  "attributes": {
    "first_purchase": false,
    "tier": "gold",
    "country": "GB",
    "lifetime_orders": 8
  }
}
```

The write is merchant-scoped and schema-validated. Each customer record carries an incrementing version and `updatedAt`. Optimistic concurrency is supported with an expected version so simultaneous sources do not silently overwrite one another.

Evaluation accepts `customerRef` and loads the latest stored record. The evaluation snapshot records the customer version used for auditability. Persistent attributes cannot be overridden by request data, avoiding ambiguous precedence and tampering.

Unknown-customer behaviour is explicit:

- A supplied but unknown `customerRef` returns `CUSTOMER_NOT_FOUND`.
- Anonymous evaluation omits `customerRef` and has no customer attributes.
- A condition that needs an absent optional attribute fails with a stable reason code.

Future connectors may populate customers through direct API calls, webhooks, or batch imports without changing evaluation.

## 7. Structured evaluation decisions

A single `eligible` boolean is insufficient for multiple programs, stacking, customer messages, and different effect types. The authoritative response is a list of structured decisions:

```json
{
  "evaluationId": "eval-789",
  "customerRef": "customer-123",
  "customerVersion": 14,
  "schemaVersion": 3,
  "expiresAt": "2026-07-18T15:05:00Z",
  "decisions": [
    {
      "programRef": "welcome-10",
      "programType": "promo",
      "outcome": "qualified",
      "effects": [
        {
          "type": "order_discount",
          "calculation": "fixed",
          "amount": { "currency": "GBP", "minorUnits": 1000 }
        }
      ],
      "reasonCodes": [],
      "message": "You received GBP 10.00 off",
      "commitRequired": true
    }
  ]
}
```

Decision outcomes are `qualified`, `not_qualified`, `unavailable`, `invalid_code`, `exhausted`, and `conflict`. Stable reason codes such as `MINIMUM_CART_NOT_MET` and `CUSTOMER_TIER_NOT_ALLOWED` support logs, UI, and integration tests. A derived `eligible` convenience field may be exposed but is never authoritative.

The shared effect union initially defines:

- order discount;
- line-item discount;
- free shipping;
- wallet debit/credit;
- points credit;
- attribution.

Only promo discount effects are produced in the first build. The remaining variants reserve shared semantics required by approved future modules; their runtime implementations are deferred.

Stacking/conflict resolution belongs to the central Decision Service rather than individual modules, ensuring cross-module decisions remain coherent.

## 8. Incentive module contract

Clients integrate once. Internally, module behaviour remains isolated:

```ts
interface IncentiveModule<TConfig> {
  type: ProgramType;
  evaluate(context: EvaluationContext, config: TConfig): Promise<ModuleDecision[]>;
  commit?(context: CommitContext, decision: ModuleDecision): Promise<CommitEffect[]>;
  handleEvent?(event: CommerceEvent, config: TConfig): Promise<FulfilmentEffect[]>;
}
```

Expected future use:

| Module | Evaluate | Commit | Events |
|---|---|---|---|
| Promo | Return discount | Record use and enforce caps | Usually none |
| Affiliate | Resolve code + discount | Record attribution and use | Optional conversion events |
| Referral | Return referee reward | Record referral redemption | Credit referrer after qualification |
| Loyalty/cashback | Return redeemable value | Debit redeemed value | Accrue points or credit |

The first implementation includes the Promo module plus a fake module used only in contract tests. We do not create speculative production stubs for affiliate, referral, or loyalty.

## 9. Commerce connector contract

The HTTP API is the primary public interface. `connector-kit` is a convenience and conformance layer for managed connectors:

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

Capabilities include automatic discounts, discount codes, line-item adjustments, checkout blocking, customer attributes, order webhooks, and wallet redemption. Capability validation fails configuration/integration checks early when a requested program behaviour cannot be delivered on a platform.

The conformance suite verifies normalization, money handling, identifiers, schema validation, decision mapping, source verification, idempotency propagation, unsupported-capability behaviour, and the evaluate/apply/commit ordering.

No production Shopify, manual-client, or other platform connector is included in this build. A fake connector proves the boundary.

## 10. API surface implemented by Runtime

Foundation defines the canonical schemas and seams for these endpoints; Runtime implements their HTTP and persistence behavior:

- Schema definitions: create/list/update/publish customer/context/cart/line-item definitions and fetch the published schema/sample payload.
- Customer upsert/read: schema-validated, versioned attributes.
- Promo programs: minimal create/list/update/read required to run the client flow.
- `POST /v1/evaluate`: validate, load customer/system state, run promo evaluation, resolve conflicts, persist a decision snapshot.
- `POST /v1/redemptions`: commit a decision idempotently, atomically enforcing usage and budget caps.

The canonical contracts reserve the future roles of `/v1/events` and wallet operations, but their runtime endpoints are deferred until an event-driven or wallet module is implemented.

## 11. Evaluation and redemption flow

1. Validate the fixed envelope.
2. Validate custom request/cart/line-item fields against the published schema.
3. Load stored customer attributes by `merchantId + customerRef`.
4. Load applicable programs and authoritative system state.
5. Combine customer, context, cart, line-item, and system variables without source precedence ambiguity.
6. Invoke registered modules.
7. Resolve stacking and conflicts centrally.
8. Persist a short-lived, immutable decision snapshot.
9. Return decisions, effects, messages, reasons, schema/customer versions, and expiry.
10. The commerce integration maps and presents the effects.
11. Before payment capture, it commits the selected decision.
12. Redemption verifies integrity/expiry and atomically rechecks program status, budget, and usage caps before recording the ledger entry.

The decision snapshot preserves evaluated customer/context facts for audit. Redemption does not silently re-evaluate customer targeting against a newer customer version; it rechecks only authoritative mutable constraints and decision integrity within the TTL.

## 12. Persistence and consistency

Storage is isolated behind repository interfaces; the first concrete implementation follows the approved Cloudflare/D1 direction.

The minimum persisted data is:

- merchants/access-gate identity;
- variable definitions and published schema versions;
- customers with attribute JSON, version, and timestamps;
- promo programs/configuration;
- short-lived evaluation decision snapshots;
- redemption ledger and program counters.

Every row is merchant-scoped. Promo caps use a D1 conditional update and ledger insert in an atomic batch, following the existing Phase 0 correctness design. Durable Objects remain the later scale upgrade; they are not needed to prove correctness at the first-client stage.

Redemptions are idempotent by merchant plus external order reference and/or explicit idempotency key. A retry returns the original stable result without a second counter decrement or ledger row.

## 13. Errors and failure policy

- Invalid fixed or custom fields return structured field-level validation errors.
- Missing required context is a request error, not `not_qualified`.
- Missing optional attributes produce an ineligible decision with a stable reason when a condition needs them.
- A supplied unknown customer returns `CUSTOMER_NOT_FOUND`; anonymous evaluation must omit the reference.
- Engine/storage failures return `EVALUATION_UNAVAILABLE` and never masquerade as ineligibility.
- Expired decisions cannot be committed.
- Redemption rechecks status/caps/budget and can return `exhausted` even after a previously qualified evaluation.
- Repeated redemption requests return their original result.
- Cross-merchant references behave as not found.
- Any module failure fails the whole evaluation in the first version; partial module results are deferred.

All API errors use a consistent envelope containing a stable code, human-readable message, correlation id, retryability, and optional field issues.

## 14. Security and tenancy

- Every schema, customer, program, decision, and redemption lookup includes `merchant_id`.
- Persistent customer attributes cannot be overridden during evaluation.
- Decision ids are opaque and bound to the merchant, customer/evaluation snapshot, expiry, and effect payload.
- Redemption rejects a tampered, expired, cross-merchant, or already-conflicting decision.
- The first build may use the Phase 0 static publishable/secret access gate; production dashboard sessions, rotatable API keys, and full billing gates remain later scope.

## 15. Verification

Required automated coverage:

- schema creation/publication and safe-edit restrictions;
- runtime validation for customer, request, cart, and line-item fields;
- stored customer attributes loaded during evaluation;
- fixed/custom/system values combined correctly;
- type-aware condition operators and messages;
- structured qualified, not-qualified, invalid-code, exhausted, and conflict decisions;
- schema/customer versions captured in decisions;
- decision expiry and tamper/cross-merchant rejection;
- atomic caps and idempotent redemption;
- tenant isolation across every repository/API path;
- Promo module compliance with `IncentiveModule`;
- fake second module proving module extensibility;
- fake connector passing the conformance suite;
- full flow: define schema → publish → update customer → configure promo → evaluate cart → commit redemption.

## 16. First-build scope

**In:**

- monorepo/package boundaries above;
- canonical contracts and OpenAPI generation;
- schema registry plus focused dashboard configuration UI;
- customer persistence/versioning;
- pure rules/decision engine;
- module and connector contracts/conformance tests;
- Promo module and minimal live promo configuration UI/API;
- evaluation decision snapshots;
- idempotent redemptions with atomic caps and ledger;
- fake connector/integration simulator;
- documentation and examples.

**Out:**

- Shopify or any other production platform connector;
- a client-specific checkout UI;
- automatic catalogue/customer synchronization mechanisms;
- affiliate, referral, loyalty, cashback, events, and wallet runtime implementations;
- dashboard login/signup, billing, analytics, and production onboarding polish;
- Durable Objects, KV hot cache, Queues, Cron, flash-sale scale testing;
- generated multi-language SDKs.

## 17. Client-visible definition of done

A prospective client can:

1. Define typed persistent customer fields and live evaluation fields in the UI.
2. Publish the schema and inspect a generated sample payload.
3. Update a customer's stored attributes independently of checkout.
4. Configure a basic promo with conditions, reward, dates, and usage/budget limits.
5. Send `customerRef` plus a canonical cart/context payload to evaluate.
6. Receive structured effects, messages, reasons, versions, and expiry.
7. Apply the effect in a custom checkout and commit it before payment capture.
8. Retry safely without double-counting.
9. Observe a deterministic rejection if the promo expires or exhausts.
10. Use the connector conformance suite to assess a future platform adapter.

## 18. Delivery workflow and documentation

- The repository and Notion copies are synchronized mirrors of the same spec; neither may change without updating the other.
- Future changes to this design must update the repo and Notion copies together in the same unit of work.
- Implementation must start from a new feature branch (suggested: `feat/integration-ready-core`), never directly on `main`.
- The implementation plan must be written and approved before code begins.
- Existing unrelated worktree changes, including the untracked `CLAUDE.md`, must remain untouched unless explicitly included by the user.

## 19. Open questions

None blocking. Exact endpoint paths, database columns, and task sequencing belong in the implementation plan; they must preserve the contracts and behaviours approved here.
