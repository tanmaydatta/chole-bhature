# Design Document: Condition Builder Modernization with `react-querybuilder`

**Date:** 2026-11-05  
**Topic:** Condition Builder UI/UX Modernization  
**Status:** In Review  
**Target File:** `docs/superpowers/specs/2026-11-05-react-querybuilder-condition-builder-design.md`  

---

## 1. Intent & The Why

Operators frequently author eligibility conditions across promotions, referral programs, and reward rules. The current condition builder relies on a hand-rolled recursive DOM structure (~490 lines of code) with flat visual styling (a simple 3px left border per nest level) and clumsy controls (`[ group ]`, `[ promote ]`, manual `↑`/`↓` buttons).

The intent of this modernization is to significantly elevate the operator UI/UX by using [`react-querybuilder`](https://github.com/react-querybuilder/react-querybuilder) as the foundational engine. This gives operators a clear visual tree hierarchy, intuitive rule and group management, accessible keyboard controls, and streamlined authoring, while preserving our platform's domain-specific requirements.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Clear Visual Tree Hierarchy**: Render nested logical groups with connecting branch lines, clear group headers, and distinct bounding frames.
- **Contract & Engine Compatibility**: Maintain 100% compatibility with `@incentives/contracts` `ConditionGroup` and `@incentives/engine` `evaluateConditionGroup`. No backend or API changes.
- **Preserve Domain Specifics**:
  1. Variable selection organized by origin (`◔ user`, `◇ dynamic`, `⚙ system`) with searchable popovers/dropdowns.
  2. Typed value inputs (`boolean` select, `enum` single/multi-select, `between` min/max ranges, numeric casting).
  3. Inline failure message customization with token interpolation preview (`{{ variable | filter }}`).
  4. Unresolved variable recovery banners when variables are missing or deleted in existing rules.
  5. Continuous validity reporting via `onValidityChange`.
- **Zero Consumer Breakage**: Keep `<ConditionBuilder value={...} variables={...} onChange={...} onValidityChange={...} />` props interface identical.

### Non-Goals
- Changing the backend condition evaluation engine or Zod schemas in `@incentives/contracts`.
- Changing how promotions, referrals, or loyalty programs persist eligibility payloads in the database.
- Introducing a third-party styling library (MUI, AntD, Chakra); styling must remain aligned with our Tailwind CSS variables palette.

### Anti-Goals
- Dropping custom error messages or token previews in favor of generic query builder inputs.
- Allowing malformed data types to leak into the contract (e.g. string numbers when the engine expects JS `number`).

---

## 3. Constraints

- **React 19 & Vite**: Dashboard is on React 19.2.7 and Vite 8.1.0. All dependencies must be strictly compatible.
- **Styling Architecture**: Must support both light and dark mode using our CSS custom properties (`--bg`, `--panel`, `--ink`, `--muted`, `--border`, `--accent`, `--user`, `--dyn`, `--sys`, etc.).
- **Evaluation Commutativity**: Conditions and groups within a `ConditionGroup` can be evaluated in any order without changing truth value, but IDs and field types must remain stable.

---

## 4. Approaches Considered

### Approach 1: `react-querybuilder` with Tailored Custom Controls (Selected)
- **Description:** Install `react-querybuilder` (`^8.26.0`). Create a bidirectional adapter between `ConditionGroup` and `RuleGroupType`. Implement custom `controlElements` for field selection, typed values, and inline message editing.
- **Pros:**
  - Modern, accessible tree UI with native branch lines.
  - Native rule duplication, group creation, and keyboard navigation.
  - Keeps 100% of bespoke features (token interpolation, origin swatches).
  - Replaces ~490 lines of fragile bespoke DOM logic with a tested library.
- **Cons:** Requires ~150 lines of adapter code and custom control overrides.
- **Decision:** Picked by human partner. Delivers the best balance of UX polish, maintainability, and domain fidelity.

### Approach 2: Out-of-the-Box `react-querybuilder`
- **Description:** Use RQB with standard HTML selects and minimal styling tweaks.
- **Pros:** Fast to install.
- **Cons:** Strips out origin categorization, failure message templating, and custom range inputs. Poor fit for our operators.

### Approach 3: Hand-Rolled Custom Tree Overhaul
- **Description:** Re-engineer the current custom recursive builder with SVG branch lines and custom drag-and-drop.
- **Pros:** Zero new dependencies.
- **Cons:** Extremely high ongoing maintenance, re-inventing accessibility and recursive tree mechanics already solved by RQB.

---

## 5. Architectural Design & Components

```
apps/dashboard/src/components/builder/
├── ConditionBuilder.tsx         # Public wrapper component (preserves exact props)
├── rqb-adapter.ts               # Bidirectional adapter between ConditionGroup & RuleGroupType
├── rqb-controls.tsx             # Custom Tailwind/CSS-variable styled RQB controlElements
├── ConditionRow.tsx             # Retained/refactored for row controls & styling
├── MessageEditor.tsx            # Existing failure message editor with token interpolation
├── VariablePicker.tsx           # Existing categorized variable selector
├── condition-validation.ts      # Existing recursive validation logic
└── ConditionBuilder.test.tsx    # Comprehensive test suite
```

### 5.1 Data Adapter (`rqb-adapter.ts`)
- **`conditionGroupToRuleGroup(group: ConditionGroup): RuleGroupType`**:
  - `match === 'ALL'` -> `combinator: 'and'`
  - `match === 'ANY'` -> `combinator: 'or'`
  - Maps `conditions` into rules with `id`, `field: condition.variable`, `operator`, `value`, and `message`.
  - Recursively maps nested `groups`.
- **`ruleGroupToConditionGroup(rg: RuleGroupType): ConditionGroup`**:
  - Maps `and` -> `ALL`, `or` -> `ANY`.
  - Partitions `rg.rules` into leaf `conditions` and nested `groups`.
  - Casts values according to variable definitions (e.g. numeric types to numbers, enum lists to arrays).
- **`variablesToFields(variables: Variable[]): Field[]`**:
  - Generates RQB field definitions with metadata: origin swatches, type information, and allowed operators per variable.

### 5.2 Custom Controls (`rqb-controls.tsx`)
- **Combinator Selector**:
  - Displays toggle or select for `Match ALL (AND)` vs `Match ANY (OR)`.
- **Field Selector**:
  - Displays the active variable with its origin chip (`◔ user`, `◇ dynamic`, `⚙ system`).
  - Searchable selection list categorized by origin.
- **Operator Selector**:
  - Filtered to operators permitted for the selected variable type (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `is`).
- **Value Editor**:
  - `boolean`: `true` / `false` dropdown.
  - `enum`: single select for `eq`/`neq`, multi-tag selector for `in`.
  - `between`: min & max pair inputs with proper type casting.
  - `date`: native date picker.
  - `number`: numeric input with auto-casting to JS `number`.
  - `string`: standard text input.
- **Failure Message Bar & Popover**:
  - Trigger button: `💬 Message` (badged if customized).
  - Expands `MessageEditor` with real-time token interpolation preview and syntax hints.
- **Unresolved Condition Alert**:
  - Detects if rule references an unregistered variable and renders a prominent warning banner with quick "Replace" or "Remove" buttons.

### 5.3 Public Wrapper (`ConditionBuilder.tsx`)
- Exports `<ConditionBuilder value={...} variables={...} onChange={...} onValidityChange={...} />`.
- Translates `value` to internal RQB query state.
- In `onQueryChange`, converts to `ConditionGroup`, runs `conditionGroupIsAuthorable(group, variables)`, and fires `onChange` and `onValidityChange`.

---

## 6. Resolved Builder & Architectural Specifications

### 6.1 Default Rule Creation & Empty Group Semantics
- **Empty Groups:** Empty groups (`rules: []`) are completely valid in both `RuleGroupType` and `@incentives/contracts` `ConditionGroup`. Empty groups will render a helpful empty branch hint guiding operators to add a condition or sub-group.
- **Rule Creation:** When an operator adds a condition, if adding via the quick field button, it initializes with a default operator and value using our typed schema (e.g. `0` for numbers, `true` for booleans, first enum value for enums). Alternatively, clicking "Add condition" can open the categorized `VariablePicker` to select the variable directly.

### 6.2 Controlled State & Idempotent ID Mapping
- **State Reconciliation:** The adapter preserves existing `condition.id` as `rule.id`. Both directions (`conditionGroupToRuleGroup` and `ruleGroupToConditionGroup`) are idempotent.
- **Input Focus & Typing:** Inputs (such as failure message text or numeric values) maintain local edit state during typing and commit changes via RQB's `handleOnChange`, ensuring zero focus loss or cursor jumps.

### 6.3 Reordering & Drag-and-Drop Scope
- **Scope Decision:** To keep the dependency footprint light and ensure 100% React 19 stability, **Phase 1 uses button-driven and keyboard-accessible actions** (Shift Up/Down, Duplicate/Clone Rule, Remove, Add Sub-group) rather than pulling in `@react-querybuilder/dnd` and heavy drag-and-drop peer dependencies. Drag-and-drop can be evaluated as a future enhancement once React 19 DND peer libraries stabilize.

---

## 7. What Is Left to the Builder
- Exact Tailwind utility classes for branch line colors in dark vs. light mode.
- Fine-tuning focus rings and keyboard trap behaviors inside the searchable variable selector.
- Test fixture organization and backwards-compatibility helper assertions in `ConditionBuilder.test.tsx`.

