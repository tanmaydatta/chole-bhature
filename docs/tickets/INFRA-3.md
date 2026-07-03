# INFRA-3 · CI/CD pipeline

## Context
Spec §3.1 tooling row (Wrangler + GitHub Actions/Workers Builds CI) and the phasing plan (§12) that needs a working pipeline from Month 1. Depends on INFRA-2's environments.

## Scope
- PR workflow: install deps, `pnpm -r build`, `pnpm -r test`, `pnpm -r lint`; fails the check on any red.
- Deploy workflow: automatic staging deploy on merge to main; production deploy gated behind an explicit approval/tag.
- D1 migrations step in the deploy pipeline (`wrangler d1 migrations apply`) against the target env, run before/with the API deploy; a failed migration blocks the deploy.
- pnpm-store caching to keep CI fast.

## Acceptance criteria
- [ ] PR workflow runs build+test+lint across all workspace packages and blocks merge on failure.
- [ ] Staging deploy runs automatically on merge to main; production deploy requires an explicit gate.
- [ ] Migrations run as an explicit pipeline step, using INFRA-2's env/binding names, before the API deploy for that env.
- [ ] A failed migration step blocks the deploy step (no partial deploy).

## Technical notes
- Uses the `dev` / `staging` / `production` wrangler environments from INFRA-2 — never deploy to prod from a PR branch build.
- `pnpm -r test` is the canonical "tests green" command referenced by every other ticket's acceptance criteria.

## Interfaces
**Consumes:** INFRA-2 wrangler environments + binding names; INFRA-1 workspace scripts (`pnpm -r build/test/lint`).
**Produces:** `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` — the "tests green" gate every subsequent ticket's PR runs through, and the D1-migrations-in-pipeline step BE-1's schema changes ride on.

## Out of scope
- Writing the D1 schema/migrations themselves (BE-1).
- Observability/alerting in the pipeline (INFRA-4).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
