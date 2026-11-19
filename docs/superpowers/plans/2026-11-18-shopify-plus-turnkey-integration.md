# Shopify Plus Turnkey Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and integrate a 100% plug-and-play Shopify Plus application (`apps/shopify-connector`) and connector library (`packages/shopify-connector`) that connects Shopify Plus checkout natively to the `incentives-platform` engine with eligible offers discovery, Rust-based Wasm discount execution, and atomic webhook redemption.

**Architecture:** A Cloudflare Worker app (`apps/shopify-connector`) acts as the Shopify app bridge, handling OAuth, App Bridge JWT session auth, and webhooks via Worker Service Bindings to Core API. A Rust WebAssembly Discount Function (`incentives-discount-fn`) deterministically executes HMAC-verified discounts in <1ms without network calls. A Checkout UI Extension (`checkout-offers-ui`) with `network_access` and `block_progress` renders candidate offers and progress bars, updating signed cart attributes before payment capture.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, D1, Rust (`wasm32-wasi`, `sha2`, `serde_json`), React, Shopify Checkout Extensibility (`@shopify/ui-extensions-react/checkout`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-11-18-shopify-plus-integration-design.md`](../specs/2026-11-18-shopify-plus-integration-design.md)

## Global Constraints
- Target platform: Shopify Plus stores only.
- Strict Wasm instruction budget: <11 million instructions, <5ms wall time. Discount Function MUST be in Rust.
- Zero network calls inside WebAssembly Discount Functions.
- Evaluation TTL for Shopify checkouts: 24 hours (86,400 seconds).
- Tenant isolation: Per-tenant signing keys (`tenantSigningKey`); global platform secret is never shared.
- Anti-leakage: `candidateOffers` strictly evaluates active public `autoApply: true` promotions; secret and affiliate codes are never enumerated.
- TDD required: Write failing tests before implementation code for every task.
- Zero merchant code: No theme Liquid edits or manual webhook setup required.

## Review Focus
- **Input class / Failure mode 1 (Cart mutation mismatch):** Shopper alters cart quantity in checkout after evaluation. Expected: Rust Wasm function rejects stale `_incentives_eval` subtotal, emitting zero discounts until UI extension re-evaluates.
- **Input class / Failure mode 2 (Token forgery & cross-cart replay):** Malicious shopper copies a signed evaluation from another cart/store. Expected: Rust Wasm function verifies `cartId == cart.id` and HMAC signature, failing closed.
- **Input class / Failure mode 3 (Post-capture redemption overspend):** Payment captured in Shopify, but campaign budget exhausted concurrently. Expected: Core API commits redemption with `status: "reconciled_overspend"` without failing the webhook.
- **Input class / Failure mode 4 (Unsynced returning customer):** Logged-in customer checks out before customer profile syncs to D1. Expected: Core API evaluates with default empty profile instead of throwing 404.
- **Input class / Failure mode 5 (Third-party cookie blockage):** Merchant opens dashboard inside Shopify Admin iframe in Safari/Chrome. Expected: App Bridge Bearer session token authenticates all requests without cookies.

---

### Task 1: Contracts & Core API Discovery Updates

**Files:**
- Modify: `packages/contracts/src/evaluation.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/src/services/evaluation-service.ts`
- Test: `packages/contracts/src/candidate-offers.test.ts`
- Test: `apps/api/test/evaluation-service-candidate-offers.test.ts`

**Interfaces:**
- Consumes: Existing `IncentiveDecision`, `FactEnvelope`, `EvaluationService`
- Produces:
  - `CandidateOfferSchema`, `CandidateOffer`: `{ programRef: string, name: string, qualified: boolean, estimatedDiscountMinorUnits: number, progress?: { current: number, target: number, shortfall: number } }`
  - `EvaluationRequestSchema.includeCandidateOffers` (boolean optional)
  - `EvaluationRequestSchema.ttlSeconds` (number optional, 60..86400)
  - `EvaluationResponseSchema.candidateOffers` (array of `CandidateOfferSchema` optional)

- [ ] **Step 1: Write the failing contract tests in `packages/contracts/src/candidate-offers.test.ts`**
  ```ts
  import { describe, expect, it } from 'vitest';
  import { CandidateOfferSchema, EvaluationRequestSchema, EvaluationResponseSchema } from './evaluation.js';

  describe('CandidateOffer contracts', () => {
    it('validates a candidate offer with progress', () => {
      const parsed = CandidateOfferSchema.parse({
        programRef: 'tier-20',
        name: '20% off large carts',
        qualified: false,
        estimatedDiscountMinorUnits: 2000,
        progress: { current: 8000, target: 10000, shortfall: 2000 },
      });
      expect(parsed.qualified).toBe(false);
      expect(parsed.progress?.shortfall).toBe(2000);
    });

    it('accepts includeCandidateOffers and 24h ttl in request schema', () => {
      const req = EvaluationRequestSchema.parse({
        cart: { currency: 'USD', subtotal: 10000, items: [] },
        includeCandidateOffers: true,
        ttlSeconds: 86400,
      });
      expect(req.includeCandidateOffers).toBe(true);
      expect(req.ttlSeconds).toBe(86400);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @incentives/contracts test -- src/candidate-offers.test.ts`
  Expected: FAIL with missing schema exports.

- [ ] **Step 3: Update `packages/contracts/src/evaluation.ts` and `index.ts`**
  Add `CandidateOfferSchema`, update `EvaluationRequestSchema` (with `includeCandidateOffers` and `ttlSeconds`), update `EvaluationResponseSchema` (with `candidateOffers`), and re-export.

- [ ] **Step 4: Run contract tests to verify they pass**
  Run: `pnpm --filter @incentives/contracts test`
  Expected: PASS

- [ ] **Step 5: Write the failing API evaluation tests in `apps/api/test/evaluation-service-candidate-offers.test.ts`**
  Test that `includeCandidateOffers: true` returns candidate offers from active public `autoApply: true` promos, derives shortfall progress, permits 24h TTL, and evaluates unsynced customers without throwing 404.

- [ ] **Step 6: Run API test to verify it fails**
  Run: `pnpm --filter @incentives/api test -- test/evaluation-service-candidate-offers.test.ts`
  Expected: FAIL

- [ ] **Step 7: Update `apps/api/src/services/evaluation-service.ts`**
  - Implement candidate offer discovery on public auto-apply promos.
  - Implement subtotal progress calculation: `{ current, target, shortfall }` on `gte`/`gt` rules.
  - Respect `ttlSeconds` up to 86400.
  - Catch missing customer profile and fallback to empty profile `{ attributes: {} }`.

- [ ] **Step 8: Run tests to verify they pass**
  Run: `pnpm --filter @incentives/api test -- test/evaluation-service-candidate-offers.test.ts`
  Expected: PASS

- [ ] **Step 9: Commit**
  ```bash
  git add packages/contracts/ apps/api/
  git commit -m "feat(api,contracts): add candidate offers discovery and 24h ttl"
  ```

---

### Task 2: Shopify Connector Conformance Library (`packages/shopify-connector`)

**Files:**
- Create: `packages/shopify-connector/package.json`
- Create: `packages/shopify-connector/tsconfig.json`
- Create: `packages/shopify-connector/src/index.ts`
- Create: `packages/shopify-connector/src/connector.ts`
- Create: `packages/shopify-connector/src/types.ts`
- Test: `packages/shopify-connector/src/conformance.test.ts`

**Interfaces:**
- Consumes: `@incentives/connector-kit`, `@incentives/contracts`
- Produces: `createShopifyConnector(): CommerceConnector<ShopifyCustomer, ShopifyCart, ShopifyOrder, ShopifyDecision>`

- [ ] **Step 1: Write failing conformance test in `packages/shopify-connector/src/conformance.test.ts`**
  Use `runConnectorConformanceSuite` from `@incentives/connector-kit` with a typed Shopify fixture.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @incentives/shopify-connector test`
  Expected: FAIL (package/connector not implemented).

- [ ] **Step 3: Implement Shopify connector mapping and normalizers**
  - `normalizeCustomer`: maps Shopify customer ID and tags to `CustomerSnapshot`.
  - `normalizeCart`: maps Shopify cart lines, subtotal amount, and currency to `CartSnapshot`.
  - `normalizeOrder`: maps Shopify order lines, total, order ID, and idempotency key to `OrderSnapshot`.
  - `mapDecision`: converts `IncentiveDecision` into `ShopifyDecision` (order discount, line adjustments, free shipping).
  - `verifyIncomingRequest`: validates Shopify `X-Shopify-Hmac-Sha256` using `crypto.subtle`.

- [ ] **Step 4: Run conformance suite to verify it passes**
  Run: `pnpm --filter @incentives/shopify-connector test`
  Expected: PASS (`passed: true`).

- [ ] **Step 5: Commit**
  ```bash
  git add packages/shopify-connector/
  git commit -m "feat(shopify-connector): implement commerce connector conformance"
  ```

---

### Task 3: Shopify Connector Worker App & OAuth Lifecycle (`apps/shopify-connector`)

**Files:**
- Create: `apps/shopify-connector/package.json`
- Create: `apps/shopify-connector/tsconfig.json`
- Create: `apps/shopify-connector/wrangler.toml`
- Create: `apps/shopify-connector/src/app.ts`
- Create: `apps/shopify-connector/src/env.ts`
- Create: `apps/shopify-connector/src/routes/oauth.ts`
- Create: `apps/shopify-connector/src/services/store-provisioning.ts`
- Test: `apps/shopify-connector/test/oauth.test.ts`

**Interfaces:**
- Consumes: `@incentives/shopify-connector`, `apps/api` Service Binding (`CORE`), Cloudflare D1
- Produces: `GET /auth/shopify`, `GET /auth/callback`, `storeProvisioningService`

- [ ] **Step 1: Write failing test for OAuth and Store Provisioning in `apps/shopify-connector/test/oauth.test.ts`**
  Test OAuth code exchange, tenant creation via mock `CORE.provisionMerchant`, credential generation (`pk_...`, `sk_...`), D1 store record persistence, and Shopify GraphQL setup calls.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @incentives/shopify-app test -- test/oauth.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement `apps/shopify-connector` app and OAuth routes**
  - Setup Hono router in `src/app.ts`.
  - Implement `/auth/shopify` (generates nonce, redirects to Shopify OAuth).
  - Implement `/auth/callback` (verifies HMAC and state, exchanges token, calls `provisionStore`).
  - Implement `provisionStore`: creates tenant in Core, generates `tenantSigningKey`, stores credentials in D1, writes App Metafield `publishable_token`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @incentives/shopify-app test -- test/oauth.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add apps/shopify-connector/
  git commit -m "feat(shopify-app): implement worker scaffolding and oauth provisioning"
  ```

---

### Task 4: Webhooks Handler & Post-Capture Reconciliation

**Files:**
- Create: `apps/shopify-connector/src/routes/webhooks.ts`
- Create: `apps/shopify-connector/src/services/redemption-service.ts`
- Modify: `apps/api/src/services/redemption-service.ts` (support `postCaptureReconciliation` overspend flag)
- Test: `apps/shopify-connector/test/webhooks.test.ts`

**Interfaces:**
- Consumes: Shopify webhook payloads, Core API `commitRedemption`
- Produces: `POST /webhooks/orders-paid`, `POST /webhooks/orders-cancelled`, `POST /webhooks/refunds-create`

- [ ] **Step 1: Write failing webhook tests in `apps/shopify-connector/test/webhooks.test.ts`**
  - Valid HMAC parses `_incentives_eval`, calls Core API commit with `idempotencyKey: shopify_<order.id>`.
  - Invalid HMAC fails with HTTP 401.
  - Post-capture overspend commits with reconciliation flag rather than failing.
  - Order cancellation triggers reversal authority.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @incentives/shopify-app test -- test/webhooks.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement webhook routes and post-capture redemption logic**
  - Implement `POST /webhooks/orders-paid` with HMAC check and idempotent redemption.
  - Add `postCaptureReconciliation: true` in Core API redemption options to record overspend without throwing.
  - Implement `POST /webhooks/orders-cancelled` and `POST /webhooks/refunds-create`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @incentives/shopify-app test -- test/webhooks.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add apps/shopify-connector/ apps/api/
  git commit -m "feat(shopify-app): implement webhooks handler and post-capture redemption"
  ```

---

### Task 5: Rust WebAssembly Discount Function (`incentives-discount-fn`)

**Files:**
- Create: `apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml`
- Create: `apps/shopify-connector/extensions/incentives-discount-fn/src/main.rs`
- Create: `apps/shopify-connector/extensions/incentives-discount-fn/src/types.rs`
- Create: `apps/shopify-connector/extensions/incentives-discount-fn/run.graphql`
- Create: `apps/shopify-connector/extensions/incentives-discount-fn/shopify.extension.toml`

**Interfaces:**
- Consumes: Shopify GraphQL RunInput (`cart`, `discountNode.metafield`)
- Produces: Shopify Function RunResult (`discounts[]`, `discountApplicationStrategy`)

- [ ] **Step 1: Write failing Rust unit tests in `src/main.rs`**
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;

      #[test]
      fn test_verifies_valid_signature_and_emits_discount() { ... }

      #[test]
      fn test_rejects_subtotal_mismatch() { ... }

      #[test]
      fn test_rejects_cart_id_mismatch() { ... }

      #[test]
      fn test_rejects_tampered_signature() { ... }
  }
  ```

- [ ] **Step 2: Run Rust tests to verify they fail**
  Run: `cargo test --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml`
  Expected: FAIL

- [ ] **Step 3: Implement Rust Discount Function logic**
  - Parse `_incentives_eval` JSON attribute.
  - Verify `cartId == input.cart.id`.
  - Verify `subtotalMinorUnits == input.cart.cost.subtotalAmount`.
  - Verify HMAC-SHA256 using `sha2` crate and secret from discount node metafield.
  - Return `FunctionResult` with `OrderSubtotal` or `ProductVariant` discount.

- [ ] **Step 4: Run Rust tests to verify they pass**
  Run: `cargo test --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml`
  Expected: PASS

- [ ] **Step 5: Compile to WebAssembly target**
  Run: `cargo build --manifest-path apps/shopify-connector/extensions/incentives-discount-fn/Cargo.toml --target wasm32-wasi --release`
  Expected: PASS, produces optimized `.wasm` binary < 200KB.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/shopify-connector/extensions/incentives-discount-fn/
  git commit -m "feat(shopify-fn): implement rust wasm discount function with hmac verification"
  ```

---

### Task 6: Checkout UI Extension (`checkout-offers-ui`)

**Files:**
- Create: `apps/shopify-connector/extensions/checkout-offers-ui/package.json`
- Create: `apps/shopify-connector/extensions/checkout-offers-ui/shopify.extension.toml`
- Create: `apps/shopify-connector/extensions/checkout-offers-ui/src/CheckoutOffers.tsx`
- Create: `apps/shopify-connector/extensions/checkout-offers-ui/src/hooks/useIncentivesEvaluation.ts`
- Test: `apps/shopify-connector/extensions/checkout-offers-ui/test/CheckoutOffers.test.tsx`

**Interfaces:**
- Consumes: Core API `/v1/evaluate` via `fetch`, Shopify Checkout UI hooks
- Produces: React Checkout UI Extension block with offers list, progress bars, and integrated code entry

- [ ] **Step 1: Write failing component tests in `test/CheckoutOffers.test.tsx`**
  Test rendering candidate offers, tier shortfall progress, code input submission, `useBuyerJourneyIntercept` blocking during evaluation, and updating `_incentives_eval` cart attribute.

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @incentives/checkout-offers-ui test`
  Expected: FAIL

- [ ] **Step 3: Implement `CheckoutOffers.tsx` and evaluation hook**
  - Read `pk_...` from app metafield.
  - Hook into `useCartLines()` and `useCost()`.
  - Call Core API `POST /v1/evaluate` with `includeCandidateOffers: true`.
  - Render available offer cards and progress bar.
  - Render in-widget code box for direct promo code entry.
  - Implement `useBuyerJourneyIntercept` to block "Pay Now" while evaluation is in-flight.
  - On offer selection or code apply: write signed token to `_incentives_eval` via `applyAttributeChange`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @incentives/checkout-offers-ui test`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add apps/shopify-connector/extensions/checkout-offers-ui/
  git commit -m "feat(checkout-ui): implement checkout offers extension with progress and intercept"
  ```

---

### Task 7: Embedded Operator Dashboard Bridge

**Files:**
- Create: `apps/shopify-connector/src/routes/admin.ts`
- Create: `apps/shopify-connector/src/middleware/shopify-session.ts`
- Test: `apps/shopify-connector/test/admin.test.ts`

**Interfaces:**
- Consumes: Shopify App Bridge JWT session tokens (`Authorization: Bearer <jwt>`)
- Produces: `/admin/dashboard/*` embedded proxy and authorized session validation

- [ ] **Step 1: Write failing tests in `apps/shopify-connector/test/admin.test.ts`**
  - Valid Shopify session JWT resolves tenant context and authorizes dashboard proxy request.
  - Missing or expired JWT returns HTTP 401.
  - Zero cookies required (100% iframe/Safari ITP safe).

- [ ] **Step 2: Run test to verify it fails**
  Run: `pnpm --filter @incentives/shopify-app test -- test/admin.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement App Bridge session middleware and admin route**
  - Implement JWT validation against Shopify's JWKS.
  - Map shop domain to tenant ID in D1.
  - Forward operator calls to `apps/operator-web` or Core API via Service Binding.

- [ ] **Step 4: Run test to verify it passes**
  Run: `pnpm --filter @incentives/shopify-app test -- test/admin.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add apps/shopify-connector/
  git commit -m "feat(shopify-app): implement embedded dashboard admin bridge with session tokens"
  ```

---

### Task 8: End-to-End System Integration Verification Gate

**Files:**
- Test: `apps/shopify-connector/test/e2e-integration.test.ts`

- [ ] **Step 1: Write comprehensive end-to-end integration test**
  Simulate full store lifecycle:
  1. OAuth install creates store and publishes default schema.
  2. Candidate offers evaluation returns qualified offer and tier progress bar.
  3. UI extension generates signed `_incentives_eval` payload.
  4. Rust Wasm discount function validates signature, subtotal, and cart ID, outputting discount operation.
  5. Shopify `orders/paid` webhook arrives with order note attribute.
  6. Atomic redemption commits in D1, budget is decremented, audit row created.
  7. Exact duplicate webhook retries idempotently without double-spend.

- [ ] **Step 2: Run end-to-end integration test**
  Run: `pnpm --filter @incentives/shopify-app test -- test/e2e-integration.test.ts`
  Expected: PASS

- [ ] **Step 3: Run complete repository workspace verification**
  ```bash
  pnpm -r build
  pnpm -r test
  pnpm -r lint
  ```
  Expected: All packages pass with zero errors.

- [ ] **Step 4: Commit**
  ```bash
  git add apps/shopify-connector/
  git commit -m "test(shopify-app): add full-flow end-to-end integration suite"
  ```
