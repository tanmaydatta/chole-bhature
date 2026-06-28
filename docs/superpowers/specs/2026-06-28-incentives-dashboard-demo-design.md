# Incentives Dashboard — Validation Demo (Design Spec)

**Date:** 2026-06-28
**Status:** Approved design → ready for implementation plan
**Type:** Static, front-end-only clickable demo (no backend)

---

## 1. Purpose & goal

Build a **clickable front-end demo** of an incentives/promotions dashboard to **validate demand** — to make the product vision tangible enough that prospective clients can react and tell us whether they'd use it. This is **not** a production build: there is no runtime engine, no real persistence, no API. Success = a prospect can navigate the dashboard, configure each program type, and "get it."

The internal framing (one flexible rules-and-rewards engine underneath) is deliberately **hidden** from the customer — the UI presents the four program types as **four distinct things**.

## 2. Scope

**In scope (this demo):**
- A React SPA dashboard with seeded mock data, fully navigable.
- All four program types presented as distinct sections.
- The Variables and Events setup areas.
- A handful of **genuinely working** ("tangible artifact") interactions — see §10.
- Light theme by default with a working **light/dark toggle**.

**Out of scope (not in this demo):**
- Backend, database, real persistence (state is in-memory / mock; resets on reload is acceptable).
- Auth / multi-tenant login (a static "client switcher" in the top bar is cosmetic).
- Real runtime evaluation of conditions, real redemption, real wallet/ledger.
- Deep analytics/charts (Analytics is a light placeholder).
- Real event ingestion.

## 3. Audience & demo narrative

- **Vertical:** E-commerce / retail.
- **Fictional client:** "Acme Store" (shown in the top-bar client switcher).
- Seeded data, variable names, and example programs all reflect online retail (`basket_value`, `items_in_basket`, `category`, `customer_country`, etc.).

## 4. Tech stack

- **React + Vite** (SPA, client-side only).
- **Tailwind CSS + shadcn/ui** for components.
- Routing via React Router (or equivalent) for the dashboard sections.
- **Theme:** CSS-variable-driven light/dark, **light default**, toggle persisted in `localStorage`. (Design tokens already prototyped — see the design-token palette in §6.)
- No server. Mock data lives in static modules; interactions mutate local/in-memory state.

## 5. Information architecture & navigation

Persistent **left sidebar** (layout "C" — grouped), logo "◆ Incentives" at top:

- **Overview** (home)
- **Incentives** (group)
  - Promo Codes — color **blue**
  - Affiliates — color **purple**
  - Referrals — color **teal**
  - Loyalty — color **amber**
- **Setup** (group)
  - Variables
  - Events
- **Insights** (group)
  - Analytics

**Top bar:** page title (left); on the right — light/dark **toggle**, **client switcher** ("Acme Store").

The four program types are **color-coded consistently** across nav icons, list pills, and their create flows — reinforcing the "four distinct things" framing.

## 6. Visual design system

- **Light default**, dark as secondary (toggle in top bar, persisted).
- **Accent:** indigo (`#4f46e5` light / `#7c83ff` dark).
- **Per-type colors:** Promo blue `#2563eb`, Affiliate purple `#7c3aed`, Referral teal `#0891b2`, Loyalty amber `#d97706` (each with a soft background variant; dark-mode variants defined).
- **Variable-origin colors:** User attributes = teal, Dynamic/context = blue, System = amber.
- Clean modern SaaS aesthetic: rounded cards (12–14px), subtle shadows, tabular numerics for stats, segmented controls for filters, pill badges for types/status.
- Density: comfortable (not cramped), ~14px base font.

> The validated companion mockups (in `.superpowers/brainstorm/.../content/`) are the visual reference for the build: `dashboard-light-v2.html`, `condition-builder.html`, `affiliate-codes.html`, `referrals-priority-v2.html`, `loyalty-trigger.html`, `setup-variables.html`, `setup-events.html`.

## 7. Core domain concepts

### 7.1 Variables
The building blocks for every condition, reward, and event payload. **Three origins:**

| Origin | Meaning | Examples | Editable? |
|---|---|---|---|
| **User attributes** | Persistent, tied to the customer | `customer_country`, `customer_tier`, `first_purchase`, `lifetime_orders` | Client-defined |
| **Dynamic / context** | Passed in per request | `basket_value`, `items_in_basket`, `category` | Client-defined |
| **System** | Provided & maintained by us (read-only, 🔒) | `budget_remaining`, `redemptions_total`, `customer_uses_count`, `today` | Read-only |

Each variable has: name, **type** (string / number / boolean / enum / date), origin, an optional **default error message**, and a "used in N programs" count.

**Key insight:** caps, budgets, per-customer limits and validity windows are **not special cases** — they're just conditions over **system variables**. (e.g. budget cap = `budget_remaining > 0`; one-use-per-customer = `customer_uses_count == 0`; date window = `today between …`.)

### 7.2 Conditions (the condition builder)
Shared mechanism used for **eligibility, caps/limits, discount triggers, and referral "applies to"**.

- Top-level **match mode**: "Customer must match **ALL / ANY**".
- **Condition rows**: `[variable] [operator] [value]`. Operator set and value control adapt to the variable's type.
- **Nested groups** (one level): "Add nested group (AND / OR)" for `AND`-of-`OR`s.
- **Variable picker**: searchable, grouped by the three origins, color-coded swatches.
- **Evaluation order:** top-to-bottom; the **first failing condition** determines the message shown ⇒ ordering = message priority.

### 7.3 Error messages (hybrid model)
Custom, client-controlled failure messages. **Resolution order:**

1. **Per-condition message** (most specific; optional override on the row)
2. **Per-variable default message** (reusable; set on the variable)
3. **Program fallback message**
4. **System default**

**Interpolation:** messages can reference variables with `{{ … }}` and filters, e.g.
`"Add {{ 50 − basket_value | money }} more to unlock 15% off!"` → renders `"Add $12 more…"`.
The condition builder shows a **live preview** of the rendered message.

### 7.4 Rewards
- **Discount:** percentage or fixed amount; free shipping.
- **Credit / points:** added to a customer **wallet** (loyalty).
- Referral has **two** reward editors (referrer + referee).

### 7.5 Events
- An event has a **name**, description, and a **payload schema** (fields with name + type + required).
- **Every payload field becomes a variable** usable in loyalty conditions and rewards.
- Plus "always available" user attributes.
- Detail view shows a **sample payload** and the `POST /v1/events/<name>` shape (illustrative only).

### 7.6 Program lifecycle / status
`Draft → Scheduled → Active → Paused ⇄ Active → Ended` (Ended is terminal).

- Every list page has a **status filter** segmented control: **Active · Scheduled · Paused · Ended · Drafts · All** (default **Active**).
- **Paused & Ended are retained** (for analytics/audit), filtered out of the default view, and **excluded from runtime evaluation**.

## 8. Program types

### 8.1 Promo Code (blue)
Single shareable code. Create flow steps: **Basics → Eligibility → Discount → Limits & schedule → Review**.
- Basics: name, code, **auto-apply** toggle.
- Eligibility: condition builder.
- Discount: type + value.
- Limits & schedule: budget, per-customer limits, date window, **stacking allowed** toggle.

### 8.2 Affiliate / Unique Promo (purple)
Like Promo + a **Generate codes** step. Steps: **Basics → Eligibility → Discount → Generate codes → Limits & schedule → Review**.
- Generate codes: **count** (1–5,000), **uses per code** (single / N / unlimited), **code pattern** (prefix + N random chars, live example).
- Generates a preview (first rows) + **Download CSV** of all codes. Each code carries the same eligibility & discount. (Use case: client gives the CSV to *their* client to distribute.)

### 8.3 Referral (teal)
Steps: **Basics → Eligibility → Rewards → Limits & schedule → Review**, with **two reward editors** (referrer / referee).
- **Priority model (explicit):** customers never choose; the system applies the **first program (by priority) whose "applies to" conditions match**.
  - Only **Active & Scheduled** programs are ranked.
  - Priority is an **editable number** *and* **drag-to-reorder**; `⋮` menu adds Move to top / bottom / position; list has search.
  - Paused/Ended appear below a "Not ranked · excluded from matching" divider.

### 8.4 Loyalty (amber)
Steps: **Basics → Trigger → Conditions → Reward → Review**.
- **Trigger:** choose an **event** (e.g. `order_completed`); the event's **payload variables** become available; selecting a different event swaps the payload.
- Conditions: condition builder over payload + user attributes.
- Reward: points / store credit / fixed amount → credited to the customer **wallet**, **auto-redeemed** (no code).
- **No stacking** with other loyalty rewards (stated as a fixed rule, not a toggle).

## 9. Screen inventory

1. **Overview** — 3 stat cards (Active programs, Redemptions 30d, Incentive spend 30d with **budget bar**), All-programs table with type pills + status, "+ New program".
2. **Promo Codes list** — list + status filter + "+ New promo".
3. **Affiliates list** — list + status filter + "+ New affiliate".
4. **Referrals list** — **priority list** (drag + number), status filter, ranked/not-ranked split.
5. **Loyalty list** — list + status filter + "+ New loyalty".
6. **Create/Edit flow** (shared shell) — focused page: top bar (back, type pill, Save draft / Continue) + **left steps rail** + form card. Step content varies by type (§8).
7. **Condition builder** (embedded in Eligibility/Conditions/Applies-to steps) — see §7.2–7.3.
8. **Setup → Variables** — table grouped by origin, filter segments, default-error-message column, "used in" count, system rows read-only.
9. **Setup → Events** — event list (left) + payload-schema detail (right) with sample payload.
10. **Insights → Analytics** — light placeholder (stat cards / simple chart stubs), explicitly shallow.

## 10. Interactions that must genuinely work (tangible artifacts)

These are the "feels real" moments and must be functional client-side (not static):

- **Theme toggle** (light/dark) — persisted.
- **Condition builder** — add / edit / remove condition rows; switch ALL/ANY; open the **variable picker** (search + grouped); add/edit a **per-condition message** with **live interpolation preview**.
- **Affiliate code generation** — enter count/pattern, **generate**, **download a real CSV**.
- **Referral priority** — **drag-to-reorder** with live renumber, **editable priority number**.
- **Loyalty event selector** — swapping the event **swaps the payload variables**.
- **Navigation** — all sidebar items route to their screens; "+ New …" enters the create flow.

Other interactions (saving a program, real validation) may be **mocked/optimistic** (e.g. "Saved" toast, append to the in-memory list).

## 11. Seeded mock data (Acme Store)

- **Programs:** `SUMMER15` (promo, 15% off >$50, active), `WELCOME10` (promo, $10 off first order, paused), `ACME-EMPLOYEES` (affiliate, 500 codes, active), `Give $10 Get $10` / `VIP Referral` / `Holiday Referral` / `Win-back Referral` (referrals), `Order Rewards` (loyalty, 5% back as points).
- **Variables:** the full set in §7.1.
- **Events:** `order_completed`, `review_submitted`, `subscription_renewed` (+ `signup_completed`).

## 12. Non-goals / future (post-validation)
Real engine & API, persistence, auth/multi-tenant, real redemption + wallet ledger, fraud controls, deep analytics, webhooks, attribute sync. Noted so the demo doesn't accidentally imply they exist.

## 13. Open questions
- None blocking. (Analytics depth, exact stacking semantics, and reward-editor detail can be refined during implementation; current level is sufficient for the validation demo.)

---

### Appendix — provenance
Design validated interactively via the brainstorming visual companion. Reference mockups persist under
`.superpowers/brainstorm/62131-1782649659/content/`.
