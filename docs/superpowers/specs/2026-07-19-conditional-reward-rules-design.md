# Conditional Reward Rules — Cross-Module Design Spec

**Date:** 2026-07-19

**Status:** Runtime implemented and locally verified; Operator UI deferred

**Purpose:** Let merchants configure different rewards for different typed conditions inside one program, with deterministic first-match selection and a reusable contract shared by Promo, Affiliate, Referral, and Loyalty.

**Notion mirror:** https://app.notion.com/p/Conditional-Reward-Rules-Cross-Module-Design-Spec-3a2e5c7c2b8e812a95dcd669ffdb8671

**Mirror state:** Repository and Notion copies synchronized and read back successfully on 2026-07-19.

**Builds on:**

- `docs/superpowers/specs/2026-07-18-integration-ready-incentives-core-design.md`
- `docs/integration/core-contracts.md`
- `docs/integration/runtime-api.md`

**Implementation linkage:**

- Runtime execution record: `docs/superpowers/plans/2026-07-19-conditional-reward-rules-runtime.md`
- Real Worker/D1 acceptance proof: `apps/api/test/full-flow.test.ts`
- Reproducible isolated-D1 walkthrough: `docs/integration/runtime-api.md#local-end-to-end-test`
- Operator UI follow-on: `docs/superpowers/plans/2026-07-18-integration-ready-core-operator-ui.md`

---

## 1. Problem and outcome

Before this change, the production Promo contract had one program-wide eligibility group and one reward. It could not express a common tiered offer such as:

- £10 off when the cart subtotal is below £100;
- £20 off when the cart subtotal is £100 or more.

Merchants need to select different rewards using the same typed variables and condition builder already used for eligibility. The selection must be deterministic, auditable, safe under budget and cap enforcement, and usable by future incentive modules without forcing every module to share the same reward payload.

The chosen outcome is:

1. Keep one global eligibility gate per program.
2. Add ordered conditional reward rules.
3. Select the first matching rule.
4. Support an optional fallback reward.
5. Return the selected rule reference in evaluation and redemption.
6. Define shared conditional-reward contracts for all four modules.
7. Implement runtime behavior for Promo only in this delivery.

## 2. Chosen approach

### Ordered reward rules inside one program

Each program owns one ordered list of reward rules. A rule has stable identity, a merchant-facing name, a typed condition group, and a module-specific reward payload. The first rule whose conditions pass supplies the reward.

This approach was selected over:

- **Separate child programs:** reuses the current single-reward runtime but fragments one merchant concept across budgets, caps, reporting, stacking, and idempotency boundaries.
- **A general expression tree with reward leaves:** maximizes theoretical flexibility but makes editing, validation, auditing, rule-order explanation, and future migration unnecessarily complex.

Array order is authoritative. The contract does not maintain a second numeric rule-priority field that could disagree with array order.

## 3. Shared conditional reward contracts

The contracts package will expose shared structural types and Zod schemas instantiated with a module-specific reward schema.

```ts
interface RewardRule<TReward> {
  id: string;
  name: string;
  conditions: ConditionGroup;
  reward: TReward;
}

interface FallbackReward<TReward> {
  id: string;
  name: string;
  reward: TReward;
}

interface ConditionalRewards<TReward> {
  rewardRules: RewardRule<TReward>[];
  fallbackReward?: FallbackReward<TReward>;
}
```

Shared validation rules:

- `id` is a non-empty opaque string and is unique across conditional rules and the fallback.
- `name` is required and limited to 200 characters.
- A conditional rule contains at least one leaf condition; an empty condition group cannot silently become an always-matching first rule.
- A configuration contains at least one conditional rule or a fallback.
- Conditions use the existing `ConditionGroup` model, including nested `ALL` and `ANY` groups.
- Conditions may reference any applicable typed customer, context, cart, line-item, event, or system definition.
- Arbitrary JavaScript and free-form executable expressions are not supported.
- Rule IDs become immutable whenever the containing program's existing lifecycle/reference rules make program identity-bearing configuration immutable.

The Zod implementation may use an internal schema factory, but the public package exports concrete schemas and inferred types rather than requiring consumers to construct schemas themselves.

## 4. Common program evaluation model

All four program contracts use the same logical stages:

1. Check lifecycle status, schedule, and module-specific access requirements such as a code or event trigger.
2. Evaluate the program-wide `eligibility` group.
3. Evaluate `rewardRules` in stored array order.
4. Select the first passing rule.
5. If no conditional rule passes, select `fallbackReward` when present.
6. If neither is available, return `not_qualified` with `NO_REWARD_RULE_MATCHED`.
7. Apply module-specific availability, budget, usage, customer-cap, currency, and consistency checks to the selected reward.
8. Return the selected reward/effects and `rewardRuleRef`.

Overlapping rules are allowed. First-match order resolves them deliberately. The API does not attempt to prove arbitrary nested predicates mutually exclusive or collectively exhaustive.

Global eligibility failure retains the existing eligibility reason and message. Rule-selection failure uses `NO_REWARD_RULE_MATCHED`; it does not reuse a failure from an arbitrary earlier reward rule because no single rule is authoritative when all rules fail.

## 5. Promo contract and runtime

### Contract change

`PromoProgram.reward` is removed. Promo composes `ConditionalRewards<CommerceReward>`:

```ts
interface PromoProgram {
  id: string;
  type: 'promo';
  name: string;
  status: ProgramStatus;
  eligibility: ConditionGroup;
  rewardRules: RewardRule<CommerceReward>[];
  fallbackReward?: FallbackReward<CommerceReward>;
  // existing schedule, budget, caps, code, stacking, and priority fields
}
```

`CommerceReward` is the existing strict union of order discount, line-item discount, and free-shipping effects. The existing Promo-specific name may be replaced by the neutral exported name because Affiliate and Referral also consume commerce rewards.

Example:

```json
{
  "id": "spend-more",
  "type": "promo",
  "name": "Spend more, save more",
  "status": "active",
  "eligibility": {
    "match": "ALL",
    "conditions": []
  },
  "rewardRules": [
    {
      "id": "over-100",
      "name": "£20 off orders of £100 or more",
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
        "calculation": "fixed",
        "amount": { "currency": "GBP", "minorUnits": 2000 }
      }
    },
    {
      "id": "under-100",
      "name": "£10 off orders under £100",
      "conditions": {
        "match": "ALL",
        "conditions": [
          {
            "id": "cart-under-100",
            "variable": "cart.subtotal",
            "operator": "lt",
            "value": 10000
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
  "stackable": false,
  "priority": 10,
  "autoApply": true
}
```

### Money and budget rules

- Every fixed monetary reward in one Promo uses the same ISO currency.
- A program budget uses that same currency.
- Percentage rewards are projected against the cart using the existing integer/BigInt arithmetic and deterministic floor rounding.
- The selected reward alone determines projected discount and budget decrement.
- A Promo containing any selectable free-shipping reward cannot configure a monetary budget until evaluation contains an authoritative shipping cost.
- Existing usage and per-customer caps remain program-wide rather than resetting for each rule.

### Runtime decision

The Promo module emits one decision. A qualified decision includes the selected rule ID:

```json
{
  "programRef": "spend-more",
  "programType": "promo",
  "rewardRuleRef": "over-100",
  "outcome": "qualified",
  "effects": [],
  "commitRequired": true,
  "eligible": true
}
```

`rewardRuleRef` is absent on ordinary non-qualified decisions because no reward was selected.

## 6. Affiliate configuration contract

Affiliate composes `ConditionalRewards<AffiliateRuleReward>`.

```ts
type CommissionReward =
  | {
      type: 'commission';
      calculation: 'fixed';
      amount: Money;
    }
  | {
      type: 'commission';
      calculation: 'percent';
      basisPoints: number;
    };

interface AffiliateRuleReward {
  customerReward?: CommerceReward;
  affiliateReward?: CommissionReward;
}
```

At least one side is required. This supports a customer-only affiliate discount initially and later supports conditional partner commission without changing rule selection.

Fixed commission uses positive integer monetary minor units. Percentage commission uses positive integer basis points no greater than 10,000. Commission settlement currency is validated independently from the shopper-facing commerce reward because a partner may settle in a different currency.

The production configuration schema also formalizes the existing demo concepts: program identity/lifecycle, global eligibility, schedule and limits, ordered conditional rewards, code-batch count, and per-code use limit. Code issuance, attribution, commission settlement, persistence, and runtime evaluation remain deferred.

## 7. Referral configuration contract

Referral composes `ConditionalRewards<ReferralRuleReward>`.

```ts
interface ReferralRuleReward {
  referrerReward?: CommerceReward | WalletAccrual;
  refereeReward?: CommerceReward | WalletAccrual;
}
```

At least one side is required. The contract permits two-sided, referrer-only, and referee-only programs. The same rule selects the bundle atomically so two independent condition lists cannot select incompatible sides.

The production configuration schema also formalizes program identity/lifecycle, global eligibility (the existing “applies to” concept), referral priority, schedule and limits, and ordered conditional reward bundles. Link/code issuance, referral identity, qualification events, attribution, wallet crediting, persistence, and runtime evaluation remain deferred.

## 8. Loyalty configuration contract

Loyalty composes `ConditionalRewards<WalletAccrual>` and references one typed event definition through `triggerEvent`.

Wallet asset terminology is not hardcoded as points or credit. The rule carries an opaque asset reference:

```ts
type WalletAccrual =
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

Validation rules:

- `assetRef` is a non-empty opaque reference.
- Fixed `quantity`, `sourceUnitsPerStep`, and `quantityPerStep` are positive safe integers representing smallest configured units.
- `sourceVariable` references a published numeric event, customer, or system definition available to the loyalty trigger.
- Per-unit calculation is `floor(source / sourceUnitsPerStep) * quantityPerStep` using integer arithmetic.
- One Loyalty program uses a compatible asset across all rule and fallback outputs.

Example: if `event.order_total` is integer currency minor units, `sourceUnitsPerStep: 100` and `quantityPerStep: 2` awards two asset units per major currency unit.

Client-facing asset labels such as Stars, Miles, Coins, Cashback, or Credits; singular/plural forms; symbol; precision; monetary backing; expiry; and redemption behavior belong to a separate Wallet Asset Catalog design. This work reserves and validates `assetRef` but does not implement that catalog.

Loyalty redemption/spending is a separate future contract from accrual. This schema covers event-triggered earning only. Event ingestion, wallet persistence, accrual ledger, asset resolution, and runtime evaluation remain deferred.

## 9. Concrete schema exports and runtime support

The contracts package exports `PromoProgramSchema`, `AffiliateProgramSchema`, `ReferralProgramSchema`, and `LoyaltyProgramSchema`, plus their inferred types and module-specific conditional reward schemas.

Those exports describe validated configuration; they do not imply that every module is operational. The current `/v1/programs` routes continue to accept and return `PromoProgramSchema` only. They do not switch to an all-module discriminated union until the corresponding persistence and runtime implementation is approved. OpenAPI must label Affiliate, Referral, and Loyalty configuration schemas as future module contracts rather than supported runtime request bodies.

## 10. Decision, snapshot, and redemption contracts

The shared decision and redemption schemas add optional `rewardRuleRef`:

```ts
interface IncentiveDecision {
  rewardRuleRef?: string;
}

interface RedemptionResponse {
  rewardRuleRef?: string;
}
```

Shared schemas keep the field optional because module decisions can be non-qualified and future modules may emit non-rule decisions. Module-specific invariants require:

- qualified Promo decisions contain `rewardRuleRef`;
- committed Promo redemptions contain the exact selected `rewardRuleRef`;
- non-qualified Promo decisions do not fabricate a selected rule;
- the selected rule exists exactly once in the snapshotted program configuration;
- snapshotted effects equal that rule or fallback reward;
- HMAC integrity covers `rewardRuleRef`, program configuration, selected effects, facts, and expiry;
- idempotent retries return the original rule reference and effects;
- a missing, changed, or mismatched rule reference/effect fails closed as unavailable or conflict according to the existing persisted-corruption and request-conflict policy.

Redemption does not re-run reward-rule conditions. It verifies and commits the signed selection, while atomically rechecking only current authoritative mutable constraints such as program status, caps, budget, reward/currency compatibility, and persisted program identity.

## 11. Configuration validation and lifecycle

Every condition in global eligibility and every conditional reward rule is validated against the schema snapshot appropriate to the program lifecycle:

- draft programs use the latest draft definitions;
- active and other non-draft programs use the current published definitions;
- repository guards independently enforce that pairing during concurrent mutations.

The API rejects:

- duplicate or empty rule IDs;
- an ID reused by the fallback;
- missing rule names;
- empty conditional rule groups;
- undefined variables;
- operators or values incompatible with definition types;
- empty Affiliate or Referral reward bundles;
- invalid commission, wallet, money, or reward shapes;
- incompatible fixed currencies;
- budget/free-shipping combinations;
- a configuration with neither conditional rules nor fallback;
- lifecycle-unsafe identity or ordering changes under existing program edit rules.

General overlap and exhaustiveness are not API errors. The dashboard may produce advisory warnings for exact duplicate predicates, an obviously always-matching earlier rule, and simple numeric gaps or overlaps. The stored array order remains authoritative even when a warning is acknowledged.

## 12. Operator UI

Operator UI implementation is an amended follow-on delivery under
`docs/superpowers/plans/2026-07-18-integration-ready-core-operator-ui.md`; it is not
part of this runtime delivery. In that follow-on, the Promo wizard will retain its
global **Eligibility** step and its single **Discount** step will become **Reward
rules**.

The planned shared editor will provide:

- stable rule name and ID;
- the existing nested typed condition builder;
- a module-specific reward editor;
- move up/down controls with accessible ordering semantics;
- duplicate and delete actions;
- optional “Otherwise…” fallback reward;
- a persistent “first matching rule wins” explanation;
- rule-, condition-, and reward-level server validation;
- advisory overlap, gap, duplicate, and unreachable-rule warnings;
- review/detail summaries in authoritative order.

The follow-on program list/detail summaries will show “2 conditional rewards” or a
concise ordered summary rather than pretending the program has one discount. A future
simulator may show the selected `rewardRuleRef` and the facts that caused the rule to
win.

The planned shared React editor will accept a module-specific reward renderer, and the
follow-on Operator UI delivery will wire Promo to the real API. Affiliate, Referral,
and Loyalty may use adapters in internal/demo code, but the product must not present
them as operational backend features until their runtimes exist.

The existing Operator UI implementation plan must be amended before implementation so it does not build the obsolete single-reward Promo form.

## 13. API, OpenAPI, and storage

This is a clean pre-client contract break:

- old Promo payloads containing top-level `reward` are rejected;
- no permanent dual-read or legacy input schema is added;
- fixtures, documentation examples, generated OpenAPI, conformance suites, and connector examples move to the new shape;
- existing local development D1 state is recreated after the contract change.

No D1 table change is required because program configuration is stored as validated JSON and the baseline migration does not seed program rows. Drizzle table metadata remains unchanged. A future production migration is unnecessary because there are no live client program records.

`GET /v1/openapi.json` remains generated exclusively from `@incentives/contracts`. It documents concrete conditional reward schemas, module-specific reward payloads, `rewardRuleRef`, field issues, and the clean Promo request/response change.

## 14. Errors and failure policy

- Global eligibility failure remains `not_qualified` with the existing condition reason.
- No rule match without fallback is `not_qualified / NO_REWARD_RULE_MATCHED` with no effects and no `rewardRuleRef`.
- Invalid program configuration is rejected at configuration time with field paths such as `rewardRules.1.conditions.conditions.0.value`.
- Published-schema drift or persisted invalid rule configuration is a retryable `503 EVALUATION_UNAVAILABLE`, never ordinary ineligibility.
- Rule evaluation infrastructure failure fails the whole evaluation under the existing all-or-nothing module policy.
- Currency mismatch and mutable cap/budget exhaustion retain their existing stable unavailable/exhausted semantics and apply to the selected reward.
- Redemption tamper, corruption, expiry, conflict, and idempotency behavior remains consistent with the Runtime error contract.

## 15. Verification

### Contract tests

- Shared rule identity, ordering, fallback, non-empty, and duplicate validation.
- Concrete schemas for Promo, Affiliate, Referral, and Loyalty.
- Empty and valid Affiliate/Referral bundles.
- Fixed and percent commissions.
- Fixed and per-unit wallet accrual with safe integer validation.
- Opaque asset references without hardcoded points/credit terminology.
- Clean rejection of the old top-level Promo `reward` field.

### Promo module tests

- Global eligibility runs before reward rules.
- First matching rule wins when multiple rules pass.
- Reordering rules changes the deterministic winner.
- Fallback selection.
- No-match decision and reason.
- Fixed, percentage, line-item, and free-shipping rewards.
- Failure messages and unavailable behavior.

### Runtime tests

- Program validation against draft versus published definitions for every rule.
- D1 persistence/read-back preserves rule order and stable IDs.
- Selected-rule currency and BigInt projected-discount calculations.
- Program budget, usage cap, and per-customer cap use the selected reward.
- Signed snapshot contains exact `rewardRuleRef` and effect.
- Tampered or mismatched rule/effect redemption fails closed.
- Valid idempotent retry returns the original rule and does not double-decrement.
- OpenAPI exact method/schema/error/header matrix remains green.
- Full real HTTP+D1 flow creates a tiered Promo, evaluates both tiers, commits one, and verifies exhaustion/idempotency behavior.

### UI tests

- Add, rename, reorder, duplicate, and delete rules.
- Configure fallback.
- Existing typed condition and reward editors remain reusable.
- Rule-level server field paths render at the correct control.
- First-match explanation and review ordering.
- Advisory warnings do not silently reorder or rewrite merchant configuration.

### Regression gates

- Existing clean-checkout gate.
- Full workspace tests, build, lint, Drizzle check, and diff check.
- Repository and Notion documentation mirrors updated and read back untruncated.

## 16. Delivery boundaries

### Included

- Shared conditional reward rule contracts.
- Concrete conditional reward configuration contracts for all four modules.
- Promo clean contract change and complete runtime behavior.
- Shared `rewardRuleRef` decision/redemption support.
- Promo API, OpenAPI, persistence validation, budget/cap, HMAC, idempotency, and end-to-end updates.
- Amendments to affected Runtime and Operator UI documentation/plans.

### Deferred

- Affiliate code issuance, attribution, commission settlement, persistence, and runtime.
- Referral identity, links/codes, qualification events, attribution, wallet crediting, persistence, and runtime.
- Loyalty event ingestion, asset registry, wallet ledger, accrual execution, redemption/spending, persistence, and runtime.
- Wallet Asset Catalog labels, symbols, precision, backing, expiry, and redemption behavior.
- Shared reward-rule editor and Promo Operator UI integration, delivered through the
  amended follow-on Operator UI plan.
- Mathematical satisfiability/exhaustiveness analysis for arbitrary nested conditions.
- Arbitrary executable merchant expressions.

## 17. Client-visible definition of done

A merchant can configure one Promo with global eligibility and multiple ordered condition-specific rewards, understand that first match wins, optionally configure an “Otherwise” reward, and inspect the ordered configuration before activation.

An integration can evaluate the Promo, receive one qualified effect with a stable `rewardRuleRef`, commit it before payment capture, and retry safely without changing the selected rule or double-counting budget/caps.

The contracts package exposes the same conditional-rule structure with concrete reward payload validation for Affiliate, Referral, and Loyalty, while clearly marking those runtimes as deferred.
