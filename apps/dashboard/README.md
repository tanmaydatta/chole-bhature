# Incentives Dashboard

The authenticated operator dashboard uses the same-origin Operator BFF for
live tenant workflows. Promo authoring, Variables, Customers, administration
and the Evaluation Playground use server data. Future-module and analytics
demo surfaces retain in-memory data that resets on reload; the theme
preference is stored in `localStorage`.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev:local                           # ordinary local Workers and operator assets
pnpm --filter @incentives/dashboard test # dashboard Vitest
CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local # disposable local API/browser suite
```

Run the commands above from the repository root with the pinned Node/pnpm and
browser installed. A standalone Vite preview serves assets but does not supply
the authenticated BFF.

## Evaluation Playground

Open **Evaluation Playground** in the sidebar or `/playground` after signing
in with `evaluations:run` and selecting a client when using ROOT access. A
published schema is required. Enter stable line/product references, quantity,
integer unit-price minor units and currency, plus optional customer reference
and Promo codes. Published context/cart/line fields use typed inputs; stored
customer attributes are resolved by Core.

The result shows authoritative decisions and revisions, code-specific reasons,
per-Promo/per-line allocations, total discount, discounted merchandise
subtotal, versions and expiry. Input changes clear the result. Evaluation
persists a signed snapshot without redeeming or spending budgets/counters.
Totals exclude tax, shipping charges and payment totals; free shipping has no
merchandise saving. Follow [Evaluate a basket in the Playground](../../docs/integration/evaluation-playground.md)
for prerequisites and an exact-price example.

## Original demo surfaces

The following retained descriptions concern the original demo components.
The live Promo, Variables and Customer routes use the authenticated server
workflows above rather than the original in-memory editors.

## The four program types

- **Promo Codes** — single shared codes (e.g. `SUMMER15`) with optional auto-apply and stacking rules.
- **Affiliates** — bulk-generated unique codes exported as a codes-only CSV (one `code` per line); each code is independently trackable.
- **Referrals** — dual rewards (referrer + referee), priority-ranked so the highest-priority eligible program wins; drag-to-reorder supported.
- **Loyalty** — event-triggered reward programs (e.g. points back on `order_completed`); no stacking within the same event.

## Core building blocks

**Variables** have three origins:
- `user` — customer attributes resolved at evaluation time (e.g. `customer_tier`, `first_purchase`).
- `dynamic` — request-time context such as basket value or category.
- `system` — read-only counters and limits managed by the platform (e.g. `budget_remaining`, `redemptions_total`).

**Condition builder** — an interactive AND/ANY rule builder where each condition row picks a variable, operator, and value. Error messages support `{{variable|filter}}` interpolation (e.g. `"You need {{basket_value - minimum|money}} more to qualify"`). Hybrid error messages merge a per-condition override with the variable's default, so the most specific message always wins.

**Events** — named event definitions (e.g. `order_completed`, `review_submitted`) with typed payload fields. The Loyalty create flow lets you swap the trigger event; payload fields become available as condition variables immediately.

**Program lifecycle** — programs move through `draft → scheduled → active → paused → ended`. List views have a segmented filter (Active / Scheduled / Paused / Ended / Drafts / All) with live badge counts.

## Project layout

```
apps/dashboard/src/
  pages/
    Overview.tsx             # cross-program stat summary
    Analytics.tsx            # shallow chart placeholders
    _ProgramListPage.tsx     # shared list-page shell
    ProgramDetail.tsx        # shared detail page (all program types; affiliate: Codes panel)
    promo/                   # PromoList, PromoCreate
    playground/              # live evaluate-only page and canonical basket builder
    affiliate/               # AffiliateList, AffiliateCreate
    referral/                # ReferralList, ReferralCreate
    loyalty/                 # LoyaltyList, LoyaltyCreate
    setup/
      Variables.tsx          # variable catalogue
      Events.tsx             # event catalogue

  components/
    layout/    AppShell, Sidebar, TopBar, ThemeToggle, ClientSwitcher
    common/    DataTable, PageHeader, SegmentedFilter, StatCard, StatusBadge, Toast, TypePill
    builder/   ConditionBuilder, ConditionRow, MessageEditor, VariablePicker
    flow/      CreateFlowShell, StepsRail
    rewards/   RewardEditor, DualRewardEditor
    codes/     CodeGenerator

  lib/
    types.ts       # all shared TypeScript types + TYPE_META
    conditions.ts  # condition evaluation logic
    interpolate.ts # renderMessage ({{token|filter}} expansion)
    rewards.ts     # rewardSummaryFor
    codes.ts       # generateCodes, toCSV, downloadCSV
    format.ts      # money formatter

  data/
    programs.ts    # seeded mock Program[]
    variables.ts   # seeded mock Variable[]
    events.ts      # seeded mock EventDef[]
    store.ts       # Zustand store (in-memory, resets on reload)

  theme/
    ThemeProvider.tsx  # light / dark via CSS variables
```

Mock data lives in `apps/dashboard/src/data/` (programs, variables, events). The demo Zustand store in `store.ts` initialises from those arrays and holds demo runtime state.

## Tangible interactions that actually work

| Interaction | Where |
|---|---|
| Condition builder — add/remove rules, pick variable + operator | Any create flow → Conditions step |
| Error message interpolation — type `{{basket_value - minimum\|money}}` | Conditions → message field |
| Affiliate CSV download — generate unique codes and download a codes-only `.csv` | Affiliate → Create → Codes step |
| Affiliate Codes panel — view per-code status/usage and download the full CSV | Affiliate detail page |
| Referral drag-to-rank — drag rows to reprioritise active referral programs | Referral list page |
| Loyalty event swap — change trigger event, payload fields update instantly | Loyalty → Create → Trigger step |
| Light / dark toggle — persists across reloads via `localStorage` | Top bar (moon / sun button) |

## Viewing & editing entries

**Programs** — every row on the Overview and each list page is clickable and navigates to a read-only detail page. The route segment is pluralized for affiliate/referral, so detail pages live at `/promo/:id`, `/affiliates/:id`, `/referrals/:id`, and `/loyalty/:id`. Programs are editable only when their status is `draft`: the detail page for a draft shows an **Edit** button that opens the create flow pre-filled with the existing data at the same path + `/edit` (e.g. `/affiliates/:id/edit`); the form's submit reads "Save changes" and writes back to the in-memory store. Non-draft programs (active, scheduled, paused, ended) are view-only. There are **4 seeded drafts** — one per program type — visible under the **Drafts** filter on each list page.

**Variables** — clicking any variable row opens a slide-over panel. System variables are read-only (marked 🔒) and open view-only; all other variables open in an editable panel. **＋ New variable** in the top-right opens an empty editable panel; new variables default to the `user` origin (the origin selector offers `user` and `dynamic`).

**Events** — clicking an event row opens a detail pane on the right with in-place editing (name, description, payload fields). **＋ New event** creates a blank event and enters edit mode immediately.

As with all demo data, new entries and edits are held in-memory and reset on page reload.

**Affiliate Codes panel** — the detail page for any affiliate program with a code count set shows a **Codes** section. It includes:
- A status summary line: unused / redeemed / expired counts.
- A preview table of up to the first 50 codes with columns `Code | Status | Uses`. The Uses column shows `used/total` for multi-use codes, `used/∞` for unlimited-use codes, and `—` for single-use codes.
- A **Download CSV** button that downloads the full code list as a codes-only CSV (a `code` header row followed by one code per line, no status or usage columns).

Status and usage values are generated client-side for illustration purposes and are not persisted.

## Original demo non-goals

The retained demo components do **not** supply:

- A real promotions engine or evaluation API
- Real code redemption or wallet debit
- Persistence of program/mock data (it is in-memory and resets on reload; only the theme preference is persisted, via `localStorage`)
- Real analytics (the Analytics page shows placeholder charts)

Those capabilities come from the live Operator/Core/Identity workflows where
implemented. Future-module runtimes and real analytics remain deferred.

## Design docs

The original spec and implementation plan live under `docs/superpowers/` at the repo root (specs and plans subdirectories).
