# Integration-Ready Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the monorepo, canonical contracts, pure evaluation engine, incentive-module extension point, and commerce-connector conformance kit without implementing a client platform or persistent runtime.

**Architecture:** The foundation follows dependency inversion: `contracts` is dependency-free except for validation, `engine` is pure domain logic, incentive modules plug into `module-kit`, and commerce adapters implement `connector-kit`. The existing dashboard moves into the workspace unchanged and remains green throughout.

**Tech Stack:** TypeScript 6 strict ESM, pnpm workspaces, Zod, React 19/Vite 8 for the existing dashboard, Vitest 4, oxlint.

**Approved design:** `docs/superpowers/specs/2026-07-18-integration-ready-incentives-core-design.md`

**Sequence:** Plan 1 of 3; followed by Runtime, then Operator UI and Simulator.

**Notion mirror:** https://app.notion.com/p/Integration-Ready-Core-Foundation-Implementation-Plan-3a1e5c7c2b8e811f9802e4425670963d

## Global Constraints

- Before Task 1, use `superpowers:using-git-worktrees` and create a new implementation branch named `feat/integration-ready-core`; never implement on `main`.
- Preserve the unrelated untracked `CLAUDE.md`; do not stage, modify, or remove it.
- Use `pnpm`, TypeScript `strict: true`, and `verbatimModuleSyntax: true` in every workspace.
- Canonical money values are integer minor units plus an ISO currency code.
- Persistent customer attributes never appear as evaluation-request overrides.
- Core packages must not import React, Hono, Cloudflare bindings, Drizzle, or connector implementations.
- Run `pnpm -r test`, `pnpm -r build`, and `pnpm -r lint` before every task commit.
- Update the repository and Notion plan/spec mirrors together when implementation changes an approved interface.

---

## File Structure

```text
package.json                              workspace scripts
pnpm-workspace.yaml                       workspace discovery
tsconfig.base.json                        strict shared TypeScript config
apps/dashboard/                           git-moved current demo
apps/api/                                 buildable runtime skeleton for Plan 2
packages/contracts/src/
  money.ts                                Money schema and helpers
  variables.ts                            variable definitions and source/type schemas
  evaluation.ts                           canonical request, outcome, effect, decision schemas
  errors.ts                               stable error envelope
  programs.ts                             base/promo program schemas
  openapi.ts                              OpenAPI document generation
  index.ts                                public exports
packages/engine/src/
  conditions.ts                           typed predicates and first-failure evaluation
  facts.ts                                source-safe fact assembly
  messages.ts                             message resolution/interpolation
  stacking.ts                             deterministic effect-conflict resolution
  index.ts                                public exports
packages/module-kit/src/
  module.ts                               IncentiveModule interfaces
  conformance.ts                          reusable module contract suite
  index.ts                                public exports
packages/modules/promo/src/
  promo-module.ts                         promo evaluation implementation
  index.ts                                public export
packages/connector-kit/src/
  connector.ts                            CommerceConnector/capability interfaces
  conformance.ts                          reusable connector contract suite
  index.ts                                public exports
```

### Task 1: Create the pnpm workspace without changing dashboard behaviour

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Move: `demo/` → `apps/dashboard/`
- Modify: `apps/dashboard/package.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: package manifests, `tsconfig.json`, and `src/index.ts` for `packages/contracts`, `packages/engine`, `packages/module-kit`, `packages/modules/promo`, and `packages/connector-kit`

**Interfaces:**
- Consumes: the current `demo/` application and its passing npm scripts.
- Produces: workspace names `@incentives/api`, `@incentives/dashboard`, `@incentives/contracts`, `@incentives/engine`, `@incentives/module-kit`, `@incentives/promo`, and `@incentives/connector-kit`.

- [ ] **Step 1: Record the existing dashboard baseline**

Run:

```bash
cd demo
npm run test
npm run build
npm run lint
```

Expected: all three commands exit `0`. Record the Vitest test count in the implementation notes for later comparison.

- [ ] **Step 2: Create the workspace files and move the dashboard with Git history**

Use `git mv demo apps/dashboard`. Create the root manifest:

```json
{
  "name": "incentives-platform",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
  - packages/modules/*
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

Rename the dashboard package to `@incentives/dashboard` and retain its existing scripts/dependencies. Delete the moved `package-lock.json` only after `pnpm install` has generated the root `pnpm-lock.yaml`; do not use both lock formats.

- [ ] **Step 3: Create buildable package skeletons**

Each non-React package uses this manifest shape, replacing its name and internal dependencies:

```json
{
  "name": "@incentives/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run --passWithNoTests",
    "lint": "oxlint src"
  },
  "devDependencies": {
    "typescript": "~6.0.2",
    "vitest": "^4.1.9",
    "oxlint": "^1.69.0"
  }
}
```

Use this `tsconfig.json` in each library:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

Adjust `packages/modules/promo/tsconfig.json` to extend `../../../tsconfig.base.json`. Give `apps/api/src/index.ts` and each library `src/index.ts` the single temporary export `export {};`.

`--passWithNoTests` is permitted only while a workspace is a testless skeleton. The task that adds a package's first real test must change that package's script back to plain `vitest run`.

- [ ] **Step 4: Install from the root and verify workspace discovery**

Run:

```bash
pnpm install
pnpm list -r --depth -1
pnpm -r test
pnpm -r build
pnpm -r lint
```

Expected: the seven named workspaces are listed; the dashboard test count matches Step 1; all commands exit `0`.

- [ ] **Step 5: Commit the workspace migration**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json apps packages
git commit -m "build: establish incentives monorepo"
```

### Task 2: Define canonical contracts and generated API schemas

**Files:**
- Create: `packages/contracts/src/money.ts`
- Create: `packages/contracts/src/variables.ts`
- Create: `packages/contracts/src/evaluation.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/programs.ts`
- Create: `packages/contracts/src/openapi.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Consumes: Zod validation only.
- Produces: `MoneySchema`, `VariableDefinitionSchema`, `EvaluationRequestSchema`, `EvaluationResponseSchema`, `ApiErrorSchema`, `PromoProgramSchema`, all inferred TypeScript types, `buildOpenApiDocument()`, and `buildPublishedEvaluationJsonSchema(definitions)`.

- [ ] **Step 1: Add contract dependencies and write failing tests**

Run `pnpm --filter @incentives/contracts add zod @asteasolutions/zod-to-openapi`.

Change `@incentives/contracts`'s test script from `vitest run --passWithNoTests` to `vitest run` before adding `contracts.test.ts`.

Create `contracts.test.ts` with these cases:

```ts
import { describe, expect, test } from 'vitest';
import {
  EvaluationRequestSchema,
  MoneySchema,
  VariableDefinitionSchema,
  buildPublishedEvaluationJsonSchema,
} from './index.js';

describe('canonical contracts', () => {
  test('requires integer minor units and a three-letter currency', () => {
    expect(MoneySchema.safeParse({ currency: 'GBP', minorUnits: 1000 }).success).toBe(true);
    expect(MoneySchema.safeParse({ currency: 'gb', minorUnits: 10.5 }).success).toBe(false);
  });

  test('rejects persistent customer attributes in evaluation input', () => {
    const result = EvaluationRequestSchema.safeParse({
      customerRef: 'customer-1',
      customer: { tier: 'gold' },
      cart: { currency: 'GBP', subtotal: 6500, items: [] },
    });
    expect(result.success).toBe(false);
  });

  test('accepts a typed line-item extension definition', () => {
    expect(VariableDefinitionSchema.parse({
      key: 'line_item.category',
      label: 'Category',
      source: 'line_item',
      type: 'string',
      required: false,
    }).key).toBe('line_item.category');
  });

  test('emits strict JSON Schema for merchant extensions', () => {
    const schema = buildPublishedEvaluationJsonSchema([
      { key: 'context.channel', label: 'Channel', source: 'context', type: 'enum', required: true, enumValues: ['web', 'app'] },
    ]);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
  });
});
```

- [ ] **Step 2: Run the contract test and confirm the red state**

Run `pnpm --filter @incentives/contracts test -- contracts.test.ts`.

Expected: FAIL because the contract modules/exports do not exist.

- [ ] **Step 3: Implement exact contract exports**

Implement these schemas and infer types with `z.infer`:

```ts
export const MoneySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  minorUnits: z.number().int(),
}).strict();

export const VariableSourceSchema = z.enum(['customer', 'context', 'cart', 'line_item', 'event', 'system']);
export const VariableTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'date']);
export const VariableDefinitionSchema = z.object({
  key: z.string().regex(/^(customer|context|cart|line_item|event|system)\.[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  source: VariableSourceSchema,
  type: VariableTypeSchema,
  required: z.boolean(),
  enumValues: z.array(z.string().min(1)).min(1).optional(),
  description: z.string().max(500).optional(),
  defaultErrorMessage: z.string().max(500).optional(),
}).strict().superRefine((definition, ctx) => {
  if (definition.key.split('.')[0] !== definition.source) {
    ctx.addIssue({ code: 'custom', path: ['key'], message: 'key namespace must match source' });
  }
  if (definition.type === 'enum' && !definition.enumValues) {
    ctx.addIssue({ code: 'custom', path: ['enumValues'], message: 'enum fields require enumValues' });
  }
  if (definition.type !== 'enum' && definition.enumValues) {
    ctx.addIssue({ code: 'custom', path: ['enumValues'], message: 'enumValues are only valid for enum fields' });
  }
});
```

Define a strict canonical request with `customerRef?`, `code?`, `cart.currency`, `cart.subtotal`, `cart.items[]`, cart/item `attributes`, and top-level `context`; do not add a `customer` property. Define:

```ts
export const DecisionOutcomeSchema = z.enum([
  'qualified', 'not_qualified', 'unavailable', 'invalid_code', 'exhausted', 'conflict',
]);
export const EffectSchema = z.union([
  z.object({ type: z.literal('order_discount'), calculation: z.literal('fixed'), amount: MoneySchema }).strict(),
  z.object({ type: z.literal('order_discount'), calculation: z.literal('percent'), basisPoints: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('line_item_discount'), productRef: z.string().min(1), calculation: z.literal('fixed'), amount: MoneySchema }).strict(),
  z.object({ type: z.literal('line_item_discount'), productRef: z.string().min(1), calculation: z.literal('percent'), basisPoints: z.number().int().min(1).max(10_000) }).strict(),
  z.object({ type: z.literal('free_shipping') }).strict(),
  z.object({ type: z.literal('wallet_debit'), amount: MoneySchema }).strict(),
  z.object({ type: z.literal('wallet_credit'), amount: MoneySchema }).strict(),
  z.object({ type: z.literal('points_credit'), points: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('attribution'), subjectRef: z.string().min(1) }).strict(),
]);
```

Define decision/response fields exactly as the design: evaluation id, optional customer ref/version, schema version, ISO expiry, program ref/type, outcome, effects, reason codes, optional message, `commitRequired`, and derived optional `eligible`. Reject an `eligible` value that contradicts the authoritative outcome.

Define `ApiErrorSchema` with `{ error: { code, message, correlationId, retryable, fields? } }`. Define `PromoProgramSchema` with common id/name/status/dates plus promo code/auto-apply, `ConditionGroup`, reward, budget/cap, and stacking fields. Manual promos (`autoApply: false`) structurally require `code`, while auto-applied promos may omit it, so generated OpenAPI describes the same invariant enforced at runtime. Condition ids must be globally unique across the top-level and nested groups so first-failure messages are unambiguous. Reuse the existing demo operator names to avoid migration translation.

Implement `buildPublishedEvaluationJsonSchema()` around the strict canonical evaluation request: context definitions map to top-level `context`, cart definitions to `cart.attributes`, and line-item definitions to every `cart.items[].attributes`. Reject duplicate definition keys before generation. Implement `buildOpenApiDocument()` with registered component schemas—including structural fixed/percent effect variants—and the future-stable `/v1/evaluate` and `/v1/redemptions` request/response components; HTTP route wiring remains Plan 2.

- [ ] **Step 4: Verify contracts and generated documents**

Run:

```bash
pnpm --filter @incentives/contracts test
pnpm --filter @incentives/contracts build
pnpm --filter @incentives/contracts lint
```

Expected: all contract tests pass; `dist/index.d.ts` exports every interface named above.

- [ ] **Step 5: Commit canonical contracts**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat: define canonical incentives contracts"
```

### Task 3: Port and complete the pure evaluation engine

**Files:**
- Create: `packages/engine/src/conditions.ts`
- Create: `packages/engine/src/facts.ts`
- Create: `packages/engine/src/messages.ts`
- Create: `packages/engine/src/stacking.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/conditions.test.ts`
- Test: `packages/engine/src/facts.test.ts`
- Test: `packages/engine/src/stacking.test.ts`
- Modify: `packages/engine/package.json`

**Interfaces:**
- Consumes: `Condition`, `ConditionGroup`, `VariableDefinition`, `Effect`, and decision types from `@incentives/contracts`; existing behaviour from the moved dashboard's `src/lib/conditions.ts`, `interpolate.ts`, `format.ts`, and `rewards.ts`.
- Produces: `assembleFacts()`, `evaluateCondition()`, `evaluateConditionGroup()`, `resolveFailureMessage()`, `renderMessage()`, and `resolveDecisionConflicts()`.

- [ ] **Step 1: Write failing evaluator/fact/stacking tests**

Change `@incentives/engine`'s test script from `vitest run --passWithNoTests` to `vitest run` before adding its first test.

Cover these exact behaviours:

```ts
test('loads stored customer, live context, line item, and system facts without overrides', () => {
  const facts = assembleFacts({
    customer: { tier: 'gold' },
    context: { channel: 'web' },
    cart: { currency: 'GBP', subtotal: 5000, attributes: { delivery_country: 'GB' } },
    lineItems: [{ productRef: 'p1', attributes: { category: 'shoes' } }],
    system: { budget_remaining: 5000 },
  });
  expect(facts.scalar['customer.tier']).toBe('gold');
  expect(facts.scalar['context.channel']).toBe('web');
  expect(facts.lineItems[0]?.['line_item.category']).toBe('shoes');
});

test('returns the first failing condition in declaration order', () => {
  const result = evaluateConditionGroup(groupWithTwoFailures, definitions, facts);
  expect(result).toMatchObject({ passed: false, firstFailure: { conditionId: 'minimum-cart' } });
});

test('resolves non-stacking qualified decisions deterministically', () => {
  expect(resolveDecisionConflicts([lowerPriority, higherPriority])).toEqual([
    expect.objectContaining({ programRef: higherPriority.programRef, outcome: 'qualified' }),
    expect.objectContaining({ programRef: lowerPriority.programRef, outcome: 'conflict', reasonCodes: ['STACKING_CONFLICT'] }),
  ]);
});
```

Also port every existing interpolation and message-fallback test from `apps/dashboard/src/lib` before removing duplicate dashboard implementations.

- [ ] **Step 2: Run focused tests and confirm missing exports**

Run `pnpm --filter @incentives/engine test`.

Expected: FAIL because the evaluator/fact/stacking functions are missing.

- [ ] **Step 3: Implement facts and predicates**

`assembleFacts()` returns `{ scalar: Record<string, unknown>; lineItems: Array<Record<string, unknown>> }` and namespaces every supplied key. Its cart input separates canonical `currency` and `subtotal` from `attributes`; cart attributes cannot use reserved canonical names. It throws on attempts to place `customer.*` values in any live source.

Implement operators with these semantics:

- `eq`/`neq`: strict equality after schema-directed type parsing;
- `gt`/`gte`/`lt`/`lte`: number/date comparison;
- `in`: scalar membership in a configured list;
- `between`: inclusive two-value numeric/date range;
- `is`: boolean equality.

Reject operator/type combinations outside the published `OPERATORS_BY_TYPE` map with `INVALID_CONDITION`. Enum operands must belong to the definition's `enumValues`; invalid configured operands must not be treated as an ordinary failed customer condition. Date controls expose `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, and `between`, matching evaluator support.

`evaluateConditionGroup()` supports ALL/ANY and one nested level, returns `{ passed, firstFailure? }`, and preserves declaration order for failure messaging. Within each `ALL` group, all line-item conditions must match the same item; `ANY` line-item conditions remain existential, and nested groups apply their own correlation independently. Missing optional facts fail only the condition using them with reason `ATTRIBUTE_MISSING`; schema validation handles missing required facts before the engine.

Port `renderMessage`, money formatting, operator labels, and the fallback order condition → variable default → program fallback → system default. Both legacy unnamespaced operands and canonical dotted fact keys must interpolate. Keep all functions pure.

Implement `resolveDecisionConflicts()` with stable sorting by descending priority then program ref using a locale-independent code-unit comparison. Mark losing non-stackable decisions `conflict` with reason `STACKING_CONFLICT`; do not discard them from the response.

- [ ] **Step 4: Remove dashboard duplicates through re-exports**

Replace dashboard copies of pure helpers with imports/re-exports from `@incentives/engine` while keeping existing public names, then run the complete dashboard test suite to prove no UI behaviour changed.

- [ ] **Step 5: Run workspace verification**

Run `pnpm -r test`, `pnpm -r build`, and `pnpm -r lint`.

Expected: all commands exit `0`; existing dashboard behaviour remains unchanged.

- [ ] **Step 6: Commit the engine**

```bash
git add packages/engine apps/dashboard packages/contracts pnpm-lock.yaml
git commit -m "feat: add pure typed evaluation engine"
```

### Task 4: Add the module contract and first Promo implementation

**Files:**
- Create: `packages/module-kit/src/module.ts`
- Create: `packages/module-kit/src/conformance.ts`
- Modify: `packages/module-kit/src/index.ts`
- Test: `packages/module-kit/src/conformance.test.ts`
- Create: `packages/modules/promo/src/promo-module.ts`
- Modify: `packages/modules/promo/src/index.ts`
- Test: `packages/modules/promo/src/promo-module.test.ts`
- Modify: both package manifests

**Interfaces:**
- Consumes: canonical contracts and pure engine functions.
- Produces: `IncentiveModule<TConfig>`, `ModuleEvaluationContext`, `ModuleDecision`, `runModuleConformanceSuite()`, and `PromoModule`.

- [ ] **Step 1: Write failing contract and Promo tests**

Change both `@incentives/module-kit` and `@incentives/promo` test scripts from `vitest run --passWithNoTests` to `vitest run` before adding their first tests.

```ts
const context: ModuleEvaluationContext = {
  merchantId: 'merchant-1',
  evaluationId: 'eval-1',
  now: new Date('2026-07-18T12:00:00Z'),
  request: validEvaluationRequest,
  facts,
  definitions,
};

test('promo qualifies and emits a canonical fixed order discount', async () => {
  const [decision] = await PromoModule.evaluate(context, welcome10);
  expect(decision).toMatchObject({
    programRef: 'welcome-10',
    programType: 'promo',
    outcome: 'qualified',
    effects: [{ type: 'order_discount', calculation: 'fixed', amount: { currency: 'GBP', minorUnits: 1000 } }],
    commitRequired: true,
  });
});

test('fake module satisfies the shared conformance suite', async () => {
  await expect(runModuleConformanceSuite(fakeModule, fakeFixture)).resolves.toEqual({ passed: true });
});
```

Also test invalid code, scheduled/paused/ended availability, first-failure message, canonical percent reward emission in integer basis points, and absent optional customer data. Monetary rounding is deferred to effect application because the canonical percent effect intentionally carries `basisPoints` rather than a precomputed amount.

- [ ] **Step 2: Confirm tests fail**

Run `pnpm --filter @incentives/module-kit test` and `pnpm --filter @incentives/promo test`.

Expected: FAIL because the interfaces and module do not exist.

- [ ] **Step 3: Implement the extension contract**

```ts
export interface IncentiveModule<TConfig> {
  readonly type: ProgramType;
  evaluate(context: ModuleEvaluationContext, config: TConfig): Promise<ModuleDecision[]>;
  commit?(context: CommitContext, decision: ModuleDecision): Promise<CommitEffect[]>;
  handleEvent?(event: CommerceEvent, config: TConfig): Promise<FulfilmentEffect[]>;
}
```

`runModuleConformanceSuite()` validates that decision program types match the module, effects pass canonical schemas, conflict metadata includes integer `priority` and boolean `stackable`, outputs are deterministic for identical inputs, reason codes are stable non-empty uppercase snake case, and modules do not mutate request/facts/config fixtures.

`ModuleDecision` extends the canonical decision with `priority`, `stackable`, and optional `stackingGroup`, making it directly consumable by the central conflict resolver. Every emitted optional `eligible` value must agree with the authoritative outcome.

Implement `PromoModule.evaluate()` using engine predicates/messages. It emits `invalid_code`, `unavailable`, `not_qualified`, or `qualified`; scheduled, draft, paused, and ended programs are unavailable, and active programs are also unavailable outside their configured date window. Defensively treat any unparsed manual configuration without a code as `invalid_code`. It does not mutate counters or perform persistence. Caps are represented as system facts for read-time messaging and remain authoritative at Plan 2 redemption.

- [ ] **Step 4: Verify the module seam**

Run module/promo tests twice to prove deterministic output, then run all workspace checks.

Expected: identical snapshots across both runs and all checks green.

- [ ] **Step 5: Commit module-kit and Promo**

```bash
git add packages/module-kit packages/modules/promo pnpm-lock.yaml
git commit -m "feat: add incentive module contract and promo module"
```

### Task 5: Add connector capabilities and conformance testing

**Files:**
- Create: `packages/contracts/src/commerce.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`
- Create: `packages/connector-kit/src/connector.ts`
- Create: `packages/connector-kit/src/conformance.ts`
- Modify: `packages/connector-kit/src/index.ts`
- Test: `packages/connector-kit/src/conformance.test.ts`
- Modify: `packages/connector-kit/package.json`

**Interfaces:**
- Consumes: canonical customer/cart/order/evaluation decision contracts.
- Produces: strict `CustomerSnapshotSchema` and `OrderSnapshotSchema`, `ConnectorCapabilities`, `CommerceConnector<TCustomer, TCart, TOrder, TDecision>`, `VerificationResult`, `UnsupportedConnectorCapabilityError`, `ConnectorFixture`, and `runConnectorConformanceSuite()`.

- [ ] **Step 1: Write a failing fake-connector conformance test**

Change `@incentives/connector-kit`'s test script from `vitest run --passWithNoTests` to `vitest run` before adding its first test.

```ts
const fakeConnector: CommerceConnector<FakeCustomer, FakeCart, FakeOrder, FakeAdjustment[]> = {
  capabilities: () => ({
    automaticDiscounts: true,
    discountCodes: true,
    lineItemAdjustments: false,
    checkoutBlocking: true,
    customerAttributes: true,
    orderWebhooks: true,
    walletRedemption: false,
  }),
  normalizeCustomer: input => ({ externalRef: input.id, attributes: input.attributes }),
  normalizeCart: input => canonicalCartFromFake(input),
  normalizeOrder: input => canonicalOrderFromFake(input),
  mapDecision: decision => fakeAdjustmentsFromDecision(decision),
  verifyIncomingRequest: async request => ({ verified: request.headers.get('x-fake-signature') === 'valid' }),
};

test('fake connector passes canonical conformance', async () => {
  await expect(runConnectorConformanceSuite(fakeConnector, fixture)).resolves.toEqual({ passed: true });
});
```

- [ ] **Step 2: Run and confirm missing contract failure**

Run `pnpm --filter @incentives/connector-kit test`.

Expected: FAIL because connector types/conformance do not exist.

- [ ] **Step 3: Implement capability and connector contracts**

Define `CustomerSnapshot` as an opaque `externalRef` plus attributes. Reuse the canonical strict `CartSchema` as `CartSnapshot`. Define strict `OrderSnapshot` with opaque `externalRef`, unchanged `idempotencyKey`, uppercase currency, integer non-negative total minor units, optional customer ref, and canonical line items. Keep these platform-neutral schemas in `@incentives/contracts`.

Define all seven capability booleans exactly as the spec. A connector that cannot represent an effect must throw `UnsupportedConnectorCapabilityError`; the conformance suite detects a connector that silently maps an unsupported effect. Initially order discounts/free shipping require automatic-discount or discount-code capability, line-item discounts require line-item-adjustment capability, and wallet debit requires wallet-redemption capability. Future-only wallet credit, points, and attribution remain unsupported until the capability model is deliberately extended. The conformance runner must verify:

- canonical money is integer/currency-safe;
- external refs are preserved as opaque strings;
- customer attributes are returned only by `normalizeCustomer`, never embedded into a cart evaluation request;
- `mapDecision` rejects/returns unsupported for effects absent from declared capabilities;
- source verification distinguishes invalid from valid fixture requests;
- the fixture propagates its order/idempotency reference unchanged;
- the documented sequence is evaluate → map/apply → commit before payment capture.

The connector interface remains the approved normalization/mapping/verification boundary; it does not gain speculative payment or persistence methods. `ConnectorFixture` supplies fake `evaluate`, `apply`, `commit`, and `capturePayment` hooks plus a trace. The conformance runner orchestrates those hooks in the documented order and verifies the trace, proving the integration recipe without performing real platform writes.

Return `{ passed: true }` or throw a typed `ConnectorConformanceError` containing stable failure codes.

- [ ] **Step 4: Verify connector-kit**

Run `pnpm --filter @incentives/connector-kit test`, build, and lint, then all workspace checks.

Expected: fake connector passes and deliberately misdeclared capability fixtures fail with the expected stable code.

- [ ] **Step 5: Commit connector-kit**

```bash
git add packages/contracts packages/connector-kit pnpm-lock.yaml
git commit -m "feat: add commerce connector conformance kit"
```

### Task 6: Publish foundation documentation and verification evidence

**Files:**
- Create: `docs/integration/core-contracts.md`
- Create: `docs/integration/connector-conformance.md`
- Modify: `CLAUDE.md` only if the user explicitly confirms the untracked file should be adopted; otherwise leave it untouched.
- Modify: Notion copies of these approved implementation docs in the same unit of work.

**Interfaces:**
- Consumes: final public exports from Tasks 2–5.
- Produces: developer-facing contract examples and the execution gate for Plan 2.

- [ ] **Step 1: Write docs that compile against public examples**

Document one complete canonical customer/cart/decision example, the source/type rules, effect/outcome enums, module dependency rule, connector capabilities, and exact commands to run conformance. Store code examples as imported fixtures in package tests so documentation examples cannot drift silently.

- [ ] **Step 2: Run the final foundation gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm -r build
pnpm -r lint
git diff --check
```

Expected: all commands exit `0`; the dashboard baseline test count is at least the Task 1 count; `git status --short` contains only intended documentation changes and the preserved untracked `CLAUDE.md`.

- [ ] **Step 3: Sync documentation to Notion and verify read-back**

Use `ntn pages create/edit` under the existing Specs/Plans hierarchy, then `ntn pages get <page-id> --json`. Expected: `truncated` is `false`, `unknown_block_ids` is empty, and the page title matches the repository document.

- [ ] **Step 4: Commit foundation docs**

```bash
git add docs/integration
git commit -m "docs: publish integration core contracts"
```

## Plan 1 completion gate

Do not start Plan 2 until:

- every workspace test/build/lint command is green;
- the dashboard remains behaviourally unchanged;
- contracts, engine, Promo, module conformance, and connector conformance have independent passing suites;
- repo/Notion documents are synchronized;
- a reviewer confirms no React/Cloudflare/persistence imports leaked into core packages.

## Self-Review

- **Spec coverage:** monorepo boundaries, contracts, typed schema definitions, structured decisions/effects, pure engine, Promo-first module seam, fake second module, connector capabilities/conformance, and documentation are mapped to Tasks 1–6.
- **Deferred intentionally to Plan 2:** persistence, HTTP routes, customer storage, schema publication state, decision snapshots, and redemption atomicity.
- **Instruction-quality scan:** no deferred-detail markers or cross-task shorthand; each task names exact files, commands, expected results, interfaces, tests, and commits.
- **Type consistency:** `EvaluationRequest`, `VariableDefinition`, `ModuleEvaluationContext`, `ModuleDecision`, `IncentiveModule`, `CommerceConnector`, outcomes, and effects retain the same names across tasks.
