# Incentives Dashboard — Demo

A static, front-end-only demo of an incentives and promotions management dashboard, built to validate customer demand. There is no backend and no authentication. All program/mock data is in-memory and resets on page reload; the only thing persisted is the light/dark theme preference (stored in `localStorage`).

## Quick start

```bash
cd demo
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run test       # Vitest (single run)
npm run build      # tsc -b && vite build (production bundle)
```

`npm run preview` serves the production build locally after `npm run build`.

## The four program types

- **Promo Codes** — single shared codes (e.g. `SUMMER15`) with optional auto-apply and stacking rules.
- **Affiliates** — bulk-generated unique codes exported as a CSV; each code is independently trackable.
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
demo/src/
  pages/
    Overview.tsx             # cross-program stat summary
    Analytics.tsx            # shallow chart placeholders
    _ProgramListPage.tsx     # shared list-page shell
    promo/                   # PromoList, PromoCreate
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

Mock data lives in `demo/src/data/` (programs, variables, events). The Zustand store in `store.ts` initialises from those arrays and holds all runtime state.

## Tangible interactions that actually work

| Interaction | Where |
|---|---|
| Condition builder — add/remove rules, pick variable + operator | Any create flow → Conditions step |
| Error message interpolation — type `{{basket_value - minimum\|money}}` | Conditions → message field |
| Affiliate CSV download — generate unique codes and download `.csv` | Affiliate → Create → Codes step |
| Referral drag-to-rank — drag rows to reprioritise active referral programs | Referral list page |
| Loyalty event swap — change trigger event, payload fields update instantly | Loyalty → Create → Trigger step |
| Light / dark toggle — persists across reloads via `localStorage` | Top bar (moon / sun button) |

## Non-goals (explicit)

This demo does **not** include:

- A real promotions engine or evaluation API
- Authentication or multi-tenant isolation
- Real code redemption or wallet debit
- Persistence of program/mock data (it is in-memory and resets on reload; only the theme preference is persisted, via `localStorage`)
- Real analytics (the Analytics page shows placeholder charts)

These are intentionally out of scope so the demo stays lightweight and deployable without any backend.

## Design docs

The original spec and implementation plan live under `docs/superpowers/` at the repo root (specs and plans subdirectories).
