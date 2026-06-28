# Affiliate Codes Panel & Codes-Only CSV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the affiliate CSV a plain list of codes, and surface per-code status + usage in the UI via a "Codes" panel on the affiliate detail page (with re-download), capturing `usesPerCode` so multi-use usage is shown.

**Architecture:** Extends the `demo/` React+TS+Vite+Tailwind+Zustand SPA. `lib/codes` gains `buildCodeRows()` (codes + random status + consistent usage) and a codes-only `toCSV()`. The affiliate `ProgramDetail` section renders a status summary + preview table + Download-CSV from a `useMemo`'d batch. Affiliate programs gain `usesPerCode` (create flow + seed).

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind v3, Zustand, Vitest + RTL.

## Global Constraints

- App under `demo/`; run all commands from `demo/`. TS `strict` + `verbatimModuleSyntax` (use `import type`; don't import `React` just for JSX).
- **CSV contains ONLY codes** (a `code` header line, then one code per line). No status/uses columns anywhere.
- **Status/usage live in the UI only** (affiliate detail "Codes" panel), generated client-side, not persisted (reset on reload — consistent with the demo).
- Per-code **status** ∈ `'unused' | 'redeemed' | 'expired'` (random). **usesTotal** = the program's `usesPerCode` (`1 | 5 | 'unlimited'`). **usesUsed** consistent with status: `unused`→0; `redeemed`→`1…cap` (single-use=1); `expired`→`0…cap`; for `unlimited` treat cap as 20 for the random range. Never `usesUsed > usesTotal` for capped codes.
- Every affiliate program carries `usesPerCode`; seed `ACME-EMPLOYEES`=`1`, the affiliate draft=`5`. Keep seed↔`buildProgram` config-key parity (the `programs-seed.test.ts` parity test must stay green).
- Detail-page preview cap = **50** codes; `+ N more` note when `codeCount > 50`. The previewed codes and the downloaded codes are the **same** `useMemo`'d set.
- Reuse existing `generateCodes`/`downloadCSV` (`lib/codes`), `StatusBadge`-style tokens, and the program store. Browser `Math.random()` is acceptable (app code).
- Each task ends green: `npm run test` AND `npm run build` from `demo/`; commit per task; pristine test output.

## File Structure

```
demo/src/
  lib/codes.ts              MODIFY — add CodeStatus/CodeRow + buildCodeRows; toCSV → codes-only
  lib/codes.test.ts         MODIFY — codes-only toCSV + buildCodeRows tests
  components/codes/CodeGenerator.tsx       MODIFY — codes-only toCSV call; report usesPerCode up
  components/codes/CodeGenerator.test.tsx  MODIFY — codes-only CSV assertions
  lib/types.ts              MODIFY — Program gains optional usesPerCode
  pages/affiliate/AffiliateCreate.tsx      MODIFY — track + persist usesPerCode in buildProgram
  data/programs.ts          MODIFY — affiliates get usesPerCode (ACME=1, draft=5)
  data/programs-seed.test.ts               MODIFY — parity assertions still hold
  pages/ProgramDetail.tsx   MODIFY — affiliate "Codes" panel (summary + preview + download)
  pages/ProgramDetail.test.tsx             MODIFY — panel + download tests
  README (demo/README.md)   MODIFY — document codes-only CSV + detail re-download
```

---

## Task 1: `lib/codes` — `buildCodeRows` + codes-only `toCSV`

**Files:**
- Modify: `demo/src/lib/codes.ts`, `demo/src/components/codes/CodeGenerator.tsx` (its `toCSV` call only)
- Test: `demo/src/lib/codes.test.ts` (update), `demo/src/components/codes/CodeGenerator.test.tsx` (update CSV assertions)

**Interfaces:**
- Produces:
  - `export type CodeStatus = 'unused' | 'redeemed' | 'expired'`
  - `export interface CodeRow { code: string; status: CodeStatus; usesUsed: number; usesTotal: number | 'unlimited' }`
  - `export function buildCodeRows(opts: { prefix: string; length: number; count: number; usesPerCode: number | 'unlimited' }): CodeRow[]`
  - `export function toCSV(codes: string[]): string` — now codes-only (was `toCSV(codes, usesLeft)`).
- Keep existing `generateCodes`, `previewExample`, `downloadCSV` unchanged.

- [ ] **Step 1: Update the failing tests** in `codes.test.ts`:

```ts
import { generateCodes, toCSV, buildCodeRows } from './codes';

test('toCSV is codes-only (code header + one per line)', () => {
  expect(toCSV(['ACME-AAAAA', 'ACME-BBBBB'])).toBe('code\nACME-AAAAA\nACME-BBBBB\n');
});

test('generates the requested count of unique codes with prefix', () => {
  const codes = generateCodes({ prefix: 'ACME-', length: 5, count: 500 });
  expect(codes).toHaveLength(500);
  expect(new Set(codes).size).toBe(500);
  expect(codes.every(c => c.startsWith('ACME-') && c.length === 10)).toBe(true);
});

test('buildCodeRows: count, valid statuses, consistent usesUsed (capped)', () => {
  const rows = buildCodeRows({ prefix: 'ACME-', length: 5, count: 200, usesPerCode: 5 });
  expect(rows).toHaveLength(200);
  expect(rows.every(r => ['unused','redeemed','expired'].includes(r.status))).toBe(true);
  expect(rows.every(r => r.usesTotal === 5)).toBe(true);
  expect(rows.every(r => r.usesUsed >= 0 && r.usesUsed <= 5)).toBe(true);
  expect(rows.filter(r => r.status === 'unused').every(r => r.usesUsed === 0)).toBe(true);
  expect(rows.filter(r => r.status === 'redeemed').every(r => r.usesUsed >= 1)).toBe(true);
});

test('buildCodeRows: single-use redeemed → exactly 1 use', () => {
  const rows = buildCodeRows({ prefix: 'X-', length: 4, count: 100, usesPerCode: 1 });
  expect(rows.filter(r => r.status === 'redeemed').every(r => r.usesUsed === 1)).toBe(true);
  expect(rows.every(r => r.usesUsed <= 1)).toBe(true);
});

test('buildCodeRows: unlimited usesTotal passes through', () => {
  const rows = buildCodeRows({ prefix: 'U-', length: 4, count: 50, usesPerCode: 'unlimited' });
  expect(rows.every(r => r.usesTotal === 'unlimited')).toBe(true);
  expect(rows.filter(r => r.status === 'unused').every(r => r.usesUsed === 0)).toBe(true);
});
```
(Delete the old `toCSV` header/`uses_left` tests that asserted the `code,status,uses_left` format.)

- [ ] **Step 2: Run** `npm run test src/lib/codes.test.ts` → FAIL (`buildCodeRows` undefined; toCSV old format).

- [ ] **Step 3: Implement** in `codes.ts`:

```ts
export type CodeStatus = 'unused' | 'redeemed' | 'expired';
export interface CodeRow { code: string; status: CodeStatus; usesUsed: number; usesTotal: number | 'unlimited'; }
const STATUSES: CodeStatus[] = ['unused', 'redeemed', 'expired'];
function randInt(maxInclusive: number): number { return Math.floor(Math.random() * (maxInclusive + 1)); }
function usesUsedFor(status: CodeStatus, usesTotal: number | 'unlimited'): number {
  if (status === 'unused') return 0;
  const cap = usesTotal === 'unlimited' ? 20 : usesTotal;
  if (status === 'redeemed') return cap <= 1 ? 1 : 1 + randInt(cap - 1); // 1..cap
  return randInt(cap); // expired: 0..cap
}
export function buildCodeRows(opts: { prefix: string; length: number; count: number; usesPerCode: number | 'unlimited'; }): CodeRow[] {
  const codes = generateCodes({ prefix: opts.prefix, length: opts.length, count: opts.count });
  return codes.map((code) => {
    const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
    return { code, status, usesTotal: opts.usesPerCode, usesUsed: usesUsedFor(status, opts.usesPerCode) };
  });
}
export function toCSV(codes: string[]): string {
  return 'code\n' + codes.join('\n') + '\n';
}
```
(Replace the old `toCSV(codes, usesLeft)` definition.)

- [ ] **Step 4: Fix the one caller** — in `CodeGenerator.tsx`, change the download handler's `toCSV(generatedCodes, usesLeft(uses))` to `toCSV(generatedCodes)`. Leave the in-flow preview table as-is. In `CodeGenerator.test.tsx`, update the CSV assertions: the CSV passed to the mocked `downloadCSV` now has first line `code` and `N` code lines (drop the `,unused,1` / `uses_left` mapping assertions).

- [ ] **Step 5: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat: codes-only CSV + buildCodeRows (status/usage) in lib/codes"`

---

## Task 2: Capture `usesPerCode` on affiliate programs

**Files:**
- Modify: `demo/src/lib/types.ts`, `demo/src/components/codes/CodeGenerator.tsx`, `demo/src/pages/affiliate/AffiliateCreate.tsx`, `demo/src/data/programs.ts`
- Test: update `demo/src/data/programs-seed.test.ts`, extend `AffiliateCreate.edit.test.tsx` (or `AffiliateCreate` test)

**Interfaces:**
- Produces: `Program.usesPerCode?: number | 'unlimited'`. `CodeGenerator` gains `initialUses?: number | 'unlimited'` and `onUsesChange?: (usesPerCode: number | 'unlimited') => void`. `AffiliateCreate.buildProgram` includes `usesPerCode`.

- [ ] **Step 1: Failing tests**
  - `programs-seed.test.ts`: assert `ACME-EMPLOYEES` (the active affiliate) has `usesPerCode === 1` and the affiliate draft has `usesPerCode === 5`.

```ts
test('affiliate programs carry usesPerCode (single + multi-use seeds)', () => {
  const active = PROGRAMS.find(p => p.type === 'affiliate' && p.status === 'active')!;
  expect(active.usesPerCode).toBe(1);
  const draft = PROGRAMS.find(p => p.type === 'affiliate' && p.status === 'draft')!;
  expect(draft.usesPerCode).toBe(5);
});
```
  - `AffiliateCreate` test: editing the affiliate draft and saving keeps `usesPerCode` (assert `updateProgram` called with `usesPerCode: 5`), and a fresh create persists the default (`usesPerCode: 1`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**
  - `types.ts`: add `usesPerCode?: number | 'unlimited';` to `Program`.
  - `CodeGenerator.tsx`: map its uses select to `1 | 5 | 'unlimited'`; accept `initialUses` to seed the select; call `onUsesChange(value)` whenever it changes and once on mount (`useEffect`) so the parent learns the default.
  - `AffiliateCreate.tsx`: add `const [usesPerCode, setUsesPerCode] = useState<number | 'unlimited'>(() => editing ? ((editing.usesPerCode as number | 'unlimited') ?? 1) : 1)`; pass `initialUses={usesPerCode}` + `onUsesChange={setUsesPerCode}` to `CodeGenerator`; in `buildProgram` include `usesPerCode`.
  - `programs.ts`: add `usesPerCode: 1` to `ACME-EMPLOYEES`, `usesPerCode: 5` to the affiliate draft.

- [ ] **Step 4: Keep parity green** — the existing `programs-seed.test.ts` "config-key set per type" test now requires `usesPerCode` on every affiliate program AND in `buildProgram` output; both are satisfied. Run the suite.

- [ ] **Step 5: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 6: Commit** `git commit -am "feat: capture usesPerCode on affiliate programs + seed"`

---

## Task 3: Affiliate "Codes" panel on `ProgramDetail` (+ download)

**Files:**
- Modify: `demo/src/pages/ProgramDetail.tsx`
- Test: `demo/src/pages/ProgramDetail.test.tsx` (extend)

**Interfaces:**
- Consumes: `buildCodeRows`, `toCSV`, `downloadCSV` (`../lib/codes`); `Program.codeCount`, `Program.usesPerCode`.

- [ ] **Step 1: Failing tests** (extend `ProgramDetail.test.tsx`; seed an affiliate program with `codeCount` + `usesPerCode` in the store):

```tsx
test('affiliate detail shows a Codes panel with a status summary and preview rows', () => {
  // render ProgramDetail at /affiliates/<id> for a multi-use affiliate (codeCount 60, usesPerCode 5)
  expect(screen.getByText(/unused/i)).toBeInTheDocument();           // summary
  expect(screen.getByText('Codes')).toBeInTheDocument();             // panel heading
  expect(screen.getByText(/\+\s*10 more/i)).toBeInTheDocument();      // 60 - 50
});

test('affiliate detail Download CSV downloads codes-only', () => {
  // mock downloadCSV from ../lib/codes
  fireEvent.click(screen.getByRole('button', { name: /download csv/i }));
  const csv = (downloadCSV as Mock).mock.calls[0][1] as string;
  expect(csv.split('\n')[0]).toBe('code');                            // codes-only header
  expect(csv).not.toMatch(/status|uses/i);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `ProgramDetail.tsx` (affiliate branch): after the existing affiliate rows, render a **Codes panel** when `program.codeCount != null`:
  - `const rows = useMemo(() => buildCodeRows({ prefix: codePrefixFor(program), length: 5, count: Number(program.codeCount), usesPerCode: (program.usesPerCode as number|'unlimited') ?? 1 }), [program.id, program.codeCount, program.usesPerCode])`.
  - `codePrefixFor(program)`: derive a stable prefix from the program name — uppercase alphanumerics of `program.name`, first 6 chars, + `'-'` (fallback `'CODE-'`).
  - **Status summary**: counts of each status across `rows`, rendered like `{u} unused · {r} redeemed · {e} expired`.
  - **Preview table** (first 50 rows): columns `Code | Status | Uses`. Status = a colored badge (reuse the status/badge token classes). Uses = `usesUsed/usesTotal` when `usesTotal` is a number, `usesUsed/∞` when `'unlimited'`, and `—` when `usesTotal === 1` (single-use).
  - `+ {codeCount - 50} more — download the CSV for the full list` when `codeCount > 50`.
  - **⬇ Download CSV** button → `downloadCSV(`${program.id}-codes.csv`, toCSV(rows.map(r => r.code)))`.

- [ ] **Step 4: Run** `npm run test` + `npm run build` → PASS.
- [ ] **Step 5: Manual** — open `ACME-EMPLOYEES` (single-use: Uses shows `—`) and the multi-use draft (Uses shows `n/5`); Download CSV yields a codes-only file; the previewed codes match the file.
- [ ] **Step 6: Commit** `git commit -am "feat: affiliate Codes panel (status/usage) + codes-only re-download"`

---

## Task 4: Docs

**Files:** Modify `demo/README.md`

- [ ] **Step 1** — update the README: the affiliate **CSV is codes-only**; affiliate **detail pages** show a **Codes panel** (per-code status + usage, `used/total` for multi-use) with a **Download CSV** for the full code list; note statuses/usage are illustrative (generated client-side, not persisted).
- [ ] **Step 2** — `npm run build` from `demo/` succeeds.
- [ ] **Step 3: Commit** `git commit -am "docs: codes-only CSV + affiliate Codes panel"`

---

## Self-Review (completed by author)

**1. Spec coverage** — codes-only CSV→T1; status/usage model→T1; usesPerCode capture+seed→T2; Codes panel (summary+preview+download)→T3; create-flow codes-only→T1; docs→T4. All spec sections covered.

**2. Placeholder scan** — no TBD/TODO; T1 has full lib code + tests; T2/T3 name exact files, props, and the `codePrefixFor` derivation; no "similar to Task N".

**3. Type consistency** — `CodeStatus`/`CodeRow`/`buildCodeRows`/`toCSV(codes)`/`usesPerCode`/`CodeGenerator.onUsesChange`+`initialUses` are used consistently across tasks; `usesTotal` is `number | 'unlimited'` throughout; CSV is codes-only everywhere.
