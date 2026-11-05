# Modernizing Condition Builder with `react-querybuilder` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the dashboard Condition Builder UI/UX by integrating `react-querybuilder` with custom domain controls (categorized origin badges, typed value inputs, failure message interpolation, unresolved variable banners) while maintaining 100% contract compatibility with `@incentives/contracts`.

**Architecture:** Wrap `react-querybuilder`'s `<QueryBuilder />` inside a drop-in replacement `<ConditionBuilder />` component. A bidirectional adapter (`rqb-adapter.ts`) converts between the application's `ConditionGroup` and RQB's `RuleGroupType`. Domain-specific features are injected via custom `controlElements` (`rqb-controls.tsx`).

**Tech Stack:** React 19.2, Vite 8.1, Tailwind CSS 3.4, `react-querybuilder` 8.26, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-react-querybuilder-condition-builder-design.md`

## Global Constraints
- React 19.2.7 and Vite 8.1.0 compatibility with zero peer dependency conflicts.
- `<ConditionBuilder>` prop signature must remain: `value: ConditionGroup`, `variables: Variable[]`, `onChange: (next: ConditionGroup) => void`, `onValidityChange?: (valid: boolean) => void`.
- The `@incentives/contracts` `ConditionGroup` and `Condition` types must not change.
- Zero changes to backend APIs or the engine evaluation schema.
- Must support both light and dark mode using existing CSS custom properties (`--bg`, `--panel`, `--ink`, `--muted`, `--border`, `--accent`, etc.).

## Review Focus
- **Input class 1:** Rule with missing variable definition (deprecated variable). Expected: rendered as an unresolved condition banner with "Replace" and "Remove" actions.
- **Input class 2:** Multi-select enum condition with operator `in`. Expected: values emitted as an array of strings in `Condition.value`.
- **Input class 3:** Numeric `between` condition. Expected: values emitted as a 2-element array `[min, max]` of JavaScript numbers.
- **Input class 4:** Condition with customized failure message containing `{{ variable | filter }}` syntax. Expected: preserved in `Condition.message` and live preview rendered accurately.
- **Input class 5:** Deeply nested groups (3+ levels). Expected: recursive nesting preserved in `ConditionGroup.groups`, branch lines rendered cleanly, and validity accurately reported.

---

### Task 1: Add `react-querybuilder` Dependency

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: None
- Produces: `react-querybuilder` package available to `apps/dashboard`

- [ ] **Step 1: Update package.json**
Add `"react-querybuilder": "^8.26.0"` to `dependencies` in `apps/dashboard/package.json`.

- [ ] **Step 2: Run pnpm install**
Run: `pnpm install`
Expected: Success with clean resolution and updated `pnpm-lock.yaml`.

- [ ] **Step 3: Verify import and build baseline**
Run: `pnpm --filter @incentives/dashboard exec node -e "import('react-querybuilder').then(() => console.log('RQB OK'))"`
Expected: Output `RQB OK`.

- [ ] **Step 4: Commit**
```bash
git add apps/dashboard/package.json pnpm-lock.yaml
git commit -m "build(dashboard): add react-querybuilder dependency"
```

---

### Task 2: Implement Bidirectional RQB Data Adapter

**Files:**
- Create: `apps/dashboard/src/components/builder/rqb-adapter.ts`
- Create: `apps/dashboard/src/components/builder/rqb-adapter.test.ts`

**Interfaces:**
- Consumes: `@incentives/contracts` (`ConditionGroup`, `Condition`), `apps/dashboard/src/lib/types` (`Variable`), `react-querybuilder` (`RuleGroupType`, `RuleType`, `Field`)
- Produces:
  - `conditionGroupToRuleGroup(group: ConditionGroup): RuleGroupType`
  - `ruleGroupToConditionGroup(rg: RuleGroupType, variables?: readonly Variable[]): ConditionGroup`
  - `variablesToFields(variables: readonly Variable[]): Field[]`

- [ ] **Step 1: Write failing adapter unit tests**
Create `apps/dashboard/src/components/builder/rqb-adapter.test.ts` testing:
1. `conditionGroupToRuleGroup` converts `ALL` to `and`, `ANY` to `or`.
2. `conditionGroupToRuleGroup` maps leaf conditions and nested groups with stable IDs and message fields.
3. `ruleGroupToConditionGroup` maps `and` to `ALL`, `or` to `ANY`.
4. `ruleGroupToConditionGroup` partitions rules into leaf `conditions` and nested `groups`.
5. `ruleGroupToConditionGroup` coerces numeric strings to numbers for number-typed variables.
6. `variablesToFields` creates fields with origin metadata, type mapping, and permitted operators.

- [ ] **Step 2: Run adapter tests to verify failure**
Run: `pnpm --filter @incentives/dashboard test src/components/builder/rqb-adapter.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `rqb-adapter.ts`**
Write `rqb-adapter.ts` implementing `conditionGroupToRuleGroup`, `ruleGroupToConditionGroup`, and `variablesToFields`.

- [ ] **Step 4: Run adapter tests to verify passing**
Run: `pnpm --filter @incentives/dashboard test src/components/builder/rqb-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/dashboard/src/components/builder/rqb-adapter.ts apps/dashboard/src/components/builder/rqb-adapter.test.ts
git commit -m "feat(dashboard): implement bidirectional react-querybuilder adapter"
```

---

### Task 3: Build Custom RQB Control Components

**Files:**
- Create: `apps/dashboard/src/components/builder/rqb-controls.tsx`
- Create: `apps/dashboard/src/components/builder/rqb-controls.test.tsx`

**Interfaces:**
- Consumes:
  - `apps/dashboard/src/lib/types` (`Variable`)
  - `apps/dashboard/src/components/builder/MessageEditor.tsx`
  - `apps/dashboard/src/components/builder/VariablePicker.tsx`
  - `react-querybuilder` (`ActionProps`, `ValueSelectorProps`, `ValueEditorProps`, `RuleProps`)
- Produces:
  - `customControlElements`: RQB control element overrides containing:
    - `combinatorSelector`: segmented toggle / select for ALL / ANY
    - `fieldSelector`: categorized variable selector with swatches & origin badges (`◔`, `◇`, `⚙`)
    - `operatorSelector`: typed operator dropdown
    - `valueEditor`: typed inputs (boolean select, enum dropdown/multi-select, between min/max, numeric input, date)
    - `rule`: custom rule wrapper rendering condition row, unresolved alert if missing variable, and expandable failure message editor (`MessageEditor`)

- [ ] **Step 1: Write failing tests for custom controls**
Create `apps/dashboard/src/components/builder/rqb-controls.test.tsx` testing:
1. Combinator selector switches between ALL and ANY.
2. Field selector renders origin icon and variable name.
3. Value editor renders two inputs for `between` operator and multi-select for `in` operator.
4. Rule component renders unresolved variable warning when variable is unknown.
5. Message toggle reveals `MessageEditor` and live preview.

- [ ] **Step 2: Run custom control tests to verify failure**
Run: `pnpm --filter @incentives/dashboard test src/components/builder/rqb-controls.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `rqb-controls.tsx`**
Implement the custom controls styled with Tailwind and CSS variables, including importing `react-querybuilder/dist/query-builder.css` and custom styles for branch connectors and light/dark theme.

- [ ] **Step 4: Run custom control tests to verify passing**
Run: `pnpm --filter @incentives/dashboard test src/components/builder/rqb-controls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/dashboard/src/components/builder/rqb-controls.tsx apps/dashboard/src/components/builder/rqb-controls.test.tsx
git commit -m "feat(dashboard): build custom RQB controls for variable origins, types, and message editing"
```

---

### Task 4: Integrate `QueryBuilder` into `ConditionBuilder.tsx`

**Files:**
- Modify: `apps/dashboard/src/components/builder/ConditionBuilder.tsx`

**Interfaces:**
- Consumes:
  - `rqb-adapter.ts` (`conditionGroupToRuleGroup`, `ruleGroupToConditionGroup`, `variablesToFields`)
  - `rqb-controls.tsx` (`customControlElements`)
  - `condition-validation.ts` (`conditionGroupIsAuthorable`)
- Produces:
  - `ConditionBuilder`: React component accepting `ConditionBuilderProps { value, variables, onChange, onValidityChange }`

- [ ] **Step 1: Update `ConditionBuilder.tsx` implementation**
Refactor `ConditionBuilder` to:
1. Convert `value` prop to RQB query via `conditionGroupToRuleGroup`.
2. Convert `variables` to `fields` via `variablesToFields`.
3. Render `<QueryBuilder fields={fields} query={query} onQueryChange={...} controlElements={customControlElements} showNotToggle={false} />`.
4. In `onQueryChange`, convert updated `RuleGroupType` back to `ConditionGroup`, run `conditionGroupIsAuthorable`, and call `onChange` and `onValidityChange`.

- [ ] **Step 2: Run typecheck on dashboard**
Run: `pnpm --filter @incentives/dashboard exec tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 3: Commit**
```bash
git add apps/dashboard/src/components/builder/ConditionBuilder.tsx
git commit -m "refactor(dashboard): wire ConditionBuilder to react-querybuilder"
```

---

### Task 5: Update & Verify `ConditionBuilder.test.tsx`

**Files:**
- Modify: `apps/dashboard/src/components/builder/ConditionBuilder.test.tsx`

**Interfaces:**
- Consumes: `ConditionBuilder`
- Produces: 100% passing test suite for all condition builder interactions and edge cases

- [ ] **Step 1: Align test interaction queries with RQB DOM elements**
Update `ConditionBuilder.test.tsx` to target the enhanced RQB elements (e.g. Add Rule / Add Group buttons, field picker, message editor, and reordering controls) while keeping all behavioral assertions identical:
1. Adding a condition updates the group.
2. Typing custom failure message updates live preview.
3. Inherited default failure message hint displays when no custom message is set.
4. Switching ALL ↔ ANY fires `onChange`.
5. Arbitrary recursive nesting (3+ levels) functions correctly.
6. Number, boolean, enum `in`, and `between` bounds author correct typed values.
7. Unresolved conditions render warning alert and can be replaced or removed.
8. Recursive validity correctly reports to `onValidityChange`.

- [ ] **Step 2: Run ConditionBuilder tests**
Run: `pnpm --filter @incentives/dashboard test src/components/builder/ConditionBuilder.test.tsx`
Expected: PASS with all tests passing.

- [ ] **Step 3: Run entire dashboard test suite**
Run: `pnpm --filter @incentives/dashboard test`
Expected: All 39+ test files passing.

- [ ] **Step 4: Commit**
```bash
git add apps/dashboard/src/components/builder/ConditionBuilder.test.tsx
git commit -m "test(dashboard): align ConditionBuilder test suite with react-querybuilder"
```

---

### Task 6: Full Workspace Verification & Walkthrough

**Files:**
- Create: `<Artifact Directory>/walkthrough.md`

**Interfaces:**
- Consumes: All updated components
- Produces: Verified production build and documented walkthrough

- [ ] **Step 1: Run production dashboard build**
Run: `pnpm --filter @incentives/dashboard build`
Expected: Clean build with zero warnings/errors.

- [ ] **Step 2: Run full workspace test suite**
Run: `pnpm --filter @incentives/contracts --filter @incentives/engine --filter @incentives/dashboard test`
Expected: All tests pass across the entire workspace.

- [ ] **Step 3: Create Walkthrough Artifact**
Document the modernized UI/UX, tree branch styling, custom controls, and verification results in `<Artifact Directory>/walkthrough.md`.

- [ ] **Step 4: Commit**
```bash
git commit --allow-empty -m "chore(dashboard): complete condition builder modernization verification"
```
