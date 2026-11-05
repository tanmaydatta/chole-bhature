# Promo CRUD UI Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the unstyled HTML screens in the Promo CRUD flow (`LivePromoList.tsx` and `LivePromoDetail.tsx`) to match the operator dashboard's polished design system while preserving all DOM contracts and automated tests.

**Architecture:** Use existing shared components (`PageHeader`, `StatusBadge`), theme custom properties (`--bg`, `--panel`, `--border`, `--accent`, `--ink`, `--muted`, `--hover`), and structured card/table containers. Keep `table`, `tr`, `button`, and `dialog` semantics to guarantee zero breakage for `LiveOperatorJourney.test.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, React Testing Library.

**Spec:** [`docs/superpowers/specs/2026-11-05-promo-crud-ui-modernization-design.md`](file:///Users/tanmay.datta/src/github.com/tanmaydatta/chole-bhature/docs/superpowers/specs/2026-11-05-promo-crud-ui-modernization-design.md)

## Global Constraints

- Must strictly use existing CSS variables (`var(--bg)`, `var(--panel)`, `var(--border)`, `var(--ink)`, `var(--muted)`, `var(--accent)`, `var(--hover)`, `var(--req)`, `var(--req-bg)`).
- Preserve table row semantics (`table > tbody > tr`) on `LivePromoList.tsx` for `closest('tr')` test assertions.
- Preserve exact button names and ARIA roles (`Publish revision`, `Confirm publish`, `Cancel publication`, `Pause Promo`, `Resume Promo`, `End Promo`, `Edit Promo`, `Review publication` dialog).
- 100% test pass across `@incentives/dashboard` (all 41 test files).

## Review Focus

1. **Table row clicking:** Clicking anywhere on a promo row must trigger navigation to `/promo/:id`, while supporting keyboard `Enter` and hover states.
2. **Review publication modal:** Must render with `role="dialog"` and `aria-modal="true"`, preventing background confusion while keeping exact trigger/stackable labels intact.
3. **Empty state:** When filtering by a status that has 0 promotions, display a clean, centered empty state instead of an empty table.
4. **Active vs Draft side-by-side:** When both `activeProgram` and `draftProgram` exist, render a responsive two-column grid (`grid lg:grid-cols-2 gap-4`).
5. **Lifecycle button state guards:** Buttons must only render according to permissions (`canPublish`, `canManage`) and lifecycle state (`draftRevision`, `active`, `paused`, `ended`), preserving the exact authorization behavior.

---

### Task 1: Modernize Promo List UI (`LivePromoList.tsx`)

**Files:**
- Modify: `apps/dashboard/src/pages/promo/LivePromoList.tsx`
- Test: `apps/dashboard/src/pages/promo/LivePromoList.test.tsx` (new unit test suite)

**Interfaces:**
- Consumes: `PageHeader` from `../../components/common/PageHeader`, `StatusBadge` from `../../components/common/StatusBadge`, `programApi` from `../../data/program-api`.
- Produces: Polished `LivePromoList` page component matching `ReferralList` styling.

- [ ] **Step 1: Write unit tests in `LivePromoList.test.tsx`**

Write test verifying that `LivePromoList` renders `PageHeader`, action button `＋ New promo` linking to `/promo/new`, status filter, table with headers, `StatusBadge`, and navigates on row click.

```tsx
// apps/dashboard/src/pages/promo/LivePromoList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, test, expect, vi } from 'vitest';
import LivePromoList from './LivePromoList';

const mockPrograms = [
  {
    configuration: { id: 'promo-1', name: 'Summer Promo', autoApply: true, startDate: '2026-06-01' },
    lifecycle: { programRef: 'promo-1', status: 'active', activeRevision: 1, updatedAt: '2026-06-01' },
  },
  {
    configuration: { id: 'promo-2', name: 'Winter Promo', autoApply: false, code: 'WINTER', startDate: '2026-12-01' },
    lifecycle: { programRef: 'promo-2', status: 'draft', draftRevision: 1, updatedAt: '2026-06-01' },
  },
];

vi.mock('../../data/program-api', () => ({
  programApi: {
    list: vi.fn(async () => ({ programs: mockPrograms })),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (p: string) => p === 'programs:manage',
    handleError: (e: any) => e,
  }),
}));

describe('LivePromoList', () => {
  test('renders page header with action button and styled table', async () => {
    render(
      <MemoryRouter>
        <LivePromoList />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Promo Codes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New promo/i })).toHaveAttribute('href', '/promo/new');
    expect(screen.getByText('Summer Promo')).toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
    expect(screen.getByText('Active revision 1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails or runs against current implementation**

Run: `pnpm --filter @incentives/dashboard test src/pages/promo/LivePromoList.test.tsx`

- [ ] **Step 3: Implement styled `LivePromoList.tsx`**

Update `apps/dashboard/src/pages/promo/LivePromoList.tsx`:
- Import `PageHeader` from `../../components/common/PageHeader`.
- Import `StatusBadge` from `../../components/common/StatusBadge`.
- Replace raw `<h1>` with `<PageHeader title="Promo Codes" action={...} />`.
- Wrap the filter in a styled toolbar container (`flex items-center justify-between gap-4 p-1`).
- Wrap the table in a card container: `rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden shadow-sm`.
- Style table headers: `bg-[var(--hover)] px-4 py-3 text-left text-[11.5px] font-semibold text-[var(--muted)] uppercase tracking-wider`.
- Style table rows: `border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors cursor-pointer group`.
- Style table cells: `px-4 py-3.5 text-[13px] text-[var(--ink)]`.
- Render `StatusBadge` for `view.lifecycle.status`.
- Render subtle chips for revisions: `<span className="inline-flex items-center rounded-full bg-[var(--hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)] border border-[var(--border)]">Active revision {num}</span>`.
- Render empty state card when filtered list is empty.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @incentives/dashboard test src/pages/promo/LivePromoList.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full operator journey tests to verify regression safety**

Run: `pnpm --filter @incentives/dashboard test src/pages/LiveOperatorJourney.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/promo/LivePromoList.tsx apps/dashboard/src/pages/promo/LivePromoList.test.tsx
git commit -m "feat(dashboard): modernize promo list UI with PageHeader and styled table card"
```

---

### Task 2: Modernize Promo Detail & Lifecycle UI (`LivePromoDetail.tsx`)

**Files:**
- Modify: `apps/dashboard/src/pages/promo/LivePromoDetail.tsx`
- Test: `apps/dashboard/src/pages/promo/LivePromoDetail.test.tsx` (new unit test suite)

**Interfaces:**
- Consumes: `PageHeader` from `../../components/common/PageHeader`, `StatusBadge` from `../../components/common/StatusBadge`, `programApi` from `../../data/program-api`.
- Produces: Polished `LivePromoDetail` with structured cards, styled action buttons, and modal dialog.

- [ ] **Step 1: Write unit tests in `LivePromoDetail.test.tsx`**

Write test verifying styled header, lifecycle action buttons, review dialog, and configuration cards.

```tsx
// apps/dashboard/src/pages/promo/LivePromoDetail.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, test, expect, vi } from 'vitest';
import LivePromoDetail from './LivePromoDetail';

const mockProgramView = {
  configuration: {
    id: 'gold-launch',
    name: 'Gold Launch Promo',
    autoApply: false,
    code: 'GOLD20',
    priority: 10,
    stackable: true,
    startDate: '2026-06-01',
    endDate: '2026-12-31',
    rewardRules: [{ id: 'rule-1', name: 'Order discount', reward: { type: 'order_discount', calculation: 'percent', basisPoints: 2000 } }],
  },
  lifecycle: { programRef: 'gold-launch', status: 'draft', draftRevision: 1, updatedAt: '2026-06-01' },
};

vi.mock('../../data/program-api', () => ({
  programApi: {
    get: vi.fn(async () => mockProgramView),
    publish: vi.fn(async () => ({ warnings: [] })),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    handleError: (e: any) => e,
  }),
}));

describe('LivePromoDetail', () => {
  test('renders styled header with edit action and configuration card', async () => {
    render(
      <MemoryRouter initialEntries={['/promo/gold-launch']}>
        <Routes>
          <Route path="/promo/:id" element={<LivePromoDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'Gold Launch Promo' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit Promo' })).toHaveAttribute('href', '/promo/gold-launch/edit');
    expect(screen.getByRole('button', { name: 'Publish revision' })).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('GOLD20')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it executes against current implementation**

Run: `pnpm --filter @incentives/dashboard test src/pages/promo/LivePromoDetail.test.tsx`

- [ ] **Step 3: Implement styled `LivePromoDetail.tsx`**

Update `apps/dashboard/src/pages/promo/LivePromoDetail.tsx`:
- Import `PageHeader` from `../../components/common/PageHeader`.
- Import `StatusBadge` from `../../components/common/StatusBadge`.
- Style header area:
  ```tsx
  <PageHeader
    title={program.name}
    action={canManage && lifecycle.status !== 'ended' ? (
      <Link
        to={`/promo/${encodeURIComponent(id)}/edit`}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-1.5 text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
      >
        Edit Promo
      </Link>
    ) : undefined}
  />
  ```
- Style lifecycle status & revisions banner:
  - `<StatusBadge status={lifecycle.status} />`
  - Active and Draft revision badges with subtle pill borders.
- Style lifecycle action buttons:
  - `Publish revision`: `bg-[var(--accent)] text-white hover:opacity-90 font-semibold px-3.5 py-2 rounded-[8px] text-[13px]`
  - `Pause Promo` / `Resume Promo`: `border border-[var(--border)] bg-[var(--panel)] text-[var(--ink)] hover:bg-[var(--hover)] font-semibold px-3.5 py-2 rounded-[8px] text-[13px]`
  - `End Promo`: `border border-rose-300 text-rose-600 bg-rose-50/50 hover:bg-rose-50 font-semibold px-3.5 py-2 rounded-[8px] text-[13px]`
- Style **Review publication** dialog:
  - `<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">`
  - `<section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-xl space-y-4">`
  - Formatted key-value list with monospace codes.
  - Buttons: `Confirm publish` (accent) and `Cancel publication` (ghost).
- Style `Configuration` component:
  - Container: `rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4`.
  - Header: `text-[15px] font-bold text-[var(--ink)]`.
  - Parameter grid (`grid grid-cols-2 gap-3 text-[13px]`):
    - Keys: `text-[var(--muted)] font-medium`.
    - Values: `text-[var(--ink)] font-semibold` with monospace pills for codes.
  - Ordered reward rules:
    - Card container for each rule (`rounded-[8px] border border-[var(--border)] p-3.5 space-y-2 bg-[var(--bg)]`).
    - Rule name, summary badge, and `<details>` styled with clean code block.
- Side-by-side grid (`grid gap-5 lg:grid-cols-2`) when both `activeProgram` and `draftProgram` exist.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @incentives/dashboard test src/pages/promo/LivePromoDetail.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full operator journey tests to verify regression safety**

Run: `pnpm --filter @incentives/dashboard test src/pages/LiveOperatorJourney.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/promo/LivePromoDetail.tsx apps/dashboard/src/pages/promo/LivePromoDetail.test.tsx
git commit -m "feat(dashboard): modernize promo detail UI with structured cards and modal review dialog"
```

---

### Task 3: Full Verification & Staging Deployment

**Files:**
- Test: Full dashboard and workspace suites
- Deploy: Worker deployment to staging

- [ ] **Step 1: Run full dashboard test suite**

Run: `pnpm --filter @incentives/dashboard test`
Expected: 42/42 test files passed, 335+ tests passed.

- [ ] **Step 2: Run dashboard typecheck and build**

Run: `pnpm --filter @incentives/dashboard build`
Expected: 0 errors, successful Vite bundle generation.

- [ ] **Step 3: Run full workspace build**

Run: `pnpm build`
Expected: All packages build cleanly.

- [ ] **Step 4: Push to origin/dev**

```bash
git push origin dev
```

- [ ] **Step 5: Deploy to staging**

Run: `set -a && . ./.env.staging && set +a && pnpm --filter @incentives/operator-web deploy:staging`
Expected: Worker deployed and bundle hash updated.

- [ ] **Step 6: Live staging verification**

Run curl verification on `https://operator.staging.wastd.dev` to verify HTTP 200 and updated bundle hash.
