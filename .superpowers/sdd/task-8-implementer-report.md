# Task 8 Implementer Report

## Scope and outcome

- Base: `cc14780da1d6e35860e868cf252cf2dfab258bf3`
- Branch: `feat/promo-selection-code-stacking`
- Extended the operator-only program view with exact active- and draft-revision
  configurations while preserving the compatible working/display configuration.
- Made new Promo authoring genuinely minimal and kept the complete authoring
  example behind an explicit action.
- Replaced the legacy auto-apply checkbox with explicit `Automatic` and
  `Code-triggered` modes.
- Made coded-to-automatic conversion destructive only after confirmation;
  cancellation preserves the complete coded draft.
- Removed the `stackingGroup` control and kept it out of accepted operator
  payloads through the strict Promo contract.
- Added trigger badges, labelled reward summaries, active/draft comparison,
  and a two-step publication review.
- Added actionable guidance for published Promo-code conflicts.
- Kept code visibility and trigger mutation behind the existing authorized
  operator routes and permissions.
- Did not change runtime/public API response contracts or use the operator view
  in public evaluation/redemption responses.
- Did not deploy, migrate, create resources, set secrets, or otherwise write to
  Cloudflare.

## TDD RED evidence

The first contract run after adding the active/draft view assertions failed
because the operator view rejected the new properties:

```text
pnpm --filter @incentives/contracts test -- production-operator-contracts.test.ts
1 failed; 115 passed
```

The first API run failed because the exact pointer-selected configurations were
absent:

```text
pnpm --filter @incentives/api test -- program-revisions.test.ts
1 failed; 444 passed
```

The first dashboard run failed because the new editor had no `Automatic` radio
and still rendered the legacy auto-apply checkbox, prefilled complete example,
and `stackingGroup` control:

```text
pnpm --filter @incentives/dashboard test -- LiveOperatorJourney.test.tsx
1 failed; 247 passed
```

These RED failures covered the three production boundaries changed by Task 8:
the operator contract, the API operator-view assembler, and the dashboard
authoring/review flow.

## GREEN evidence

Fresh final verification after the last production change:

```text
pnpm --filter @incentives/contracts test -- production-operator-contracts.test.ts
6 files passed; 116 tests passed
```

```text
pnpm --filter @incentives/dashboard test -- LiveOperatorJourney.test.tsx
37 files passed; 250 tests passed
```

```text
pnpm --filter @incentives/api test -- program-revisions.test.ts
14 files passed; 445 tests passed
```

The package scripts run their package suites in addition to the named file, so
the final evidence also exercised adjacent operator contracts, routes, BFF
parsing, access control, and lifecycle behavior.

Build and static checks:

```text
pnpm --filter @incentives/dashboard build
PASS
```

```text
pnpm --filter @incentives/dashboard lint
PASS with two pre-existing Fast Refresh warnings:
src/theme/ThemeProvider.tsx:9:14 react(only-export-components)
src/components/common/Toast.tsx:15:17 react(only-export-components)
```

```text
pnpm --filter @incentives/api build
PASS
```

```text
pnpm --filter @incentives/api lint
PASS
```

```text
git diff --check
PASS
```

## Behavior pinned by tests

- Active and draft configurations are present exactly when their lifecycle
  revision pointers are present.
- Each exact configuration has the lifecycle program reference.
- Draft configuration is the compatible working configuration while a draft
  exists.
- Without a draft, the compatible working configuration may differ from the
  immutable active revision only by the current logical lifecycle status.
- Paused and ended lifecycle views retain the immutable historical active
  revision payload.
- A new editor is minimal until the user explicitly loads the complete example.
- Automatic mode has no code, is not stackable, and hides coded controls.
- Code-triggered mode requires a code and exposes stackability.
- Cancelling coded-to-automatic conversion preserves the coded draft;
  confirming removes both code and stackability.
- The list and detail views identify trigger mode.
- Active and pending draft configurations render side by side.
- Publication does not call the publish endpoint until explicit confirmation.
- Code-conflict failures give the user guidance to change code or schedule.
- A user without the operator read/manage permissions cannot fetch the operator
  view, see a Promo code, or reach the trigger editor.

## Changed files

- `packages/contracts/src/operator-bff.ts`
- `packages/contracts/src/production-operator-contracts.test.ts`
- `apps/api/src/services/program-service.ts`
- `apps/api/test/program-revisions.test.ts`
- `apps/dashboard/src/lib/bff-client.test.ts`
- `apps/dashboard/src/pages/LiveOperatorJourney.test.tsx`
- `apps/dashboard/src/pages/OperatorAccessFlow.test.tsx`
- `apps/dashboard/src/pages/promo/LivePromoEditor.tsx`
- `apps/dashboard/src/pages/promo/LivePromoDetail.tsx`
- `apps/dashboard/src/pages/promo/LivePromoList.tsx`
- `.superpowers/sdd/task-8-implementer-report.md`

## Decisions and assumptions

- Revision payloads are immutable evidence. An exact `activeConfiguration` may
  retain the status it had when published; pause/end state belongs to the
  lifecycle view and compatible `configuration`.
- `configuration` remains `record.program` for operator compatibility. When a
  draft exists it is exactly the draft configuration; otherwise it can differ
  from the exact active revision only by current lifecycle status.
- The API loads active and draft payloads with `getRevision` using the exact
  lifecycle pointers; it does not infer active state from mutable fields.
- `PromoProgramSchema` is strict. Because `stackingGroup` is no longer part of
  that contract, the operator BFF rejects it rather than allowing a hidden
  legacy value to be re-sent by the editor.
- Promo codes are exposed only through the existing `programs:read` operator
  route. Trigger edits require `programs:manage`; publication confirmation
  requires `programs:publish`.
- Trigger-mode authorization is enforced by route access as well as UI
  visibility, not by sending a redacted shape through the authorized operator
  view.

## Concerns and intentional boundaries

- Independent review found no Critical or Important issues. Its only Minor
  observation was that the coded-to-automatic test stopped at UI state instead
  of inspecting the submitted payload. The final test now saves the converted
  draft and proves `autoApply: true`, `stackable: false`, and absence of both
  `code` and `stackingGroup`.
- The dashboard production build retains its existing warning that the main
  JavaScript chunk exceeds 500 kB.
- The two existing dashboard Fast Refresh lint warnings are unrelated to this
  task and remain unchanged.
- Arbitrary revision history, rollback, multiple concurrent drafts,
  percentage-input UX, and Loyalty-reward authoring remain explicit follow-ups.
- This task does not redesign all operator styling; it adds the required state
  clarity within the current dashboard visual system.
- `.pnpm-store/` and `CLAUDE.md` remain untouched and untracked.
