# Evaluation Playground staging verification — 2026-10-14

The evaluate-only Playground is deployed and verified on existing staging; all applicable headless cases passed and every run-owned tenant was disposed.

## Source and deployment

[PR #23](https://github.com/tanmaydatta/chole-bhature/pull/23) merged into `dev` at
`1d25ef36d06fb7b44b288bd85c3a92d61999983d`; its tree is
`5dee1f03e2d53a5cf6840148f090c8e168d405e6`. The approved rollout used that exact
clean source, a fresh build and successful API/Operator dry-run packaging.
The unchanged source already passed build/lint, 1,805 Vitest tests plus nine
Node tests and nine headless local cases in 49.3 seconds. PR `verify` and
`local-e2e` passed; post-merge `verify` passed while `local-e2e` was skipped by
the existing PR-only workflow, not another browser pass. Those unchanged local
suites were not repeated for this operational release.

**Staging Worker versions — each verified at 100% traffic**

| Worker | Previous version | Deployed version / deployment time (UTC) |
|---|---|---|
| `incentives-api-staging` | `8a316b34-febc-431d-b124-844357b2b960` | `565fa15a-0eed-4af9-97a9-a7da821b75e8` / `2026-10-14T10:43:41.302144Z` |
| `incentives-operator-web-staging` | `cc1de389-1e1b-4d9b-a022-a8c36ad57b98` | `21227fa1-725f-4f97-9286-58a092c5526e` / `2026-10-14T10:46:05.964724Z` |

The protected API → Operator deployment commands confirmed the authenticated
Product D1 target. Before/after version metadata matched exact staging
variables, Product D1 and Secrets Store identifiers, private service targets
and entrypoints, inherited secret names, compatibility settings and Operator
SPA/worker-first asset routing. No unexpected variable or binding was found.
Identity, migrations, secret values, production and the static demo were not changed.
This is observed source-to-upload command provenance, not an immutable
commit tag on the provider versions.

## Runtime and headless results

API health returned `200` and `{"status":"ok"}`; OpenAPI retained canonical
`codes[]` evaluation and evaluation-ID redemption contracts. Both exact
staging origins responded without redirects. The served dashboard script
matched the fresh build byte-for-byte (SHA-256
`8a137df81a018cf536864d8e314d09d13b89eed67cedf82e814eace93b39b0c3`).
Raw `/playground` HTML was not byte-identical: Cloudflare inserted a
JavaScript-detection script and an empty hidden same-origin `/cdn-cgi/content`
nofollow link. Removing only those two structurally validated additions left
application markup identical to the build. No product, configuration or test
assertion was changed for that observation. Deployment metadata does not
establish an exhaustive live route or exposure inventory; rendered fixed
staging routes/privacy remained unchanged.

The existing owner ROOT session and read-only cross-Worker capability
handshake passed before deployment and again before fixtures. The full command was:

```sh
CI=true E2E_BROWSER_CHANNEL=chromium \
  E2E_OPERATOR_STORAGE_STATE=/absolute/private/current-root-state.json \
  pnpm e2e:staging
```

Result: **7 passed, 2 intended local-only skips, 0 failed**, using two workers,
with no reported retry or flake. Playwright reported **1.0 minute**; total
command time was **63.450 seconds**, exit `0`, completed at
`2026-10-14T10:55:01.210Z`.

- Three API cases passed exact authoring/evaluation/signed redemption and
  retry, concurrent independent tenant isolation, and failed-scenario disposal.
- Promo browser authoring, persistence and publication passed.
- All three Playground browser cases passed published revision authority,
  anonymous/stored-customer baskets, edited-result invalidation, exact capped
  and stacked per-line discounts, typed live fields, code-specific failures,
  empty selection and free shipping's zero merchandise saving.
- `local-stack.api.spec.ts` and `cloud-access.browser.spec.ts` were skipped
  only because their existing scenarios require local controlled stacks.
  No product case was skipped and settings/assertions were unchanged.

## Cleanup and evidence boundaries

All eight scenario manifests retained correct ownership and marked all 53
recorded resources `cleaned`. Existing protected disposal assertions passed;
final read-only inventories at `2026-10-14T10:57:18.704Z` again confirmed all
eight runs disposed with **zero run-owned Product and Auth rows**. Only
sanitized disposal/audit tombstones remain. No arbitrary SQL deletion or
manual data reset was used. Private states, proofs and manifests remain untracked.

Browser evidence uses ROOT with ordinary merchant selection; it is not member
sign-in, invitation/email delivery or fresh passkey acceptance. Local real
Core Workers/D1 tests separately prove snapshot HMAC integrity and unchanged
budgets/counters/redemption rows. Evaluation persists its normal signed
snapshot, but the Playground has no redemption or spending action; the
existing API scenarios exercise redemption separately. Merchandise subtotal
is not a final tax/shipping/payment total. Full Task 10, simulator CLI, Gate D,
production and per-PR cloud deployment acceptance remain open.

## Related

- [Staging Worker operations](../integration/staging-operations.md)
- [Evaluate a basket in the Playground](../integration/evaluation-playground.md)
- [End-to-end test workspace](../../tests/e2e/README.md)
- [Production Operator Platform and Integration Harness Implementation Plan](../superpowers/plans/2026-07-19-production-operator-platform.md)
