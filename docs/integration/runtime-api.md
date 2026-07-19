# Integration Runtime API

This is the platform-neutral HTTP boundary for the first client integration. A custom checkout, a manual backend integration, and a future Shopify adapter all follow the same sequence: define typed fields, store customer attributes, configure a Promo program, evaluate a cart, apply the selected effects, and commit the selected decision before payment capture.

The generated OpenAPI document is served at `GET /v1/openapi.json`. It is produced by `@incentives/contracts`; the Worker does not keep a handwritten copy.

## Access and tenant scope

The current first-client runtime uses two static bearer tokens:

- A **publishable token** can read the published schema and call evaluation. A secret token is also accepted on those routes.
- A **secret token** is required for schema configuration, customer reads/writes, Promo configuration, and redemption.
- `GET /v1/health` and `GET /v1/openapi.json` are public. The two `/v1/test-*` routes only verify which access gate a token can pass.

Send a token as `Authorization: Bearer <token>`. In this phase each configured token resolves to the seeded merchant identity. The API never accepts `merchantId` from the request: every schema, customer, program, evaluation, and redemption query derives its merchant from the credential. A reference belonging to another merchant behaves as not found.

Publishable tokens belong only in trusted storefront evaluation calls where exposure is acceptable. Secret tokens must remain on a client-controlled server and must never be shipped in browser or mobile code.

## 1. Define and publish typed data

Create fields with `POST /v1/schema/definitions` using the secret token. The client defines each field's source and type in the operator UI; the API then enforces those definitions on every write or evaluation.

```json
{
  "key": "customer.tier",
  "label": "Customer tier",
  "source": "customer",
  "type": "enum",
  "required": true,
  "enumValues": ["gold", "silver"]
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

Draft definitions may be listed, replaced, or deleted through `/v1/schema/definitions`. Keys, sources, and types become immutable once a program references the field, and referenced fields cannot be deleted. Publish the draft with `POST /v1/schema/publish`. Publication creates an immutable, incrementing version. Once integrations exist, a new required field is a breaking change and is rejected; additive optional fields are allowed.

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

Use the secret-gated `/v1/programs` routes to create, list, read, and replace Promo programs. Conditions may reference only built-in fields or fields defined in the current schema, and operators and values must match the field type.

```json
{
  "id": "gold-web-10",
  "type": "promo",
  "name": "Gold web offer",
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
  "reward": {
    "type": "order_discount",
    "calculation": "fixed",
    "amount": { "currency": "GBP", "minorUnits": 1000 }
  },
  "budget": { "currency": "GBP", "minorUnits": 10000 },
  "usageCap": 10,
  "perCustomerCap": 1,
  "stackable": false,
  "priority": 10,
  "autoApply": true
}
```

Money is always an ISO currency plus integer minor units. Fixed rewards and budgets must use the same currency; evaluation currency must also match. Free-shipping rewards cannot have a monetary budget because the request does not contain a shipping cost. Lifecycle values are `draft`, `scheduled`, `active`, `paused`, and `ended`. Only a draft program can be edited, and its external `id` is immutable.

## 4. Evaluate with stored customer data and live context

Call `POST /v1/evaluate` with a publishable or secret token:

```json
{
  "customerRef": "customer-123",
  "cart": {
    "currency": "GBP",
    "subtotal": 6500,
    "items": []
  },
  "context": {
    "channel": "web"
  }
}
```

The fixed envelope is strict. Cart money is integer minor units, product/variant/customer references are opaque strings, and live custom fields must match the currently published context/cart/line-item definitions. Persistent customer attributes have no request override path.

The response contains an immutable decision snapshot identity and one structured decision per considered program:

```json
{
  "evaluationId": "evaluation-789",
  "customerRef": "customer-123",
  "customerVersion": 1,
  "schemaVersion": 1,
  "expiresAt": "2026-07-19T10:05:00.000Z",
  "decisions": [
    {
      "programRef": "gold-web-10",
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
      "message": "You received GBP 10.00 off.",
      "commitRequired": true,
      "eligible": true
    }
  ]
}
```

`outcome` is authoritative. It can be `qualified`, `not_qualified`, `unavailable`, `invalid_code`, `exhausted`, or `conflict`. `eligible` is only a derived convenience boolean (`true` exactly when outcome is `qualified`). `reasonCodes`, `message`, and `effects` explain what happened; `commitRequired` tells the integration whether applying the effect must be followed by redemption. Never apply effects from a decision that is not qualified.

The server stores the facts, request, program/system state, decisions, schema/customer versions, and expiry in an HMAC-SHA-256-protected snapshot. The default time-to-live is 300 seconds and can be configured up to 86,400 seconds. Do not alter a decision or construct a redemption from client-calculated effects. If checkout cannot commit before `expiresAt`, evaluate again and use the new decision.

## 5. Redeem before order/payment capture

After mapping a qualified effect into the commerce platform, but **before final order or payment capture**, call secret-gated `POST /v1/redemptions`:

```json
{
  "evaluationId": "evaluation-789",
  "programRef": "gold-web-10",
  "externalOrderRef": "order-456",
  "idempotencyKey": "checkout-attempt-abc"
}
```

At least one of `externalOrderRef` or `idempotencyKey` is required; callers may send either one or both. Use stable values for the same logical checkout attempt. A successful first commit and every valid retry return the original canonical result:

```json
{
  "redemptionId": "redemption-123",
  "evaluationId": "evaluation-789",
  "programRef": "gold-web-10",
  "externalOrderRef": "order-456",
  "idempotencyKey": "checkout-attempt-abc",
  "status": "committed",
  "effects": [
    {
      "type": "order_discount",
      "calculation": "fixed",
      "amount": { "currency": "GBP", "minorUnits": 1000 }
    }
  ]
}
```

Redemption verifies the signed snapshot and its TTL, requires exactly one qualified committable decision for the selected program, and atomically rechecks active status, reward/currency consistency, total usage, per-customer cap, and remaining budget while inserting the ledger row. A successful result always has `status: "committed"`.

Retries do not consume a second use or decrement the budget twice. Reusing either identifier with a different evaluation, program, order, or counterpart identifier returns `409 VERSION_CONFLICT`. If identifiers resolve to two different previous redemptions, the request also conflicts. Do not create a new idempotency key merely because a network response was lost; retry the identical request. If the service returns `409 EXHAUSTED`, remove or re-price the stale discount before capture.

## Errors and retry guidance

All errors have the same envelope and carry the response's `x-correlation-id`:

```json
{
  "error": {
    "code": "CONTEXT_VALIDATION_FAILED",
    "message": "The request context failed validation",
    "correlationId": "...",
    "retryable": false,
    "fields": [
      { "path": "context.channel", "code": "invalid_value", "message": "..." }
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
| `409` | `VERSION_CONFLICT` | Read/reconcile customer state, or stop conflicting redemption identifier reuse. |
| `409` | `SCHEMA_CONFLICT`, `PROGRAM_CONFLICT` | Correct an unsafe schema or program lifecycle mutation. |
| `409` | `EXHAUSTED` | Remove/re-price an incentive that lost its cap, budget, or active status race. |
| `410` | `DECISION_EXPIRED` | Evaluate again, apply the new decision, then commit it. |
| `503` | `EVALUATION_UNAVAILABLE` | No ineligibility decision was fabricated. If `retryable` is true, retry with bounded exponential backoff and log the correlation id. For redemption, reuse the same identifiers. |

Retry transport failures and retryable `503` responses. Do not automatically retry non-retryable `4xx` responses without changing the request or resolving state. Evaluation/storage failures are errors, never ordinary `not_qualified` decisions.

## Local end-to-end test

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @incentives/api exec wrangler d1 migrations apply incentives-dev --local
pnpm --filter @incentives/api exec wrangler dev --local \
  --var PUBLISHABLE_TOKEN:publishable-local \
  --var SECRET_TOKEN:secret-local-token \
  --var DECISION_SIGNING_SECRET:local-decision-signing-secret
```

Use the port printed by Wrangler (normally `http://localhost:8787`). Fetch `http://localhost:8787/v1/openapi.json`, then execute the five sections above with `curl` or an API client. Keep `Authorization: Bearer secret-local-token` for configuration/customer/redemption calls and use `publishable-local` for the published-schema/evaluate calls.

The automated acceptance path runs real Hono handlers against isolated workerd+D1 storage:

```bash
pnpm --filter @incentives/api test -- full-flow.test.ts
```

That test creates definitions, publishes them, stores a customer, creates a Promo, receives a qualified decision, and commits a redemption with `status: "committed"`. Run the complete workspace gate before integration changes are merged:

```bash
pnpm -r test
pnpm -r build
pnpm -r lint
git diff --check
```
