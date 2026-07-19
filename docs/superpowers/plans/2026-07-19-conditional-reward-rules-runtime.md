# Conditional Reward Rules Contracts and Promo Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Promo's single reward with deterministic ordered conditional rewards, expose reusable validated configuration contracts for Affiliate, Referral, and Loyalty, and carry the selected rule identity safely through evaluation and redemption.

**Status:** Ready for execution after planning review.

**Architecture:** Shared contract factories define ordered rules independently of reward payloads; each module exports a concrete strict schema. Only Promo is connected to persistence and runtime execution. Promo evaluates global eligibility once, selects the first matching rule or fallback, and signs `rewardRuleRef` with the selected effect. Configuration, evaluation, and redemption each independently fail closed on invalid or mismatched rule state.

**Tech Stack:** TypeScript 6, Zod 4, Vitest, Cloudflare Workers/Hono, D1/Drizzle, existing `@incentives/contracts`, `@incentives/engine`, `@incentives/module-kit`, and `@incentives/promo` workspaces.

**Approved design:** `docs/superpowers/specs/2026-07-19-conditional-reward-rules-design.md`

**Sequence:** Execute after the Integration-Ready Core Runtime plan. Complete this plan before Task 3 of `docs/superpowers/plans/2026-07-18-integration-ready-core-operator-ui.md`.

**Notion mirror:** https://app.notion.com/p/Conditional-Reward-Rules-Contracts-and-Promo-Runtime-Implementation-Plan-3a2e5c7c2b8e81448f05c2db9a00fe60

**Mirror state:** Repository and Notion copies synchronized on 2026-07-19.

## Global constraints

- This is a clean pre-client break: reject top-level Promo `reward`; do not add dual-read compatibility or a data migration.
- `/v1/programs` remains Promo-only. Affiliate, Referral, and Loyalty schemas are configuration contracts, not operational APIs.
- Reuse the existing typed `ConditionGroup`; never execute arbitrary expressions or JavaScript.
- Array order is authoritative. Do not add a parallel numeric rule-priority field.
- Preserve the existing all-or-nothing evaluation, HMAC integrity, idempotency, cap, and atomic budget semantics.
- Program usage and customer caps remain program-wide; only the selected reward determines projected monetary cost.
- Use TDD for every behavior change. Run the focused failing test before implementation, then the focused and workspace gates after implementation.
- Do not change D1 table metadata or add a migration; program JSON is already stored in `config_json`.

---

## Public contract map

```ts
export interface RewardRule<TReward> {
  id: string;
  name: string;
  conditions: ConditionGroup;
  reward: TReward;
}

export interface FallbackReward<TReward> {
  id: string;
  name: string;
  reward: TReward;
}

export interface ConditionalRewards<TReward> {
  rewardRules: RewardRule<TReward>[];
  fallbackReward?: FallbackReward<TReward>;
}

export type CommerceReward =
  | OrderDiscountEffect
  | LineItemDiscountEffect
  | FreeShippingEffect;

export type CommissionReward =
  | { type: 'commission'; calculation: 'fixed'; amount: Money }
  | { type: 'commission'; calculation: 'percent'; basisPoints: number };

export interface AffiliateRuleReward {
  customerReward?: CommerceReward;
  affiliateReward?: CommissionReward;
}

export interface ReferralRuleReward {
  referrerReward?: CommerceReward | WalletAccrual;
  refereeReward?: CommerceReward | WalletAccrual;
}

export type WalletAccrual =
  | {
      type: 'wallet_accrual';
      assetRef: string;
      calculation: 'fixed';
      quantity: number;
    }
  | {
      type: 'wallet_accrual';
      assetRef: string;
      calculation: 'per_unit';
      sourceVariable: string;
      sourceUnitsPerStep: number;
      quantityPerStep: number;
      rounding: 'floor';
    };
```

Qualified Promo decisions and committed redemption responses add:

```ts
rewardRuleRef: string;
```

The shared schemas keep this field optional because non-rule and non-qualified decisions are valid shared shapes. Promo runtime tests enforce the stronger module invariant.

## File structure

```text
packages/contracts/src/conditions.ts                 shared typed condition schemas
packages/contracts/src/reward-rules.ts               generic rule structures and reward payloads
packages/contracts/src/programs.ts                   ProgramStatus and clean-break Promo schema
packages/contracts/src/affiliate-program.ts          future Affiliate configuration schema
packages/contracts/src/referral-program.ts           future Referral configuration schema
packages/contracts/src/loyalty-program.ts            future Loyalty configuration schema
packages/contracts/src/evaluation.ts                 rewardRuleRef decision/redemption fields
packages/contracts/src/openapi.ts                     concrete schema components and live Promo route
packages/contracts/src/runtime-api.ts                 Promo-only program list response
packages/contracts/src/contracts.test.ts              shared/Promo contract tests
packages/contracts/src/future-programs.test.ts        Affiliate/Referral/Loyalty contract tests
packages/contracts/src/documentation-examples.test.ts canonical example validation
packages/contracts/test-fixtures/documentation-examples.ts updated clean-break fixtures
packages/modules/promo/src/promo-module.ts             ordered selection implementation
packages/modules/promo/src/promo-module.test.ts        selection behavior tests
apps/api/src/services/program-service.ts               rule-wide schema/config validation
apps/api/src/services/evaluation-service.ts            selected-effect checks and snapshots
apps/api/src/services/redemption-service.ts            selected-rule verification and response
apps/api/src/repositories/d1-repositories.ts            canonical JSON read/write checks
apps/api/test/programs.test.ts                          configuration API tests
apps/api/test/evaluate.test.ts                          runtime selection/cap/budget tests
apps/api/test/redemptions.test.ts                       commit/tamper/idempotency tests
apps/api/test/repositories.test.ts                      order and persisted-corruption tests
apps/api/test/full-flow.test.ts                         real-D1 end-to-end tiered Promo
docs/integration/core-contracts.md                      shared and future configuration contracts
docs/integration/runtime-api.md                         live Promo evaluation/redemption contract
```

### Task 1: Extract conditions and add shared conditional-reward primitives

**Files:**

- Create: `packages/contracts/src/conditions.ts`
- Create: `packages/contracts/src/reward-rules.ts`
- Modify: `packages/contracts/src/programs.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`

**Interfaces:**

- `conditions.ts` owns the unchanged `Condition*Schema` exports and inferred types.
- `reward-rules.ts` exports `CommerceRewardSchema`, concrete rule/fallback schemas used by module schemas, generic TypeScript interfaces, and module reward payload schemas.
- `programs.ts` re-exports or imports conditions without changing condition JSON.

- [ ] **Step 1: Write failing shared-rule schema tests**

Add tests that prove:

- rule names are required and at most 200 characters;
- every conditional rule has at least one condition leaf;
- rule IDs and fallback ID are unique;
- a configuration has at least one rule or a fallback;
- stored array order survives parsing;
- order, line-item, and free-shipping payloads parse as `CommerceReward`.

```ts
test('preserves authoritative rule order and rejects a duplicate fallback id', () => {
  const parsed = PromoConditionalRewardsSchema.parse({
    rewardRules: [over100Rule, under100Rule],
    fallbackReward: fallback,
  });
  expect(parsed.rewardRules.map(rule => rule.id)).toEqual(['over-100', 'under-100']);
  expect(PromoConditionalRewardsSchema.safeParse({
    rewardRules: [over100Rule],
    fallbackReward: { ...fallback, id: 'over-100' },
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run the test and confirm missing exports**

Run:

```bash
pnpm --filter @incentives/contracts test -- contracts.test.ts
```

Expected: FAIL because `PromoConditionalRewardsSchema`, `RewardRule`, and `CommerceRewardSchema` do not exist.

- [ ] **Step 3: Move condition schemas without changing behavior**

Move `ConditionOperatorSchema`, `ConditionValueSchema`, `ConditionSchema`, `ConditionGroupSchema`, and their inferred types verbatim into `conditions.ts`. Update imports and package exports. Run the existing contracts, engine, Promo, and API tests before adding rule behavior; they must remain green.

- [ ] **Step 4: Implement the shared schema factory and concrete Promo instance**

Use one internal factory so identity/non-empty validation cannot drift between modules:

```ts
function createConditionalRewardsSchema<TReward extends z.ZodType>(reward: TReward) {
  const rule = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    conditions: NonEmptyConditionGroupSchema,
    reward,
  }).strict();
  const fallback = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(200),
    reward,
  }).strict();
  return z.object({
    rewardRules: z.array(rule),
    fallbackReward: fallback.optional(),
  }).strict().superRefine(validateConditionalRewardIdentitiesAndPresence);
}

export const CommerceRewardSchema = z.union([
  OrderDiscountEffectSchema,
  LineItemDiscountEffectSchema,
  FreeShippingEffectSchema,
]);

export const PromoConditionalRewardsSchema =
  createConditionalRewardsSchema(CommerceRewardSchema);
```

The factory also exposes concrete `PromoRewardRuleSchema` and `PromoFallbackRewardSchema` instances for composition into `PromoProgramSchema`; the complete `PromoConditionalRewardsSchema` owns the cross-field presence/identity refinement. `NonEmptyConditionGroupSchema` must count leaves in both `conditions` and `groups[].conditions`; it must not reject an empty global eligibility group.

- [ ] **Step 5: Verify and commit shared primitives**

Run:

```bash
pnpm --filter @incentives/contracts test
pnpm --filter @incentives/contracts build
pnpm --filter @incentives/engine test
pnpm --filter @incentives/promo test
pnpm --filter @incentives/api test
```

Expected: all exit `0`.

```bash
git add packages/contracts
git commit -m "feat: add shared conditional reward contracts"
```

### Task 2: Add concrete Affiliate, Referral, and Loyalty configuration schemas

**Files:**

- Create: `packages/contracts/src/affiliate-program.ts`
- Create: `packages/contracts/src/referral-program.ts`
- Create: `packages/contracts/src/loyalty-program.ts`
- Create: `packages/contracts/src/future-programs.test.ts`
- Modify: `packages/contracts/src/reward-rules.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

```ts
interface AffiliateProgram extends ConditionalRewards<AffiliateRuleReward> {
  id: string;
  type: 'affiliate';
  name: string;
  status: ProgramStatus;
  eligibility: ConditionGroup;
  startDate?: string;
  endDate?: string;
  usageCap?: number;
  perCustomerCap?: number;
  codeBatchCount: number;
  perCodeUseLimit: number;
}

interface ReferralProgram extends ConditionalRewards<ReferralRuleReward> {
  id: string;
  type: 'referral';
  name: string;
  status: ProgramStatus;
  eligibility: ConditionGroup;
  priority: number;
  startDate?: string;
  endDate?: string;
  usageCap?: number;
  perCustomerCap?: number;
}

interface LoyaltyProgram extends ConditionalRewards<WalletAccrual> {
  id: string;
  type: 'loyalty';
  name: string;
  status: ProgramStatus;
  triggerEvent: string;
  eligibility: ConditionGroup;
  startDate?: string;
  endDate?: string;
  usageCap?: number;
  perCustomerCap?: number;
}
```

These schemas describe configuration only. Do not add them to `ProgramListResponseSchema`, repositories, routes, or runtime module registration.

- [ ] **Step 1: Write failing module-contract tests**

Cover:

- Affiliate customer-only, affiliate-only, and two-sided bundles;
- rejection of an empty Affiliate reward bundle;
- fixed positive minor-unit and percent 1–10,000 commission validation;
- independent commission and customer-reward currencies;
- Referral referrer-only, referee-only, and two-sided bundles;
- rejection of an empty Referral reward bundle;
- commerce and wallet accrual on either Referral side;
- Loyalty fixed and per-unit accrual;
- safe positive integers, `rounding: 'floor'`, and `sourceVariable` limited syntactically to `event.*`, `customer.*`, or `system.*` references;
- one Loyalty asset reference across every selectable rule/fallback;
- opaque `assetRef` examples such as `stars`, `miles`, and `cashback_gbp` without a hardcoded points/credit enum;
- schedule ordering and per-customer cap not exceeding usage cap in every applicable schema.

```ts
test('accepts a loyalty asset with client-defined terminology', () => {
  expect(LoyaltyProgramSchema.parse({
    ...loyaltyBase,
    triggerEvent: 'order_completed',
    rewardRules: [{
      id: 'gold-order',
      name: 'Gold order Stars',
      conditions: eventOrderTotalAtLeast100,
      reward: {
        type: 'wallet_accrual',
        assetRef: 'stars',
        calculation: 'per_unit',
        sourceVariable: 'event.order_total',
        sourceUnitsPerStep: 100,
        quantityPerStep: 2,
        rounding: 'floor',
      },
    }],
  }).rewardRules[0]?.reward.assetRef).toBe('stars');
});
```

- [ ] **Step 2: Run and confirm missing concrete schemas**

Run `pnpm --filter @incentives/contracts test -- future-programs.test.ts`.

Expected: FAIL because the three program schemas and module reward schemas are absent.

- [ ] **Step 3: Implement module reward payload schemas**

Use strict discriminated unions, positive safe integers, and bundle `.superRefine()` checks. The per-unit arithmetic contract is represented exactly; runtime accrual calculation remains deferred:

```ts
const PositiveSafeIntegerSchema = z.number().int().positive()
  .max(Number.MAX_SAFE_INTEGER);

export const WalletAccrualSchema = z.discriminatedUnion('calculation', [
  z.object({
    type: z.literal('wallet_accrual'),
    assetRef: z.string().min(1),
    calculation: z.literal('fixed'),
    quantity: PositiveSafeIntegerSchema,
  }).strict(),
  z.object({
    type: z.literal('wallet_accrual'),
    assetRef: z.string().min(1),
    calculation: z.literal('per_unit'),
    sourceVariable: z.string()
      .regex(/^(event|customer|system)\.[a-z][a-z0-9_]*$/),
    sourceUnitsPerStep: PositiveSafeIntegerSchema,
    quantityPerStep: PositiveSafeIntegerSchema,
    rounding: z.literal('floor'),
  }).strict(),
]);
```

- [ ] **Step 4: Implement and export the three strict program schemas**

Share schedule/cap refinements where practical, but export only concrete public schemas and inferred types. Attach OpenAPI descriptions saying “Future configuration contract; no runtime routes” so component generation cannot imply operational support.

The schema can validate the `sourceVariable` namespace but cannot resolve a merchant's published registry by itself. Document numeric-definition resolution as a required contextual validation for the future Loyalty configuration service; do not imply the current Promo API performs it.

- [ ] **Step 5: Prove runtime isolation and commit**

Add a test asserting `ProgramListResponseSchema` rejects an Affiliate/Referral/Loyalty entry. Run contracts build/test and API typecheck/test.

```bash
git add packages/contracts
git commit -m "feat: define future incentive program contracts"
```

### Task 3: Apply the clean-break Promo and selected-rule response contracts

**Files:**

- Modify: `packages/contracts/src/programs.ts`
- Modify: `packages/contracts/src/evaluation.ts`
- Modify: `packages/contracts/src/runtime-api.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/contracts/test-fixtures/documentation-examples.ts`
- Modify: `packages/contracts/src/documentation-examples.test.ts`
- Modify: `packages/module-kit/src/conformance.test.ts`
- Modify: `packages/connector-kit/src/conformance.test.ts` only where a qualified Promo fixture is constructed
- Modify: `packages/connector-kit/test-fixtures/documentation-example.ts` only where a qualified Promo fixture is constructed
- Modify: existing API test Promo factories under `apps/api/test/*.test.ts`

**Interfaces:**

```ts
const PromoProgramBaseSchema = z.object({
  id: z.string().min(1),
  type: z.literal('promo'),
  name: z.string().min(1).max(200),
  status: ProgramStatusSchema,
  eligibility: ConditionGroupSchema,
  rewardRules: z.array(PromoRewardRuleSchema),
  fallbackReward: PromoFallbackRewardSchema.optional(),
  // unchanged schedule, budget, caps, stackability, and priority fields
}).strict();
```

Apply the shared presence/unique-ID refinement to the completed manual/automatic discriminated union, together with the existing date refinement. Do not spread a refined object's `.shape` and accidentally discard its cross-field checks.

`IncentiveDecisionSchema` and both branches of `RedemptionResponseSchema` add `rewardRuleRef: z.string().min(1).optional()`.

- [ ] **Step 1: Write failing clean-break and response tests**

Assert:

- canonical `rewardRules` Promo parses;
- old `{ reward: ... }` Promo fails because the schema is strict;
- a Promo with neither rules nor fallback fails;
- a qualified decision and committed redemption can carry `rewardRuleRef`;
- empty `rewardRuleRef` fails;
- ordinary non-qualified shared decisions remain valid without the optional field.

- [ ] **Step 2: Run and observe failures at the old contract**

Run contracts tests. Expected: new payload fails and old payload still succeeds.

- [ ] **Step 3: Replace the Promo field and update canonical fixtures**

Remove the top-level `reward` schema/type. Prefer `CommerceReward` naming; do not retain a legacy input alias. Mechanically update test factories to one default rule:

```ts
rewardRules: [{
  id: 'default-reward',
  name: 'Default reward',
  conditions: {
    match: 'ALL',
    conditions: [{
      id: 'positive-cart',
      variable: 'cart.subtotal',
      operator: 'gte',
      value: 0,
    }],
  },
  reward: fixedTenOff,
}],
```

Use an explicit fallback where a fixture truly means unconditional reward; never invent an empty conditional group.

- [ ] **Step 4: Add selected-rule fields to shared outputs**

Update schema tests and conformance fixtures. Because the field is optional, existing non-Promo connector decisions remain source-compatible.

- [ ] **Step 5: Audit the clean break and commit**

Run:

```bash
rg -n 'program\.reward|config\.reward|PromoProgram\[.reward.\]|PromoRewardSchema|"reward"\s*:' packages apps/api docs/integration
```

Expected: no production top-level Promo reward reads; remaining `reward` matches are nested rule payloads or explicitly named future bundle fields.

Run contracts/module-kit/connector-kit/API builds and tests, then commit:

```bash
git add packages apps/api
git commit -m "feat: replace promo reward with ordered rules"
```

### Task 4: Implement deterministic Promo rule selection

**Files:**

- Modify: `packages/modules/promo/src/promo-module.ts`
- Modify: `packages/modules/promo/src/promo-module.test.ts`

**Behavior order:** lifecycle → manual code → global eligibility → ordered reward rules → fallback → no-match.

- [ ] **Step 1: Write failing module tests**

Cover:

- global eligibility failure does not evaluate/select a reward rule;
- first match wins when two conditions pass;
- reversing rule order changes the winner;
- fallback selection;
- no match yields `not_qualified`, `NO_REWARD_RULE_MATCHED`, no effects, no `rewardRuleRef`, and `commitRequired: false`;
- selected fixed, percent, line-item, and free-shipping rewards are copied;
- global eligibility retains its current condition-specific message;
- lifecycle/code failures never fabricate a rule reference.

```ts
expect(await evaluate(over150Cart, [over100, over50])).toMatchObject([{
  outcome: 'qualified',
  rewardRuleRef: 'over-100',
  effects: [twentyOff],
  commitRequired: true,
  eligible: true,
}]);
```

- [ ] **Step 2: Run focused tests and confirm selection is absent**

Run `pnpm --filter @incentives/promo test -- promo-module.test.ts`.

Expected: FAIL because implementation still assumes one reward.

- [ ] **Step 3: Implement one-pass ordered selection**

```ts
function selectReward(
  context: ModuleEvaluationContext,
  config: PromoProgram,
): { rewardRuleRef: string; reward: CommerceReward } | null {
  for (const rule of config.rewardRules) {
    if (evaluateConditionGroup(rule.conditions, context.definitions, context.facts).passed) {
      return { rewardRuleRef: rule.id, reward: rule.reward };
    }
  }
  return config.fallbackReward === undefined
    ? null
    : {
        rewardRuleRef: config.fallbackReward.id,
        reward: config.fallbackReward.reward,
      };
}
```

Return `NO_REWARD_RULE_MATCHED` when `selectReward()` returns `null`; do not expose an arbitrary failed rule's condition message.

- [ ] **Step 4: Verify module and downstream types**

Run Promo tests/build, module-kit tests/build, then API build. Expected: all exit `0`.

- [ ] **Step 5: Commit selection behavior**

```bash
git add packages/modules/promo
git commit -m "feat: select promo rewards by ordered conditions"
```

### Task 5: Validate every configurable condition and reward at the Program API

**Files:**

- Modify: `apps/api/src/services/program-service.ts`
- Modify: `apps/api/src/errors.ts`
- Modify: `apps/api/test/programs.test.ts`
- Modify: `apps/api/test/repositories.test.ts`

**Interfaces:** `POST/PATCH /v1/programs` still parse `PromoProgramSchema` and return field-aware validation failures through the existing error boundary.

- [ ] **Step 1: Write failing Program API tests**

Cover:

- variables in global eligibility and every rule condition are validated;
- draft programs use latest draft definitions and non-draft programs require published definitions;
- invalid operator/value paths identify the relevant `rewardRules` index;
- all fixed commerce rewards share one currency;
- budget currency matches that fixed currency;
- any selectable free-shipping rule or fallback forbids a monetary budget;
- fixed reward amounts are positive;
- cap relationship remains valid;
- create/get/list preserves IDs and order;
- PATCH of a draft can reorder rules while keeping IDs, while non-draft edit remains blocked;
- old top-level `reward` gets a 400 response.

- [ ] **Step 2: Run focused tests and confirm only global conditions are inspected**

Run `pnpm --filter @incentives/api test -- programs.test.ts repositories.test.ts`.

Expected: FAIL on rule variables and multi-reward money validation.

- [ ] **Step 3: Generalize condition traversal with paths**

Traverse global eligibility plus every rule condition group. Pass the structural prefix into `ContextValidationError`/Zod issue mapping so errors resolve to paths such as `rewardRules.1.conditions.conditions.0.value`; do not flatten away rule identity.

Extend `ContextValidationError` to accept optional canonical `ApiFieldError[]`, and have `mapFailure()` preserve them. Semantic operator/type errors should use the same field structure as Zod errors:

```ts
throw new ContextValidationError('The program failed validation', [{
  path: `rewardRules.${ruleIndex}.conditions.conditions.${conditionIndex}.value`,
  code: 'invalid_condition_value',
  message: `Condition ${condition.id} has an invalid value for ${definition.type}`,
}]);
```

- [ ] **Step 4: Validate the complete selectable reward set**

```ts
function selectableRewards(program: PromoProgram): CommerceReward[] {
  return [
    ...program.rewardRules.map(rule => rule.reward),
    ...(program.fallbackReward === undefined ? [] : [program.fallbackReward.reward]),
  ];
}
```

Validate positive fixed amounts, at most one fixed commerce currency, budget currency, any-free-shipping budget exclusion, and existing caps. Percent rewards need no currency but remain bounded by their canonical schema.

- [ ] **Step 5: Verify repository round-trip and no migration**

In the real-D1 repository test, create a two-rule Promo plus fallback, read it back, and assert `['over-100', 'under-100']` order. Confirm `git diff -- apps/api/migrations apps/api/src/db/schema.ts` is empty.

- [ ] **Step 6: Verify and commit configuration validation**

Run API tests/build/lint and contracts tests, then:

```bash
git add apps/api
git commit -m "feat: validate conditional promo configuration"
```

### Task 6: Apply currency, cap, and budget checks to the selected reward

**Files:**

- Modify: `apps/api/src/services/evaluation-service.ts`
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts`
- Modify: `apps/api/test/evaluate.test.ts`
- Modify: `apps/api/test/repositories.test.ts`
- Modify: `packages/engine/src/stacking.test.ts` only if a qualified decision fixture must include a rule reference

- [ ] **Step 1: Write failing evaluation tests**

Cover:

- `< 10000` selects £10 and `>= 10000` selects £20;
- overlapping conditions choose the first stored rule;
- no match/fallback semantics reach the HTTP response unchanged;
- selected fixed, percentage, line-item, and free-shipping projections remain exact;
- only selected reward cost is compared to/decremented from budget;
- usage and per-customer caps remain shared across rules;
- selected fixed reward and budget currency mismatch produce existing unavailable semantics;
- `rewardRuleRef` survives stable decision conversion, conflict resolution where selected, snapshot creation, HMAC signing, repository persistence, and response parsing;
- the exact Promo configuration used for selection is embedded in the signed snapshot, and changing it in persisted `facts_json` invalidates the HMAC;
- failed/unselected rules do not appear in the response or signed effects.

- [ ] **Step 2: Run focused tests and confirm single-reward helpers fail**

Run `pnpm --filter @incentives/api test -- evaluate.test.ts`.

Expected: FAIL at `hasCurrencyMismatch(program.reward)`, selected-cost expectations, or missing rule references.

- [ ] **Step 3: Move currency checks after rule selection**

Evaluate Promo first, then inspect the qualified decision's selected effect and the program budget:

```ts
function selectedCurrencyMismatch(
  program: PromoProgram,
  decision: PromoDecision,
  cartCurrency: string,
): boolean {
  const effect = decision.effects[0];
  return (program.budget !== undefined && program.budget.currency !== cartCurrency)
    || (effect !== undefined && 'amount' in effect
      && effect.amount.currency !== cartCurrency);
}
```

Transform only the selected decision to the existing currency-unavailable shape. Keep `projectedDiscountMinorUnits(decision.effects, cart)` unchanged so BigInt/floor behavior remains centralized.

- [ ] **Step 4: Preserve selected identity through exhaustion and signing**

Spreading an already selected decision may retain `rewardRuleRef` for `exhausted` because a rule was genuinely selected; ordinary lifecycle/code/global/no-match decisions must omit it. Verify `decisionSnapshot()` and `integrityPayload()` include the complete decision object without a special exclusion.

Extend the existing snapshot entry—already persisted inside `facts_json`—rather than adding a D1 column:

```ts
interface EvaluationProgramSnapshot {
  programRef: string;
  system: Record<string, unknown>;
  config: PromoProgram;
}

facts.programs.push({
  programRef: record.externalRef,
  system,
  config: record.program,
});
```

Update `FactsSchema` to parse `config` with `PromoProgramSchema`. Because `decisionSnapshot()` already includes `facts`, HMAC signing now covers the exact ordered rules, fallback, selected effects, rule reference, facts, and expiry without a table migration. Add repository corruption tests for malformed or tampered snapshotted configs.

- [ ] **Step 5: Verify and commit evaluation behavior**

Run API evaluation/full tests, engine tests, and API build/lint.

```bash
git add apps/api packages/engine
git commit -m "feat: evaluate selected promo reward safely"
```

### Task 7: Verify and commit the exact selected rule during redemption

**Files:**

- Modify: `apps/api/src/services/redemption-service.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts` only if canonical response validation requires it
- Modify: `apps/api/test/redemptions.test.ts`
- Modify: `apps/api/test/repositories.test.ts`

- [ ] **Step 1: Write failing redemption and corruption tests**

Cover:

- a valid selected conditional rule commits its ID and effect;
- a valid fallback commits its ID and effect;
- idempotent retry returns the original `rewardRuleRef` and effects;
- unknown, duplicate, missing, or changed rule reference fails closed;
- selected rule effect mismatch fails closed;
- response effect/rule tampering is detected during retry validation;
- current status, program-wide cap, customer cap, and selected-cost budget are atomically rechecked;
- redemption never re-evaluates rule conditions against new facts.

```ts
expect(await redeem(evaluationId, 'spend-more')).toMatchObject({
  status: 'committed',
  rewardRuleRef: 'over-100',
  effects: [twentyOff],
});
```

- [ ] **Step 2: Run focused tests and confirm current comparison targets one top-level reward**

Run `pnpm --filter @incentives/api test -- redemptions.test.ts repositories.test.ts`.

Expected: FAIL because redemption compares to `[program.program.reward]` and omits the rule reference.

- [ ] **Step 3: Resolve the selected reward by stable ID**

```ts
function rewardByRef(program: PromoProgram, rewardRuleRef: string): CommerceReward {
  const matches = [
    ...program.rewardRules
      .filter(rule => rule.id === rewardRuleRef)
      .map(rule => rule.reward),
    ...(program.fallbackReward?.id === rewardRuleRef
      ? [program.fallbackReward.reward]
      : []),
  ];
  if (matches.length !== 1) {
    throw new VersionConflictError('The selected reward rule changed after evaluation');
  }
  return matches[0]!;
}
```

Require `decision.rewardRuleRef` for a qualified Promo decision, compare canonical selected effect to `decision.effects`, and perform currency/projected-cost checks on that effect.

Resolve and validate the selected reward first against the signed `facts.programs[].config`, then against the current repository program. The snapshot proves what was evaluated; the current program supplies authoritative status/cap/budget state. Missing/duplicate snapshot entries, unknown IDs, or either effect mismatch fail closed. Do not re-run the rule's conditions.

- [ ] **Step 4: Include the reference in response and retry integrity**

Construct `RedemptionResponseSchema` with `rewardRuleRef: decision.rewardRuleRef`. `validateCommittedRedemption()` compares response rule reference and effects to the signed decision. Atomic repository commit continues to compare the full `expectedProgram` JSON, so reordered/changed configuration cannot slip through.

- [ ] **Step 5: Verify and commit redemption behavior**

Run all redemption/repository/full-flow tests and API build/lint.

```bash
git add apps/api
git commit -m "feat: commit selected promo reward rule"
```

### Task 8: Generate truthful OpenAPI and update validated integration documentation

**Files:**

- Modify: `packages/contracts/src/openapi.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/contracts/test-fixtures/documentation-examples.ts`
- Modify: `packages/contracts/src/documentation-examples.test.ts`
- Modify: `docs/integration/core-contracts.md`
- Modify: `docs/integration/runtime-api.md`
- Modify: `docs/integration/connector-conformance.md` only if a Promo decision example is present

- [ ] **Step 1: Write failing OpenAPI/documentation-example tests**

Assert generated OpenAPI contains components for:

- `RewardRule`, `CommerceReward`, `PromoProgram` with `rewardRules` and no top-level `reward`;
- `AffiliateProgram`, `ReferralProgram`, and `LoyaltyProgram` described as future configuration contracts;
- `rewardRuleRef` in decision/redemption responses;
- live `/v1/programs` request/response bodies referencing Promo only.

Add validated examples for a two-tier Promo, first-match response, fallback response, no-match response, and committed redemption.

- [ ] **Step 2: Run and confirm stale generated schemas/examples**

Run contracts tests. Expected: FAIL because OpenAPI and documentation fixtures still describe one reward.

- [ ] **Step 3: Register concrete components without widening live routes**

Register all four program components. Use future-schema descriptions/metadata, but keep `promoProgram` as the only schema passed to `POST /v1/programs`, `PATCH /v1/programs/{externalRef}`, and `ProgramListResponseSchema`.

- [ ] **Step 4: Update client-facing docs**

Document:

- global eligibility versus ordered reward-rule conditions;
- first-match and fallback semantics;
- `NO_REWARD_RULE_MATCHED`;
- `rewardRuleRef` through evaluate/redeem;
- selected reward budget/cap behavior;
- Affiliate/Referral/Loyalty as contracts only;
- Loyalty `assetRef` as opaque terminology, with Wallet Asset Catalog explicitly deferred;
- clean local D1 recreation before testing old workspaces.

Every JSON example must be imported from or duplicated into a schema-validated fixture.

- [ ] **Step 5: Verify and commit generated contract documentation**

Run contracts test/build/lint and API OpenAPI route tests.

```bash
git add packages/contracts docs/integration
git commit -m "docs: publish conditional reward runtime contracts"
```

### Task 9: Prove the tiered Promo end to end and synchronize documentation

**Files:**

- Modify: `apps/api/test/full-flow.test.ts`
- Modify: `docs/superpowers/specs/2026-07-19-conditional-reward-rules-design.md` only for final implementation status/linkage
- Modify: this plan's checkbox/status metadata during execution
- Modify: Notion mirrors for the design, this runtime plan, the Operator UI plan, and changed integration docs

- [ ] **Step 1: Write the failing real-D1 full-flow scenario**

The test must:

1. publish typed `customer.tier` and `context.channel` definitions;
2. store a customer once via `PATCH /v1/customers/{customerRef}`;
3. create one active Promo with global eligibility and ordered `>= £100 → £20`, `< £100 → £10`, plus optional fallback;
4. evaluate below and above the threshold without resending customer attributes;
5. assert different `rewardRuleRef` and effects;
6. redeem one qualified decision and retry idempotently;
7. prove program-wide usage/customer/budget exhaustion across different rules;
8. assert no-match behavior in a second Promo without fallback.

- [ ] **Step 2: Run the scenario and confirm the feature is not yet complete**

Run `pnpm --filter @incentives/api test:full-flow`.

Expected before implementation: FAIL on new Promo payload/selected rule assertions.

- [ ] **Step 3: Make only integration-level corrections**

Do not add new production behavior here. Correct fixture wiring or expose a missing already-designed field, then rerun focused suites if any production file changes.

- [ ] **Step 4: Run the complete verification matrix**

```bash
pnpm install --frozen-lockfile
pnpm --filter @incentives/contracts test
pnpm --filter @incentives/contracts build
pnpm --filter @incentives/contracts lint
pnpm --filter @incentives/engine test
pnpm --filter @incentives/module-kit test
pnpm --filter @incentives/connector-kit test
pnpm --filter @incentives/promo test
pnpm --filter @incentives/api test
pnpm --filter @incentives/api build
pnpm --filter @incentives/api lint
pnpm --filter @incentives/api db:check
pnpm test
pnpm build
pnpm lint
git diff --check
```

Expected: every command exits `0` and `git diff --check` prints nothing.

- [ ] **Step 5: Perform the clean-break/manual audit**

Create an isolated local D1 state directory so old single-reward rows are never read:

```bash
INCENTIVES_D1_STATE_DIR="$(mktemp -d)"
pnpm --filter @incentives/api exec wrangler d1 migrations apply incentives-dev --local --persist-to "$INCENTIVES_D1_STATE_DIR"
pnpm --filter @incentives/api exec wrangler dev --persist-to "$INCENTIVES_D1_STATE_DIR"
```

Using the exact curl payloads added to `docs/integration/runtime-api.md`, create the tiered Promo, evaluate carts on both sides of the threshold, redeem, and retry. Capture only request IDs/outcomes/rule refs in implementation notes. Never capture tokens or customer attribute values. The temporary directory can be discarded after the manual run; do not delete or overwrite an existing `.wrangler/state` directory.

Run the stale-field audit from Task 3 again. Confirm no migration files changed and no future module appears in a live route.

- [ ] **Step 6: Synchronize repository and Notion copies**

Update implementation status and exact verification evidence in repository docs. Mirror every changed document to its existing Notion page; create this plan's page under the Plans parent. Read each page back and verify it is not truncated and contains no unknown blocks.

- [ ] **Step 7: Request review and commit the integration proof**

Use `superpowers:requesting-code-review`, address verified findings, rerun affected gates, then:

```bash
git add apps/api/test docs
git commit -m "test: prove conditional promo rewards end to end"
```

## Completion criteria

This runtime plan is complete only when:

- Promo accepts ordered rules/fallback and rejects the former top-level reward;
- all four modules have concrete strict configuration schema exports;
- only Promo is exposed by runtime routes;
- first-match selection is deterministic and selected effects are safe under currency, budget, usage, and customer caps;
- signed decisions and committed/idempotent redemptions preserve exact `rewardRuleRef`;
- tamper, stale config, unknown rule, and effect mismatch paths fail closed;
- the real-D1 full flow proves two cart thresholds without resending customer attributes;
- all workspace gates pass;
- no D1 schema migration exists;
- repository and Notion documentation are synchronized;
- the amended Operator UI plan is ready to build the shared rule editor against this runtime contract.

## Self-review checklist

- **Spec coverage:** Shared rules, all four concrete contracts, Promo runtime, first-match/fallback/no-match, selected-reference integrity, money/caps, clean break, OpenAPI, storage, manual proof, and UI sequencing all map to Tasks 1–9.
- **Type consistency:** `CommerceReward`, `WalletAccrual`, module bundles, `ConditionalRewards<TReward>`, optional shared `rewardRuleRef`, and stronger Promo invariants use the same names throughout.
- **Runtime boundary:** Affiliate/Referral/Loyalty exports never enter live program routes or repositories.
- **No placeholders:** Every task names exact files, test behavior, commands, expected red state, implementation shape, verification, and commit boundary.
- **No hidden migration:** Program JSON changes only; migration and table metadata are explicitly audited.
- **UI dependency:** Operator UI Task 3 is amended, but this plan does not duplicate its API-client/schema/editor execution work.
