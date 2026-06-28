# Dashboard Detail & Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dashboard entry clickable → a read-only detail view; allow editing programs only when `status==='draft'` (reusing the create flows pre-filled), make Variables/Events always-editable (system vars read-only), and fix the PageHeader button misalignment.

**Architecture:** Extends the existing `demo/` React+TS+Vite+Tailwind+Zustand SPA. Program rows route to a shared read-only `ProgramDetail` at `/<type>/:id`; drafts link to `/<type>/:id/edit` which reuses the existing `*Create` flow in edit mode. Variables and Events graduate from static arrays to in-memory Zustand stores (so edits/creates persist in-session) wired into the condition-builder variable picker and loyalty event selector.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind v3, React Router v7, Zustand, Vitest + RTL.

## Global Constraints

- App lives under `demo/`; run all commands from `demo/`. TypeScript `strict: true` + `verbatimModuleSyntax` (use `import type`; don't import `React` just for JSX).
- **Programs are editable only when `status === 'draft'`.** Non-draft (active/scheduled/paused/ended) → view-only; hitting an edit route for a non-draft redirects to the detail page.
- **Variables/Events are always editable EXCEPT system variables (`readOnly: true`)**, which are view-only.
- Detail routes `/<type>/:id` render inside `<AppShell>`; create/edit routes (`/<type>/new`, `/<type>/:id/edit`) are full-screen (outside AppShell), like the existing `/new` routes.
- Type→route segment map (verbatim): `promo→promo`, `affiliate→affiliates`, `referral→referrals`, `loyalty→loyalty`.
- Reuse existing utilities — do NOT reimplement: `rewardSummaryFor` (`lib/rewards.ts`), `operatorLabel`/`resolveMessage`/`OPERATORS_BY_TYPE` (`lib/conditions.ts`), `renderMessage` (`lib/interpolate.ts`), `TYPE_META`/types (`lib/types.ts`), and components `PageHeader`/`DataTable`/`TypePill`/`StatusBadge`/`SegmentedFilter`/`ConditionBuilder`/`RewardEditor`/`DualRewardEditor`/`CreateFlowShell`/`useToast`.
- Each task ends green: `npm run test` AND `npm run build` from `demo/`. Commit per task. Keep test output pristine.
- New stores reset on reload (acceptable; matches current behavior). No backend.

## File Structure

```
demo/src/
  data/
    variables.ts            (existing — keep VARIABLES seed export)
    variablesStore.ts       NEW — Zustand store seeded from VARIABLES
    events.ts               (existing — keep EVENTS seed export)
    eventsStore.ts          NEW — Zustand store seeded from EVENTS
    programs.ts             MODIFY — add 4 draft programs + enrich actives
    store.ts                (existing program store; updateProgram already present)
  hooks/
    useProgramEdit.ts       NEW — reads :id, loads draft, guards non-draft
  lib/
    routes.ts               NEW — typeToSegment(type) helper
  components/
    common/PageHeader.tsx   MODIFY — add w-full
    common/DataTable.tsx    MODIFY — optional onRowClick
    builder/ConditionView.tsx   NEW — read-only conditions renderer
    setup/VariablePanel.tsx     NEW — slide-over view/edit/create for a variable
  pages/
    ProgramDetail.tsx       NEW — shared read-only program detail
    Overview.tsx            MODIFY — clickable rows
    _ProgramListPage.tsx    MODIFY — clickable rows
    referral/ReferralList.tsx   MODIFY — clickable rows (stopPropagation on input/handle)
    promo/PromoCreate.tsx   MODIFY — edit mode + picker from store
    affiliate/AffiliateCreate.tsx  MODIFY — edit mode + picker from store
    referral/ReferralCreate.tsx    MODIFY — edit mode + picker from store
    loyalty/LoyaltyCreate.tsx      MODIFY — edit mode + picker + event selector from store
    setup/Variables.tsx     MODIFY — read store, rows open VariablePanel
    setup/Events.tsx        MODIFY — read store, in-place edit + New event
  App.tsx                   MODIFY — detail + edit routes
```

---

## Task 1: Fix PageHeader alignment

**Files:**
- Modify: `demo/src/components/common/PageHeader.tsx`
- Modify: `demo/src/pages/setup/Variables.tsx:79`, `demo/src/pages/setup/Events.tsx:13`
- Test: `demo/src/components/common/common.test.tsx` (extend)

**Interfaces:** Produces: `PageHeader` root now `w-full` so `justify-between` works in any parent.

- [ ] **Step 1: Failing test** — extend `common.test.tsx`:

```tsx
test('PageHeader root is full width so the action right-aligns', () => {
  const { container } = render(<PageHeader title="X" action={<button>＋ New</button>} />);
  const root = container.firstChild as HTMLElement;
  expect(root.className).toContain('w-full');
  expect(root.className).toContain('justify-between');
});
```

- [ ] **Step 2: Run** → FAIL (no `w-full`).
- [ ] **Step 3: Implement** — in `PageHeader.tsx` change the root to `className="flex items-center justify-between w-full"`.
- [ ] **Step 4: Fix wrappers** — in `Variables.tsx:79` and `Events.tsx:13` replace `<div className="flex items-center justify-between mb-4">` with `<div className="mb-4">` (keep the `<PageHeader .../>` child unchanged).
- [ ] **Step 5: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 6: Manual** — `npm run dev`; on Variables & Events the `＋ New …` button is now right-aligned; list/Overview unaffected.
- [ ] **Step 7: Commit** `git commit -am "fix: PageHeader full-width so action right-aligns on Variables/Events"`

---

## Task 2: DataTable clickable rows

**Files:**
- Modify: `demo/src/components/common/DataTable.tsx`
- Test: `demo/src/components/common/common.test.tsx` (extend)

**Interfaces:**
- Produces: `DataTable({ columns, rows, onRowClick? })` where `onRowClick?: (index: number) => void`. When provided, each `<tr>` gets `cursor-pointer`, `role="button"`, `tabIndex={0}`, an `onClick`, and Enter/Space `onKeyDown` calling `onRowClick(index)`.

- [ ] **Step 1: Failing test**

```tsx
test('DataTable fires onRowClick with the row index', () => {
  const onRowClick = vi.fn();
  render(<DataTable columns={[{ key: 'name', header: 'Name' }]} rows={[{ name: 'A' }, { name: 'B' }]} onRowClick={onRowClick} />);
  fireEvent.click(screen.getByText('B').closest('tr')!);
  expect(onRowClick).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add the optional prop; on each row spread `onRowClick && { onClick: () => onRowClick(i), role: 'button', tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(i); } }, className: '<existing> cursor-pointer' }`. Rows without `onRowClick` keep current behavior.
- [ ] **Step 4: Run** → PASS + build.
- [ ] **Step 5: Commit** `git commit -am "feat: DataTable optional onRowClick for clickable rows"`

---

## Task 3: Variables store

**Files:**
- Create: `demo/src/data/variablesStore.ts`
- Modify: `demo/src/pages/setup/Variables.tsx` (read from store instead of importing `VARIABLES` directly)
- Test: `demo/src/data/variablesStore.test.ts`

**Interfaces:**
- Produces: `useVariablesStore` with `{ variables: Variable[]; addVariable(v: Variable): void; updateVariable(name: string, patch: Partial<Variable>): void }`, seeded from `VARIABLES` (`./variables`). Identity = `name`.

- [ ] **Step 1: Failing test**

```ts
import { useVariablesStore } from './variablesStore';
beforeEach(() => useVariablesStore.setState({ variables: useVariablesStore.getInitial?.() ?? undefined } as never, false));
test('seeds from VARIABLES and supports add/update', () => {
  const s = useVariablesStore.getState();
  expect(s.variables.length).toBeGreaterThan(0);
  s.addVariable({ name: 'promo_seen', type: 'boolean', origin: 'user' });
  expect(useVariablesStore.getState().variables.some(v => v.name === 'promo_seen')).toBe(true);
  s.updateVariable('promo_seen', { type: 'string' });
  expect(useVariablesStore.getState().variables.find(v => v.name === 'promo_seen')!.type).toBe('string');
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `variablesStore.ts`:

```ts
import { create } from 'zustand';
import type { Variable } from '../lib/types';
import { VARIABLES } from './variables';
interface VariablesState {
  variables: Variable[];
  addVariable: (v: Variable) => void;
  updateVariable: (name: string, patch: Partial<Variable>) => void;
}
export const useVariablesStore = create<VariablesState>((set) => ({
  variables: VARIABLES.map(v => ({ ...v })),
  addVariable: (v) => set((s) => ({ variables: [...s.variables, v] })),
  updateVariable: (name, patch) => set((s) => ({
    variables: s.variables.map(v => (v.name === name ? { ...v, ...patch } : v)),
  })),
}));
```
(Adjust the test's `beforeEach` reset to `useVariablesStore.setState({ variables: VARIABLES.map(v => ({ ...v })) })`.)

- [ ] **Step 4: Wire Variables screen** — `Variables.tsx` reads `const variables = useVariablesStore(s => s.variables)` instead of importing `VARIABLES`; rendering/grouping/filter logic unchanged. Update `Variables.test.tsx` to reset the store in `beforeEach` if needed (keep existing assertions).
- [ ] **Step 5: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat: variables store seeded from VARIABLES; Variables screen reads it"`

---

## Task 4: Events store

**Files:**
- Create: `demo/src/data/eventsStore.ts`
- Modify: `demo/src/pages/setup/Events.tsx` (read from store)
- Test: `demo/src/data/eventsStore.test.ts`

**Interfaces:**
- Produces: `useEventsStore` with `{ events: EventDef[]; addEvent(e: EventDef): void; updateEvent(name: string, patch: Partial<EventDef>): void }`, seeded from `EVENTS` (`./events`). Identity = `name`.

- [ ] **Step 1: Failing test** (mirror Task 3): seeds from `EVENTS`; `addEvent`/`updateEvent` reflected.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `eventsStore.ts` (same shape as `variablesStore.ts`, typed to `EventDef`, seeded `EVENTS.map(e => ({ ...e }))`).
- [ ] **Step 4: Wire Events screen** — `Events.tsx` reads `const events = useEventsStore(s => s.events)` instead of importing `EVENTS`; selection/detail logic unchanged. Keep existing tests green (reset store in `beforeEach`).
- [ ] **Step 5: Run** + build → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat: events store seeded from EVENTS; Events screen reads it"`

---

## Task 5: Seed drafts + enrich active programs

**Files:**
- Modify: `demo/src/data/programs.ts`
- Modify: `demo/src/data/data.test.ts` (counts/assertions if affected)
- Test: `demo/src/data/programs-seed.test.ts` (new)

**Interfaces:** Produces: `PROGRAMS` now includes exactly **one `status:'draft'` program per type** (promo/affiliate/referral/loyalty), each with full config, and **active programs carry config** (eligibility `ConditionGroup`, discount/reward, limits, type extras). Every program has a unique `id`.

- [ ] **Step 1: Failing test** (`programs-seed.test.ts`):

```ts
import { PROGRAMS } from './programs';
test('one draft per program type exists', () => {
  for (const t of ['promo','affiliate','referral','loyalty'] as const) {
    expect(PROGRAMS.filter(p => p.type === t && p.status === 'draft')).toHaveLength(1);
  }
});
test('every program has a unique id', () => {
  const ids = PROGRAMS.map(p => p.id);
  expect(new Set(ids).size).toBe(ids.length);
});
test('an active promo carries eligibility config', () => {
  const p = PROGRAMS.find(x => x.type === 'promo' && x.status === 'active')!;
  expect(p.eligibility).toBeTruthy();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add 4 draft programs (e.g. `Draft Summer Sale`/promo, `Draft Partner Codes`/affiliate, `Draft VIP Referral`/referral, `Draft Signup Reward`/loyalty), each with: `id`, `name`, `type`, `status:'draft'`, `subtitle`, `rewardSummary`, `redemptions:0`, an `eligibility` `ConditionGroup` referencing real variable names, a discount/reward, limits (budget/perCustomer/dates/stackable for promo), and type extras (affiliate `codeCount`; referral `referrerReward`/`refereeReward`/`appliesTo`/`priority`; loyalty `triggerEvent`). Enrich each existing active program with the same config fields. Keep field names consistent with what the create flows write (read `PromoCreate.tsx` `buildProgram` etc. for the exact keys).
- [ ] **Step 4: Fix existing tests** — update `data.test.ts` if it asserted exact counts; keep the "all four types present" assertion valid.
- [ ] **Step 5: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat: seed draft program per type + enrich active program config"`

---

## Task 6: ConditionView (read-only conditions renderer)

**Files:**
- Create: `demo/src/components/builder/ConditionView.tsx`
- Test: `demo/src/components/builder/ConditionView.test.tsx`

**Interfaces:**
- Consumes: `operatorLabel`, `resolveMessage` (`../../lib/conditions`), `Variable`/`Condition`/`ConditionGroup` (`../../lib/types`), variable list via prop.
- Produces: `ConditionView({ group: ConditionGroup; variables: Variable[] })` — read-only render: "Customer must match ALL/ANY" + each condition as an origin-colored variable chip + `operatorLabel(op)` + value, with the resolved message (`resolveMessage(condition, variable)`) shown muted. Empty group → "No conditions (applies to everyone)".

- [ ] **Step 1: Failing test**

```tsx
test('renders each condition read-only with operator label', () => {
  const variables = [{ name: 'basket_value', type: 'number', origin: 'dynamic' }] as const;
  render(<ConditionView group={{ match: 'ALL', conditions: [{ id: '1', variable: 'basket_value', operator: 'gte', value: '50' }] }} variables={variables as never} />);
  expect(screen.getByText(/basket_value/)).toBeInTheDocument();
  expect(screen.getByText('≥')).toBeInTheDocument();
  expect(screen.getByText('50')).toBeInTheDocument();
});
test('empty group shows applies-to-everyone', () => {
  render(<ConditionView group={{ match: 'ALL', conditions: [] }} variables={[]} />);
  expect(screen.getByText(/applies to everyone/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — map conditions to rows; origin color via `--user/--dyn/--sys` tokens (look up the variable by name to get its origin); use `operatorLabel` and `resolveMessage`. No inputs/handlers (read-only).
- [ ] **Step 4: Run** → PASS + build.
- [ ] **Step 5: Commit** `git commit -am "feat: read-only ConditionView for detail pages"`

---

## Task 7: ProgramDetail page + routes + routes helper

**Files:**
- Create: `demo/src/lib/routes.ts`, `demo/src/pages/ProgramDetail.tsx`
- Modify: `demo/src/App.tsx` (add detail routes inside AppShell)
- Test: `demo/src/pages/ProgramDetail.test.tsx`

**Interfaces:**
- Produces: `typeToSegment(type: ProgramType): string` (`lib/routes.ts`) mapping per Global Constraints; `ProgramDetail` (reads `:id` via `useParams`, finds program in `useProgramStore(s=>s.programs)`, renders by `program.type`).
- Behavior: header (name, `TypePill`, `StatusBadge`, redemptions); sections via `ConditionView` (eligibility), `rewardSummaryFor` (discount/reward; referral shows both rewards; loyalty shows trigger event + reward), limits, type extras. If `program.status === 'draft'` → an **Edit** link to `/${typeToSegment(type)}/${id}/edit`; else a muted "Only drafts can be edited" note. Back link to `/${typeToSegment(type)}`. Unknown id → "Program not found" + link home.

- [ ] **Step 1: Failing test**

```tsx
// helper renders ProgramDetail at /promo/:id with a seeded store program
test('shows Edit for a draft and hides it for a non-draft', () => {
  // render with a draft promo id → expect link/button "Edit"
  // render with an active promo id → expect no "Edit", expect "Only drafts can be edited"
});
test('renders eligibility via ConditionView', () => { /* assert a condition variable name appears */ });
```
(Write concrete renders using `MemoryRouter` with `initialEntries={['/promo/<id>']}` and a `<Routes>` containing `<Route path="/promo/:id" element={<ProgramDetail/>} />`; seed the program store in `beforeEach`.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `lib/routes.ts` + `ProgramDetail.tsx` (reuse `ConditionView`, `rewardSummaryFor`, `TypePill`, `StatusBadge`, `PageHeader`). Style with the established card/section classes (match the create-flow review-step look).
- [ ] **Step 4: Wire routes** — in `App.tsx`, inside the `<AppShell>` group add `<Route path="/promo/:id" element={<ProgramDetail/>} />` and the same for `affiliates`/`referrals`/`loyalty`. (Static `/promo`, `/promo/new` keep priority via RR ranking.)
- [ ] **Step 5: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 6: Manual** — visit a draft and an active program detail; confirm Edit visibility + sections.
- [ ] **Step 7: Commit** `git commit -am "feat: read-only ProgramDetail page + detail routes"`

---

## Task 8: Clickable rows → detail

**Files:**
- Modify: `demo/src/pages/Overview.tsx`, `demo/src/pages/_ProgramListPage.tsx`, `demo/src/pages/referral/ReferralList.tsx`
- Test: extend `demo/src/pages/Overview.test.tsx`, `demo/src/pages/ProgramListPage.test.tsx`, `demo/src/pages/referral/ReferralList.test.tsx`

**Interfaces:** Consumes `DataTable.onRowClick` (Task 2), `typeToSegment` (Task 7), `useNavigate`.

- [ ] **Step 1: Failing tests** — for each list, clicking a row navigates to `/<type>/<id>`:

```tsx
test('clicking a promo row navigates to its detail', () => {
  // render PromoList in a MemoryRouter with a route catch that records location
  fireEvent.click(screen.getByText('SUMMER15').closest('tr')!);
  expect(currentPath()).toMatch(/^\/promo\/.+/);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**
  - Overview & `_ProgramListPage`: keep a parallel array of the displayed programs in render order; pass `onRowClick={(i) => navigate(`/${typeToSegment(prog[i].type)}/${prog[i].id}`)}` to `DataTable`.
  - `ReferralList`: each row body `onClick` → `navigate(`/referrals/${p.id}`)`; add `onClick={e => e.stopPropagation()}` (and `onKeyDown` stop) on the **priority number input** and the **drag handle** so they don't trigger navigation; keep drag working.
- [ ] **Step 4: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 5: Manual** — rows navigate; referral priority input + drag still work without navigating.
- [ ] **Step 6: Commit** `git commit -am "feat: clickable program rows navigate to detail"`

---

## Task 9: Edit mode — hook + Promo flow (+ variable picker from store)

**Files:**
- Create: `demo/src/hooks/useProgramEdit.ts`
- Modify: `demo/src/pages/promo/PromoCreate.tsx`, `demo/src/App.tsx` (add `/promo/:id/edit`)
- Test: `demo/src/hooks/useProgramEdit.test.tsx`, extend `demo/src/pages/promo/PromoCreate.test.tsx`

**Interfaces:**
- Produces: `useProgramEdit(expectedType: ProgramType): { editMode: boolean; editing: Program | null }` — reads `:id`; if `id` present and (program missing OR `status!=='draft'`) it `navigate(..., { replace: true })` to the program's detail (if it exists) else the type list, and returns `editing: null`. If `id` present and program is a draft → returns `{ editMode: true, editing }`.

```ts
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProgramStore } from '../data/store';
import { typeToSegment } from '../lib/routes';
import type { Program, ProgramType } from '../lib/types';
export function useProgramEdit(expectedType: ProgramType): { editMode: boolean; editing: Program | null } {
  const { id } = useParams();
  const programs = useProgramStore(s => s.programs);
  const navigate = useNavigate();
  const found = id ? programs.find(p => p.id === id) ?? null : null;
  const isDraft = found?.status === 'draft';
  useEffect(() => {
    if (id && !isDraft) {
      navigate(found ? `/${typeToSegment(found.type)}/${found.id}` : `/${typeToSegment(expectedType)}`, { replace: true });
    }
  }, [id, isDraft, found, expectedType, navigate]);
  return { editMode: Boolean(id && isDraft), editing: id && isDraft ? found : null };
}
```

- [ ] **Step 1: Failing test** (`useProgramEdit.test.tsx`) — a draft id returns `{editMode:true, editing}`; a non-draft id triggers redirect (returns `editing:null`); render a tiny probe component at `/promo/:id/edit` inside `MemoryRouter`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the hook (above).
- [ ] **Step 4: Wire PromoCreate** — call `const { editMode, editing } = useProgramEdit('promo')`. Initialize the step state from `editing` when present (lazy `useState(() => editing ? mapFromProgram(editing) : default)` for each field, or a single `useState` of a draft object seeded from `editing`). Pass the condition-builder variables from `useVariablesStore(s => s.variables)` instead of importing `VARIABLES`. In `buildProgram(status)`, when `editing`, preserve `id: editing.id` and `redemptions: editing.redemptions`. Primary action label = `editMode ? 'Save changes' : 'Create'`; on submit `editMode ? updateProgram(editing!.id, buildProgram('active')) : addProgram(buildProgram('active'))`, then `navigate(editMode ? `/promo/${editing!.id}` : '/promo')`. Save-draft path keeps `status:'draft'` and (edit) preserves id.
- [ ] **Step 5: Add route** — `App.tsx`: `<Route path="/promo/:id/edit" element={<PromoCreate />} />` (full-screen, beside `/promo/new`).
- [ ] **Step 6: Extend PromoCreate.test** — editing a draft prefills (a known field value is shown) and "Save changes" calls `updateProgram` + navigates to `/promo/:id`; create mode unchanged.
- [ ] **Step 7: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 8: Commit** `git commit -am "feat: program edit mode (hook) + Promo edit flow + store-backed variable picker"`

---

## Task 10: Edit mode — Affiliate, Referral, Loyalty (+ pickers/event selector from store)

**Files:**
- Modify: `demo/src/pages/affiliate/AffiliateCreate.tsx`, `demo/src/pages/referral/ReferralCreate.tsx`, `demo/src/pages/loyalty/LoyaltyCreate.tsx`, `demo/src/App.tsx`
- Test: extend each flow's test (or add `*Create.edit.test.tsx`)

**Interfaces:** Consumes `useProgramEdit` (Task 9), `useVariablesStore`, `useEventsStore`.

- [ ] **Step 1: Failing tests** — for each flow, editing its seeded draft prefills and "Save changes" calls `updateProgram` + navigates to the detail; loyalty also: the event selector lists events from `useEventsStore`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — apply the Task-9 pattern to each:
  - `AffiliateCreate`: `useProgramEdit('affiliate')`; prefill incl. `codeCount`; variables from `useVariablesStore`; route `/affiliates/:id/edit`.
  - `ReferralCreate`: `useProgramEdit('referral')`; prefill `referrerReward`/`refereeReward`/`appliesTo`; **preserve `priority`** in `buildProgram` when editing; variables from `useVariablesStore`; route `/referrals/:id/edit`.
  - `LoyaltyCreate`: `useProgramEdit('loyalty')`; prefill `triggerEvent`; **events list from `useEventsStore(s=>s.events)`** (was `EVENTS`); condition variables = selected event payload + user-attr variables from `useVariablesStore`; route `/loyalty/:id/edit`.
  - Add all three `/<type>/:id/edit` routes in `App.tsx`.
- [ ] **Step 4: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: edit mode for affiliate/referral/loyalty + store-backed pickers"`

---

## Task 11: Variables slide-over (VariablePanel)

**Files:**
- Create: `demo/src/components/setup/VariablePanel.tsx`
- Modify: `demo/src/pages/setup/Variables.tsx` (row click + New variable open the panel)
- Test: `demo/src/components/setup/VariablePanel.test.tsx`, extend `Variables.test.tsx`

**Interfaces:**
- Produces: `VariablePanel({ variable: Variable | null; mode: 'view'|'edit'|'create'; onClose: () => void })` — a right slide-over. `view` (system/readOnly) renders fields read-only, no Save. `edit` (user/dynamic) and `create` render editable fields (name, type `<select>`, origin `<select>` excluding system for create, enum values as comma-separated when type=enum, default error message) + Save → `addVariable`/`updateVariable` from `useVariablesStore`, then `onClose`.

- [ ] **Step 1: Failing tests** — system variable opens in read-only (no Save button); a user variable edit saves via `updateVariable`; "New variable" creates via `addVariable`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `VariablePanel.tsx`; wire `Variables.tsx`: clicking a row opens the panel (`mode = variable.readOnly ? 'view' : 'edit'`), "＋ New variable" opens `mode='create'`. Use existing token styling; panel = fixed right drawer + overlay.
- [ ] **Step 4: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 5: Manual** — edit a user var (reflects in table + condition picker); system var read-only; create a var.
- [ ] **Step 6: Commit** `git commit -am "feat: variable detail/edit slide-over (system vars read-only)"`

---

## Task 12: Events in-place edit + New event

**Files:**
- Modify: `demo/src/pages/setup/Events.tsx`
- Test: extend `demo/src/pages/setup/Events.test.tsx`

**Interfaces:** Consumes `useEventsStore` (`addEvent`/`updateEvent`).

- [ ] **Step 1: Failing tests** — clicking **Edit** on the detail pane makes the name/description/fields editable; Save calls `updateEvent` and the change shows; "＋ New event" calls `addEvent` and selects the new event in edit mode.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — add an `editing` state to the detail pane; Edit toggles inputs for name, description, payload fields (name/type/required rows, add/remove field), and sample; Save → `updateEvent(name, patch)`. "＋ New event" → `addEvent({ name:'new_event', description:'', live:false, usedIn:0, fields:[], sample:{} })` then select + edit. Keep the read-only render (incl. the React-span sample payload) for non-edit mode.
- [ ] **Step 4: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: events in-place edit + new event"`

---

## Task 13: Docs

**Files:**
- Modify: `demo/README.md`

- [ ] **Step 1** — add a short "Viewing & editing entries" section: rows are clickable → detail; programs are editable only as drafts (4 seeded drafts under the Drafts filter); Variables/Events are always editable (system vars read-only). Note the detail/edit routes.
- [ ] **Step 2** — `npm run build` from `demo/` succeeds.
- [ ] **Step 3: Commit** `git commit -am "docs: document detail view + draft editing"`

---

## Self-Review (completed by author)

**1. Spec coverage** — PageHeader fix→T1; clickable rows→T2,T8; program detail→T6,T7; draft-only edit + routes→T9,T10; variables store+slide-over→T3,T11; events store+edit→T4,T12; picker/event-selector integration→T9,T10; seed drafts+enrichment→T5; docs→T13. All spec sections covered.

**2. Placeholder scan** — no TBD/TODO; logic tasks (stores, hook, ConditionView, DataTable, PageHeader) carry real code; screen tasks name exact files, props, and reused utilities (not "similar to Task N").

**3. Type consistency** — `useVariablesStore`/`useEventsStore`/`useProgramEdit`/`typeToSegment`/`ConditionView` and the existing `updateProgram`/`addProgram`/`rewardSummaryFor`/`operatorLabel`/`resolveMessage` names are used consistently across tasks; identities are `name` (variables/events) and `id` (programs).
