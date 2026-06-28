# Incentives Dashboard Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, front-end-only clickable demo of an incentives/promotions dashboard (Promo, Affiliate, Referral, Loyalty + Variables/Events) to validate customer demand.

**Architecture:** A React + TypeScript SPA with in-memory mock data and no backend. Pure logic (message interpolation, error-message resolution, affiliate code/CSV generation) lives in tested `lib/` utilities. Presentational screens are React+Tailwind ports of the approved companion mockups. A light/dark theme is driven by CSS variables. The four program types are presented as four distinct, color-coded sections (the shared engine is hidden).

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router v6, Zustand (in-memory program store), Vitest + React Testing Library.

## Global Constraints

- **No backend / no persistence beyond `localStorage` for theme.** Mock data is in-memory; resetting on reload is acceptable.
- **Light theme is the default;** a working light/dark toggle is in the top bar, persisted to `localStorage`.
- **Visual source of truth:** the approved mockups under `.superpowers/brainstorm/62131-1782649659/content/` — port them faithfully, **including dark mode**:
  - `dashboard-light-v2.html` → Overview + app shell
  - `condition-builder.html` → create-flow shell + condition builder + message editor
  - `affiliate-codes.html` → affiliate "Generate codes" step (CSV download)
  - `referrals-priority-v2.html` → referral priority list + status filter
  - `loyalty-trigger.html` → loyalty trigger/event step
  - `setup-variables.html` → Variables screen
  - `setup-events.html` → Events screen
- **Per-type colors (verbatim):** Promo `#2563eb`, Affiliate `#7c3aed`, Referral `#0891b2`, Loyalty `#d97706`. Accent indigo `#4f46e5` (light) / `#7c83ff` (dark). Variable origins: User=teal `#0891b2`, Dynamic=blue `#2563eb`, System=amber `#d97706`. (Dark-mode variants are defined in the mockups' `:root[data-theme="dark"]` blocks — copy them.)
- **Vertical/narrative:** e-commerce retail; fictional client "Acme Store".
- **Error-message resolution order (everywhere):** per-condition → per-variable default → program fallback → system default.
- **Referral priority:** only `Active`/`Scheduled` programs are ranked; editable number + drag; paused/ended excluded.
- **Loyalty:** reward to wallet, auto-redeem, **no stacking** (fixed rule, not a toggle).
- TypeScript `strict: true`. Each task ends green (`npm run test`, `npm run build`) and is committed.

---

## File Structure

```
src/
  main.tsx, App.tsx, index.css
  theme/ThemeProvider.tsx
  lib/      types.ts, format.ts, interpolate.ts, conditions.ts, codes.ts
  data/     variables.ts, events.ts, programs.ts, store.ts
  components/
    layout/   AppShell.tsx, Sidebar.tsx, TopBar.tsx, ThemeToggle.tsx, ClientSwitcher.tsx
    common/   StatCard.tsx, TypePill.tsx, StatusBadge.tsx, SegmentedFilter.tsx, DataTable.tsx, PageHeader.tsx
    builder/  ConditionBuilder.tsx, ConditionRow.tsx, VariablePicker.tsx, MessageEditor.tsx
    flow/     CreateFlowShell.tsx, StepsRail.tsx
    rewards/  RewardEditor.tsx, DualRewardEditor.tsx
    codes/    CodeGenerator.tsx
  pages/
    Overview.tsx, Analytics.tsx
    promo/{PromoList,PromoCreate}.tsx
    affiliate/{AffiliateList,AffiliateCreate}.tsx
    referral/{ReferralList,ReferralCreate}.tsx
    loyalty/{LoyaltyList,LoyaltyCreate}.tsx
    setup/{Variables,Events}.tsx
```
Tests are co-located as `*.test.ts(x)`.

---

## Phase 0 — Scaffolding & foundation

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `vitest.setup.ts`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: a running Vite dev server and a passing Vitest setup. `App` renders a placeholder.

- [ ] **Step 1: Scaffold Vite React-TS**

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install react-router-dom zustand
npm install -D tailwindcss postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom jsdom
npx tailwindcss init -p
```

- [ ] **Step 2: Configure Tailwind** — set `tailwind.config.ts` `content: ['./index.html','./src/**/*.{ts,tsx}']`, and add `darkMode: ['selector', '[data-theme="dark"]']`. Replace `src/index.css` top with `@tailwind base; @tailwind components; @tailwind utilities;` (CSS variable theme tokens added in Task 2).

- [ ] **Step 3: Configure Vitest** — in `vite.config.ts` add:

```ts
/// <reference types="vitest" />
test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true }
```
Create `vitest.setup.ts` with `import '@testing-library/jest-dom';`. Add scripts to `package.json`: `"test": "vitest run"`, `"test:watch": "vitest"`, `"build": "tsc -b && vite build"`.

- [ ] **Step 4: Write the smoke test** (`src/App.test.tsx`):

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';
test('renders app placeholder', () => {
  render(<App />);
  expect(screen.getByText(/Incentives/i)).toBeInTheDocument();
});
```

- [ ] **Step 5: Minimal `App.tsx`** — `export default function App(){ return <div>◆ Incentives</div>; }`

- [ ] **Step 6: Run** `npm run test` (PASS) and `npm run build` (succeeds).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite react-ts + tailwind + vitest"
```

---

### Task 2: Theme system (light default + dark toggle, persisted)

**Files:**
- Create: `src/theme/ThemeProvider.tsx`
- Modify: `src/index.css` (add `:root` light tokens + `[data-theme="dark"]` tokens — copy the variable sets from any mockup's `<style>` `:root` blocks)
- Test: `src/theme/ThemeProvider.test.tsx`

**Interfaces:**
- Produces: `ThemeProvider` (wraps app, sets `document.documentElement[data-theme]`), `useTheme(): { theme: 'light'|'dark'; toggle: () => void }`. Default `'light'`; persists to `localStorage['theme']`.

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';
function Probe(){ const { theme, toggle } = useTheme(); return <button onClick={toggle}>{theme}</button>; }
test('defaults to light and toggles + persists', () => {
  render(<ThemeProvider><Probe/></ThemeProvider>);
  expect(screen.getByRole('button')).toHaveTextContent('light');
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('button')).toHaveTextContent('dark');
  expect(localStorage.getItem('theme')).toBe('dark');
});
```

- [ ] **Step 2: Run** → FAIL (no module).

- [ ] **Step 3: Implement `ThemeProvider.tsx`**

```tsx
import { createContext, useContext, useEffect, useState } from 'react';
type Theme = 'light' | 'dark';
const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'light');
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); }, [theme]);
  return <Ctx.Provider value={{ theme, toggle: () => setTheme(t => (t === 'light' ? 'dark' : 'light')) }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
```

- [ ] **Step 4: Add CSS tokens** to `src/index.css` — copy the `:root{…}` and `html[data-theme="dark"]{…}` variable blocks from `dashboard-light-v2.html` (bg, panel, ink, muted, faint, border, hover, accent, accent-soft, per-type + per-type-bg, green, shadow). These become the shared palette.

- [ ] **Step 5: Run test** → PASS.

- [ ] **Step 6: Commit** `git commit -am "feat: theme provider with persisted light/dark"`

---

### Task 3: App shell — sidebar, top bar, routing skeleton

**Files:**
- Create: `src/components/layout/{AppShell,Sidebar,TopBar,ThemeToggle,ClientSwitcher}.tsx`
- Modify: `src/App.tsx` (Router + routes to placeholder pages), `src/main.tsx` (wrap in `ThemeProvider` + `BrowserRouter`)
- Test: `src/components/layout/Sidebar.test.tsx`

**Interfaces:**
- Produces: `<AppShell/>` rendering `Sidebar` + `TopBar` + `<Outlet/>`. `Sidebar` nav groups: Overview; **Incentives**(Promo Codes, Affiliates, Referrals, Loyalty); **Setup**(Variables, Events); **Insights**(Analytics). Routes: `/`, `/promo`, `/affiliates`, `/referrals`, `/loyalty`, `/variables`, `/events`, `/analytics` (+ create routes added later). `TopBar` props: `{ title: string }`.

- [ ] **Step 1: Failing test** — render `Sidebar` inside `MemoryRouter`; assert all eight nav labels present and the four type colors applied (assert links exist by role/name).

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
test('sidebar shows all sections', () => {
  render(<MemoryRouter><Sidebar/></MemoryRouter>);
  ['Overview','Promo Codes','Affiliates','Referrals','Loyalty','Variables','Events','Analytics']
    .forEach(l => expect(screen.getByText(l)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `Sidebar` (port nav markup/classes from `dashboard-light-v2.html` `.side`, using `NavLink` with active styling and per-type icon colors), `TopBar` (title + `ThemeToggle` + `ClientSwitcher` "Acme Store"), `ThemeToggle` (uses `useTheme`, 🌙/☀️), `AppShell` (flex layout + `<Outlet/>`). Use Tailwind classes backed by the CSS variables (e.g. `bg-[var(--panel)]`).

- [ ] **Step 4: Wire routing** in `App.tsx` — `<Routes>` with `AppShell` as layout route and placeholder `<div>` pages for each path. `main.tsx` wraps `<ThemeProvider><BrowserRouter><App/></BrowserRouter></ThemeProvider>`.

- [ ] **Step 5: Run** test (PASS) + `npm run build`.

- [ ] **Step 6: Manual check** — `npm run dev`; sidebar + topbar render, theme toggle flips light/dark across the shell, nav routes change the placeholder.

- [ ] **Step 7: Commit** `git commit -am "feat: app shell, sidebar nav, routing skeleton"`

---

## Phase 1 — Domain types, mock data & tested logic

### Task 4: Domain types & seeded mock data

**Files:**
- Create: `src/lib/types.ts`, `src/data/{variables,events,programs}.ts`
- Test: `src/data/data.test.ts`

**Interfaces (produced — later tasks rely on these exact names/types):**

```ts
// types.ts
export type Origin = 'user' | 'dynamic' | 'system';
export type VarType = 'string' | 'number' | 'boolean' | 'enum' | 'date';
export interface Variable { name: string; type: VarType; origin: Origin; enumValues?: string[]; defaultMessage?: string; readOnly?: boolean; }
export type Operator = 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'between'|'is';
export interface Condition { id: string; variable: string; operator: Operator; value: string | string[]; message?: string; }
export interface ConditionGroup { match: 'ALL' | 'ANY'; conditions: Condition[]; groups?: ConditionGroup[]; }
export type ProgramType = 'promo' | 'affiliate' | 'referral' | 'loyalty';
export type Status = 'draft' | 'scheduled' | 'active' | 'paused' | 'ended';
export interface Reward { kind: 'percent'|'fixed'|'free_shipping'|'points'|'credit'; value?: number; }
export interface EventField { name: string; type: VarType; required: boolean; }
export interface EventDef { name: string; description: string; live: boolean; usedIn: number; fields: EventField[]; sample: Record<string, string>; }
export interface Program {
  id: string; name: string; type: ProgramType; status: Status;
  rewardSummary: string; redemptions: number;
  // type-specific (optional): code, autoApply, stackable, eligibility, discount,
  // codeCount, referrerReward, refereeReward, priority, triggerEvent, fallbackMessage…
  [k: string]: unknown;
}
export const TYPE_META: Record<ProgramType, { label: string; color: string; bg: string; icon: string }>; // verbatim colors from Global Constraints
```

- [ ] **Step 1: Failing test** — assert seeded data integrity:

```ts
import { VARIABLES } from './variables'; import { EVENTS } from './events'; import { PROGRAMS } from './programs';
test('variables cover all three origins incl. system read-only', () => {
  expect(VARIABLES.some(v => v.origin === 'system' && v.readOnly)).toBe(true);
  expect(new Set(VARIABLES.map(v => v.origin))).toEqual(new Set(['user','dynamic','system']));
});
test('seed has all four program types', () => {
  expect(new Set(PROGRAMS.map(p => p.type))).toEqual(new Set(['promo','affiliate','referral','loyalty']));
});
test('order_completed event exposes payload fields', () => {
  expect(EVENTS.find(e => e.name === 'order_completed')!.fields.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `types.ts` (above) + `TYPE_META`. Seed `variables.ts` (the full §7.1 set incl. system vars with `defaultMessage`s from `setup-variables.html`), `events.ts` (order_completed, review_submitted, subscription_renewed, signup_completed — fields + sample from `setup-events.html`/`loyalty-trigger.html`), `programs.ts` (the Acme programs from `dashboard-light-v2.html` + referral set from `referrals-priority-v2.html`).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: domain types + seeded mock data"`

---

### Task 5: Message interpolation utility

**Files:** Create `src/lib/format.ts`, `src/lib/interpolate.ts`; Test `src/lib/interpolate.test.ts`

**Interfaces:**
- Produces: `money(n: number): string` (→ `"$12"`/`"$12.50"`); `renderMessage(template: string, ctx: Record<string, number|string>): string` — resolves `{{ expr | filter }}` where `expr` supports `var`, numeric literals, and `a − b` / `a - b` subtraction; supported filter: `money`. Unknown vars render as empty; malformed tokens render literally.

- [ ] **Step 1: Failing test**

```ts
import { renderMessage } from './interpolate';
test('interpolates subtraction with money filter', () => {
  expect(renderMessage('Add {{ 50 − basket_value | money }} more', { basket_value: 38 }))
    .toBe('Add $12 more');
});
test('plain variable substitution', () => {
  expect(renderMessage('Hi {{ customer_tier }}', { customer_tier: 'gold' })).toBe('Hi gold');
});
test('leaves text without tokens untouched', () => {
  expect(renderMessage('No tokens here', {})).toBe('No tokens here');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `format.ts` (`money`) and `interpolate.ts` (regex `/\{\{([^}]+)\}\}/g`; split on `|` for filter; parse expr: if it contains `−`/`-` between two operands, compute `Number(left)-Number(right)` resolving each operand from `ctx` or as a literal; else resolve single operand; apply `money` filter when present).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: message interpolation + money filter"`

---

### Task 6: Error-message resolution

**Files:** Create `src/lib/conditions.ts`; Test `src/lib/conditions.test.ts`

**Interfaces:**
- Produces: `OPERATORS_BY_TYPE: Record<VarType, Operator[]>`; `operatorLabel(op: Operator): string` (e.g. `gte`→`'≥'`, `in`→`'is any of'`); `resolveMessage(condition: Condition, variable: Variable, programFallback?: string): string` implementing **condition → variable.defaultMessage → programFallback → system default** (`"This code isn't valid for your order."`).

- [ ] **Step 1: Failing test**

```ts
import { resolveMessage, operatorLabel } from './conditions';
const v = { name:'budget_remaining', type:'number', origin:'system', defaultMessage:'Offer ended' } as const;
test('falls back to variable default then program then system', () => {
  expect(resolveMessage({ id:'1', variable:'budget_remaining', operator:'gt', value:'0' }, v))
    .toBe('Offer ended');
  expect(resolveMessage({ id:'1', variable:'x', operator:'gt', value:'0' }, { ...v, defaultMessage: undefined }, 'Prog msg'))
    .toBe('Prog msg');
  expect(resolveMessage({ id:'1', variable:'x', operator:'gt', value:'0', message:'Row msg' }, v)).toBe('Row msg');
});
test('operator label maps gte to ≥', () => { expect(operatorLabel('gte')).toBe('≥'); });
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `conditions.ts` per interfaces.

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: error-message resolution + operator metadata"`

---

### Task 7: Affiliate code & CSV generation

**Files:** Create `src/lib/codes.ts`; Test `src/lib/codes.test.ts`

**Interfaces:**
- Produces: `generateCodes(opts: { prefix: string; length: number; count: number }): string[]` (unique, charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`); `previewExample(prefix: string, length: number): string`; `toCSV(codes: string[], usesLeft: number|'∞'): string` (header `code,status,uses_left`); `downloadCSV(filename: string, csv: string): void` (Blob + anchor click).

- [ ] **Step 1: Failing test**

```ts
import { generateCodes, toCSV } from './codes';
test('generates the requested count of unique codes with prefix', () => {
  const codes = generateCodes({ prefix:'ACME-', length:5, count:500 });
  expect(codes).toHaveLength(500);
  expect(new Set(codes).size).toBe(500);
  expect(codes.every(c => c.startsWith('ACME-') && c.length === 10)).toBe(true);
});
test('CSV has header + one row per code', () => {
  const csv = toCSV(['ACME-AAAAA'], 1);
  expect(csv.split('\n')[0]).toBe('code,status,uses_left');
  expect(csv).toContain('ACME-AAAAA,unused,1');
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `codes.ts` (loop with a `Set` to guarantee uniqueness; `downloadCSV` guards `typeof document !== 'undefined'`).

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Commit** `git commit -am "feat: affiliate code + CSV generation"`

---

### Task 8: In-memory program store

**Files:** Create `src/data/store.ts`; Test `src/data/store.test.ts`

**Interfaces:**
- Produces: Zustand `useProgramStore` with `{ programs: Program[]; addProgram(p): void; updateProgram(id, patch): void; setReferralPriority(orderedIds: string[]): void; byType(type): Program[]; }`. Seeded from `PROGRAMS`.

- [ ] **Step 1: Failing test** — add a program, assert `byType('promo')` includes it; reorder referral ids, assert `priority` reflects new index+1.

- [ ] **Step 2: Run** → FAIL. **Step 3:** implement store (vanilla zustand, seed in initializer). **Step 4:** Run → PASS. **Step 5:** Commit `git commit -am "feat: in-memory program store"`

---

## Phase 2 — Shared UI components

### Task 9: Common presentational primitives

**Files:** Create `src/components/common/{StatCard,TypePill,StatusBadge,SegmentedFilter,DataTable,PageHeader}.tsx`; Test `src/components/common/common.test.tsx`

**Interfaces:**
- `StatCard({ label, value, delta?, bar? })`; `TypePill({ type })` (uses `TYPE_META`); `StatusBadge({ status })` (green active / grey paused-ended / accent scheduled); `SegmentedFilter({ options:{label,count?}[], value, onChange })`; `DataTable({ columns, rows })`; `PageHeader({ title, action? })`.

- [ ] **Step 1: Failing test** — render `TypePill type="promo"` → text "Promo" + blue; `StatusBadge status="paused"` → "Paused"; `SegmentedFilter` click fires `onChange`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement, porting pill/badge/segment classes from the mockups (`.pill .p-promo`, `.st`, `.seg`). **Step 4:** Run → PASS. **Step 5:** Commit `git commit -am "feat: common UI primitives"`

---

### Task 10: Condition builder (the hero) + message editor + variable picker

**Files:** Create `src/components/builder/{ConditionBuilder,ConditionRow,VariablePicker,MessageEditor}.tsx`; Test `src/components/builder/ConditionBuilder.test.tsx`

**Reference:** `condition-builder.html` (markup, classes, picker grouping, message box, live preview).

**Interfaces:**
- `ConditionBuilder({ value: ConditionGroup, variables: Variable[], onChange })` — match ALL/ANY selector; list of `ConditionRow`; "＋ Add condition" opens `VariablePicker`; "＋ Add nested group".
- `ConditionRow({ condition, variable, onChange, onRemove })` — variable chip (origin color), operator select (`OPERATORS_BY_TYPE`), value control by type, and a `MessageEditor` toggle.
- `VariablePicker({ variables, onPick })` — search + three origin groups (color swatches), from `setup-variables.html`/picker in `condition-builder.html`.
- `MessageEditor({ condition, variable, onChange })` — textarea with the inherited-default shown as placeholder (`resolveMessage`), "Insert" chips, and a **live preview** via `renderMessage` against a sample context `{ basket_value: 38, ... }`.

- [ ] **Step 1: Failing tests**
  - add condition via picker appends a row;
  - typing a per-condition message updates preview text via `renderMessage`;
  - a row with no message shows the variable's default as placeholder/inherited hint;
  - switching ALL/ANY calls `onChange` with new `match`.

```tsx
// sketch
fireEvent.click(screen.getByText('＋ Add condition'));
fireEvent.click(screen.getByText('basket_value'));
expect(screen.getByText(/basket_value/)).toBeInTheDocument();
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the four components (controlled, driven by `onChange`); operator/value adapt to `variable.type`; preview uses `renderMessage`. Port styling from `condition-builder.html`.
- [ ] **Step 4:** Run → PASS; `npm run build`.
- [ ] **Step 5: Manual check** — mount in a scratch route: add/remove rows, switch ALL/ANY, edit a message and watch the preview update, open the picker and pick from each origin.
- [ ] **Step 6:** Commit `git commit -am "feat: condition builder + message editor + variable picker"`

---

### Task 11: Create-flow shell + reward editors

**Files:** Create `src/components/flow/{CreateFlowShell,StepsRail}.tsx`, `src/components/rewards/{RewardEditor,DualRewardEditor}.tsx`; Test `src/components/flow/CreateFlowShell.test.tsx`

**Reference:** `condition-builder.html` (top bar + steps rail + form card), `loyalty-trigger.html` (amber rail).

**Interfaces:**
- `CreateFlowShell({ typeMeta, steps: {key,label}[], activeStep, onStep, onCancel, onSaveDraft, children, footer })` — focused page: top bar (back, type pill, Save draft / Continue) + `StepsRail` (done ✓ / active / upcoming, type-colored active) + form card.
- `RewardEditor({ value: Reward, onChange })` — kind select (percent/fixed/free_shipping/points/credit) + value.
- `DualRewardEditor({ referrer, referee, onChange })` — two `RewardEditor`s labeled Referrer/Referee.

- [ ] **Step 1: Failing test** — render shell with 5 steps; clicking step 3 fires `onStep('discount')`; active step has type color.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement. **Step 4:** Run → PASS. **Step 5:** Commit `git commit -am "feat: create-flow shell + reward editors"`

---

## Phase 3 — Screens

> Each screen task: port the referenced mockup into the page using the shared components + store; add a render smoke test (renders without crashing, key labels present); finish with a manual checklist + commit.

### Task 12: Overview page

**Files:** Create `src/pages/Overview.tsx`; Modify `App.tsx` route `/`; Test `src/pages/Overview.test.tsx`
**Reference:** `dashboard-light-v2.html`.

- [ ] **Step 1: Failing test** — renders 3 `StatCard`s (Active programs, Redemptions (30d), Incentive spend (30d) with budget bar) and the programs `DataTable` with type pills + status; "＋ New program" present.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement using `useProgramStore`, `StatCard`, `DataTable`, `TypePill`, `StatusBadge`. **Step 4:** Run → PASS. **Step 5: Manual** — table rows match seed; budget bar shows 64%. **Step 6:** Commit `git commit -am "feat: overview page"`

---

### Task 13: Generic program list page + Promo/Affiliate/Loyalty lists

**Files:** Create `src/pages/_ProgramListPage.tsx` (shared), `src/pages/promo/PromoList.tsx`, `src/pages/affiliate/AffiliateList.tsx`, `src/pages/loyalty/LoyaltyList.tsx`; Modify `App.tsx`; Test `src/pages/ProgramListPage.test.tsx`

**Interfaces:** `_ProgramListPage({ type })` — `PageHeader` + `SegmentedFilter` (Active/Scheduled/Paused/Ended/Drafts/All, default Active, with counts) + `DataTable`; filters `useProgramStore().byType(type)` by status. The three list pages are thin wrappers passing `type`.

- [ ] **Step 1: Failing test** — for `type="promo"`, default shows only Active rows; switching filter to "All" shows paused too; counts reflect seed.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement. **Step 4:** Run → PASS. **Step 5: Manual** — filters work on all three lists. **Step 6:** Commit `git commit -am "feat: program list pages + status filter"`

---

### Task 14: Promo create flow

**Files:** Create `src/pages/promo/PromoCreate.tsx`; Modify `App.tsx` route `/promo/new`; Test `src/pages/promo/PromoCreate.test.tsx`
**Reference:** `condition-builder.html`.

Steps in the flow: **Basics** (name, code, auto-apply) → **Eligibility** (`ConditionBuilder`) → **Discount** (`RewardEditor`) → **Limits & schedule** (budget, per-customer limit, date window, **stacking allowed** toggle) → **Review**. On "Create", `addProgram(...)` (optimistic) + toast + navigate to `/promo`.

- [ ] **Step 1: Failing test** — flow renders with steps rail; Eligibility step mounts `ConditionBuilder`; Review → "Create" calls store `addProgram` and navigates.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement (local React state for the draft; `CreateFlowShell` + step bodies). **Step 4:** Run → PASS. **Step 5: Manual** — walk all five steps; create appends to the Promo list. **Step 6:** Commit `git commit -am "feat: promo create flow"`

---

### Task 15: Affiliate create flow (working CSV)

**Files:** Create `src/pages/affiliate/AffiliateCreate.tsx`, `src/components/codes/CodeGenerator.tsx`; Modify `App.tsx` route `/affiliates/new`; Test `src/components/codes/CodeGenerator.test.tsx`
**Reference:** `affiliate-codes.html`.

Adds a **Generate codes** step (count, uses-per-code, pattern → live example) using `generateCodes`; preview first 8 + "+N more"; **Download CSV** via `toCSV`/`downloadCSV`.

- [ ] **Step 1: Failing test** — set count 25, click Generate → preview renders 8 rows + "+ 17 more"; Download button enabled and calls a (mocked) `downloadCSV` with a CSV containing 25 data rows.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement `CodeGenerator` (uses `lib/codes`) + embed in the affiliate flow (Basics → Eligibility → Discount → **Generate codes** → Limits & schedule → Review). **Step 4:** Run → PASS. **Step 5: Manual** — real CSV downloads. **Step 6:** Commit `git commit -am "feat: affiliate create flow + working CSV download"`

---

### Task 16: Referral list (priority) + create flow

**Files:** Create `src/pages/referral/{ReferralList,ReferralCreate}.tsx`; Modify `App.tsx`; Test `src/pages/referral/ReferralList.test.tsx`
**Reference:** `referrals-priority-v2.html`.

`ReferralList`: status filter; **ranked section** (Active/Scheduled only) with drag-to-reorder + editable priority number (calls `setReferralPriority`) + `⋮`; below a "Not ranked · excluded from matching" divider for paused/ended; rows show **both** rewards + "applies to" chips. `ReferralCreate`: Basics → Eligibility → **Rewards** (`DualRewardEditor`) → Limits & schedule → Review.

- [ ] **Step 1: Failing test** — only Active/Scheduled appear in the ranked list; reordering (simulate via the number input change) renumbers priorities through the store; paused row appears under the divider.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement (HTML5 drag per mockup JS, ported to React state + store; number input commits priority). **Step 4:** Run → PASS. **Step 5: Manual** — drag reorders + renumbers; paused/ended below divider. **Step 6:** Commit `git commit -am "feat: referral priority list + create flow"`

---

### Task 17: Loyalty create flow + list

**Files:** Create `src/pages/loyalty/LoyaltyCreate.tsx`; Modify `App.tsx`; Test `src/pages/loyalty/LoyaltyCreate.test.tsx`
**Reference:** `loyalty-trigger.html`.

Steps: Basics → **Trigger** (event select → payload variables swap from `EVENTS`; "always available" user attrs; 🎁 reward preview; 💡 wallet/auto-redeem/**no-stacking** banner) → **Conditions** (`ConditionBuilder` over payload+user vars) → **Reward** (`RewardEditor` points/credit) → Review. (Loyalty list reuses `_ProgramListPage type="loyalty"` from Task 13.)

- [ ] **Step 1: Failing test** — selecting `review_submitted` swaps payload chips to rating/product_id/has_photo; no-stacking banner present.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement (event payload from `EVENTS`; conditions get event fields as `dynamic`-origin variables + user attrs). **Step 4:** Run → PASS. **Step 5: Manual** — event swap works; create appends to Loyalty list. **Step 6:** Commit `git commit -am "feat: loyalty create flow"`

---

### Task 18: Setup → Variables screen

**Files:** Create `src/pages/setup/Variables.tsx`; Modify `App.tsx` route `/variables`; Test `src/pages/setup/Variables.test.tsx`
**Reference:** `setup-variables.html`.

Grouped table by origin (User/Dynamic/System), filter segments, columns: type, origin badge, **default error message**, used-in; system rows read-only (🔒).

- [ ] **Step 1: Failing test** — renders the three origin group headers; a system var shows 🔒 and "auto"; a user var shows its default message.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement from `VARIABLES`. **Step 4:** Run → PASS. **Step 5:** Commit `git commit -am "feat: setup variables screen"`

---

### Task 19: Setup → Events screen

**Files:** Create `src/pages/setup/Events.tsx`; Modify `App.tsx` route `/events`; Test `src/pages/setup/Events.test.tsx`
**Reference:** `setup-events.html`.

Two-pane: event list (click to select) + detail (payload schema table "→ variable", sample payload + `POST /v1/events/<name>`).

- [ ] **Step 1: Failing test** — clicking `subscription_renewed` swaps the detail to its fields (plan/term_months/mrr) and updates the sample payload heading.
- [ ] **Step 2:** Run → FAIL. **Step 3:** implement from `EVENTS`. **Step 4:** Run → PASS. **Step 5: Manual** — selection swaps detail. **Step 6:** Commit `git commit -am "feat: setup events screen"`

---

### Task 20: Analytics placeholder

**Files:** Create `src/pages/Analytics.tsx`; Modify `App.tsx` route `/analytics`; Test `src/pages/Analytics.test.tsx`

Light placeholder: a few `StatCard`s + simple bar stubs + an "Insights coming soon" note (explicitly shallow per spec §9/§12).

- [ ] **Step 1: Failing test** — renders heading "Analytics" + ≥1 StatCard. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `git commit -am "feat: analytics placeholder"`

---

## Phase 4 — Wiring & polish

### Task 21: Entry points, toasts, empty states, route finalize

**Files:** Modify list pages + `App.tsx`; add a tiny toast util/component; Test `src/pages/Overview.test.tsx` (extend)

Wire every "＋ New …" / "＋ New program" to its create route; optimistic "Saved" toast on create; empty-state copy for filtered lists with no rows; ensure all sidebar links route correctly.

- [ ] **Step 1: Failing test** — Overview "＋ New program" navigates to a chooser (or directly to `/promo/new` for the demo) ; list with filter yielding 0 shows empty state.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + `npm run build`. **Step 5: Manual** — full click-through of all flows. **Step 6:** Commit `git commit -am "feat: wire entry points, toasts, empty states"`

---

### Task 22: README + docs

**Files:** Create `README.md`; Modify nothing else.

Document: what the demo is, how to run (`npm install`, `npm run dev`, `npm run test`, `npm run build`), the four program types, where mock data lives, and the explicit non-goals (no backend). Per user's doc rule, this ships with the build.

- [ ] **Step 1:** Write `README.md`. **Step 2:** `npm run build` succeeds. **Step 3:** Commit `git commit -am "docs: add README for incentives demo"`

---

## Self-Review (completed by author)

**1. Spec coverage** — every spec section maps to a task: IA/shell→T3; theming→T2; variables/3 origins/system→T4,T18; conditions+hybrid messages+interpolation→T5,T6,T10; rewards→T11; events→T4,T19; lifecycle/status→T4,T13; Promo→T14; Affiliate+CSV→T7,T15; Referral dual-reward+priority→T16; Loyalty event/no-stacking→T17; Overview→T12; Analytics→T20; tangible interactions→T2,T10,T15,T16,T17; mock data→T4; non-goals respected (no backend tasks). No gaps.

**2. Placeholder scan** — no TBD/TODO; logic tasks contain real test+impl code; screen tasks cite the authoritative mockup + shared components by exact name (not "similar to Task N").

**3. Type consistency** — names are defined once in T4 (`Program`, `Condition`, `ConditionGroup`, `Variable`, `EventDef`, `Reward`, `TYPE_META`) and reused verbatim; util signatures (`renderMessage`, `resolveMessage`, `generateCodes`, `toCSV`, `setReferralPriority`, `byType`) are consistent across consuming tasks.
