# Per-PR Cloud E2E pilot ledger

**Baseline recorded:** 2026-09-30
**Status:** Local baseline complete. This is not approval for a Cloudflare
pilot, deployment, credential change, or every-push workflow.

## Local verification baseline

The commands below were run from the `feat/per-pr-cloud-e2e` worktree. The
first sandboxed Worker-backed run could not bind `127.0.0.1` or write a local
Wrangler debug log, so it stopped before assertions. The same local-only
commands were rerun with that local permission and passed; no remote
Cloudflare operation was run.

| Command | Result | Measured time / count |
|---|---|---|
| `pnpm install --frozen-lockfile` | passed; lockfile already satisfied | 168 ms |
| `pnpm build` | passed | 13.168 s wall time |
| `pnpm lint` | passed (two existing dashboard fast-refresh warnings) | 3.846 s wall time |
| `pnpm test` | passed | 97 Vitest files / 1,395 assertions, plus 9 Node assertions; about 52 s from first workspace test start through the final Node suite |
| `E2E_BROWSER_CHANNEL=chromium pnpm e2e:local` | passed | 5 Playwright tests in 24.4 s (25.258 s shell wall time) |

The local test command's package counts were: contracts 120; engine 71;
connector kit 43; operator web 152; E2E unit suite 39; Identity browser suite
146; Identity Node suite 82; module kit 11; dashboard 252; Promo 19; and API
460. The two Node script suites add 9 assertions. The slowest reported Vitest
package duration was Identity's browser suite at 24.59 s; dashboard reported
6.37 s and API 6.95 s.

Playwright used its pinned Chromium after installing it because it was absent
from the local Playwright cache. Its five passing tests were:

1. exact GAP-030/031 authoring, evaluation, signed redemption, and retry;
2. two concurrent run-scoped scenarios without tenant cross-talk;
3. cleanup after an intentionally failed scenario;
4. browser authoring, persistence, and publishing of the capped Promo; and
5. the **local-only** simultaneous-stack test. The last test proved two local
   bootstraps had distinct origins/directories, healthy Operator responses,
   distinct root sessions, and isolated Auth D1 state; it took 8.7 s.

## Assertion inventory retained for cloud E2E

The future cloud target must preserve these assertions from the existing suite;
a status-only probe is not equivalent coverage.

| Area | Exact assertion inventory |
|---|---|
| GAP pricing | The cart has original merchandise subtotal 10,001 minor units. A 25% order discount is capped at 1,500 and the matching-line fixed discount is 500 per unit: 500 on `duplicate_line_1`, 1,000 on `duplicate_line_2`, and 0 on `other_line`. The asserted total discount is **3,000** and discounted merchandise subtotal is **7,001**. Program/rule ordering is capped-quarter then five-per-unit. |
| Published configuration | Both run-scoped Promos are read back active after publication. Their stored active rewards retain the 2,500 basis-point / 1,500-minor-unit cap and the 500-minor-unit matching-product rule. |
| Evaluation and receipt | Evaluation decisions and the full price breakdown equal the exact expected breakdown. Redemption retains the evaluation ID, full breakdown, ordered program/rule entries, and is inspected with `integrityVerified: true`; the inspected redemption result equals the original result and has `receiptIntegrityVerified: true`. Inspection also checks each Promo at one use, 1,500 committed spend, and 3,500 budget remaining. |
| Idempotency | Retrying the identical redemption request returns a deep-equal redemption. Reusing its idempotency key with a changed external order is rejected as `409 VERSION_CONFLICT`. |
| Browser flow | The actual edit page displays the maximum as `1500`; the test changes it to `1600`, restores `1500`, saves, verifies the GBP 15.00 summary, reloads and verifies it again, reads persisted configuration, confirms the publication dialog, publishes, sees active revision 1, and reads the persisted active reward again. |
| Concurrent and failure cleanup | Concurrent scenarios have different run, merchant, evaluation, and redemption IDs, retain the 3,000 result, and keep each program reference scoped to its own run. The failure scenario creates only its recorded tenant, throws intentionally, and still disposes that tenant. |
| Disposal proof | `withScenarioRun` cleans managed local/staging tenants in `finally`; `assertRunDisposed` requires recorded resources, every resource marked `cleaned`, disposal status for the run, and zero counts for every Product and Auth D1 inventory category. |

The current E2E suite does **not** test real email delivery. The planned
`cloud-ci` target therefore uses per-stack local capture/suppression rather
than claiming a Resend or inbox-delivery result.

## Current build payload and artifact-limit check

`pnpm build` currently produces TypeScript Worker entry outputs, not the
future `bundle-v1` artifact. The following measurements are therefore the
Task 1 baseline that Task 3 must recompute after it creates the actual
controller-consumable bundle.

| Payload component | Files / measurement |
|---|---:|
| API Worker entry, `apps/api/dist/worker.js` | 10,315 bytes |
| Identity Worker entry, `apps/identity/dist/worker.js` | 20,337 bytes |
| Operator Worker entry, `apps/operator-web/dist/worker.js` | 28,498 bytes |
| Dashboard assets, `apps/dashboard/dist` | 5 files; 753,670 bytes (736.01 KiB); largest 719,379 bytes |
| SQL migrations, API plus Identity | 14 files; 50,581 bytes (49.40 KiB); largest 19,074 bytes |
| Candidate payload (three entries + dashboard assets) | 8 files; 812,820 bytes (793.77 KiB); largest 719,379 bytes |
| Candidate payload including migrations | 22 files; 863,401 bytes (843.17 KiB); largest 719,379 bytes |

The largest present candidate file is well below the proposed **20 MiB per
file** limit, the largest migration is well below the separate **1 MiB
migration** limit, and the 863,401-byte candidate payload is well below the
proposed **64 MiB total unpacked** limit. No cap change is proposed. Task 3
must still measure and validate the actual `bundle-v1` output, including any
bundler-added modules or assets, before treating these limits as accepted for
controller use.

## Evidence boundary

This ledger contains only local counts, durations, source-derived assertions,
and non-sensitive file sizes. It deliberately contains no credentials, browser
state, run proof, cookie, token, customer payload, raw trace, Worker version,
or Cloudflare resource identifier.
