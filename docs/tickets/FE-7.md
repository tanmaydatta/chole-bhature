# FE-7 · Analytics-lite dashboard

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §8 — analytics-lite from `program_stats`. **Cut candidate if team = 2** (binding decision) — check before starting whether this ticket is still in scope. Depends on BE-17, FE-1.

## Scope
- Analytics-lite page: redemptions, incentive spend, wallet issued, read from BE-17's `program_stats` rollups.

## Acceptance criteria
- [ ] Page renders real rollup numbers (redemptions count, spend, wallet issued) per merchant.
- [ ] Tests green.

## Technical notes
Scope-level for now; refresh the exact `program_stats` shape from BE-17's finalized rollup schema before starting. If cut (team = 2), the dashboard ships without analytics for MVP — `program_stats` still exists for future use.

## Interfaces
**Consumes:** FE-1 `api-client`; BE-17 `program_stats` rollup data.
**Produces:** the analytics-lite page (terminal, no dependents).

## Out of scope
- Advanced analytics/A-B testing (deferred, Spec §2).
- Real-time (vs. rollup-interval) metrics.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
