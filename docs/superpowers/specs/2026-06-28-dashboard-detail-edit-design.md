# Dashboard Detail & Edit — Design Spec

**Date:** 2026-06-28
**Status:** Approved design → ready for implementation plan
**Extends:** the incentives-dashboard demo (app under `demo/`, on `main` @ `9f3dd07`)

---

## 1. Purpose

Make the demo feel like a real product: **every entry shown in the dashboard is clickable → a detail view**, and entries can be **edited** — with one rule:

- **Programs** (Promo / Affiliate / Referral / Loyalty): editable **only when their status is `draft`**. Active/Scheduled/Paused/Ended programs are **view-only**.
- **Variables** and **Events**: **always editable** (they have no lifecycle), except **system variables (🔒) which stay read-only**.

Plus a bug fix: the `＋ New …` button is misaligned on the Variables and Events screens.

## 2. Scope

**In scope**
- Fix `PageHeader` button alignment (Variables, Events).
- Clickable program rows → read-only detail page at `/<type>/:id`.
- Draft programs: **Edit** → `/<type>/:id/edit` (existing create flow, pre-filled, "Save changes").
- Variables: clickable → slide-over detail/edit (system vars read-only); "＋ New variable" reuses it.
- Events: clickable → detail (existing two-pane) with in-place **Edit** + "＋ New event".
- Convert Variables and Events from static arrays to **in-memory stores** (add/update), wired into the condition-builder variable picker and the loyalty event selector.
- Seed **one draft program per type** (4) with full config + **lightly enrich active seed programs** so read-only details look real.

**Out of scope / non-goals**
- No backend/persistence beyond the existing in-memory + localStorage(theme). New stores reset on reload (matches current behavior).
- No delete/duplicate/status-transition actions (view + edit only).
- No new program types, no validation/required-field gating (consistent with current flows).
- Variables/Events stay non-versioned (no draft concept for them).

## 3. Bug fix — PageHeader alignment

**Cause:** `PageHeader` (`demo/src/components/common/PageHeader.tsx`) is `flex justify-between` but **not `w-full`**. On Variables (`demo/src/pages/setup/Variables.tsx:79`) and Events (`demo/src/pages/setup/Events.tsx:13`) it is wrapped in an extra `<div className="flex items-center justify-between mb-4">`, so as a flex *child* it shrinks to content width and `justify-between` collapses → the button sits next to the title. List pages place it as a block child of a `flex-col`, so they're unaffected.

**Fix:** add `w-full` to `PageHeader`'s root `<div>`; on Variables and Events replace the wrapping `<div className="flex items-center justify-between mb-4">` with a plain `<div className="mb-4">` (or remove the wrapper, keeping a `mb-4` on the header). Verify Overview and list pages still render correctly.

## 4. Routing

| Route | Component | Shell | Notes |
|---|---|---|---|
| `/promo/:id` `/affiliates/:id` `/referrals/:id` `/loyalty/:id` | `ProgramDetail` (shared) | inside AppShell | read-only detail |
| `/promo/:id/edit` … `/loyalty/:id/edit` | the existing `*Create` flow in **edit mode** | full-screen (outside AppShell) | drafts only |
| `/promo/new` … (existing) | `*Create` create mode | full-screen | unchanged |

React Router v6 ranks static segments above dynamic, so `/promo/new` beats `/promo/:id` and `/promo/:id/edit` (more segments) is distinct — but order them new → :id/edit → :id for clarity. Detail routes live inside the `<AppShell>` route group; create/edit routes stay outside it.

## 5. Program detail page (`ProgramDetail`)

**File:** `demo/src/pages/ProgramDetail.tsx` (one shared component; reads `:id` + infers/validates `type` from the route or the program). Looks the program up via `useProgramStore(s => s.programs)`; if not found → friendly "not found" with a link back.

**Layout:** a page header — program name, `TypePill`, `StatusBadge`, redemptions — and read-only sections mirroring that type's create flow:
- **Basics:** name, code (promo/affiliate), auto-apply.
- **Eligibility:** the `ConditionGroup` rendered **read-only** (see §8).
- **Discount / Reward:** `rewardSummaryFor(...)`; referral shows **both** referrer + referee; loyalty shows the reward.
- **Limits & schedule:** budget, per-customer limit, date window, stacking (promo); loyalty shows "no stacking (fixed)".
- **Type extras:** affiliate → code-batch summary (count, uses per code); referral → priority + "applies to"; loyalty → trigger event + payload.

**Edit affordance:** if `program.status === 'draft'`, show a primary **Edit** button → `/<type>/:id/edit`. Otherwise show a muted note like "Only drafts can be edited" (no Edit button). Provide a back link to the type's list.

## 6. Edit mode (reuse the create flows)

Refactor each `*Create.tsx` (`PromoCreate`, `AffiliateCreate`, `ReferralCreate`, `LoyaltyCreate`) to support **both** create and edit:
- Read `:id` via `useParams`. If present → look up the program in the store.
  - If missing **or** `status !== 'draft'` → `navigate` away (to `/<type>/:id` if it exists, else `/<type>`). No editing of non-drafts.
  - Else → **prefill** all step state from the program, set `editMode = true`.
- In edit mode: relabel the primary "Create" action to **"Save changes"**; on submit call `updateProgram(id, {...})` (not `addProgram`) and navigate to `/<type>/:id`. "Save draft" keeps `status:'draft'`.
- In create mode: unchanged behavior.
Keep the shared `buildProgram(status)` helper; in edit mode it preserves the existing `id`/`redemptions`.

## 7. Variables — store + slide-over

- **Store:** `demo/src/data/variablesStore.ts` — Zustand, seeded from the existing `VARIABLES` array, with `variables: Variable[]`, `addVariable(v)`, `updateVariable(name, patch)`. Variable identity = `name` (unique).
- **Variables screen** reads from the store.
- **Slide-over panel** (`demo/src/components/setup/VariablePanel.tsx`): opens when a variable row is clicked or "＋ New variable" is pressed.
  - User/dynamic variable → editable form (name, type, origin, enum values when type=enum, default error message) + **Save** (`updateVariable`).
  - System variable (`readOnly`) → read-only view (no Save), with the 🔒 indicator.
  - New → empty form, **Create** (`addVariable`, origin defaults to user/dynamic — not system).

## 8. Events — store + in-place edit

- **Store:** `demo/src/data/eventsStore.ts` — Zustand, seeded from `EVENTS`, with `events: EventDef[]`, `addEvent(e)`, `updateEvent(name, patch)`. Identity = `name`.
- **Events screen** (`demo/src/pages/setup/Events.tsx`) reads from the store. The detail pane gains an **Edit** toggle that makes the selected event's fields editable (name, description, payload fields [name/type/required], sample) + **Save** (`updateEvent`). "＋ New event" creates a new editable event (`addEvent`) and selects it.

## 9. Shared read-only renderers

To render eligibility on detail pages without the interactive builder, add a small **read-only conditions view** (`demo/src/components/builder/ConditionView.tsx`): for a `ConditionGroup`, list "match ALL/ANY" + each row as `variable-chip operatorLabel(op) value` with the resolved message (`resolveMessage`), origin-colored chips (reusing the `--user/--dyn/--sys` tokens). Reuse `operatorLabel`, `resolveMessage`, `TYPE_META`, `rewardSummaryFor`.

## 10. Picker integration

So newly created/edited config shows up:
- The condition-builder **VariablePicker** receives its variable list from `variablesStore` (the create/edit flows pass `useVariablesStore(...)` instead of the static `VARIABLES`).
- The loyalty **event selector** reads events from `eventsStore`.

## 11. Clickable rows

- **`DataTable`** (`demo/src/components/common/DataTable.tsx`): add optional `onRowClick?: (index: number) => void`; when set, rows get `cursor-pointer`, hover, `role="button"`, and keyboard activation. Overview + the list pages pass a handler mapping the row to its program id → `navigate('/<type>/<id>')`.
- **ReferralList** custom rows: clicking the row body navigates to `/referrals/:id`; the **priority number input** and **drag handle** call `stopPropagation` so they keep working without triggering navigation.
- **Variables** rows → open the slide-over (not a route).
- **Events** list items already select → detail (keep; that's the detail view).

## 12. Seed changes (`demo/src/data/programs.ts`)

- Ensure every seed program has a stable unique `id`.
- Add **one `status:'draft'` program per type** (promo, affiliate, referral, loyalty) with **full config** (eligibility `ConditionGroup`, discount/reward, limits, type extras) so the draft-edit flow prefills meaningfully. They appear under each list's **Drafts** filter.
- **Lightly enrich the active seed programs** with eligibility/discount/limits (+ type extras) so their read-only detail pages are populated, not empty.

## 13. Testing

- `PageHeader` root includes `w-full`; Variables/Events no longer wrap it in a width-collapsing flex (assert button is reachable + header renders).
- Clicking a program row navigates to `/<type>/:id` (Overview + a list page + referral row).
- `ProgramDetail`: renders type sections from a program; a **draft** shows the Edit button, a non-draft does **not**.
- Edit route: with a draft id, the flow prefills (a known field value appears) and "Save changes" calls `updateProgram` + navigates; with a non-draft id it redirects.
- `variablesStore`/`eventsStore`: add + update reflected; VariablePanel saves a user var; a system var renders read-only (no Save); Events edit saves; "New event" adds.
- Picker integration: a variable added to the store appears in the condition-builder picker.

## 14. Open questions
None blocking. (Detail-page section styling reuses the established create-flow visual language; variable enum editing can be a simple comma-separated field.)
