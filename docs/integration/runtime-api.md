# Integration Runtime API

**Notion mirror:** https://app.notion.com/p/Integration-Runtime-API-3a2e5c7c2b8e812f889eeddd2d56ef70

**Mirror state:** Repository and Notion copies synchronized and read back successfully on 2026-07-24.

This is the platform-neutral HTTP boundary for the first client integration. A custom checkout, a manual backend integration, and a future Shopify adapter all follow the same sequence: define typed fields, store customer attributes, configure a Promo program, evaluate a cart, apply the complete selected effect set, and commit the complete selected bundle before payment capture.

The generated OpenAPI document is served at `GET /v1/openapi.json`. It is produced by `@incentives/contracts`; the Worker does not keep a handwritten copy.

## Access and tenant scope

The current first-client runtime uses persisted, show-once merchant API credentials created by an authorized operator:

- A `pk_…` **publishable credential** can read the published schema and call evaluation when it carries the required scope. It also has an exact-origin allowlist and per-minute rate limit.
- An `sk_…` **secret credential** is required for customer reads/writes, Promo runtime routes, and redemption. Scoped routes require `schema:read`, `customers:write`, `evaluations:write`, or `redemptions:write` as applicable.
- Schema definition authoring/publication and immutable Promo revision publication are operator workflows behind the session-authenticated BFF, not public credential endpoints.
- `GET /v1/health` and `GET /v1/openapi.json` are public. The two `/v1/test-*` routes only verify which access gate a token can pass.

Send a token as `Authorization: Bearer <token>`. Only its digest is persisted after the show-once handoff. Each credential resolves to exactly one merchant; the API never accepts `merchantId` from the request. Every schema, customer, program, evaluation, and redemption query derives its merchant from the authenticated credential. A reference belonging to another merchant behaves as not found.

Publishable tokens belong only in trusted storefront evaluation calls where exposure is acceptable. Secret tokens must remain on a client-controlled server and must never be shipped in browser or mobile code.

## 1. Define and publish typed data

Create and publish fields through the authorized Operator **Variables** workflow. Operator Web calls the private Core BFF surface with a signed session and explicit permissions; there is no public `/v1/schema/definitions` mutation. The published public schema then enforces those definitions on every customer write or evaluation.

```json
{
  "key": "customer.tier",
  "label": "Customer tier",
  "source": "customer",
  "type": "enum",
  "required": true,
  "enumValues": ["bronze", "silver", "gold"]
}
```

```json
{
  "key": "context.channel",
  "label": "Sales channel",
  "source": "context",
  "type": "enum",
  "required": true,
  "enumValues": ["web", "mobile"]
}
```

Sources have distinct lifecycles:

- `customer.*` is persistent client-owned profile data stored by this service.
- `context.*`, `cart.*`, and `line_item.*` are live values sent with evaluation. Their shape is defined in the UI before callers send them.
- `system.*` and canonical commerce fields such as `cart.currency`, `cart.subtotal`, and line price/quantity are built in and read-only.
- `event.*` is reserved for future event-driven modules; there is no events runtime endpoint in this build.

Authorized operators may list, replace, deprecate, and publish draft definitions through the BFF. Keys, sources, and types become immutable once a program references the field, and referenced fields cannot be deleted. Publication creates an immutable, incrementing version. Once integrations exist, a new required field is a breaking change and is rejected; additive optional fields are allowed.

`GET /v1/schema/published` accepts a publishable or secret token and returns the version, definitions, strict JSON Schema, and sample evaluation payload. Unknown custom fields are rejected. Missing required live fields are request validation errors, not ordinary program ineligibility.

## 2. Store customer attributes independently

Store or replace a customer profile with the secret token:

```http
PATCH /v1/customers/customer-123
Content-Type: application/json
```

```json
{
  "attributes": {
    "tier": "gold"
  }
}
```

`PATCH` uses **whole-object replacement semantics**, not a deep merge. Send every attribute that should remain stored. The first write creates version `1`. Every later write must include the version returned by the preceding read or write:

```json
{
  "attributes": {
    "tier": "silver"
  },
  "expectedVersion": 1
}
```

Two writers using the same expected version cannot silently overwrite each other; one receives `409 VERSION_CONFLICT`. Read the latest record with `GET /v1/customers/{customerRef}`, reconcile, and retry with the new version.

Do not send persistent customer attributes to evaluation. Evaluation accepts only an optional `customerRef`, loads the latest stored profile itself, and records the customer version in the decision snapshot. A supplied unknown reference returns `404 CUSTOMER_NOT_FOUND`; omit `customerRef` for an anonymous evaluation.

## 3. Configure a Promo program

Create, review, publish, and manage Promo revisions through the authorized
Operator **Promos** workflow. Operator Web calls private Core operator methods
with a signed session and explicit program permissions. The public HTTP app does
not mount `/v1/programs`; requests to that path return `404 NOT_FOUND` even with
a valid `sk_…` credential.

Use the following as the configuration to enter and review in Operator.
Conditions may reference only built-in fields or fields defined in the current
schema, and operators and values must match the field type.

```json
{
  "id": "gold-web-rewards",
  "type": "promo",
  "name": "Gold web rewards",
  "status": "active",
  "eligibility": {
    "match": "ALL",
    "conditions": [
      {
        "id": "gold-tier",
        "variable": "customer.tier",
        "operator": "eq",
        "value": "gold"
      },
      {
        "id": "web-channel",
        "variable": "context.channel",
        "operator": "eq",
        "value": "web"
      }
    ]
  },
  "rewardRules": [
    {
      "id": "large-cart-20-percent",
      "name": "Twenty percent off large carts",
      "conditions": {
        "match": "ALL",
        "conditions": [
          {
            "id": "cart-at-least-100",
            "variable": "cart.subtotal",
            "operator": "gte",
            "value": 10000
          }
        ]
      },
      "reward": {
        "type": "order_discount",
        "calculation": "percent",
        "basisPoints": 2000
      }
    },
    {
      "id": "medium-cart-10-off",
      "name": "Ten pounds off medium carts",
      "conditions": {
        "match": "ALL",
        "conditions": [
          {
            "id": "cart-at-least-50",
            "variable": "cart.subtotal",
            "operator": "gte",
            "value": 5000
          }
        ]
      },
      "reward": {
        "type": "order_discount",
        "calculation": "fixed",
        "amount": { "currency": "GBP", "minorUnits": 1000 }
      }
    }
  ],
  "fallbackReward": {
    "id": "fallback-5-off",
    "name": "Fallback five pounds off",
    "reward": {
      "type": "order_discount",
      "calculation": "fixed",
      "amount": { "currency": "GBP", "minorUnits": 500 }
    }
  },
  "budget": { "currency": "GBP", "minorUnits": 100000 },
  "usageCap": 100,
  "perCustomerCap": 1,
  "stackable": false,
  "priority": 10,
  "autoApply": true
}
```

`eligibility` is the global gate. If it passes, `rewardRules` are evaluated in the configured order and the first matching rule wins, even when a later rule also matches. If none match, `fallbackReward` is selected when configured. A Promo without a matching rule or fallback returns `not_qualified` with `NO_REWARD_RULE_MATCHED`.

Money is always an ISO currency plus integer minor units. Fixed rewards and budgets must use the same currency; evaluation currency must also match. In the current runtime, a free-shipping reward has no monetary charge and cannot coexist with a budget because evaluation does not yet accept an authoritative shipping cost. The approved future authority will make free-shipping budgets and per-order caps optional, require a client-supplied actual shipping cost in the same currency with no conversion, apply a full waiver or none, and use a configurable reservation TTL that defaults to 15 minutes. Expiry and failure recovery are money movements, with event-driven reversals planned rather than implemented here. Lifecycle values are `draft`, `scheduled`, `active`, `paused`, and `ended`. Only a draft program can be edited, and its external `id` is immutable.

The OpenAPI document also publishes `AffiliateProgram`, `ReferralProgram`, and `LoyaltyProgram` as future configuration contracts. The current Operator program workflow accepts only Promo configuration, and no runtime evaluates or persists those future program types. Loyalty `assetRef` values are opaque references; preserve them byte-for-byte. Defining and resolving them through a Wallet Asset Catalog is deferred.

## 4. Evaluate automatic or submitted coded Promos

Call `POST /v1/evaluate` with a publishable or secret token. The fixed envelope is strict. Cart money is integer minor units, product/variant/customer references are opaque strings, and live custom fields must match the currently published context/cart/line-item definitions. Persistent customer attributes have no request override path.

### Automatic mode: zero or one public winner

Omit `codes` or send an empty array to select automatic mode:

```json
{
  "customerRef": "customer-123",
  "cart": {
    "currency": "GBP",
    "subtotal": 12500,
    "items": []
  },
  "context": {
    "channel": "web"
  }
}
```

Core privately checks automatic Promos by descending priority and then immutable `programRef` ascending. It returns the first qualified candidate and reveals none of the rejected candidates:

```json
{
  "evaluationId": "evaluation-789",
  "customerRef": "customer-123",
  "customerVersion": 1,
  "schemaVersion": 1,
  "expiresAt": "2026-07-19T10:05:00.000Z",
  "decisions": [
    {
      "programRef": "gold-web-rewards",
      "programRevision": 1,
      "programType": "promo",
      "outcome": "qualified",
      "rewardRuleRef": "large-cart-20-percent",
      "effects": [
        {
          "type": "order_discount",
          "calculation": "percent",
          "basisPoints": 2000
        }
      ],
      "reasonCodes": [],
      "message": "You received 20% off.",
      "commitRequired": true,
      "eligible": true
    }
  ]
}
```

For a globally eligible cart below both thresholds, the configured fallback is still a qualified automatic winner:

```json
{
  "evaluationId": "evaluation-789",
  "customerRef": "customer-123",
  "customerVersion": 1,
  "schemaVersion": 1,
  "expiresAt": "2026-07-19T10:05:00.000Z",
  "decisions": [
    {
      "programRef": "gold-web-rewards",
      "programRevision": 1,
      "programType": "promo",
      "outcome": "qualified",
      "rewardRuleRef": "fallback-5-off",
      "effects": [
        {
          "type": "order_discount",
          "calculation": "fixed",
          "amount": { "currency": "GBP", "minorUnits": 500 }
        }
      ],
      "reasonCodes": [],
      "message": "You received GBP 5.00 off.",
      "commitRequired": true,
      "eligible": true
    }
  ]
}
```

If no automatic Promo qualifies, the successful response has an empty decision list; it does not expose private `not_qualified`, `unavailable`, or `exhausted` candidates:

```json
{
  "evaluationId": "evaluation-789",
  "customerRef": "customer-123",
  "customerVersion": 1,
  "schemaVersion": 1,
  "expiresAt": "2026-07-19T10:05:00.000Z",
  "decisions": []
}
```

### Coded mode: submitted-code diagnostics and stacking

A non-empty `codes` array suppresses every automatic Promo and resolves only the submitted codes:

```json
{
  "codes": ["GATEC15", "VIP20"],
  "customerRef": "customer-1",
  "cart": {
    "currency": "GBP",
    "subtotal": 12500,
    "items": []
  },
  "context": {
    "channel": "web"
  }
}
```

Core trims and uppercases codes using locale-independent Unicode default case conversion. Duplicate normalized values are evaluated once while the first submitted display value is preserved. `codeResults` stays in first-submitted order, but selected decisions are ordered by descending priority and then `programRef` ascending:

```json
{
  "evaluationId": "evaluation-123",
  "customerRef": "customer-1",
  "customerVersion": 1,
  "schemaVersion": 1,
  "expiresAt": "2026-07-24T15:05:00.000Z",
  "decisions": [
    {
      "programRef": "vip-shipping",
      "programRevision": 1,
      "programType": "promo",
      "outcome": "qualified",
      "rewardRuleRef": "free-shipping",
      "effects": [{ "type": "free_shipping" }],
      "reasonCodes": [],
      "commitRequired": true,
      "eligible": true
    },
    {
      "programRef": "gate-c-15",
      "programRevision": 1,
      "programType": "promo",
      "outcome": "qualified",
      "rewardRuleRef": "fifteen-percent",
      "effects": [
        {
          "type": "order_discount",
          "calculation": "percent",
          "basisPoints": 1500
        }
      ],
      "reasonCodes": [],
      "commitRequired": true,
      "eligible": true
    }
  ],
  "codeResults": [
    {
      "code": "GATEC15",
      "normalizedCode": "GATEC15",
      "outcome": "selected",
      "programRef": "gate-c-15",
      "reasonCodes": []
    },
    {
      "code": "VIP20",
      "normalizedCode": "VIP20",
      "outcome": "selected",
      "programRef": "vip-shipping",
      "reasonCodes": []
    }
  ]
}
```

Diagnostics use `selected`, `invalid_code`, `not_qualified`, `unavailable`, `exhausted`, or `combination_rejected`. Invalid or otherwise unselected submitted codes do not block valid stackable codes. One qualified non-stackable code succeeds. If several codes qualify and any selected Promo is non-stackable, `decisions` is empty and every otherwise-qualified member has `outcome: "combination_rejected"` plus `CODE_COMBINATION_NOT_ALLOWED`. The response never reveals a code or program the caller did not submit.

`outcome` is authoritative. `eligible` is only a derived convenience boolean (`true` exactly when outcome is `qualified`). `rewardRuleRef` identifies the selected conditional rule or fallback. Never apply effects from a decision that is not qualified.

Budget and cap checks use only each selected reward. Percent order discounts are capped by order value; fixed line-item discounts are multiplied by matching quantity and capped by line value. Evaluation marks a coded diagnostic exhausted or skips an exhausted automatic candidate. Redemption recomputes all selected charges from the signed cart and atomically rechecks every budget, total usage cap, and per-customer cap before committing.

The server stores the mode, request digest, submitted-code diagnostics, facts, request, selected decisions, schema/customer versions, correlation ID, and expiry in an HMAC-SHA-256-protected snapshot. The default time-to-live is 300 seconds and can be configured up to 86,400 seconds. Do not alter a decision or construct a redemption from client-calculated effects. If checkout cannot commit before `expiresAt`, evaluate again and use the new decision.

## 5. Redeem the complete selected bundle before capture

After mapping every qualified effect into the commerce platform, but **before final order or payment capture**, call secret-gated `POST /v1/redemptions`:

```json
{
  "evaluationId": "evaluation-123",
  "externalOrderRef": "order-456",
  "idempotencyKey": "checkout-789"
}
```

Both client-owned identifiers are required. A successful first commit and every exact retry return the original canonical bundle:

```json
{
  "redemptionId": "redemption-123",
  "evaluationId": "evaluation-123",
  "externalOrderRef": "order-456",
  "status": "committed",
  "entries": [
    {
      "programRef": "vip-shipping",
      "programRevision": 1,
      "rewardRuleRef": "free-shipping",
      "effects": [{ "type": "free_shipping" }]
    },
    {
      "programRef": "gate-c-15",
      "programRevision": 1,
      "rewardRuleRef": "fifteen-percent",
      "effects": [
        {
          "type": "order_discount",
          "calculation": "percent",
          "basisPoints": 1500
        }
      ]
    }
  ],
  "idempotencyKey": "checkout-789"
}
```

The complete selected decision set is the unit of work. Redemption verifies the signed snapshot and TTL, revalidates every active revision and reward, then asks the provider-neutral atomic coordinator to commit all ordered entries or none. The initial D1 adapter atomically writes the bundle header and entries and updates all applicable usage, per-customer, and budget counters. It never partially commits a valid prefix. The future distributed free-shipping budget authority must implement this same port and stable outcomes; no Durable Object or distributed reservation adapter is implemented in the current delivery.

An exact retry returns the same `redemptionId` and ordered `entries` without consuming a second use or decrementing any budget twice. The exact retry of a stable non-retryable rejection returns the same error. Reusing an idempotency key or external order reference with a changed evaluation, order, counterpart identifier, or bundle digest returns `409 VERSION_CONFLICT`. Do not create a new key because a response was lost.

For a retryable `503 REDEMPTION_UNAVAILABLE`, retry the identical request with bounded exponential backoff. For `409 BUDGET_EXHAUSTED`, `USAGE_CAP_EXHAUSTED`, or `PER_CUSTOMER_CAP_EXHAUSTED`, remove or re-price the entire stale bundle before capture; no child was committed.

## Errors and retry guidance

All errors have the same envelope and carry the response's `x-correlation-id`:

```json
{
  "error": {
    "code": "CONTEXT_VALIDATION_FAILED",
    "message": "The request context failed validation",
    "correlationId": "correlation-123",
    "retryable": false,
    "fields": [
      {
        "path": "context.channel",
        "code": "invalid_value",
        "message": "Expected one of: web, mobile"
      }
    ]
  }
}
```

| HTTP | Typical code | Integration action |
| --- | --- | --- |
| `400` | `CONTEXT_VALIDATION_FAILED` | Correct the fixed envelope, field type, required field, program config, or identifier shape. Do not retry unchanged. |
| `401` | `UNAUTHORIZED` | Supply a valid bearer token. |
| `403` | `FORBIDDEN` | Move the call to a trusted server using the secret token. |
| `404` | `CUSTOMER_NOT_FOUND`, `SCHEMA_NOT_PUBLISHED`, `PROGRAM_NOT_FOUND`, `NOT_FOUND` | Correct the merchant-scoped reference or create/publish the dependency. |
| `409` | `VERSION_CONFLICT` | Read/reconcile customer state, or stop changed redemption-identifier/bundle reuse. |
| `409` | `SCHEMA_CONFLICT`, `PROGRAM_CONFLICT` | Correct an unsafe schema or program lifecycle mutation. |
| `409` | `NOTHING_TO_COMMIT` | Do not redeem an evaluation with no selected committable decisions. |
| `409` | `BUDGET_EXHAUSTED`, `USAGE_CAP_EXHAUSTED`, `PER_CUSTOMER_CAP_EXHAUSTED` | Remove/re-price the complete stale bundle; no child committed. |
| `410` | `DECISION_EXPIRED` | Evaluate again, apply the new decision, then commit it. |
| `503` | `EVALUATION_UNAVAILABLE`, `REDEMPTION_UNAVAILABLE` | No ineligibility or committed bundle was fabricated. Retry with bounded exponential backoff, record the correlation ID, and reuse identical redemption identifiers. |

Retry transport failures and retryable `503` responses. Do not automatically retry non-retryable `4xx` responses without changing the request or resolving state. Evaluation/storage failures are errors, never ordinary `not_qualified` decisions.

## Local end-to-end test

Use the disposable three-Worker/two-D1 procedure in
[Gate C manual end-to-end test](../testing/gate-c-manual-test.md), through root
selection and the authorized schema/credential steps. Do not reuse or delete a
normal checkout's Wrangler state. In Operator:

1. create and publish the two definitions from section 1;
2. create a disposable secret credential with all four current scopes;
3. copy its plaintext only from the show-once handoff; and
4. load it into the shell without printing it.

```bash
INCENTIVES_API_URL="http://localhost:8787"
read -r -s -p 'Disposable local secret credential: ' INCENTIVES_SECRET_TOKEN
printf '\n'
export INCENTIVES_API_URL INCENTIVES_SECRET_TOKEN

curl --fail-with-body --silent --request PATCH \
  "$INCENTIVES_API_URL/v1/customers/customer-123" \
  --header "Authorization: Bearer $INCENTIVES_SECRET_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"attributes":{"tier":"gold"}}'
```

In the authorized Operator **Promos** workflow, create an Automatic Promo with
external reference `gold-web-rewards`, enter the configuration from section 3,
save the draft, inspect the publication review, and publish revision 1. Confirm
the canonical reload shows it as Active before continuing. Do not try to create
it with the public credential: `/v1/programs` is deliberately absent from the
public app.

Evaluate both sides of the threshold. Neither evaluation resends customer attributes:

```bash
curl --fail-with-body --silent --request POST \
  "$INCENTIVES_API_URL/v1/evaluate" \
  --header "Authorization: Bearer $INCENTIVES_SECRET_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"customerRef":"customer-123","cart":{"currency":"GBP","subtotal":7500,"items":[]},"context":{"channel":"web"}}'

HIGH_EVALUATION="$(curl --fail-with-body --silent --request POST \
  "$INCENTIVES_API_URL/v1/evaluate" \
  --header "Authorization: Bearer $INCENTIVES_SECRET_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{"customerRef":"customer-123","cart":{"currency":"GBP","subtotal":12500,"items":[]},"context":{"channel":"web"}}')"
HIGH_EVALUATION_ID="$(node -e \
  'process.stdout.write(JSON.parse(process.argv[1]).evaluationId)' \
  "$HIGH_EVALUATION")"
```

Commit the higher-tier decision before capture, then retry the identical request. Both
responses must contain the same `redemptionId` and `rewardRuleRef`:

```bash
curl --fail-with-body --silent --request POST \
  "$INCENTIVES_API_URL/v1/redemptions" \
  --header "Authorization: Bearer $INCENTIVES_SECRET_TOKEN" \
  --header 'Content-Type: application/json' \
  --data "{\"evaluationId\":\"$HIGH_EVALUATION_ID\",\"externalOrderRef\":\"manual-order-1\",\"idempotencyKey\":\"manual-checkout-1\"}"

curl --fail-with-body --silent --request POST \
  "$INCENTIVES_API_URL/v1/redemptions" \
  --header "Authorization: Bearer $INCENTIVES_SECRET_TOKEN" \
  --header 'Content-Type: application/json' \
  --data "{\"evaluationId\":\"$HIGH_EVALUATION_ID\",\"externalOrderRef\":\"manual-order-1\",\"idempotencyKey\":\"manual-checkout-1\"}"
```

Both responses must contain the same `redemptionId` and the same ordered `entries`.
The explicit dependency build makes this sequence work from a clean checkout without
pre-existing `dist/` directories. The automated acceptance path likewise builds those
dependencies and then runs real Hono handlers against isolated workerd+D1 storage:

```bash
pnpm --filter @incentives/api test:full-flow
```

That test creates definitions, publishes them, stores a customer once, creates ordered
tiered and no-fallback Promos, evaluates both cart thresholds without customer-attribute
overrides, retries a committed bundle idempotently, and proves program-wide cap and
budget exhaustion across selected rules. Run the complete workspace gate before
integration changes are merged:

```bash
pnpm -r test
pnpm --filter @incentives/api db:check
pnpm -r build
pnpm -r lint
git diff --check
```

Every JSON block in this guide is copied from a named value in `packages/contracts/test-fixtures/documentation-examples.ts` (or, for the two field definitions, from `canonicalVariableDefinitions`). `packages/contracts/src/documentation-examples.test.ts` parses each value through its public contract schema.
