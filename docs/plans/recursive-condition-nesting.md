# Plan: Recursive Condition Nesting Fix

**Date:** 2026-11-03
**Scope:** Condition builder UI — only `ConditionBuilder` component and its validation helper

---

## Problem

`ConditionGroup` is a recursive type: `groups` contains `ConditionGroup[]` which can have their own `groups`, ad infinitum.

But the UI is **hardcoded to exactly 2 levels**:
- Level 0: root conditions
- Level 1: nested groups + their conditions

There is zero code to render, edit, or validate `group.groups` inside nested groups. You cannot write `((a AND b) OR c) AND (d OR (e AND f))` — anything beyond 2 levels is impossible.

---

## Design Decision: Unified List, True Recursion

At every nesting level, a group has two things: **conditions** (leaf nodes) and **sub-groups** (internal nodes). Both belong in the same list, mixed together. The group's match (ALL/ANY) applies to everything in the list — individual conditions AND sub-group results.

This is the simplest mental model and correctly reflects the recursive data structure.

---

## The Change: 3 files, one extracted component

### File 1: `apps/dashboard/src/components/builder/ConditionBuilder.tsx` — Extract and recurse

**Extract** the nested group rendering block (lines 209–251) into a new `ComponentGroup` component that is self-recursive:

```tsx
interface ComponentGroupProps {
  group: ConditionGroup;
  depth: number;
  variables: Variable[];
  onChange: (next: ConditionGroup) => void;
}
```

Every `ComponentGroup` renders:
1. The group's own conditions (using existing `conditionRow` logic)
2. A "＋ Add condition" button per group
3. A "＋ Add sub-group" button per group
4. Recursively renders each of its own `groups` as `ComponentGroup` with `depth + 1`

**Delete** the old inline nested group loop (lines 209–251) and replace with a single call to `ComponentGroup` for each top-level nested group.

**State management**: Each `ComponentGroup` has its own local state for its own pickers (`pickerOpen`, `replacement`). No shared state across levels. Remove `nestedPicker` state entirely — each level owns its own picker.

### File 2: `apps/dashboard/src/components/builder/condition-validation.ts` — Recursive validation

**Change** `conditionGroupIsAuthorable` from flat mapping to recursion:

```typescript
// Before (line 36-39):
export function conditionGroupIsAuthorable(
  group: ConditionGroup,
  variables: readonly Variable[],
): boolean {
  return [
    ...group.conditions,
    ...(group.groups ?? []).flatMap(nested => nested.conditions),
  ].every(condition => conditionIssue(condition, variables) === null);
}

// After:
export function conditionGroupIsAuthorable(
  group: ConditionGroup,
  variables: readonly Variable[],
): boolean {
  return group.conditions.every(c => conditionIssue(c, variables) === null)
    && (group.groups ?? []).every(g => conditionGroupIsAuthorable(g, variables));
}
```

One line change. Recursion depth is bounded by browser stack for any reasonable UI.

### File 3: `apps/dashboard/src/components/builder/ConditionBuilder.test.tsx` — New tests

---

## Visual Design

Depth-based indentation:

```
Level 0 (root):  Customer must match ALL of these conditions:
┌──────────────────────────────────────────┐
│  ◔ cart.subtotal  ≥  10000               │
│  ◔ customer.tier  eq  "gold"              │
│                                          │
│  ＋ Add condition      ＋ Add sub-group  │
└──────────────────────────────────────────┘

Level 1 sub-group (indented, left border):
┌─┐
│├  ALL
││
││  ◔ customer.country  eq  "US"           │
││  ◔ customer.membership  in  "basic,pro"  │
││
││  ＋ Add condition      ＋ Add sub-group  │
│└─────────────────────────────────────────┘

Level 2 sub-group (more indented):
┌──┐
│ │ ALL
│ │
│ │  ◔ cart.currency  eq  "USD"            │
│ │
│ │  ＋ Add condition      ＋ Add sub-group  │
│ └─────────────────────────────────────────┘
```

- Indentation increases with `depth` via `padding-left: ${depth * 20}px`
- Left border color persists per level
- Each level has its own match selector, "Add condition", "Add sub-group", "Remove group"
- Subtle background at deeper levels for visual separation

---

## What is NOT changing

| Component | Status | Reason |
|---|---|---|
| `ConditionRow.tsx` | No change | Already handles any condition correctly |
| `LivePromoEditor.tsx` | No change | Passes `ConditionGroup` value, no nesting-aware logic |
| `LivePromoDetail.tsx` | No change | Renders condition descriptions, not the builder |
| `RewardEditor.tsx` | No change | Passes `ConditionGroup` to `ConditionBuilder` |
| `ConditionView.tsx` | No change | Non-editable display |
| `VariablePicker.tsx` | No change | Unchanged |
| Data types in `@incentives/contracts` | No change | Already recursive |
| Engine logic in `packages/engine` | No change | Already handles arbitrary nesting |

---

## Files to modify (3 total)

| File | Change |
|---|---|
| `apps/dashboard/src/components/builder/ConditionBuilder.tsx` | Extract `ComponentGroup` recursive component; replace inline nested group rendering with recursive calls; remove old nested group state (`nestedPicker`) — each level has its own picker state |
| `apps/dashboard/src/components/builder/condition-validation.ts` | Make `conditionGroupIsAuthorable` recursive instead of flat-mapping |
| `apps/dashboard/src/components/builder/ConditionBuilder.test.tsx` | Add tests for 3+ level nesting, mixed conditions+subgroups, validation at depth |

---

## Testing plan

### Unit tests — `ConditionBuilder.test.tsx`
1. Verify 3-level nesting renders correctly
2. Verify 4-level nesting renders correctly
3. Verify adding a condition at depth 2 updates the correct group
4. Verify adding a sub-group at depth 2 creates `groups.groups` (not just `groups`)
5. Verify removing a sub-group at depth 2 removes the correct item
6. Verify `conditionGroupIsAuthorable` returns false when an invalid condition is at depth 3
7. Verify `conditionGroupIsAuthorable` returns true for deeply valid nesting
8. Verify mixed conditions + sub-groups at every level

### Manual verification
Run `pnpm dev:local`, navigate to `/promo/new`, create:
```
(cart.subtotal ≥ 10000) AND ((customer.country eq "US") OR ((customer.tier eq "gold") AND (cart.currency eq "USD")))
```
Verify draft saves, loads, and persists correctly.

---

## Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Infinite recursion in rendering | None | `ComponentGroup` only renders `group.groups`, which is finite |
| State management complexity | Low | Each `ComponentGroup` owns its own local state; no shared state across levels |
| Breaking existing saves | None | The data shape is unchanged — only rendering and validation traverse it differently |
| Breaking existing tests | Low | Only new tests added; existing tests pass unchanged since they use ≤2 level nesting |
| Stack overflow in validation | None | Only reaches stack overflow at ~10,000+ levels of nesting — impossible in this UI |

---

## Summary

3 files, one recursive component extraction, one recursive validation change, new tests. The existing data types and engine already support arbitrary nesting — this is purely a UI rendering and validation gap.
