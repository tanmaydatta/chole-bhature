# Shopify Plus Turnkey Integration — Design Spec

**Date:** 2026-11-18  
**Status:** Revised Post-Architectural Review (V2)  
**Audience:** Core Engineers, Product Leads, Integration Engineers  

---

## 1. Intent and Why

Every growing e-commerce merchant on Shopify Plus runs incentives—welcome discounts, tiered cart promotions, creator affiliate codes, and loyalty cashback. Today, running these programs requires stitching together multiple disparate point-solution apps (a loyalty app + a referral app + a discount tool) that do not share customer data, unified targeting conditions, or atomic budget controls.

This project delivers a **100% plug-and-play Shopify Plus App** that connects a merchant's Shopify store directly to the `incentives-platform` engine. The merchant's marketing and growth team gains the full power of our condition-based targeting, atomic financial caps, and ordered reward rules—without writing a single line of code, modifying theme templates, or needing an in-house engineering team.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
* **Zero Merchant Engineering (Plug and Play):** The merchant installs the custom app, activates the Checkout UI Extension in Shopify's Checkout Editor via drag-and-drop, and manages all campaigns from our dashboard.
* **Eligible Offers at Checkout:** Shoppers at checkout see a native, interactive list of eligible public offers, tiered progress bars (e.g. *"Add $15 to unlock 25% off"*), and can apply or swap offers with a single click.
* **Integrated Code Entry:** Shoppers can enter promo and creator affiliate codes inside the checkout widget or the checkout flow, with immediate pre-application evaluation against the Core API.
* **Atomic Ledger and Budget Protection:** Discount redemptions are committed idempotently on payment completion (`orders/paid`), decremented against real-time campaign budgets and customer usage caps in Cloudflare D1, with post-capture reconciliation safety.
* **Monorepo and Stack Consistency:** The connector backend lives in this repository as `apps/shopify-connector`, built on Cloudflare Workers and Hono, directly consuming [`@incentives/connector-kit`](../../packages/connector-kit/src/connector.ts) and [`@incentives/contracts`](../../packages/contracts/src/index.ts) via internal Worker Service Bindings.

### Non-Goals
* **Non-Plus Store Support:** Standard Shopify plans (Basic, Shopify, Advanced) are intentionally excluded from this design. We assume the merchant is on Shopify Plus, allowing native Checkout UI Extensions and custom app deployment.
* **Storefront Theme Liquid Editing:** We do not touch, inject, or edit merchant theme code, cart drawers, or Liquid templates. All shopper interactions happen securely inside the Shopify Checkout funnel.
* **Public App Store Listing (Initial Phase):** This integration will be deployed as a Shopify Custom App directly installable by design partner stores, bypassing Shopify App Store review delays, mandatory public app billing APIs, and third-party app directory requirements.

### Anti-Goals
* **Never Execute Network Calls in WebAssembly:** Shopify Discount Functions run in a sandboxed Wasm environment with no network access (`fetch` is illegal). We will never attempt to call external APIs from within the Discount Function.
* **Never Trust Client-Side Calculations for Financial State:** The Checkout UI Extension displays estimated offers, but actual order price reductions and redemptions are verified against signed snapshots and committed via verified server-side webhooks.
* **Never Overwrite or Clutter Native Shopify Codes:** We do not spam Shopify Admin with thousands of temporary throwaway discount codes. Promos and affiliate codes are managed through unified Function IDs and registered code nodes.
* **Never Leak Unannounced or Affiliate Codes in Discovery:** The `candidateOffers` discovery API strictly evaluates public, `autoApply: true` promotions and never enumerates secret, coded, or partner campaigns to anonymous shoppers.

---

## 3. Constraints

1. **Shopify Plus Only:** Leverages Checkout Extensibility (`@shopify/ui-extensions-react/checkout`), Checkout Network Access (`network_access = true`), and Checkout Blocking (`block_progress = true`).
2. **Zero Code for Merchants:** The onboarding workflow requires no API token copying, no file editing, and no custom webhook configuration.
3. **Wasm Execution Sandbox:** Discount Functions must execute deterministically in <5ms without network calls and stay strictly under the 11 million instruction budget. To meet this budget reliably, the function is written in **Rust** (`cargo wasi`).
4. **Tenant Isolation:** Every Shopify store maps to a distinct merchant tenant in `apps/api`. API calls and database queries must remain strictly tenant-isolated using per-tenant signing keys and worker service bindings.

---

## 4. Approaches Considered

### Approach 1: Integrated Cloudflare Worker App (`apps/shopify-connector`) *(Selected)*
* **Description:** Add `apps/shopify-connector` as a new Cloudflare Worker app in the monorepo, paired with an `extensions/` directory housing the Checkout UI Extension (React) and Shopify Discount Function (Rust/Wasm). Connects to Core API via Cloudflare Worker RPC / Service Bindings.
* **Why Selected:** Seamlessly integrates with our existing Cloudflare Workers + D1 stack, reuses `@incentives/connector-kit` directly, maintains one unified CI/test gate, and avoids managing external servers or databases.

### Approach 2: Shopify Remix Starter App (`apps/shopify-app`)
* **Description:** Scaffold a standard `@shopify/shopify-app-remix` application using Node.js, Prisma, and Docker/Vercel.
* **Why Rejected:** Introduces a second database (SQLite/PostgreSQL via Prisma), an extra runtime (Node.js), and separate hosting overhead, fragmenting our monorepo architecture.

### Approach 3: Headless Checkout Extension Only (Direct Core API Calls)
* **Description:** Deploy only a frontend Checkout UI Extension that connects directly to `apps/api`, requiring the merchant to manually input API keys and set up webhook endpoints in Shopify Admin.
* **Why Rejected:** Violates the core requirement: zero merchant engineering. Non-technical merchants cannot and will not manage webhook signatures or credential scopes manually.

---

## 5. Architectural Specification

### 5.1 System Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                     SHOPIFY PLUS                                       │
│                                                                                        │
│  [ Checkout UI Extension ] (React / Web Worker)                                        │
│          │                                                                             │
│          │ 1. Direct fetch() to /v1/evaluate (pk_...)                                  │
│          ▼                                                                             │
│  [ Core API: apps/api ] ── Evaluates eligibility, tiers & candidate offers             │
│          │                                                                             │
│          │ 2. Returns decisions + candidateOffers[] + tenant-signed token               │
│          ▼                                                                             │
│  [ Checkout UI Extension ]                                                             │
│          │                                                                             │
│          │ 3. applyAttributeChange('_incentives_eval', signedPayloadJson)              │
│          │ 4. applyDiscountCodeChange('INCENTIVES_APPLIED')                            │
│          │ 5. useBuyerJourneyIntercept blocks "Pay Now" during in-flight evaluation   │
│          ▼                                                                             │
│  [ Shopify Native Checkout Engine ]                                                    │
│          │                                                                             │
│          │ 6. Executes Rust Wasm Function locally (deterministic <100k instructions)   │
│          ▼                                                                             │
│  [ Discount Function (Rust Wasm) ] ◄── Reads cart.attribute('_incentives_eval')       │
│          │                         ◄── Reads discountNode.metafield(tenant_secret)     │
│          │ 7. Verifies HMAC + subtotal + cartId, emits discount operations             │
│          ▼                                                                             │
│  [ Order Paid / Completed ]                                                            │
│          │                                                                             │
│          │ 8. Webhook: orders/paid                                                     │
│          ▼                                                                             │
│  [ Shopify Connector Worker: apps/shopify-connector ]                                 │
│          │                                                                             │
│          │ 9. verifyIncomingRequest() (HMAC SHA-256)                                   │
│          │ 10. Service Binding RPC -> Core API commitRedemption()                     │
│          ▼                                                                             │
│  [ Core API: apps/api ] ── Decrements budget & writes immutable D1 audit row           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 5.2 Component 1: `apps/shopify-connector` (Cloudflare Worker Backend)

* **Runtime:** Cloudflare Workers + Hono + D1.
* **Bindings:**
  * `CORE`: Service binding to `apps/api` (`WorkerEntrypoint`).
  * `DB`: D1 database binding (`shopify_installed_shops`).
  * `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`: App credentials.

* **Routes:**
  * `GET /auth/shopify`: Initiates Shopify OAuth flow for custom app install.
  * `GET /auth/callback`: Validates OAuth callback, exchanges code for persistent offline access token.
  * `POST /webhooks/orders-paid`: Handles Shopify `orders/paid` event.
  * `POST /webhooks/orders-cancelled`: Handles order cancellation and budget restoral.
  * `POST /webhooks/refunds-create`: Handles partial/full refunds.
  * `POST /webhooks/customers-update`: Syncs customer profile and tags.
  * `POST /webhooks/app-uninstalled`: Marks store inactive.
  * `GET /admin/dashboard/*`: Proxies or loads the embedded Dashboard via Shopify App Bridge.

* **Automated Store Provisioning Flow (On OAuth Callback):**
  1. Call `env.CORE.provisionMerchant(operatorContext, { name: shopDomain })` via Service Binding to create a dedicated merchant tenant.
  2. Generate a tenant-specific evaluation signing secret (`tenantSigningKey`), stored in the merchant's D1 tenant configuration.
  3. Generate a `pk_...` (publishable token) and `sk_...` (secret token) via `env.CORE.createCredential`.
  4. Store the shop domain, encrypted access token, tenant ID, and `tenantSigningKey` in D1 table `shopify_installed_shops`.
  5. Publish a baseline Shopify schema in Core API (`customer.tags`, `customer.orders_count`, `customer.total_spent`, `cart.subtotal`, `context.channel`).
  6. Register an App Metafield on the Shop (`$app:incentives:publishable_token`) with `access: { storefront: "PUBLIC_READ" }`, enabling the extension to read `pk_...` without hardcoded keys.
  7. Register Shopify webhooks with the shop domain:
     - `orders/paid` $\rightarrow$ `https://shopify.domain.dev/webhooks/orders-paid`
     - `orders/cancelled` $\rightarrow$ `https://shopify.domain.dev/webhooks/orders-cancelled`
     - `refunds/create` $\rightarrow$ `https://shopify.domain.dev/webhooks/refunds-create`
     - `customers/create`, `customers/update` $\rightarrow$ `https://shopify.domain.dev/webhooks/customers-update`
  8. Register the Shopify Discount Function:
     - Call `discountAutomaticAppCreate` to register the function node.
     - Write the tenant-specific `tenantSigningKey` to the discount node's metafield (`$app:incentives:signing-secret`).
     - Call `discountCodeAppCreate` to register the master code discount node.
  9. Enqueue a customer bulk backfill job (`bulkOperationRunQuery`) to sync existing customers and historical order counts into D1.

---

### 5.3 Component 2: Checkout UI Extension (`extensions/checkout-offers-ui`)

* **Target:** `purchase.checkout.reductions.render-after` (renders immediately beneath the discount code input box).
* **Configuration (`shopify.extension.toml`):**
  ```toml
  name = "Incentives Eligible Offers"
  type = "ui_extension"

  [[extensions.targeting]]
  target = "purchase.checkout.reductions.render-after"
  module = "./src/CheckoutOffers.tsx"

  [extensions.capabilities]
  network_access = true
  block_progress = true
  ```

* **Behavior & The Native Code Entry Solution:**
  1. **Dual Entry Handling:**
     - **In-Widget Code Box:** The extension provides an integrated code input box directly within its UI (*"Have an exclusive code? [ Enter code ] [ Apply ]"*).
     - When the shopper submits a code in this box, the extension immediately calls Core API `POST /v1/evaluate` with `codes: [enteredCode]`. If valid, it writes `_incentives_eval` and invokes `applyDiscountCodeChange('INCENTIVES_APPLIED')` or the synced code, ensuring the token is set *before* the Wasm function evaluates.
     - **Native Discount Box Handling:** If a shopper uses the native Shopify discount box, the entered code must exist in Shopify's code node pool (`discountRedeemCodeBulkAdd`). To prevent the native server-side rejection race condition:
       - The code is registered in Shopify's code pool.
       - The Wasm function accepts the registered code as a recognized trigger.
       - The extension detects the entered code via `useDiscountCodes()`, triggers a background evaluation, writes `_incentives_eval`, and the checkout recalculates.
  2. **Checkout Interception (`useBuyerJourneyIntercept`):**
     - When a cart mutation (quantity change/line removal) or code evaluation is in flight, the extension intercepts the checkout progress and disables the "Pay Now" button until the re-evaluation resolves and `_incentives_eval` is updated. This prevents shoppers from paying before discounts update or paying at full price during subtotal shifts.
  3. **Offer Discovery & Interactive Selection:**
     - Displays eligible public offers returned from `candidateOffers`.
     - Displays tier progress bars (e.g. *"Spend $15.00 more to unlock Free Shipping"*).
     - Clicking `[Apply]` writes the signed payload to `_incentives_eval` via `applyAttributeChange` and applies the code via `applyDiscountCodeChange`.

---

### 5.4 Component 3: Shopify Discount Function in Rust (`extensions/incentives-discount-fn`)

* **Runtime:** WebAssembly compiled from **Rust** (`cargo build --target wasm32-wasi --release`).
* **Why Rust:** Pure-JS QuickJS implementations risk exceeding Shopify's 11M instruction limit on large carts. In Rust, deserializing JSON, computing HMAC-SHA256 via the `sha2` crate, and emitting operations consumes <100,000 instructions (<1% of budget) and completes in <1ms.
* **Input Query (`run.graphql`):**
  ```graphql
  query RunInput {
    cart {
      id
      attribute(key: "_incentives_eval") {
        value
      }
      cost {
        subtotalAmount {
          amount
          currencyCode
        }
      }
      lines {
        id
        quantity
        cost {
          subtotalAmount {
            amount
            currencyCode
          }
        }
      }
    }
    discountNode {
      metafield(namespace: "$app:incentives", key: "signing-secret") {
        value
      }
    }
  }
  ```
* **Tamper Resistance, Anti-Replay, and Verification Logic:**
  - `_incentives_eval` carries:
    ```json
    {
      "evaluationId": "eval_8f92a10b...",
      "shopDomain": "brand.myshopify.com",
      "cartId": "gid://shopify/Cart/c1-...",
      "subtotalMinorUnits": 12000,
      "currency": "USD",
      "discountMinorUnits": 2000,
      "target": "order",
      "expiresAt": "2026-11-19T11:00:00Z",
      "signature": "hmac_sha256_hex..."
    }
    ```
  - **Cart ID & Domain Match:** The function verifies `cartId == cart.id`. This prevents cross-cart replay attacks where an attacker copies a VIP evaluation into another cart.
  - **Subtotal Verification:** Verifies that `cart.cost.subtotalAmount.amount` converted to minor units matches `subtotalMinorUnits`.
  - **Currency Verification:** Verifies that `cart.cost.subtotalAmount.currencyCode == currency`.
  - **HMAC Verification:** Computes HMAC-SHA256 over `evaluationId:cartId:subtotalMinorUnits:currency:discountMinorUnits:expiresAt` using the tenant secret read from `discountNode.metafield`. If the signature does not match or the payload is expired, the function emits zero discounts.
  - **Output Operations:** Returns standard Shopify discount operations:
    - Order discount (`orderSubtotal`)
    - Line item discounts (`productVariant`)
    - Free shipping waiver (`deliveryOption`)

---

### 5.5 Component 4: Webhook Handler & Post-Capture Atomic Redemption

* **Route:** `POST /webhooks/orders-paid` in `apps/shopify-connector`.
* **The 24-Hour TTL & Post-Capture Reconciliation Invariant:**
  - In Shopify, payment capture precedes webhook delivery. Because checkouts can take 10–15 minutes, evaluation snapshots for Shopify checkouts use an extended TTL of **24 hours** (`86400` seconds), which is fully supported by `TtlSchema`.
  - When `orders/paid` arrives:
    1. Verifies HMAC header `X-Shopify-Hmac-Sha256` via `CommerceConnector.verifyIncomingRequest`.
    2. Reads `order.note_attributes` to retrieve `_incentives_eval`, parsing the authoritative `evaluationId`.
    3. Calls Core API via Worker Service Binding:
       ```ts
       await env.CORE.commitRedemption({
         evaluationId,
         externalOrderRef: order.admin_graphql_api_id,
         idempotencyKey: `shopify_${order.id}`,
         postCaptureReconciliation: true
       });
       ```
    4. **Post-Capture Overspend Handling:** If a concurrent order exhausted the campaign budget while this shopper was completing payment, Core API records the redemption with `status: "reconciled_overspend"` and logs an operational audit warning. This guarantees that merchant financial ledgers accurately reflect real-world captured funds without trapping Shopify in a 48-hour webhook retry loop.
    5. Webhook handler responds with HTTP `200 OK`.

* **Cancellations and Refunds:**
  - `POST /webhooks/orders-cancelled`: Calls Core API reversal authority to restore usage caps and campaign budget.
  - `POST /webhooks/refunds-create`: Reconciles item/order refunds against the original discount allocations.

---

### 5.6 Component 5: Embedded Operator Dashboard

* **Location:** Rendered inside Shopify Admin when the merchant navigates to the app.
* **Technology:** Existing React app (`apps/dashboard`), wrapped with `@shopify/app-bridge-react`.
* **Auth:** Uses App Bridge session tokens (`Authorization: Bearer <shopify_session_token>`) on all requests. Third-party cookies are not used, ensuring 100% compatibility with Safari ITP and modern browser iframe partition rules.
* **Functionality:** Marketers manage Promos, budget caps, variables, and customer attributes without needing external credentials.

---

### 5.7 Core API & Contracts Updates

1. **Contracts Update (`packages/contracts/src/evaluation.ts`):**
   Export candidate offer schemas without breaking strict response validation:
   ```ts
   export const CandidateOfferSchema = z.object({
     programRef: z.string().min(1),
     name: z.string().min(1),
     qualified: z.boolean(),
     estimatedDiscountMinorUnits: z.number().int().nonnegative(),
     progress: z.object({
       current: z.number().int().nonnegative(),
       target: z.number().int().nonnegative(),
       shortfall: z.number().int().nonnegative(),
     }).optional(),
   }).strict();

   // Additive fields on EvaluationRequest and EvaluationResponse:
   export const EvaluationRequestSchema = z.object({
     // ... existing fields
     includeCandidateOffers: z.boolean().optional().default(false),
     ttlSeconds: z.number().int().min(60).max(86400).optional(),
   });
   ```

2. **Public Offer Isolation (Anti-Leakage Invariant):**
   In `@incentives/modules/promo` and `apps/api/src/services/evaluation-service.ts`:
   When `includeCandidateOffers: true`, candidate offers are derived **exclusively from active, public `autoApply: true` promotions**. Secret promo codes, unannounced influencer codes, and affiliate codes are strictly excluded from candidate enumeration.

3. **Graceful Returning Customer Evaluation:**
   In `apps/api/src/services/evaluation-service.ts`, if `customerRef` is passed for a logged-in checkout customer who has not yet been synced to D1, the evaluation proceeds gracefully using empty/default customer attributes rather than throwing `CUSTOMER_NOT_FOUND` (404).

4. **CORS / Preflight Handling:**
   In `apps/api/src/auth/api-credentials.ts`:
   Preflight `OPTIONS` requests are handled statelessly by checking standard CORS headers against allowed origin patterns, including `https://extensions.shopifycdn.com` and registered shop checkout domains.

---

## 6. What is Left to the Builder

The builder who implements this spec is free to decide:
1. **Extension Styling Details:** Exact Tailwind / Polaris token mapping for the offer cards, progress bar colors, and badge pill designs inside the Checkout UI Extension.
2. **Shopify CLI Version & Bundler:** Use of Shopify CLI 3.x with Vite for bundling the extensions.
3. **Internal D1 Schema for App State:** Exact column schema for `shopify_installed_shops` (e.g. `shop_domain`, `access_token_encrypted`, `tenant_id`, `created_at`, `updated_at`).
4. **Retry & Backoff Configuration:** Specific exponential backoff parameters for webhook delivery retry handling.

---

## 7. Security and Tenant Isolation Invariants

* **No Secret Tokens in Frontend Code:** The Checkout UI Extension only ever receives the store's `pk_...` publishable key. The `sk_...` secret key remains strictly on `apps/shopify-connector` in Cloudflare Workers.
* **Per-Tenant Signing Keys:** Every merchant tenant has a unique `tenantSigningKey`. The global `DECISION_SIGNING_SECRET` is never exposed or shared with Shopify metafields.
* **Cart-Locked Signatures:** HMAC tokens include `cartId` and `shopDomain`, preventing replay across carts, customers, or stores.
* **HMAC Webhook Verification:** All incoming Shopify webhooks must verify `X-Shopify-Hmac-Sha256` before processing. Unverified webhooks immediately fail closed with HTTP `401`.
* **Idempotent Redemptions:** Webhooks may be delivered multiple times by Shopify. Redemptions use the unique Shopify Order GID as the `idempotencyKey` to guarantee zero double-spend.
* **Service Binding Isolation:** Merchant provisioning, token generation, and schema publishing are inaccessible over public HTTP and operate strictly via authenticated Cloudflare Worker Service Bindings.
