# FE-5 · Affiliate codes panel on real data

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §7/§8 — affiliate codes panel wired to a backend-owned CSV. Depends on BE-14 (codes endpoints) and FE-1 (client/auth).

## Scope
- Codes panel UI (`components/codes`, `pages/affiliate`) wired to BE-14's bulk-generate and codes-only CSV endpoints, replacing the demo's client-side `buildCodeRows`/`toCSV` mock generation.

## Acceptance criteria
- [ ] The panel triggers bulk generation via BE-14's endpoint and displays the resulting codes/status/usage from real data.
- [ ] CSV download hits BE-14's export endpoint (server-generated file), not client-side `toCSV`.
- [ ] Per-code stats display real usage/redemption counts once available.
- [ ] Existing demo Codes-panel tests pass against the real client.
- [ ] Tests green.

## Technical notes
- This supersedes the demo's client-only code generation/CSV (`generateCodes`/`toCSV` remain in `packages/engine` for server-side use via BE-14; the dashboard no longer calls them directly for real data).

## Interfaces
**Consumes:** FE-1 `api-client`; BE-14 bulk-generate/CSV-export/per-code-stats endpoints.
**Produces:** the real-data Codes panel (terminal — no ticket depends on FE-5's output directly per the board).

## Out of scope
- Referral code UI (not in this ticket's scope per the board; affiliate only).
- Server-side generation logic itself (BE-14).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
