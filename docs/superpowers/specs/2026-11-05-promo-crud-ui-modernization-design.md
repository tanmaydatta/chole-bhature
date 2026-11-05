# Design Document: Promo CRUD UI Modernization

**Date:** 2026-11-05  
**Topic:** Promo CRUD UI & Styling Modernization  
**Status:** In Review  
**Target File:** `docs/superpowers/specs/2026-11-05-promo-crud-ui-modernization-design.md`  

---

## 1. Intent & The Why

During a live demo flow of the Incentives platform, an operator or stakeholder walks through managing promotional campaigns: viewing active promos, creating a new promotion, configuring tiered reward rules and conditions, reviewing draft revisions, publishing them to production, and controlling promo lifecycles (pausing, resuming, ending).

Currently, while [`LivePromoEditor.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoEditor.tsx) has received the modernized condition builder, [`LivePromoList.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoList.tsx) and [`LivePromoDetail.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoDetail.tsx) render raw, unstyled HTML elements with virtually 0 CSS. Buttons appear as browser default gray rectangular buttons, tables lack boundaries and hover cues, filters are unstyled form controls, and status badges are plain unformatted text.

The intent of this design is to elevate the entire Promo CRUD demo flow to match the polished design system used in other sections of the dashboard (such as `ReferralList` and `ProgramDetail`), creating a unified, professional user experience while preserving all DOM contracts and automated test guarantees.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Design System Consistency:** Seamlessly integrate existing design components ([`PageHeader`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/components/common/PageHeader.tsx), [`StatusBadge`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/components/common/StatusBadge.tsx), CSS theme tokens `--panel`, `--border`, `--accent`, `--ink`, `--muted`, `--hover`) into `LivePromoList` and `LivePromoDetail`.
- **Promo List Elevation ([`LivePromoList.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoList.tsx)):**
  - Use `PageHeader` with title "Promo Codes" and a prominent `＋ New promo` accent button for authorized managers.
  - Interactive status filter tabs or styled select supporting `all`, `draft`, `scheduled`, `active`, `paused`, `ended`.
  - Polished table card container with subtle header borders, zebra hover rows (`hover:bg-[var(--hover)]`), clickable rows, schedule formatting, and `StatusBadge`.
  - Empty state when no programs match the filter.
- **Promo Detail Elevation ([`LivePromoDetail.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoDetail.tsx)):**
  - Polished navigation header with title, `StatusBadge`, and revision badges (`Active revision X`, `Draft revision Y`).
  - Action button bar with distinct variants:
    - Primary accent for `Publish revision`
    - Secondary/outline for `Edit Promo`, `Pause Promo`, `Resume Promo`
    - Destructive/danger for `End Promo`
  - Structured metadata card for promo parameters (Trigger, Priority, Schedule, Code, Stackable).
  - Ordered reward rules styled as clean cards with discount summary chips, rule IDs, and expandable JSON details.
  - Publication review modal with a styled backdrop, clear summary breakdown, and primary `Confirm publish` / neutral `Cancel publication` buttons.
  - Responsive grid layout for comparing Active vs. Draft configurations side-by-side.
- **Test Integrity:** 100% test compatibility with `LiveOperatorJourney.test.tsx` and all existing dashboard tests. Preserves semantic tags (`table`, `tr`, `button`, accessible role/name selectors).

### Non-Goals
- Changing BFF APIs, backend contracts, or database schemas.
- Modifying non-promo routes (`/referrals`, `/loyalty`, `/affiliates`).

### Anti-Goals
- Introducing any heavy external UI libraries (e.g., Bootstrap, Chakra, Material UI).
- Breaking existing screen queries (e.g. changing `tr` table rows into arbitrary `div`s that would break `row.closest('tr')` in `LiveOperatorJourney.test.tsx`).

---

## 3. Constraints

1. **Test Selector Preservation:**
   - Tests in `LiveOperatorJourney.test.tsx` use:
     - `screen.findByText('Gold launch').closest('tr')`
     - `screen.getByRole('button', { name: 'Publish revision' })`
     - `screen.getByRole('button', { name: 'Confirm publish' })`
     - `screen.getByRole('button', { name: 'Cancel publication' })`
     - `screen.getByRole('button', { name: 'Pause Promo' })`
     - `screen.getByRole('button', { name: 'Resume Promo' })`
     - `screen.getByRole('button', { name: 'End Promo' })`
     - `screen.getByRole('dialog')` for the review publication modal
     - `screen.getByRole('link', { name: 'Edit Promo' })`
   All of these accessible queries and elements must remain exactly as named.

2. **Theming & Color Variables:**
   - Must use the dashboard's CSS custom properties:
     - `var(--bg)`: Background
     - `var(--panel)`: Card/Panel background
     - `var(--border)`: Border stroke
     - `var(--ink)`: Primary text
     - `var(--muted)`: Secondary text
     - `var(--accent)`: Primary action color (indigo/blue)
     - `var(--hover)`: Hover highlight
     - `var(--req)` / `var(--req-bg)`: Destructive / Alert colors

---

## 4. Approaches Considered

### Approach 1: Full Alignment with Dashboard Design System (Selected)
- **Description:** Refactor [`LivePromoList.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoList.tsx) and [`LivePromoDetail.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoDetail.tsx) to employ [`PageHeader`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/components/common/PageHeader.tsx), [`StatusBadge`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/components/common/StatusBadge.tsx), styled table containers, card panels, and modal dialogs.
- **Pros:**
  - High aesthetic quality and 100% cohesion with the rest of the application.
  - Zero new dependencies.
  - Strictly preserves existing DOM semantics and test contracts.
- **Cons:** Requires updating ~200 lines across the two files.
- **Decision:** Picked by human partner.

### Approach 2: Standalone Card Grid Layout (No Table)
- **Description:** Discard the `table` on `/promo` and render cards in a multi-column grid.
- **Pros:** Visually distinct.
- **Cons:** Inconsistent with referral/loyalty listing pages; breaks automated tests that rely on table row traversal (`closest('tr')`).

### Approach 3: Minimal Utility Patch
- **Description:** Inject quick inline Tailwind classes onto the bare elements without component abstractions.
- **Pros:** Faster.
- **Cons:** Fragile, inconsistent, leaves code feeling unmaintained.

---

## 5. Detailed Component Specifications

### 5.1 Promo List ([`LivePromoList.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoList.tsx))
- **Container:** `<div className="flex flex-col gap-5">`
- **Header:**
  ```tsx
  <PageHeader
    title="Promo Codes"
    action={canManage ? (
      <Link
        to="/promo/new"
        className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        ＋ New promo
      </Link>
    ) : undefined}
  />
  ```
- **Filter Bar:**
  A styled control row with a filter label and pill/select options for `All`, `Active`, `Scheduled`, `Paused`, `Ended`, `Draft`.
- **Table Card:**
  An enclosed card (`rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden`):
  - `<thead>`: Background `bg-[var(--hover)]`, uppercase/small headers with tracking and padding.
  - `<tbody>`: Rows with `cursor-pointer hover:bg-[var(--hover)] transition-colors border-t border-[var(--border)]`, interactive focus styles, and padding on `<td>`.
  - Cells:
    - **Name:** Bold `text-[14px] text-[var(--ink)]`.
    - **Trigger:** Badge chip for `Automatic` vs `Code-triggered`.
    - **Status:** Rendered via `<StatusBadge status={view.lifecycle.status} />`.
    - **Revision:** Rendered via subtle chips (`bg-[var(--hover)] text-[12px]`).
    - **Schedule:** Formatted text (`text-[13px] text-[var(--muted)]`).
- **Empty State:**
  When `visible.length === 0`: Centered message in a padded card with muted icon and clear guidance.

### 5.2 Promo Detail ([`LivePromoDetail.tsx`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/apps/dashboard/src/pages/promo/LivePromoDetail.tsx))
- **Header:**
  `PageHeader` showing the promo name, with the `Edit Promo` link styled as an outline/secondary action button.
- **Lifecycle Strip:**
  A flex row featuring:
  - `<StatusBadge status={lifecycle.status} />`
  - Revision badges (`Active revision X`, `Draft revision Y`) with subtle pill borders.
- **Action Toolbar:**
  A flex row containing styled action buttons:
  - `Publish revision`: Solid accent button (`bg-[var(--accent)] text-white hover:opacity-90`).
  - `Pause Promo` / `Resume Promo`: Neutral button with hover highlight (`border border-[var(--border)] hover:bg-[var(--hover)]`).
  - `End Promo`: Danger outline button (`border border-rose-300 text-rose-600 hover:bg-rose-50`).
- **Review Publication Dialog:**
  A modal overlay or backdrop card with:
  - `role="dialog"` and `aria-modal="true"`.
  - Header: `<h2>Review publication</h2>`.
  - Clean two-column metadata list of draft parameters.
  - Action footer with `Confirm publish` (accent) and `Cancel publication` (ghost/neutral).
- **Configuration Sections:**
  Structured cards (`rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4`):
  - Parameters in clean definition rows (External reference with monospace code, Trigger, Schedule, Priority, Stackable).
  - Reward rules in cards with numbered headers, discount summary badges, and clean syntax formatting for exact details.
  - Side-by-side grid when both Active and Draft configurations exist.

---

## 6. Verification Plan

1. **Dashboard Unit & Journey Tests:**
   `pnpm --filter @incentives/dashboard test`
   Confirm 41/41 test files and 334 tests pass (especially `LiveOperatorJourney.test.tsx` and `OperatorAccessFlow.test.tsx`).
2. **Dashboard Typecheck & Build:**
   `pnpm --filter @incentives/dashboard build`
3. **Workspace Full Build:**
   `pnpm build`
4. **Staging Deployment & Live Verification:**
   Deploy to Cloudflare Worker `incentives-operator-web-staging` and inspect `https://operator.staging.wastd.dev/promo` and `https://operator.staging.wastd.dev/promo/ref1`.
