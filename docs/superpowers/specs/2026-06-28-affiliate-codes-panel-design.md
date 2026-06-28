# Affiliate Codes Panel & Codes-Only CSV — Design Spec

**Date:** 2026-06-28
**Status:** Approved design → ready for implementation plan
**Extends:** the incentives-dashboard demo (app under `demo/`, on `main` @ `73db9ff`)

---

## 1. Purpose

Let clients re-download an existing affiliate program's codes, and surface per-code status/usage in the UI:

- **The downloadable CSV contains ONLY the codes** (one per line) — nothing else.
- **Status and usage live in the UI** — the affiliate **detail page** gets a "Codes" panel showing each code's status and (for multi-use codes) how many uses are consumed.

Today CSV download only exists in the affiliate *create* flow's Generate-codes step; existing affiliates (e.g. `ACME-EMPLOYEES`) have no way to re-download, and `toCSV` hardcodes a `status` column.

## 2. Scope

**In scope**
- `toCSV` → **codes only** (single `code` column, one per line). Applies everywhere (detail page + create-flow step).
- Affiliate **detail page** (`ProgramDetail`, affiliate type) gains a **Codes panel**: status summary + preview table (first ~50) + **⬇ Download CSV** (all codes).
- A per-code **status + usage model**, rendered in the UI only, generated client-side (no persistence).
- Capture **`usesPerCode`** on affiliate programs (create flow + seed) so the Uses column is meaningful; make one seed affiliate multi-use.
- `lib/codes` refactor: `buildCodeRows(...)` for the UI rows; `toCSV(codes)` for the bare-codes CSV.

**Out of scope / non-goals**
- No persistence — codes and statuses are generated on the fly and reset on reload (consistent with the rest of the demo).
- No real redemption tracking; statuses are illustrative.
- No status/usage columns in the CSV (explicitly codes-only).
- Non-affiliate program types are unaffected.

## 3. CSV format

`toCSV(codes: string[]): string` returns a `code` header line followed by one code per line. No other columns. Both the detail-page download and the create-flow Generate-codes download use it. Filename stays `acme-affiliate-codes.csv` (or `<program-id>-codes.csv`).

## 4. Status & usage model (`lib/codes`)

```ts
export type CodeStatus = 'unused' | 'redeemed' | 'expired';
export interface CodeRow { code: string; status: CodeStatus; usesUsed: number; usesTotal: number | 'unlimited'; }
export function buildCodeRows(opts: {
  prefix: string; length: number; count: number; usesPerCode: number | 'unlimited';
}): CodeRow[];
```

- **code**: generated via the existing unique-code logic (random; not persisted).
- **status**: randomly assigned per code from `unused` / `redeemed` / `expired`.
- **usesTotal**: `opts.usesPerCode` (`1` single-use, `5` "up to 5", or `'unlimited'`).
- **usesUsed**: consistent with status so rows never look broken:
  - `unused` → `0`
  - `redeemed` → single-use `1`; multi-use random `1…usesTotal`; unlimited random `1…~20`
  - `expired` → random `0…usesTotal` (single-use `0` or `1`; unlimited `0…~20`)

`buildCodeRows` is the single source for both the UI table/summary and the CSV (the CSV is `toCSV(rows.map(r => r.code))`), so the previewed codes and the downloaded codes are the **same set**.

> Browser `Math.random()` is fine here (app code, not a workflow script).

## 5. Affiliate Codes panel (`ProgramDetail`)

For `program.type === 'affiliate'`, render a **Codes panel** below the existing affiliate section:
- Generate the full batch **once** with `useMemo`, keyed by `program.id + codeCount + usesPerCode`, so it's stable while the page is open.
- **Status summary** line over all rows: `{n} unused · {n} redeemed · {n} expired`.
- **Preview table** of the first **50** rows: columns **Code | Status | Uses**.
  - Status: a small colored badge (reuse the established badge styling/tokens).
  - Uses: multi-use → `usesUsed / usesTotal` (e.g. `3 / 5`); unlimited → `usesUsed / ∞`; single-use → `—` (status conveys it).
  - If `codeCount > 50`, show a muted `+ {codeCount − 50} more — download the CSV for the full list`.
- **⬇ Download CSV** button → `downloadCSV(filename, toCSV(rows.map(r => r.code)))` (all codes).
- If the program has no `codeCount`, render nothing (defensive).

## 6. `usesPerCode` capture

- Add optional **`usesPerCode?: number | 'unlimited'`** to the `Program` interface (`lib/types.ts`).
- `AffiliateCreate.buildProgram` stores `usesPerCode` from the Generate-codes step's "uses per code" selection (Single→`1`, Up to 5→`5`, Unlimited→`'unlimited'`). `CodeGenerator` reports the selected uses value to the parent (extend its callback or add an `onUsesChange`), so `AffiliateCreate` can persist it.
- Seed affiliates (`data/programs.ts`) get `usesPerCode`: `ACME-EMPLOYEES` = `1` (single-use); the **affiliate draft** = `5` (multi-use) so the `used / total` column is demoable. (Every affiliate program must carry `usesPerCode`.)
- Maintain the existing seed↔`buildProgram` config-key parity (the parity test must still pass with `usesPerCode` present on both).

## 7. Create-flow update

The Generate-codes step (`CodeGenerator`) keeps its in-flow preview, but:
- Its **Download CSV uses the codes-only `toCSV`** (so all CSV downloads are consistent).
- It already knows the uses option; ensure that value is reported up to `AffiliateCreate` for `usesPerCode` (§6).
- At creation, the in-flow preview semantics are unchanged (brand-new codes); the create step does not need the random status/usage model — that's a detail-page concern.

## 8. Testing

- `lib/codes`: `toCSV(['A','B'])` → `code\nA\nB` (codes only, no status/uses columns). `buildCodeRows` → correct count; statuses ∈ the 3-value set; `usesUsed` consistent with status (unused→0; redeemed multi-use ∈ `1..total`; never `usesUsed > usesTotal` for capped); unlimited handled.
- `ProgramDetail` (affiliate): renders the status summary + a preview row; shows `+ N more` when `codeCount > 50`; clicking Download CSV calls `downloadCSV` with a CSV whose body is codes-only (mock `downloadCSV`); single-use vs multi-use Uses column rendering.
- `AffiliateCreate`/seed: created affiliate carries `usesPerCode`; seed parity test still green; the multi-use seed has `usesPerCode > 1`.

## 9. Open questions
None blocking. (Preview cap = 50; status colors reuse existing badge tokens; filename retains the `…-codes.csv` convention.)
