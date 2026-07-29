# Promo Selection, Code Stacking, and Atomic Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Promo evaluation private and deterministic: automatic requests return at most one winner, coded requests evaluate only submitted codes, compatible coded Promos may combine, and the complete selected set commits as one atomic redemption bundle.

**Architecture:** Keep `/v1/evaluate` as the single public entrypoint and infer automatic or coded mode from an optional `codes` array. Put normalization and ordering in shared domain code, keep Promo-specific selection in the engine, enforce code ownership and bundle commits in provider-neutral persistence ports, and use a D1 transactional adapter first. Keep the public atomic-redemption callsite independent of Cloudflare so a future distributed budget-authority adapter can implement the same contract.

**Tech Stack:** TypeScript, Zod, Hono, Cloudflare Workers, D1/Drizzle, React, React Router, Vitest, Testing Library, pnpm.

**Status:** Done — Tasks 1–9 and Task 10 review remediation are implemented,
verified, independently reviewed, and merged through PR #10. Migration `0006`,
API, and Operator Web are deployed to staging, and every mandatory manual Gate
C case passed, including `OBS-API-01`.

**Notion mirror:** https://app.notion.com/p/Promo-Selection-Code-Stacking-and-Atomic-Redemption-Implementation-Plan-3a7e5c7c2b8e811791dee0d21803c8e2

**Approved design:** [Promo Selection, Code Stacking, and Atomic Redemption design](../specs/2026-07-23-promo-selection-code-stacking-design.md)

## Global Constraints

- Preserve the clean break: reject singular `code`; accept only optional `codes`.
- Apply the new selection rules only to Promo. Do not silently impose them on Affiliate, Referral, or Loyalty.
- Use one shared normalization function and one shared binary `programRef` comparator at every callsite.
- Automatic Promos have no code and are always non-stackable.
- Only coded Promos expose `stackable`.
- Remove `stackingGroup` from contracts, storage serialization, services, and UI.
- Never expose rejected automatic candidates or unrelated codes in a public response.
- Treat a selected coded set as one redemption bundle. No public child-program commit endpoint remains.
- Keep provider details behind `AtomicRedemptionCoordinator`; do not expose D1 or Cloudflare types to services.
- Do not claim distributed ACID. The initial adapter is atomic because the relevant state is in one D1 database.
- Preserve readable legacy redemption records for staging audit, but never emit the old response contract.
- Structured logs must include correlation IDs and sanitized identifiers, never credentials, raw codes, customer attributes, or request bodies.
- Free-shipping reservations and cost accounting remain governed by the separate free-shipping budget-authority design.
- Multiple parallel drafts, full revision diff/history/rollback, percentage-friendly authoring, and Loyalty rewards remain documented follow-ups.
- Do not deploy, migrate staging, rotate secrets, or write to Cloudflare from an implementation session. The account owner executes each external write after reviewing the exact command.
- Do not use git worktrees for this repository.

## File Map

| Area | Files |
|---|---|
| Shared contracts | `packages/contracts/src/evaluation.ts`, `packages/contracts/src/programs.ts`, `packages/contracts/src/operator-bff.ts`, `packages/contracts/src/runtime-api.ts`, `packages/contracts/src/openapi.ts`, `packages/contracts/src/index.ts`, new `packages/contracts/src/promo-codes.ts` |
| Contract tests | `packages/contracts/src/contracts.test.ts`, `packages/contracts/src/production-operator-contracts.test.ts`, `packages/contracts/src/documentation-examples.test.ts`, `packages/contracts/test-fixtures/documentation-examples.ts` |
| Selection engine | `packages/engine/src/stacking.ts`, `packages/engine/src/stacking.test.ts`, `packages/engine/src/index.ts` |
| Module boundary | `packages/module-kit/src/module.ts`, `packages/module-kit/src/conformance.ts`, `packages/module-kit/src/conformance.test.ts`, `packages/modules/promo/src/promo-module.ts`, `packages/modules/promo/src/promo-module.test.ts` |
| Persistence contracts | `apps/api/src/repositories/types.ts`, `apps/api/src/repositories/d1-repositories.ts`, `apps/api/src/db/schema.ts` |
| Migration | new `apps/api/migrations/0006_promo_selection_redemption_bundles.sql`, `apps/api/test/production-migration.test.ts`, `apps/api/test/repositories.test.ts` |
| Program publication | `apps/api/src/services/program-service.ts`, `apps/api/src/routes/programs.ts`, `apps/api/src/errors.ts`, `apps/api/test/programs.test.ts`, `apps/api/test/program-revisions.test.ts` |
| Evaluation | `apps/api/src/services/evaluation-service.ts`, `apps/api/src/routes/evaluate.ts`, `apps/api/test/evaluate.test.ts` |
| Atomic redemption | new `apps/api/src/redemption/atomic-redemption-coordinator.ts`, new `apps/api/src/redemption/d1-atomic-redemption-coordinator.ts`, `apps/api/src/services/redemption-service.ts`, `apps/api/src/services/redemption-receipt.ts`, `apps/api/src/routes/redemptions.ts`, `apps/api/src/env.ts`, `apps/api/src/app.ts`, `apps/api/test/redemptions.test.ts` |
| Observability | new `apps/api/src/observability.ts`, `apps/api/src/app.ts`, `apps/api/src/errors.ts`, `apps/api/src/routes/evaluate.ts`, `apps/api/src/routes/redemptions.ts`, `apps/api/test/app.test.ts`, `apps/api/test/evaluate.test.ts` |
| Operator API/UI | `packages/contracts/src/operator-bff.ts`, `apps/api/src/services/program-service.ts`, `apps/dashboard/src/data/program-api.ts`, `apps/dashboard/src/lib/bff-client.ts`, `apps/dashboard/src/pages/promo/LivePromoEditor.tsx`, `apps/dashboard/src/pages/promo/LivePromoDetail.tsx`, `apps/dashboard/src/pages/promo/LivePromoList.tsx`, `apps/dashboard/src/pages/LiveOperatorJourney.test.tsx` |
| End-to-end verification | `apps/api/test/full-flow.test.ts`, `docs/integration/core-contracts.md`, `docs/integration/runtime-api.md`, `docs/testing/gate-c-manual-test.md`, `docs/testing/staging-activation-run-2026-07-21.md`, `docs/product/current-state-and-roadmap.md`, `docs/product/follow-up-register.md` |

---

### Task 1: Make the Public Contracts Express the Approved Product Model

**Files:**

- Create: `packages/contracts/src/promo-codes.ts`
- Modify: `packages/contracts/src/evaluation.ts`
- Modify: `packages/contracts/src/programs.ts`
- Modify: `packages/contracts/src/runtime-api.ts`
- Modify: `packages/contracts/src/openapi.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.test.ts`
- Test: `packages/contracts/src/documentation-examples.test.ts`
- Test fixture: `packages/contracts/test-fixtures/documentation-examples.ts`

- [x] **Step 1: Add failing normalization and request-shape tests**

Add contract tests for:

- omitted `codes` and `codes: []`;
- one to ten distinct normalized codes;
- duplicate codes preserving the first occurrence;
- rejection of eleven distinct codes;
- rejection of singular `code`;
- trimming and default uppercase conversion;
- code-point length rather than UTF-16 code-unit length;
- case expansion such as `ß` becoming `SS`; and
- no compatibility or fuzzy normalization.

Use explicit fixtures:

```ts
expect(normalizePromoCode('  gatec15  ')).toEqual({
  display: 'gatec15',
  normalized: 'GATEC15',
});
expect(normalizePromoCode('ß')).toEqual({
  display: 'ß',
  normalized: 'SS',
});
expect(normalizeDistinctPromoCodes([' gatec15 ', 'GATEC15', 'vip20']))
  .toEqual([
    { display: 'gatec15', normalized: 'GATEC15' },
    { display: 'vip20', normalized: 'VIP20' },
  ]);
expect(() => EvaluationRequestSchema.parse({
  code: 'GATEC15',
  cart: validCart,
})).toThrow();
```

Run:

```bash
pnpm --filter @incentives/contracts test
```

Expected: FAIL because the shared normalization helpers and `codes` contract do not exist.

- [x] **Step 2: Add failing strict Promo-trigger tests**

Pin the discriminated union:

```ts
expect(PromoProgramSchema.safeParse({
  ...basePromo,
  autoApply: true,
  stackable: false,
}).success).toBe(true);

expect(PromoProgramSchema.safeParse({
  ...basePromo,
  autoApply: true,
  code: 'AUTO',
  stackable: false,
}).success).toBe(false);

expect(PromoProgramSchema.safeParse({
  ...basePromo,
  autoApply: true,
  stackable: true,
}).success).toBe(false);

expect(PromoProgramSchema.safeParse({
  ...basePromo,
  autoApply: false,
  code: 'SAVE20',
  stackable: true,
}).success).toBe(true);

expect(PromoProgramSchema.safeParse({
  ...basePromo,
  autoApply: false,
  stackable: false,
  stackingGroup: 'legacy',
}).success).toBe(false);
```

Run the same contracts test command and confirm it fails on the current permissive automatic shape and retained `stackingGroup`.

- [x] **Step 3: Add failing response and redemption-bundle tests**

Define the coded diagnostic outcomes and the bundle response before implementation:

```ts
const CodeEvaluationResultSchema = z.object({
  code: PromoCodeSchema,
  normalizedCode: NormalizedPromoCodeSchema,
  outcome: z.enum([
    'selected',
    'invalid_code',
    'not_qualified',
    'unavailable',
    'exhausted',
    'combination_rejected',
  ]),
  programRef: z.string().min(1).optional(),
  reasonCodes: z.array(ReasonCodeSchema),
}).strict();

const RedemptionEntrySchema = z.object({
  programRef: z.string().min(1),
  programRevision: z.number().int().positive(),
  rewardRuleRef: z.string().min(1).optional(),
  effects: z.array(EffectSchema),
}).strict();
```

Pin these clean-break shapes:

```ts
expect(RedemptionRequestSchema.parse({
  evaluationId: 'evaluation-1',
  externalOrderRef: 'order-1',
  idempotencyKey: 'checkout-1',
})).toBeTruthy();

expect(() => RedemptionRequestSchema.parse({
  evaluationId: 'evaluation-1',
  programRef: 'promo-a',
  externalOrderRef: 'order-1',
  idempotencyKey: 'checkout-1',
})).toThrow();
```

The new response has one bundle ID and ordered `entries`; it has no top-level `programRef`, `rewardRuleRef`, or `effects`.

- [x] **Step 4: Implement shared code normalization**

Create `packages/contracts/src/promo-codes.ts`:

```ts
import { z } from './zod.js';

export const PromoCodeSchema = z.string().superRefine((value, context) => {
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 128) {
    context.addIssue({
      code: 'custom',
      message: 'Promo code must contain 1 to 128 Unicode code points',
    });
  }
});

export const NormalizedPromoCodeSchema = PromoCodeSchema.transform(
  value => value.trim().toUpperCase(),
);

export interface NormalizedPromoCode {
  display: string;
  normalized: string;
}

export function normalizePromoCode(value: string): NormalizedPromoCode {
  const display = PromoCodeSchema.parse(value).trim();
  return {
    display,
    normalized: display.toUpperCase(),
  };
}

export function normalizeDistinctPromoCodes(
  values: readonly string[],
): NormalizedPromoCode[] {
  const distinct = new Map<string, NormalizedPromoCode>();
  for (const value of values) {
    const code = normalizePromoCode(value);
    if (!distinct.has(code.normalized)) distinct.set(code.normalized, code);
  }
  if (distinct.size > 10) {
    throw new RangeError('At most 10 distinct promo codes may be evaluated');
  }
  return [...distinct.values()];
}
```

Catch that domain `RangeError` inside the evaluation schema's `superRefine` and
add one issue at `codes`. Keep the ten-code rule in shared contract code; do not
replace it with route-local validation.

- [x] **Step 5: Implement the strict trigger union and clean-break API schemas**

In `programs.ts`:

```ts
const AutomaticPromoProgramSchema = PromoProgramBaseSchema.extend({
  autoApply: z.literal(true),
  stackable: z.literal(false),
});

const CodedPromoProgramSchema = PromoProgramBaseSchema.extend({
  autoApply: z.literal(false),
  code: PromoCodeSchema,
  stackable: z.boolean(),
});
```

Remove `stackingGroup` from `PromoProgramBaseSchema`.

In `evaluation.ts`:

```ts
export const EvaluationRequestSchema = z.object({
  customerRef: z.string().min(1).optional(),
  codes: z.array(PromoCodeSchema).optional(),
  cart: CartSchema,
  context: AttributesSchema.optional(),
}).strict().superRefine(validateDistinctCodeLimit);

export const EvaluationResponseSchema = z.object({
  evaluationId: z.string().min(1),
  customerRef: z.string().min(1).optional(),
  customerVersion: z.number().int().positive().optional(),
  schemaVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }),
  decisions: z.array(IncentiveDecisionSchema),
  codeResults: z.array(CodeEvaluationResultSchema).optional(),
}).strict();

export const RedemptionRequestSchema = z.object({
  evaluationId: z.string().min(1),
  externalOrderRef: z.string().min(1),
  idempotencyKey: z.string().min(1),
}).strict();
```

Make `codeResults` absent in automatic responses and required by service behavior in coded responses. Export all inferred types and update OpenAPI/documentation fixtures.

- [x] **Step 6: Run contract verification**

```bash
pnpm --filter @incentives/contracts test
pnpm --filter @incentives/contracts build
pnpm --filter @incentives/contracts lint
```

Expected: all pass.

- [x] **Step 7: Commit Task 1**

```bash
git add packages/contracts
git commit -m "feat(contracts): define promo selection and bundle redemption"
```

---

### Task 2: Replace Generic Conflict Rewriting with Explicit Promo Selection

**Files:**

- Modify: `packages/engine/src/stacking.ts`
- Modify: `packages/engine/src/stacking.test.ts`
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/module-kit/src/module.ts`
- Modify: `packages/module-kit/src/conformance.ts`
- Modify: `packages/module-kit/src/conformance.test.ts`
- Modify: `packages/modules/promo/src/promo-module.ts`
- Modify: `packages/modules/promo/src/promo-module.test.ts`

- [x] **Step 1: Write failing comparator and automatic-selection tests**

Export one binary comparator and use it in selection:

```ts
expect(compareProgramRank(
  { priority: 20, programRef: 'promo-z' },
  { priority: 10, programRef: 'promo-a' },
)).toBeLessThan(0);

expect(compareProgramRank(
  { priority: 10, programRef: 'promo-a' },
  { priority: 10, programRef: 'promo-b' },
)).toBeLessThan(0);
```

Test automatic selection with ordered candidates:

```ts
expect(selectAutomaticDecision([
  notQualified({ priority: 30, programRef: 'promo-a' }),
  qualified({ priority: 20, programRef: 'promo-b' }),
  qualified({ priority: 10, programRef: 'promo-c' }),
])).toEqual([expect.objectContaining({ programRef: 'promo-b' })]);
```

Also assert zero qualified candidates returns `[]` and rejected candidates are not returned.

Run:

```bash
pnpm --filter @incentives/engine test
```

Expected: FAIL because the shared comparator and automatic selector are not exported.

- [x] **Step 2: Write failing coded-combination tests**

Cover:

- zero qualified decisions;
- one qualified non-stackable decision succeeds;
- several qualified stackable decisions succeed in rank order;
- one non-stackable member rejects the entire qualified set;
- non-qualified decisions do not participate in the conflict;
- every rejected qualified member receives `CODE_COMBINATION_NOT_ALLOWED`; and
- equal priority uses `programRef` binary order.

The selector result should separate selected decisions from conflict metadata:

```ts
expect(selectCodedDecisionCombination([
  qualified({ programRef: 'a', stackable: true }),
  qualified({ programRef: 'b', stackable: false }),
  invalidCode({ programRef: 'c' }),
])).toEqual({
  decisions: [],
  rejectedProgramRefs: ['a', 'b'],
});
```

- [x] **Step 3: Remove code matching and stacking groups from the module boundary**

The API resolves a submitted normalized code to one tenant-owned program before calling the Promo module. The module evaluates eligibility and reward rules; it must not scan `request.codes`.

Change:

```ts
export interface ModuleDecision extends IncentiveDecision {
  priority: number;
  stackable: boolean;
}
```

Remove `stackingGroup` from conformance fixtures and `PromoModule` output. Delete manual-code mismatch behavior from `PromoModule.evaluate`; coded `invalid_code` now belongs to the evaluation orchestrator when lookup finds no claim.

Add a Promo-module test proving a coded configuration evaluates normally once the orchestrator has selected it.

- [x] **Step 4: Implement explicit selection functions**

Replace `resolveDecisionConflicts` with:

```ts
export interface RankedProgram {
  priority: number;
  programRef: string;
}

export function compareProgramRank(
  left: RankedProgram,
  right: RankedProgram,
): number {
  const priorityOrder = right.priority - left.priority;
  if (priorityOrder !== 0) return priorityOrder;
  if (left.programRef < right.programRef) return -1;
  if (left.programRef > right.programRef) return 1;
  return 0;
}

export function selectAutomaticDecision(
  candidates: readonly ConflictCandidate[],
): ConflictCandidate[] {
  const winner = [...candidates]
    .sort(compareProgramRank)
    .find(candidate => candidate.outcome === 'qualified');
  return winner === undefined ? [] : [winner];
}

export function selectCodedDecisionCombination(
  candidates: readonly ConflictCandidate[],
): {
  decisions: ConflictCandidate[];
  rejectedProgramRefs: string[];
} {
  const qualified = candidates
    .filter(candidate => candidate.outcome === 'qualified')
    .sort(compareProgramRank);
  if (qualified.length <= 1 || qualified.every(candidate => candidate.stackable)) {
    return { decisions: qualified, rejectedProgramRefs: [] };
  }
  return {
    decisions: [],
    rejectedProgramRefs: qualified.map(candidate => candidate.programRef),
  };
}
```

Keep these functions Promo-oriented in naming or module placement. Do not route future Loyalty decisions through them accidentally.

- [x] **Step 5: Run engine and module verification**

```bash
pnpm --filter @incentives/engine test
pnpm --filter @incentives/module-kit test
pnpm --filter @incentives/promo test
pnpm --filter @incentives/engine build
pnpm --filter @incentives/module-kit build
pnpm --filter @incentives/promo build
```

Expected: all pass.

- [x] **Step 6: Commit Task 2**

```bash
git add packages/engine packages/module-kit packages/modules/promo
git commit -m "feat(engine): select automatic and coded promo decisions"
```

---

### Task 3: Add Code Claims, Evaluation Snapshots, and Redemption Bundles to D1

**Files:**

- Create: `apps/api/migrations/0006_promo_selection_redemption_bundles.sql`
- Modify: `apps/api/src/db/schema.ts`
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts`
- Test: `apps/api/test/production-migration.test.ts`
- Test: `apps/api/test/repositories.test.ts`

- [x] **Step 1: Write failing production-migration assertions**

Require these tables/columns:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  'promo_code_claims',
  'redemptions',
  'redemption_entries',
]));

expect(columns('evaluation_decisions')).toEqual(expect.arrayContaining([
  'mode',
  'submitted_codes_json',
  'code_results_json',
  'request_digest',
  'correlation_id',
]));

expect(columns('redemption_operations')).toEqual(expect.arrayContaining([
  'idempotency_key',
  'state',
  'terminal_error_code',
  'request_digest',
]));

expect(columns('redemptions')).toEqual(expect.arrayContaining([
  'result_json',
]));
```

Add a migration test that seeds valid legacy automatic and coded configurations, migrates them, and verifies:

- automatic code is cleared;
- automatic stackable becomes false;
- `stackingGroup` is removed;
- coded display and normalized code are retained;
- a legacy singular redemption remains readable; and
- ambiguous invalid legacy configuration aborts migration rather than inventing intent.

Run:

```bash
pnpm --filter @incentives/api test -- production-migration.test.ts
```

Expected: FAIL because migration `0006` does not exist.

- [x] **Step 2: Write failing repository round-trip tests**

Pin record types:

```ts
export type EvaluationMode = 'automatic' | 'coded';

export interface EvaluationDecisionRecord {
  evaluationId: string;
  merchantId: string;
  mode: EvaluationMode;
  submittedCodes: string[];
  codeResults: CodeEvaluationResult[];
  requestDigest: string;
  correlationId: string;
  // existing snapshot, integrity, expiry, and timestamps
}

export interface RedemptionEntryRecord {
  position: number;
  programRef: string;
  programRevision: number;
  rewardRuleRef?: string;
  effects: Effect[];
  discountMinorUnits: number;
  currency: string;
}

export interface RedemptionBundleCreate {
  redemptionId: string;
  merchantId: string;
  evaluationId: string;
  externalOrderRef: string;
  idempotencyKey: string;
  requestDigest: string;
  result: RedemptionResponse;
  entries: RedemptionEntryRecord[];
  createdAt: string;
  receiptIntegrityHash: string;
}
```

Test evaluation round-trip retains ordered submitted codes and code results. Test bundle round-trip retains authoritative child order.

- [x] **Step 3: Create the migration**

The migration should:

1. rebuild normalized program JSON without `stackingGroup`;
2. validate trigger invariants;
3. add evaluation snapshot columns with explicit values for migrated rows;
4. add `promo_code_claims`;
5. add durable `redemption_operations` for pending, committed, and terminally
   rejected idempotency outcomes;
6. rebuild or extend `redemptions` as committed bundle headers;
7. add ordered `redemption_entries`;
8. add an internal D1 commit-guard table used to force transaction rollback;
9. backfill one child entry per legacy redemption; and
10. add tenant-scoped indexes for normalized-code lookup, idempotency, external
    order, evaluation, and program counts.

Representative schema:

```sql
CREATE TABLE promo_code_claims (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  program_ref TEXT NOT NULL,
  active_revision INTEGER NOT NULL,
  display_code TEXT NOT NULL,
  normalized_code TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id)
);

CREATE INDEX promo_code_claims_lookup
  ON promo_code_claims(merchant_id, normalized_code, released_at);

CREATE TABLE redemption_operations (
  merchant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  external_order_ref TEXT NOT NULL,
  evaluation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'committed', 'rejected')),
  terminal_error_code TEXT,
  retryable INTEGER,
  redemption_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, idempotency_key)
);

CREATE TABLE redemption_entries (
  redemption_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  program_ref TEXT NOT NULL,
  program_revision INTEGER NOT NULL,
  reward_rule_ref TEXT,
  effects_json TEXT NOT NULL,
  discount_minor_units INTEGER NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (redemption_id, position),
  FOREIGN KEY (redemption_id) REFERENCES redemptions(id)
);

CREATE TABLE redemption_commit_guards (
  redemption_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  changed_rows INTEGER NOT NULL CHECK (changed_rows = 1),
  PRIMARY KEY (redemption_id, position)
);
```

An interval cannot be protected by a simple unique index. Publication must use an atomic conditional claim in Task 4.

- [x] **Step 4: Update Drizzle and repository serialization**

Add typed schema definitions, deterministic JSON parsing, and strict contract parsing. Reject malformed migrated rows rather than returning partially trusted records.

Update receipt serialization so bundle-level identity and ordered entries are signed. Keep a private legacy reader for migrated staging records.

- [x] **Step 5: Run migration and repository verification**

```bash
pnpm --filter @incentives/api test -- production-migration.test.ts repositories.test.ts
pnpm --filter @incentives/api build
pnpm --filter @incentives/api lint
```

Expected: all pass.

- [x] **Step 6: Commit Task 3**

```bash
git add apps/api/migrations apps/api/src/db apps/api/src/repositories apps/api/test/production-migration.test.ts apps/api/test/repositories.test.ts
git commit -m "feat(api): persist promo claims and redemption bundles"
```

---

### Task 4: Enforce Race-Safe Code Ownership at Publication

**Files:**

- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts`
- Modify: `apps/api/src/services/program-service.ts`
- Modify: `apps/api/src/routes/programs.ts`
- Modify: `apps/api/src/errors.ts`
- Test: `apps/api/test/programs.test.ts`
- Test: `apps/api/test/program-revisions.test.ts`
- Test: `apps/api/test/repositories.test.ts`

- [x] **Step 1: Write failing overlap-policy tests**

Cover tenant scoping and interval behavior:

- same code in different merchants succeeds;
- same normalized code in overlapping active intervals conflicts;
- paused and future scheduled claims still conflict;
- non-overlapping scheduled intervals may reuse a code;
- an ended Promo releases its claim;
- an automatic Promo owns no claim;
- a conflicting draft may be saved but not published;
- two concurrent overlapping publishes produce one success and one conflict; and
- editing a published Promo claims the new interval before releasing the old revision.

Test the API error:

```ts
expect(response.status).toBe(409);
expect(await response.json()).toMatchObject({
  error: {
    code: 'PROMO_CODE_CONFLICT',
    retryable: false,
  },
});
```

Run:

```bash
pnpm --filter @incentives/api test -- programs.test.ts program-revisions.test.ts repositories.test.ts
```

Expected: FAIL because publication does not claim normalized codes.

- [x] **Step 2: Add repository operations for claim lookup and atomic publication**

Add domain input:

```ts
export interface PromoCodeClaimInput {
  merchantId: string;
  programId: string;
  programRef: string;
  activeRevision: number;
  displayCode: string;
  normalizedCode: string;
  startsAt?: string;
  endsAt?: string;
  claimedAt: string;
}
```

Expose only domain operations:

```ts
interface ProgramRepository {
  // existing methods
  getPublishedByNormalizedCode(
    merchantId: string,
    normalizedCode: string,
  ): Promise<ProgramRecord | null>;
  publishDraftWithCodeClaim(input: PublishProgramInput): Promise<ProgramRecord>;
}
```

The service must not perform a separate conflict read followed by an insert.

- [x] **Step 3: Implement the D1 conditional claim batch**

Use `env.DB.batch` so publication, claim insertion, counter activation, and previous-claim release share one transactional unit.

The overlap predicate is:

```sql
existing.released_at IS NULL
AND existing.merchant_id = :merchant_id
AND existing.normalized_code = :normalized_code
AND existing.program_ref <> :program_ref
AND COALESCE(existing.ends_at, '9999-12-31T23:59:59.999Z')
    >= COALESCE(:starts_at, '0001-01-01T00:00:00.000Z')
AND COALESCE(:ends_at, '9999-12-31T23:59:59.999Z')
    >= COALESCE(existing.starts_at, '0001-01-01T00:00:00.000Z')
```

The conditional insert must report zero changes when a conflict exists. Convert that known outcome to `PromoCodeConflictError`. Do not rely on SQLite `NOCASE`; normalized code identity comes from the shared TypeScript helper.

- [x] **Step 4: Release claims only when reuse is safe**

Ending a Promo releases the claim in the same lifecycle batch. Pausing does not release it because the Promo can resume. Publishing an automatic replacement releases the old coded claim only after the new active revision is durable.

- [x] **Step 5: Map a precise public error**

Add:

```ts
export class PromoCodeConflictError extends Error {
  override readonly name = 'PromoCodeConflictError';
  constructor(readonly conflictingProgramRef: string) {
    super('This code overlaps another published Promo');
  }
}
```

Map it to `PROMO_CODE_CONFLICT`, HTTP 409, non-retryable. Only an authorized operator response may identify the conflicting Promo; the public runtime must not.

- [x] **Step 6: Run publication verification**

```bash
pnpm --filter @incentives/api test -- programs.test.ts program-revisions.test.ts repositories.test.ts
pnpm --filter @incentives/api build
```

Expected: all pass, including the concurrent publication case.

- [x] **Step 7: Commit Task 4**

```bash
git add apps/api/src apps/api/test/programs.test.ts apps/api/test/program-revisions.test.ts apps/api/test/repositories.test.ts
git commit -m "feat(api): claim promo codes atomically on publish"
```

---

### Task 5: Orchestrate Automatic and Coded Evaluation Without Inventory Leakage

**Files:**

- Modify: `apps/api/src/services/evaluation-service.ts`
- Modify: `apps/api/src/routes/evaluate.ts`
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts`
- Test: `apps/api/test/evaluate.test.ts`
- Test: `apps/api/test/full-flow.test.ts`

- [x] **Step 1: Add failing automatic-mode tests**

Test the public response:

- omitted `codes` and `codes: []` are automatic;
- only automatic, effective, tenant-owned Promos are candidates;
- rank is priority descending then binary `programRef` ascending;
- a rejected higher-ranked candidate permits the next candidate;
- the first qualified candidate is the only decision;
- no qualified candidate returns `decisions: []`;
- no automatic response contains `codeResults`;
- no unrelated invalid, unavailable, exhausted, or ineligible decision is public; and
- automatic candidates are evaluated only until a winner is found.

Use an evaluator spy to assert short-circuiting.

- [x] **Step 2: Add failing coded-mode tests**

Test:

- non-empty `codes` suppresses automatic Promos;
- only resolved submitted normalized codes are evaluated;
- duplicate normalized codes are evaluated once;
- `codeResults` stays in first-occurrence input order;
- `decisions` uses priority and `programRef` order;
- unresolved code is `invalid_code` without a `programRef`;
- ineligible/unavailable/exhausted results do not block valid stackable results;
- one qualified non-stackable code succeeds;
- several stackable qualified codes succeed;
- several qualified codes with any non-stackable member yield no decisions;
- only otherwise-qualified members become `combination_rejected`; and
- codeResults never reveal codes not supplied by the caller.

Representative assertion:

```ts
expect(response).toMatchObject({
  decisions: [
    { programRef: 'promo-a', outcome: 'qualified' },
    { programRef: 'promo-b', outcome: 'qualified' },
  ],
  codeResults: [
    {
      code: 'vip20',
      normalizedCode: 'VIP20',
      outcome: 'selected',
      programRef: 'promo-b',
    },
    {
      code: 'unknown',
      normalizedCode: 'UNKNOWN',
      outcome: 'invalid_code',
    },
  ],
});
```

Run:

```bash
pnpm --filter @incentives/api test -- evaluate.test.ts
```

Expected: FAIL because evaluation still loads and returns every active Promo.

- [x] **Step 3: Introduce a mode-specific candidate pipeline**

Create small internal functions:

```ts
type EvaluationMode = 'automatic' | 'coded';

function evaluationMode(request: EvaluationRequest): EvaluationMode {
  return normalizeDistinctPromoCodes(request.codes ?? []).length === 0
    ? 'automatic'
    : 'coded';
}

async function automaticCandidates(
  repositories: Repositories,
  merchantId: string,
): Promise<ProgramRecord[]> {
  return (await repositories.programs.listActive(merchantId))
    .filter(record => record.program.autoApply)
    .sort((left, right) => compareProgramRank(
      { priority: left.program.priority, programRef: left.externalRef },
      { priority: right.program.priority, programRef: right.externalRef },
    ));
}
```

For coded mode, resolve each normalized code through
`getPublishedByNormalizedCode`. A paused, scheduled, or otherwise unavailable
published Promo remains resolved and returns `unavailable`; only a code with no
unreleased published claim is `invalid_code`. Never scan unrelated coded
programs to construct the public response.

- [x] **Step 4: Reuse one program-evaluation helper**

Extract the existing customer facts, counters, cap, currency, availability, and projected-cost logic into one helper that evaluates a single resolved program. Automatic mode calls it sequentially and stops at the first qualified decision. Coded mode calls it once per resolved distinct code.

Do not duplicate cap or budget logic between modes.

- [x] **Step 5: Persist complete signed selection identity**

Add to `decisionSnapshot` and the HMAC payload:

```ts
{
  mode,
  submittedCodes,
  codeResults,
  requestDigest,
  correlationId,
  customerRef,
  customerVersion,
  schemaVersion,
  request,
  facts,
  decisions,
}
```

The digest uses `canonicalJson` and binds normalized request identity. Store the selected decision order exactly as returned.

Pass `correlationId` into the service:

```ts
evaluate(
  merchantId: string,
  input: unknown,
  correlationId: string,
): Promise<EvaluationResponse>
```

- [x] **Step 6: Handle rejected reservation cleanup through a narrow hook**

If evaluation-time availability creates reservations, keep their opaque cancellation handles outside public decisions. When stacking rejects the final coded set, cancel all prepared handles. A failed cancellation is logged and recovered conservatively; it does not restore decisions to the rejected response.

For the current D1-only implementation, provide a no-op/default handle path so the orchestration contract is ready without pretending the distributed free-shipping authority already exists.

- [x] **Step 7: Run evaluation and flow verification**

```bash
pnpm --filter @incentives/api test -- evaluate.test.ts full-flow.test.ts
pnpm --filter @incentives/api build
```

Expected: all pass.

- [x] **Step 8: Commit Task 5**

```bash
git add apps/api/src/services/evaluation-service.ts apps/api/src/routes/evaluate.ts apps/api/src/repositories apps/api/test/evaluate.test.ts apps/api/test/full-flow.test.ts
git commit -m "feat(api): select private automatic and coded evaluations"
```

---

### Task 6: Commit Selected Decisions Through a Provider-Neutral Atomic Bundle Port

**Files:**

- Create: `apps/api/src/redemption/atomic-redemption-coordinator.ts`
- Create: `apps/api/src/redemption/d1-atomic-redemption-coordinator.ts`
- Modify: `apps/api/src/services/redemption-service.ts`
- Modify: `apps/api/src/services/redemption-receipt.ts`
- Modify: `apps/api/src/repositories/types.ts`
- Modify: `apps/api/src/repositories/d1-repositories.ts`
- Modify: `apps/api/src/routes/redemptions.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/redemptions.test.ts`
- Test: `apps/api/test/repositories.test.ts`
- Test: `apps/api/test/full-flow.test.ts`

- [x] **Step 1: Write failing port contract tests**

Define the provider-neutral port:

```ts
export interface CommitRedemptionBundleInput {
  merchantId: string;
  evaluation: EvaluationDecisionRecord;
  externalOrderRef: string;
  idempotencyKey: string;
  requestDigest: string;
  correlationId: string;
  committedAt: string;
}

export type TerminalRedemptionErrorCode =
  | 'NOTHING_TO_COMMIT'
  | 'DECISION_EXPIRED'
  | 'INVALID_DECISION'
  | 'PROGRAM_UNAVAILABLE'
  | 'PER_CUSTOMER_CAP_EXHAUSTED'
  | 'BUDGET_EXHAUSTED';

export type ExhaustionReasonCode =
  | 'PER_CUSTOMER_CAP_EXHAUSTED'
  | 'BUDGET_EXHAUSTED';

export type CommitRedemptionBundleResult =
  | { kind: 'committed'; bundle: RedemptionBundleCreate }
  | { kind: 'exact_retry'; bundle: RedemptionBundleCreate }
  | {
      kind: 'terminal_retry';
      code: TerminalRedemptionErrorCode;
      retryable: false;
    }
  | { kind: 'conflict' }
  | { kind: 'exhausted'; reasonCode: ExhaustionReasonCode }
  | { kind: 'unavailable'; retryable: true };

export interface AtomicRedemptionCoordinator {
  commitBundle(
    input: CommitRedemptionBundleInput,
  ): Promise<CommitRedemptionBundleResult>;
  getBundle(input: {
    merchantId: string;
    idempotencyKey: string;
  }): Promise<RedemptionBundleCreate | null>;
}
```

Create a reusable contract test suite that an in-memory test adapter and the D1 adapter both pass. The port must not import D1, Durable Objects, Worker RPC, alarms, or Cloudflare-specific error types.

- [x] **Step 2: Add failing redemption behavior tests**

Cover:

- bundle request rejects `programRef`;
- evaluation with no selected committable decisions returns `NOTHING_TO_COMMIT`;
- one selected decision commits one child;
- several selected decisions commit ordered children;
- final failure of any child commits no header, entries, or counters;
- every selected active revision and reward rule is revalidated;
- exact retry returns the original bundle ID and entries;
- exact retry of a terminal business rejection returns the same stable error;
- same key with different digest conflicts;
- same external order with a different evaluation conflicts;
- concurrent exact requests converge;
- concurrent different requests cannot exceed any cap or budget;
- expired or tampered evaluation cannot commit; and
- public response appears only after the complete D1 batch succeeds.

Run:

```bash
pnpm --filter @incentives/api test -- redemptions.test.ts
```

Expected: FAIL because the service still requires one `programRef`.

- [x] **Step 3: Compute one canonical bundle digest**

Bind:

```ts
const requestDigest = await sha256(canonicalJson({
  kind: 'redemption_bundle_v1',
  merchantId,
  evaluationId: request.evaluationId,
  externalOrderRef: request.externalOrderRef,
  idempotencyKey: request.idempotencyKey,
  selected: evaluation.decisions.map(decision => ({
    programRef: decision.programRef,
    programRevision: decision.programRevision,
    rewardRuleRef: decision.rewardRuleRef,
    effects: decision.effects,
  })),
}));
```

The exact selected order is part of the digest. Do not sort again at redemption time.

- [x] **Step 4: Implement the D1 transactional adapter**

Acquire or load one `redemption_operations` row first. An exact pending retry
reconciles by checking for the committed bundle before attempting the same
operation again. A changed digest or external-order identity conflicts.

For each selected child, compute current cap and budget predicates. Execute one
transactional `env.DB.batch` containing:

1. conditional counter updates for every child;
2. one guard insert per conditional update using that statement's `changes()`;
3. legacy counter mirrors still needed by current reads;
4. one bundle-header insert;
5. ordered child-entry inserts;
6. the immutable signed result;
7. the operation transition from `pending` to `committed`; and
8. deletion of successful internal guard rows.

After the batch:

- every guard row has `CHECK (changed_rows = 1)`, so any failed conditional
  update aborts and rolls back the complete batch;
- after a rolled-back guard failure, re-read the authoritative counters and
  persist a terminal `rejected` operation only when a named cap/budget predicate
  is deterministically false; otherwise leave the operation retryable;
- that separate idempotent terminal write must not create committed usage;
- partial changed counts cannot commit and must never be reported as success;
- exact unique-key collision loads the existing record and compares its digest; and
- any uncertain error is retryable with the same key.

A crash that leaves `pending` is not a terminal result. Retrying the same key
first looks for a committed bundle, then safely resumes the unchanged operation.
Do not ask the caller to invent a new idempotency key.

Update per-customer counts and committed-spend queries to use `redemption_entries`. Retain a private read path for migrated legacy rows.

- [x] **Step 5: Refactor the service to depend only on the port**

Construction:

```ts
export function createRedemptionService(
  repositories: Repositories,
  coordinator: AtomicRedemptionCoordinator,
  env: Env,
) {
  return {
    async redeem(
      merchantId: string,
      input: unknown,
      correlationId: string,
    ): Promise<RedemptionResponse> {
      // validate snapshot, derive digest, call coordinator, map stable result
    },
  };
}
```

Add `atomicRedemptions` to request-scoped variables and construct `createD1AtomicRedemptionCoordinator(context.env)` in middleware. Callsites must not know which adapter is installed.

- [x] **Step 6: Sign bundle receipts**

Change receipt material to:

```ts
{
  kind: 'redemption_bundle_v2',
  merchantId,
  redemptionId,
  evaluationId,
  externalOrderRef,
  idempotencyKey,
  requestDigest,
  status: 'committed',
  entries,
  createdAt,
}
```

Verification must fail if a child is added, removed, mutated, or reordered.

- [x] **Step 7: Document the future distributed adapter boundary in code**

Add interface comments describing durable prepare/authorize/finalize semantics and stable failure results. Do not add a Cloudflare Durable Object implementation in this task.

- [x] **Step 8: Run redemption verification**

```bash
pnpm --filter @incentives/api test -- redemptions.test.ts repositories.test.ts full-flow.test.ts
pnpm --filter @incentives/api build
pnpm --filter @incentives/api lint
```

Expected: all pass.

- [x] **Step 9: Commit Task 6**

```bash
git add apps/api/src/redemption apps/api/src/services/redemption-service.ts apps/api/src/services/redemption-receipt.ts apps/api/src/repositories apps/api/src/routes/redemptions.ts apps/api/src/env.ts apps/api/src/app.ts apps/api/test
git commit -m "feat(api): commit selected promos as atomic bundles"
```

---

### Task 7: Propagate Correlation IDs and Emit Sanitized Failure Logs

**Files:**

- Create: `apps/api/src/observability.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/errors.ts`
- Modify: `apps/api/src/routes/evaluate.ts`
- Modify: `apps/api/src/routes/redemptions.ts`
- Test: `apps/api/test/app.test.ts`
- Test: `apps/api/test/evaluate.test.ts`
- Test: `apps/api/test/redemptions.test.ts`

- [x] **Step 1: Add failing structured-log tests**

Spy on `console.error` and force an evaluation dependency failure. Assert one JSON event contains:

```ts
expect(log).toMatchObject({
  event: 'api_request_failed',
  correlationId: 'correlation-123',
  route: '/v1/evaluate',
  method: 'POST',
  code: 'EVALUATION_UNAVAILABLE',
  status: 503,
  retryable: true,
});
```

Assert the serialized log does not contain:

- `Authorization`;
- bearer-token suffixes;
- submitted promo codes;
- customer references or attributes;
- cart/context bodies; or
- dependency error stacks in production mode.

Add equivalent bundle-redemption coverage and assert the response header, body error, stored snapshot, and log share one correlation ID.

Run:

```bash
pnpm --filter @incentives/api test -- app.test.ts evaluate.test.ts redemptions.test.ts
```

Expected: FAIL because the current error boundary returns a correlation ID but does not log it.

- [x] **Step 2: Implement a sanitized event writer**

Create:

```ts
export interface ApiFailureLog {
  event: 'api_request_failed';
  correlationId: string;
  route: string;
  method: string;
  code: string;
  status: number;
  retryable: boolean;
  merchantId?: string;
  credentialId?: string;
  dependency?: string;
}

export function logApiFailure(input: ApiFailureLog): void {
  console.error(JSON.stringify(input));
}
```

Only pass already-sanitized scalar fields. Do not pass arbitrary error objects into the logger.

- [x] **Step 3: Log at the centralized error boundary**

Refactor mapping so `apiErrorResponse` can log the final stable code/status exactly once. Include merchant and credential IDs only after successful authentication populated them.

Known program outcomes remain decision results and are not error logs. Dependency failures use stable categories such as `d1`, `decision_integrity`, or `atomic_redemption`.

- [x] **Step 4: Propagate correlation IDs into services and adapters**

Routes pass `context.get('correlationId')`. Evaluation snapshots store it. Bundle coordinator input carries it. Internal traces use it. The response header remains `x-correlation-id`.

- [x] **Step 5: Run observability verification**

```bash
pnpm --filter @incentives/api test -- app.test.ts evaluate.test.ts redemptions.test.ts
pnpm --filter @incentives/api build
```

Expected: all pass, closing the staging gap where evaluation failures lacked their correlation ID in Cloudflare logs.

- [x] **Step 6: Commit Task 7**

```bash
git add apps/api/src/observability.ts apps/api/src/app.ts apps/api/src/errors.ts apps/api/src/routes apps/api/test
git commit -m "fix(api): correlate and sanitize runtime failure logs"
```

---

### Task 8: Make Trigger Mode, Active/Draft State, and Publication Intent Clear in the Operator

**Files:**

- Modify: `packages/contracts/src/operator-bff.ts`
- Modify: `packages/contracts/src/production-operator-contracts.test.ts`
- Modify: `apps/api/src/services/program-service.ts`
- Modify: `apps/api/test/program-revisions.test.ts`
- Modify: `apps/dashboard/src/data/program-api.ts`
- Modify: `apps/dashboard/src/lib/bff-client.ts`
- Modify: `apps/dashboard/src/pages/promo/LivePromoEditor.tsx`
- Modify: `apps/dashboard/src/pages/promo/LivePromoDetail.tsx`
- Modify: `apps/dashboard/src/pages/promo/LivePromoList.tsx`
- Modify: `apps/dashboard/src/pages/LiveOperatorJourney.test.tsx`

- [x] **Step 1: Add failing operator-view contract tests**

The operator needs to distinguish active and draft configuration:

```ts
export const OperatorProgramViewSchema = z.object({
  configuration: PromoProgramSchema,
  lifecycle: ProgramLifecycleSchema,
  activeConfiguration: PromoProgramSchema.optional(),
  draftConfiguration: PromoProgramSchema.optional(),
}).strict();
```

Pin invariants:

- `activeConfiguration` matches `activeRevision`;
- `draftConfiguration` matches `draftRevision`;
- `configuration` remains the working display configuration for compatibility inside the operator codebase;
- an authorized operator can see display code;
- runtime responses never use this operator view.

- [x] **Step 2: Add failing editor interaction tests**

Testing Library cases:

- a new editor starts blank/minimal rather than silently containing the complete sample;
- “Use complete authoring example” remains an explicit action;
- Automatic mode hides code, forces `stackable: false`, and removes code from the payload;
- Code-triggered mode requires code and exposes stacking;
- switching a populated coded draft to Automatic prompts before clearing code and stacking;
- canceling the warning preserves the coded draft;
- no `stackingGroup` control is rendered;
- invalid trigger combinations cannot save;
- a code-conflict response displays understandable publication guidance; and
- unauthorized users cannot read code or modify trigger settings.

Run:

```bash
pnpm --filter @incentives/dashboard test -- LiveOperatorJourney.test.tsx
```

Expected: FAIL because the editor uses a checkbox, silently preloads the full example, and renders stacking group.

- [x] **Step 3: Add failing detail and pre-publication tests**

The detail/review must show:

- Automatic or Code-triggered;
- display code only for coded mode and authorized operators;
- Stackable only for coded mode;
- priority;
- active revision and draft revision;
- active configuration beside the pending draft when both exist; and
- a confirmation summary before publication.

Do not implement full history, arbitrary revision diff, rollback, or multiple drafts here.

- [x] **Step 4: Implement explicit mode transitions**

Use explicit controls:

```ts
type TriggerMode = 'automatic' | 'coded';

function toAutomatic(program: PromoProgram): PromoProgram {
  const { code: _code, ...withoutCode } = program as PromoProgram & {
    code?: string;
  };
  return {
    ...withoutCode,
    autoApply: true,
    stackable: false,
  };
}

function toCoded(program: PromoProgram): PromoProgram {
  return {
    ...program,
    autoApply: false,
    code: '',
    stackable: false,
  };
}
```

Type narrowing may require constructing from shared base fields rather than spreading the union. Preserve the core rule: no hidden stale code or stackability survives a switch to Automatic.

- [x] **Step 5: Return active and draft configurations from the operator service**

Load the exact active and draft revisions identified by lifecycle. Do not infer active configuration from current mutable fields.

The publish action first shows a review card with trigger, code, stacking, priority, active revision, and draft revision. The user then explicitly confirms publication.

- [x] **Step 6: Update list and detail presentation**

Add trigger badges to the list. Replace raw JSON-only configuration where practical with labeled reward summaries while retaining exact reward details for debugging.

Do not address the separate percentage-input UX or Loyalty-reward authoring gap in this task; keep both in the follow-up register.

- [x] **Step 7: Run operator verification**

```bash
pnpm --filter @incentives/contracts test -- production-operator-contracts.test.ts
pnpm --filter @incentives/dashboard test -- LiveOperatorJourney.test.tsx
pnpm --filter @incentives/dashboard build
pnpm --filter @incentives/dashboard lint
pnpm --filter @incentives/api test -- program-revisions.test.ts
```

Expected: all pass.

- [x] **Step 8: Commit Task 8**

```bash
git add packages/contracts/src/operator-bff.ts packages/contracts/src/production-operator-contracts.test.ts apps/api/src/services/program-service.ts apps/api/test/program-revisions.test.ts apps/dashboard
git commit -m "feat(operator): author and review promo trigger modes"
```

---

### Task 9: Update Integration Docs, Manual Verification, Current State, and Follow-Ups

**Files:**

- Modify: `docs/integration/core-contracts.md`
- Modify: `docs/integration/runtime-api.md`
- Modify: `docs/testing/gate-c-manual-test.md`
- Modify: `docs/testing/staging-activation-run-2026-07-21.md`
- Modify: `docs/product/current-state-and-roadmap.md`
- Modify: `docs/product/follow-up-register.md`
- Modify: `docs/superpowers/specs/2026-07-23-promo-selection-code-stacking-design.md`
- Modify: `docs/superpowers/plans/2026-07-24-promo-selection-code-stacking.md`

- [x] **Step 1: Make contract documentation executable**

Replace singular-code and singular-redemption examples with:

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

and:

```json
{
  "evaluationId": "evaluation-123",
  "externalOrderRef": "order-456",
  "idempotencyKey": "checkout-789"
}
```

Document automatic zero-or-one behavior, coded diagnostics, stacking rejection, ordered bundle entries, idempotency, retry rules, and code privacy.

- [x] **Step 2: Add repeatable manual staging cases**

For each case, include prerequisites, exact operator actions or `curl`, expected HTTP status, expected body, and which correlation ID to record:

1. automatic highest-priority winner;
2. fallback to a lower-priority eligible automatic Promo;
3. no eligible automatic Promo;
4. correct, incorrect, duplicate, case-varied, and whitespace-varied codes;
5. mixed valid and invalid stackable codes;
6. one non-stackable code;
7. multi-code non-stackable rejection;
8. exact bundle retry;
9. changed idempotency-key reuse;
10. cap/budget all-or-nothing failure;
11. tenant isolation; and
12. Cloudflare log lookup by correlation ID.

Do not put secrets or real API tokens into the guide.

- [x] **Step 3: Update the current-state roadmap**

Record:

- this work is the next clean-break runtime correction before client integration;
- D1 is the initial atomic coordinator adapter;
- future free-shipping budget authority implements the same port;
- external deployment remains local/staging only until separately approved; and
- Shopify/manual integration remains uncommitted.

- [x] **Step 4: Reconcile the follow-up register**

Close only gaps actually fixed by this implementation:

- missing correlation ID in failure logs;
- silent full-example editor default;
- missing trigger/code detail;
- ambiguous automatic stacking behavior.

Keep these open:

- active-versus-draft full diff;
- revision history and rollback;
- multiple parallel drafts;
- user-friendly percent input instead of basis points;
- Loyalty rewards in Promo authoring;
- non-root passkeys/MFA; and
- free-shipping distributed budget authority and reversal lifecycle.

- [x] **Step 5: Update design and plan statuses**

Mark the design implemented only after all automated and manual staging evidence exists. Until then use:

```md
**Status:** Approved; implementation plan ready
```

Track this plan with checkbox completion. Keep its Notion mirror under the Plans page and keep the status next to its link on the parent Plans page.

- [x] **Step 6: Run documentation fixture verification**

```bash
pnpm --filter @incentives/contracts test -- documentation-examples.test.ts
rg -n '"code"|programRef.*redemption|stackingGroup' docs/integration docs/testing/gate-c-manual-test.md
```

Expected:

- documentation tests pass;
- remaining singular `code`, public redemption `programRef`, or `stackingGroup` matches are explicitly historical/deprecation notes, not current instructions.

- [x] **Step 7: Commit Task 9**

```bash
git add docs packages/contracts/test-fixtures/documentation-examples.ts
git commit -m "docs: document promo selection and atomic bundles"
```

---

### Task 10: Run Full Verification and Prepare the Human-Controlled Staging Rollout

**Files:**

- Verify all files changed in Tasks 1–9
- Update: `docs/testing/staging-activation-run-2026-07-21.md`

- [x] **Step 1: Run focused suites from a clean process**

```bash
pnpm --filter @incentives/contracts test
pnpm --filter @incentives/engine test
pnpm --filter @incentives/module-kit test
pnpm --filter @incentives/promo test
pnpm --filter @incentives/api test
pnpm --filter @incentives/dashboard test
```

Expected: all pass with no watch processes left running.

- [x] **Step 2: Run repository-wide verification**

```bash
pnpm build
pnpm test
pnpm lint
pnpm verify:clean-tests
```

Expected: every command exits 0.

- [x] **Step 3: Inspect migration and compatibility boundaries**

Confirm:

- migration `0006` succeeds from the production migration baseline;
- invalid legacy configurations fail loudly;
- legacy redemption records remain readable internally;
- current OpenAPI rejects singular `code` and redemption `programRef`;
- no public child-program commit endpoint exists; and
- no service imports the D1 atomic coordinator implementation directly.

Commands:

```bash
rg -n "D1Database|DurableObject|Cloudflare" apps/api/src/services apps/api/src/redemption/atomic-redemption-coordinator.ts
rg -n "stackingGroup|request\\.code\\b|programRef.*RedemptionRequest" packages apps
```

Expected: provider-specific matches are confined to adapters/env wiring; legacy matches are migration/audit or explicit historical tests.

- [x] **Step 4: Perform a security/privacy review**

Search logs and response builders:

```bash
rg -n "console\\.(log|error|warn)|JSON\\.stringify\\(.*request|Authorization|submittedCodes|normalizedCode" apps/api/src
```

Verify:

- no bearer token or credential digest is logged;
- no raw customer attributes or request bodies are logged;
- automatic responses reveal no rejected candidates;
- coded responses echo only caller-submitted codes; and
- authorized operator code visibility is permission-protected.

- [x] **Step 5: Prepare, but do not execute, staging commands**

Write the exact migration/deploy commands in the protected Task 10 cutover
guide and link it from the activation record. Present them to the Cloudflare
account owner one at a time in this order:

1. open a continuous quiet window;
2. authenticate and confirm Product D1 through generated configuration;
3. run count-only inventory plus legacy Promo and redemption prechecks;
4. capture protected API/Operator status and Product write markers;
5. capture the exact pre-migration Product D1 Time Travel bookmark;
6. apply D1 migration and verify the migration/table counts;
7. verify API health before deployment while the previous Worker is live;
8. deploy and verify the API Worker and clean-break OpenAPI;
9. deploy and verify Operator Web; Identity is not part of this rollout;
10. run the manual staging guide with fresh references;
11. record safe versions/evidence; and
12. retain the bookmark and sanitized rollout evidence privately until
    acceptance.

Normal Task 10 recovery is quiet-window containment plus a reviewed forward
fix. The protected runner exposes neither D1 restore nor Worker rollback. The
canonical guide records a coordinated exceptional Time Travel restore only
when the exact bookmark is in retention, post-bookmark writes are disposable,
the previous compatible Worker source is known, and the owner explicitly
approves the destructive restore.

The implementation agent does not execute these external writes.

- [x] **Step 6: Finish and merge the development branch**

Use `superpowers:verification-before-completion`, then
`superpowers:finishing-a-development-branch`. Create a reviewed PR into `dev`
and merge it; never push directly to `dev`. Confirm that the merged `dev`
commit contains the protected runner revision that passed local verification.

Merge evidence must include:

- focused and full test output;
- migration verification;
- remaining follow-ups;
- PR URL and merge commit; and
- confirmation that repository and Notion plan statuses match.

Completed through PR #10 at merge commit
`1ebc5fe723684fb3e4e9551c545e6627b21a3b3c`.

- [x] **Step 7: Request code review**

Use `superpowers:requesting-code-review`. Review specifically for:

- clean-break contract completeness;
- race-safe code claims;
- deterministic shared ordering;
- all-or-nothing D1 bundle semantics;
- digest/idempotency correctness;
- tenant privacy;
- correlation propagation; and
- accidental coupling to Cloudflare outside adapters.

- [x] **Step 8: Apply review feedback and rerun verification**

Use `superpowers:receiving-code-review` for actionable feedback, then repeat Steps 1–4. Do not mark this plan done on the strength of an earlier run.

- [x] **Step 9: Run the documented manual staging guide from merged `dev`**

The account owner checks out the exact merged `dev` commit, generates one new
`RUN_SUFFIX` for the complete staging run, and follows the Gate C manual's
derived-value table. Every client identity, program reference, Promo code,
customer reference, credential label, external order reference, and
idempotency key uses that suffix consistently; generated
evaluation/redemption IDs are copied from the current run. Do not reuse a
suffix or refresh only a subset of the references. Record:

- expected versus actual result;
- HTTP status;
- evaluation/redemption ID;
- correlation ID;
- deployed Worker version IDs; and
- any new gap with severity and follow-up owner.

Progress recorded 2026-07-27:

- protected Product-D1 prechecks, Time Travel bookmark capture, migration
  `0006`, API deployment, Operator Web deployment, and pre/post health checks
  passed;
- the clean-break OpenAPI shape passed;
- fresh-tenant automatic zero-or-one priority selection passed, including
  failover and the no-winner case;
- `SELECT-CODE-01` passed normalization, duplicate collapse, invalid-code
  isolation, priority ordering, and automatic suppression; and
- `SELECT-CODE-02` passed mixed valid/invalid stackable selection: both valid
  Promos remained selected in priority order while the missing code retained
  its input-aligned `INVALID_PROMO_CODE` diagnostic; and
- `SELECT-CODE-03` passed a single non-stackable code with exactly one
  qualified decision and one matching selected diagnostic; and
- `SELECT-CODE-04` passed atomic rejection of a stackable/non-stackable
  combination while preserving the independent invalid-code diagnostic; and
- `REDEEM-BUNDLE-01` passed atomic two-Promo commit, deterministic entry order,
  and exact canonical idempotent retry; and
- `REDEEM-BUNDLE-02` passed changed-order idempotency-key conflict with a
  matching safe correlation ID; and
- `REDEEM-BUNDLE-03` passed atomic rollback: an exhausted second entry rejected
  the complete bundle, returned no partial entries, and left the first entry's
  budget available; and
- `TENANT-API-01` passed submitted-code tenant isolation: Beta received an
  opaque invalid-code diagnostic with no Alpha Promo reference, while Alpha
  selected its own qualified Promo; and
- automated concurrency coverage remained green; and
- `OBS-API-01` passed: the exact client-visible correlation ID
  `2f6dffe6-d497-43f1-a088-f29df0a3f015` located the matching sanitized
  Cloudflare `api_request_failed` event for the expected
  `POST /v1/redemptions` `VERSION_CONFLICT`, with no secret or request payload.

The canonical manual procedure, dated staging report, follow-up register,
current-state page, this plan, and their Notion mirrors were reconciled with
the completed Gate C result.
