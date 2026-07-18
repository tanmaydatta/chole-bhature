# Integration-Ready Core Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the approved contracts and Promo module into a persistent Cloudflare/D1 API for schema publication, stored customers, promo configuration, structured evaluation decisions, and atomic idempotent redemption.

**Architecture:** Hono routes validate canonical Zod contracts, thin services orchestrate repositories and the pure module/engine packages, and Drizzle repositories isolate D1. Evaluation persists an immutable short-lived decision snapshot; redemption verifies it and atomically rechecks mutable caps before writing the ledger.

**Tech Stack:** TypeScript 6, Hono, Zod, Cloudflare Workers, D1, Drizzle ORM/drizzle-kit, Wrangler, `@cloudflare/vitest-pool-workers`, Vitest 4.

**Approved design:** `docs/superpowers/specs/2026-07-18-integration-ready-incentives-core-design.md`

**Sequence:** Plan 2 of 3; requires Foundation and is followed by Operator UI and Simulator.

**Notion mirror:** https://app.notion.com/p/Integration-Ready-Core-Runtime-Implementation-Plan-3a1e5c7c2b8e817aa380c66100f83b5c

## Global Constraints

- Execute only after the Foundation Plan completion gate passes, in the same `feat/integration-ready-core` worktree/branch.
- Preserve the canonical contracts from `@incentives/contracts`; route-local lookalike types are prohibited.
- Every query and identifier is scoped by `merchant_id`; cross-merchant objects behave as not found.
- Persistent customer attributes cannot be supplied or overridden by `/v1/evaluate`.
- Evaluation failures never masquerade as ordinary ineligibility.
- Redemption is idempotent and commits the counter update plus ledger insert atomically.
- D1 conditional updates provide first-client correctness; Durable Objects/KV/Queues remain deferred.
- Use TDD and end every task with `pnpm -r test`, `pnpm -r build`, `pnpm -r lint`, and a focused commit.
- Keep repository and Notion docs synchronized when an implemented contract changes.

---

## File Structure

```text
apps/api/
  wrangler.toml                         Worker + D1 binding
  drizzle.config.ts                     migration generation
  migrations/0001_core.sql              initial persistent schema
  src/app.ts                            Hono composition only
  src/index.ts                          Worker export
  src/env.ts                            typed bindings/context
  src/errors.ts                         ApiError mapping
  src/auth/static-token.ts              Phase-0 publishable/secret gate
  src/db/schema.ts                      Drizzle tables
  src/db/client.ts                      per-request Drizzle factory
  src/repositories/*.ts                 repository interfaces + D1 implementations
  src/services/schema-service.ts        schema draft/publish/safety rules
  src/services/customer-service.ts      versioned validated customer writes
  src/services/program-service.ts       Promo CRUD/config validation
  src/services/evaluation-service.ts    facts/modules/conflicts/snapshot orchestration
  src/services/redemption-service.ts    snapshot verification + atomic commit
  src/routes/schemas.ts                 schema endpoints
  src/routes/customers.ts               customer endpoints
  src/routes/programs.ts                Promo endpoints
  src/routes/evaluate.ts                evaluation endpoint
  src/routes/redemptions.ts             commit endpoint
  test/fixtures.ts                      merchant/schema/customer/promo fixtures
  test/*.test.ts                        workerd integration suites
```

### Task 1: Configure the Worker, D1 schema, migrations, and repositories

**Files:**
- Modify: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`
- Create: `apps/api/wrangler.toml`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/repositories/types.ts`
- Create: `apps/api/src/repositories/d1-repositories.ts`
- Create: `apps/api/migrations/0001_core.sql`
- Test: `apps/api/test/repositories.test.ts`

**Interfaces:**
- Consumes: canonical variable/program/decision schemas.
- Produces: `Repositories` with `schemas`, `customers`, `programs`, `decisions`, and `redemptions`; binding name `DB`; database row types and migration.

- [ ] **Step 1: Add runtime dependencies and write repository round-trip tests**

Run:

```bash
pnpm --filter @incentives/api add hono drizzle-orm zod
pnpm --filter @incentives/api add -D drizzle-kit wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers vitest
```

Change `@incentives/api`'s test script from `vitest run --passWithNoTests` to `vitest run` before adding the first repository test. From this task onward, a missing API test suite must fail the command.

Add an API `pretest` script that builds contracts, engine, module-kit, and Promo using repeated pnpm `--filter` arguments. This keeps every filtered Plan 2 test command valid from a clean checkout with no `dist/` output and avoids shell `&&`.

Write tests using isolated D1 storage that insert two merchants with the same external customer ref and prove reads cannot cross tenant scope. Add redemption repository tests for external-order-only, idempotency-key-only, both identifiers, neither identifier, unique `(merchant_id, external_order_ref)`, and unique `(merchant_id, idempotency_key)` behavior, plus a customer optimistic-version update test.

```ts
test('customer refs are isolated by merchant', async () => {
  await repositories.customers.create('merchant-a', customer('shared', { tier: 'gold' }));
  await repositories.customers.create('merchant-b', customer('shared', { tier: 'silver' }));
  expect((await repositories.customers.get('merchant-a', 'shared'))?.attributes.tier).toBe('gold');
  expect((await repositories.customers.get('merchant-b', 'shared'))?.attributes.tier).toBe('silver');
});
```

- [ ] **Step 2: Run the repository test and verify failure**

Run `pnpm --filter @incentives/api test -- repositories.test.ts`.

Expected: FAIL because D1 config, migration, and repositories are missing.

- [ ] **Step 3: Create the exact relational model**

Create tables:

- `merchants(id, name, created_at)`;
- `variable_definitions(id, merchant_id, schema_version, key, label, source, type, required, enum_values_json, description, default_error_message, state, created_at)`;
- `schema_versions(merchant_id, version, state, published_at, definitions_json)` with unique merchant/version;
- `customers(id, merchant_id, external_ref, attributes_json, version, updated_at)` with unique merchant/ref;
- `programs(id, merchant_id, external_ref, type, name, status, config_json, priority, max_uses, usage_count, budget_remaining, created_at, updated_at)`;
- `evaluation_decisions(id, merchant_id, customer_ref, customer_version, schema_version, request_json, decisions_json, integrity_hash, expires_at, created_at)`;
- `redemptions(id, merchant_id, external_order_ref NULL, idempotency_key NULL, evaluation_id, result_json, discount_minor_units, currency, created_at)` with `CHECK (external_order_ref IS NOT NULL OR idempotency_key IS NOT NULL)`, a unique merchant/non-null-order constraint, and a unique merchant/non-null-idempotency-key constraint. Either identifier may be present alone or both may be present.

All foreign keys include or validate merchant ownership in repository methods. Store JSON as text validated at repository boundaries against `@incentives/contracts`.

Define repositories with exact methods such as:

```ts
interface CustomerRepository {
  get(merchantId: string, externalRef: string): Promise<CustomerRecord | null>;
  upsert(input: CustomerUpsert): Promise<CustomerRecord>;
}

interface DecisionRepository {
  create(input: EvaluationDecisionRecord): Promise<void>;
  get(merchantId: string, evaluationId: string): Promise<EvaluationDecisionRecord | null>;
}
```

Create one Drizzle instance per request from `env.DB`; no module singleton.

- [ ] **Step 4: Apply migration locally and verify repositories**

Run:

```bash
pnpm --filter @incentives/api exec wrangler d1 migrations apply incentives-dev --local
pnpm --filter @incentives/api test -- repositories.test.ts
pnpm --filter @incentives/api build
```

Expected: migration applies cleanly from empty storage and all repository tests pass.

- [ ] **Step 5: Commit persistence foundation**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat: add tenant-scoped D1 persistence"
```

### Task 2: Compose Hono, static access gates, and the error envelope

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/errors.ts`
- Create: `apps/api/src/auth/static-token.ts`
- Modify: `apps/api/src/env.ts`, `apps/api/src/index.ts`
- Test: `apps/api/test/app.test.ts`

**Interfaces:**
- Consumes: `ApiErrorSchema`, D1 repository factory, Workers secrets `PUBLISHABLE_TOKEN` and `SECRET_TOKEN`.
- Produces: `createApp()`, `requirePublishable`, `requireSecret`, request context `merchantId`, `correlationId`, and `repositories`.

- [ ] **Step 1: Write failing auth/error tests**

```ts
test.each([
  ['/v1/health', undefined, 200],
  ['/v1/test-publishable', undefined, 401],
  ['/v1/test-publishable', 'publishable-test', 200],
  ['/v1/test-secret', 'publishable-test', 403],
  ['/v1/test-secret', 'secret-test', 200],
])('%s enforces key kind', async (path, token, expected) => {
  const response = await SELF.fetch(`https://example.test${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  expect(response.status).toBe(expected);
});
```

Assert errors validate against `ApiErrorSchema` and contain a response/request correlation id.

- [ ] **Step 2: Run and confirm failures**

Run `pnpm --filter @incentives/api test -- app.test.ts`.

Expected: protected routes/middleware do not exist.

- [ ] **Step 3: Implement application composition**

`createApp()` installs correlation-id, repository, and JSON-error middleware. Static tokens resolve to the seeded merchant and key kind; publishable routes accept publishable or secret credentials, while secret routes accept only secret credentials. This corrects the older Phase 0 wording that incorrectly implied a secret key should be rejected on read routes.

Map validation errors to `400 CONTEXT_VALIDATION_FAILED`, unknown objects to `404`, optimistic conflicts to `409 VERSION_CONFLICT`, expired decisions to `410 DECISION_EXPIRED`, cap exhaustion to a structured `409 EXHAUSTED`, and unexpected failures to retryable `503 EVALUATION_UNAVAILABLE` without leaking stack traces.

- [ ] **Step 4: Verify middleware and build**

Run focused tests followed by all workspace checks. Expected: exact statuses above and schema-valid bodies.

- [ ] **Step 5: Commit API composition**

```bash
git add apps/api
git commit -m "feat: add Worker API access gates and errors"
```

### Task 3: Implement schema drafts, safe edits, publication, and generated samples

**Files:**
- Create: `apps/api/src/services/schema-service.ts`
- Create: `apps/api/src/routes/schemas.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/schemas.test.ts`

**Interfaces:**
- Consumes: `VariableDefinitionSchema`, JSON Schema generator, `variable_definitions`, `schema_versions`, program references.
- Produces: secret-gated `/v1/schema/definitions` CRUD, `POST /v1/schema/publish`, and publishable/secret `GET /v1/schema/published`.

- [ ] **Step 1: Write failing schema lifecycle tests**

Cover create → publish version 1 → additive optional draft → publish version 2. Assert unknown source/key mismatch is rejected, required additions to a published integration are rejected, canonical/system edits are rejected, and any field referenced by a draft or active program cannot change key/source/type or be deleted.

```ts
test('publication returns strict schema and sample payload', async () => {
  const response = await secret.post('/v1/schema/publish');
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    version: 1,
    jsonSchema: { type: 'object', additionalProperties: false },
    sample: { context: { channel: 'web' } },
  });
});
```

- [ ] **Step 2: Confirm missing-route failures**

Run `pnpm --filter @incentives/api test -- schemas.test.ts`.

Expected: `404` for schema routes.

- [ ] **Step 3: Implement transactional publication rules**

Validate definitions with canonical schemas on every write. Publication creates an immutable incrementing version snapshot. Generate deterministic sample values: first enum option, `false`, `0`, `"example"`, and `2026-01-01`; canonical cart sample always uses integer money and an empty items array. Do not allow publishing if the draft contains errors.

- [ ] **Step 4: Verify schema service and tenant isolation**

Run focused tests plus a second-merchant test that cannot see or reference the first merchant's definitions.

- [ ] **Step 5: Commit schema registry runtime**

```bash
git add apps/api
git commit -m "feat: add versioned schema registry API"
```

### Task 4: Implement versioned customer storage and validation

**Files:**
- Create: `apps/api/src/services/customer-service.ts`
- Create: `apps/api/src/routes/customers.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/customers.test.ts`

**Interfaces:**
- Consumes: published customer definitions and `CustomerRepository`.
- Produces: secret-gated `PATCH /v1/customers/:customerRef`, secret-gated `GET /v1/customers/:customerRef`, `CustomerRecord { externalRef, attributes, version, updatedAt }`.

- [ ] **Step 1: Write failing customer tests**

Test valid typed upsert, unknown field rejection, enum/type rejection, missing required customer field rejection, version increment, stale expected-version conflict, and cross-merchant not-found.

```ts
test('updates against the published schema and increments version', async () => {
  const first = await patchCustomer('c-1', { attributes: { tier: 'gold' } });
  const second = await patchCustomer('c-1', { attributes: { tier: 'silver' }, expectedVersion: first.version });
  expect(second.version).toBe(first.version + 1);
});
```

- [ ] **Step 2: Confirm routes fail before implementation**

Run focused test; expect `404`.

- [ ] **Step 3: Implement strict customer validation**

Build a Zod object from published `source='customer'` definitions with `additionalProperties: false` semantics. Require `expectedVersion` on updates after version 1. Store the whole validated attribute object so PATCH semantics are deterministic replacement, not ambiguous deep merge; document this behaviour in the response and API reference.

- [ ] **Step 4: Verify concurrency and isolation**

Run two concurrent writes with the same expected version; expect one success and one `409 VERSION_CONFLICT`. Run all workspace checks.

- [ ] **Step 5: Commit customer API**

```bash
git add apps/api
git commit -m "feat: add typed versioned customer profiles"
```

### Task 5: Implement minimal Promo program configuration

**Files:**
- Create: `apps/api/src/services/program-service.ts`
- Create: `apps/api/src/routes/programs.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/programs.test.ts`

**Interfaces:**
- Consumes: `PromoProgramSchema`, current variable definitions, program repository.
- Produces: secret-gated `POST/GET/PATCH /v1/programs` for type `promo`; immutable external ref after creation.

- [ ] **Step 1: Write failing program tests**

Test full Promo round-trip, invalid reward/currency/cap, undefined condition variable, system/canonical variable acceptance, no type other than `promo`, and tenant isolation. Assert a field referenced by this program becomes protected by Task 3 schema rules.

- [ ] **Step 2: Run and confirm `404` failures**

Run `pnpm --filter @incentives/api test -- programs.test.ts`.

- [ ] **Step 3: Implement validated Promo CRUD**

Validate the whole config with `PromoProgramSchema`, then verify every condition key exists in canonical/system or merchant definitions and every operator is valid for the field type. Store common status/name/priority relationally and the validated type config as JSON. Limit first-build lifecycle values to draft, scheduled, active, paused, and ended; only draft programs are editable, matching existing UI behaviour.

- [ ] **Step 4: Verify program behaviour and workspace**

Run focused plus all workspace checks. Expected: no test uses a mock repository where a workerd D1 test is possible.

- [ ] **Step 5: Commit program API**

```bash
git add apps/api
git commit -m "feat: add validated promo program API"
```

### Task 6: Implement structured evaluation and immutable decision snapshots

**Files:**
- Create: `apps/api/src/services/evaluation-service.ts`
- Create: `apps/api/src/routes/evaluate.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/evaluate.test.ts`

**Interfaces:**
- Consumes: published schema, customer/program repositories, `assembleFacts`, `PromoModule`, conflict resolver, decision repository.
- Produces: publishable-or-secret `POST /v1/evaluate` returning `EvaluationResponse` and persisting `EvaluationDecisionRecord`.

- [ ] **Step 1: Write failing evaluation tests**

Cover canonical/context validation, stored-customer lookup, no request customer override, anonymous evaluation, unknown customer error, schema/customer version capture, qualified/not-qualified/invalid-code/unavailable/conflict decisions, deterministic messages, and decision TTL.

```ts
test('loads stored attributes and ignores no caller override path', async () => {
  await saveCustomer('c-1', { tier: 'gold' });
  const response = await evaluate({
    customerRef: 'c-1',
    cart: { currency: 'GBP', subtotal: 6500, items: [] },
    context: { channel: 'web' },
  });
  expect(response.customerVersion).toBe(1);
  expect(response.decisions[0]?.outcome).toBe('qualified');
});
```

- [ ] **Step 2: Confirm evaluation tests fail**

Run focused test; expect missing route/service failure.

- [ ] **Step 3: Implement the twelve-step evaluation pipeline**

Follow Design Spec §11 verbatim. Generate an opaque evaluation id, set a configurable five-minute default expiry, store canonical request/facts/decisions and versions, and calculate an integrity HMAC over merchant id, evaluation id, snapshot, and expiry using `DECISION_SIGNING_SECRET`. Return only canonical response fields; never return stored customer attributes.

Translate validation failures to field issues. Translate unexpected module/repository errors to retryable `503 EVALUATION_UNAVAILABLE`; do not return `not_qualified` on infrastructure failure.

- [ ] **Step 4: Verify snapshots, failure policy, and tenancy**

Assert stored snapshots are immutable, HMACs differ after tampering, and another merchant receives not-found. Run all workspace checks.

- [ ] **Step 5: Commit evaluation runtime**

```bash
git add apps/api
git commit -m "feat: add structured promo evaluation API"
```

### Task 7: Implement atomic, idempotent redemption

**Files:**
- Create: `apps/api/src/services/redemption-service.ts`
- Create: `apps/api/src/routes/redemptions.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/redemptions.test.ts`

**Interfaces:**
- Consumes: decision snapshot/HMAC, program counters, D1 batch helper.
- Produces: secret-gated `POST /v1/redemptions` with canonical `RedemptionResponse` successes (`status: 'committed'`) and canonical `ApiError` envelopes for exhausted, expired, and conflict outcomes.

- [ ] **Step 1: Write failing redemption tests**

Test a newly committed redemption and its stable canonical response for all request variants: external order ref only, idempotency key only, and both. Reject neither at the canonical request boundary. Test that retries by external order ref or idempotency key return the original `RedemptionResponse` with `status: 'committed'`. Test expired/tampered/cross-merchant decision, decision currency/amount mismatch, paused program after evaluation, budget exhaustion, usage exhaustion, and concurrent last-cap attempts; exhausted, expired, and conflict outcomes must return the canonical `ApiError` envelope with the Task 2 HTTP/error mapping.

```ts
test('concurrent final-cap commits allow exactly one redemption', async () => {
  const responses = await Promise.all([
    redeemRaw({ evaluationId, externalOrderRef: 'o-1', idempotencyKey: 'k-1' }),
    redeemRaw({ evaluationId: secondEvaluationId, externalOrderRef: 'o-2', idempotencyKey: 'k-2' }),
  ]);
  expect(responses.filter(({ status, body }) =>
    status === 200 && body.status === 'committed')).toHaveLength(1);
  expect(responses.filter(({ status, body }) =>
    status === 409 && body.error?.code === 'EXHAUSTED')).toHaveLength(1);
});
```

- [ ] **Step 2: Run and verify red state**

Run focused test; expect missing redemption route/service.

- [ ] **Step 3: Implement verification and atomic batch**

Validate request and load the merchant-scoped decision. Return an existing redemption result before any counter mutation. Verify TTL, HMAC, selected qualified decision, exact effect amount/currency, and current program status. Execute a conditional program update plus redemption insert in one D1 batch:

```sql
UPDATE programs
SET usage_count = usage_count + 1,
    budget_remaining = CASE
      WHEN budget_remaining IS NULL THEN NULL
      ELSE budget_remaining - ?1
    END
WHERE id = ?2 AND merchant_id = ?3 AND status = 'active'
  AND (max_uses IS NULL OR usage_count < max_uses)
  AND (budget_remaining IS NULL OR budget_remaining >= ?1);
```

Zero affected rows returns the canonical `ApiError` envelope as `409 EXHAUSTED` without a ledger row. An expired decision returns `410 DECISION_EXPIRED`; an optimistic conflict returns `409 VERSION_CONFLICT`. Unique-key races reread and return the original stable canonical `RedemptionResponse` with `status: 'committed'`.

- [ ] **Step 4: Verify retry/concurrency correctness**

Run redemption suite repeatedly, then all workspace checks. Expected: no counter/ledger mismatch and no flaky concurrency test.

- [ ] **Step 5: Commit redemption runtime**

```bash
git add apps/api
git commit -m "feat: add atomic idempotent redemptions"
```

### Task 8: Publish OpenAPI, runtime guide, and the complete API gate

**Files:**
- Create: `apps/api/src/routes/openapi.ts`
- Create: `docs/integration/runtime-api.md`
- Modify: `apps/api/src/app.ts`
- Modify: `docs/superpowers/specs/2026-07-18-integration-ready-incentives-core-design.md` only if implementation revealed an approved contract correction
- Update: corresponding Notion pages
- Test: `apps/api/test/full-flow.test.ts`

**Interfaces:**
- Consumes: every runtime endpoint.
- Produces: `GET /v1/openapi.json`, full client flow evidence, and the gate for the Operator UI Plan.

- [ ] **Step 1: Write the full-flow integration test**

The test must use real HTTP handlers and isolated D1:

```ts
test('define → publish → customer → promo → evaluate → redeem', async () => {
  await createDefinition(customerTierDefinition);
  await createDefinition(contextChannelDefinition);
  await publishSchema();
  await upsertCustomer('c-1', { tier: 'gold' });
  await createPromo(goldWebPromo);
  const evaluation = await evaluate(goldWebCart);
  const redemption = await redeemEvaluation(evaluation.evaluationId, 'order-1');
  expect(evaluation.decisions[0]?.outcome).toBe('qualified');
  expect(redemption.status).toBe('committed');
});
```

- [ ] **Step 2: Confirm the test exposes any missing route wiring**

Run it in isolation. Expected before final wiring: FAIL only for concrete missing composition/docs, not domain behaviour already covered.

- [ ] **Step 3: Serve generated OpenAPI and write the integration guide**

Document credentials, schema publication, replacement semantics for customer PATCH, canonical evaluate request, structured response, redeem-before-capture, TTL, idempotency, errors, and retry guidance. Serve the exact generated document from `@incentives/contracts`; do not maintain a handwritten divergent schema.

- [ ] **Step 4: Run the runtime completion gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm -r build
pnpm -r lint
git diff --check
```

Expected: all commands exit `0`; full-flow test uses workerd+D1; no mock store fallback exists for runtime acceptance.

- [ ] **Step 5: Sync Notion and commit runtime docs**

Verify Notion read-back is untruncated, then:

```bash
git add apps/api docs/integration docs/superpowers/specs
git commit -m "docs: publish integration runtime API"
```

## Plan 2 completion gate

Do not start the Operator UI Plan until the complete HTTP flow is green against isolated D1, OpenAPI matches runtime validation, atomic/idempotent redemption evidence is stable, and repository/Notion docs are synchronized.

## Self-Review

- **Spec coverage:** D1 repositories, tenancy, access gate, error policy, schema lifecycle, customers, Promo config, structured evaluation, decision snapshots, HMAC/TTL, atomic caps, idempotency, OpenAPI, and full flow map to Tasks 1–8.
- **Deferred intentionally to Plan 3:** live dashboard schema/promo wiring and the integration simulator UI.
- **Instruction-quality scan:** no deferred-detail markers or generic error-handling steps; tests, exact behaviour, SQL, commands, and commits are stated.
- **Type consistency:** all routes consume the Foundation Plan's canonical schemas; repository/service names and evaluation/redemption identifiers remain consistent.
