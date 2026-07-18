# INFRA-1 · Monorepo scaffold
> **Phase 0 (M0):** Delivered in Phase 0 by **P0-1** (monorepo scaffold + `demo/` → `apps/dashboard` + package stubs). Effectively complete; Phase 1 only verifies/extends the shared tsconfig + lint/format config.

## Context
Foundation ticket, no upstream dependencies. Spec §3.1 pins the target repo layout (pnpm workspaces: `apps/api`, `apps/dashboard`, `apps/reference-store`, `packages/engine`). Binding decision: **evolve this repo** (`chole-bhature`) — do not create a new repo.

## Scope
- Add root `package.json` + `pnpm-workspace.yaml` declaring `apps/*` and `packages/*` as workspace packages.
- Move `demo/` → `apps/dashboard` (preserve git history where practical).
- Scaffold empty, buildable placeholders: `apps/api`, `apps/reference-store`, `packages/engine` (own `package.json` + `tsconfig.json`).
- Shared `tsconfig.base.json` (`strict: true`, `verbatimModuleSyntax: true`) extended by every package.
- Shared lint/format config (oxlint + prettier) at the root, replacing/extending the demo-local config.
- Root scripts fanning out to workspaces: `pnpm -r build`, `pnpm -r test`, `pnpm -r lint`.

## Acceptance criteria
- [ ] `pnpm install` succeeds at repo root with workspaces `apps/*`, `packages/*`.
- [ ] `apps/dashboard` is the former `demo/` app; `pnpm --filter dashboard test` runs the existing vitest suite green.
- [ ] `apps/api`, `apps/reference-store`, `packages/engine` exist as valid empty TS packages that build with `tsc -b`.
- [ ] `tsconfig.base.json` sets `"strict": true` and `"verbatimModuleSyntax": true`; every package tsconfig extends it.
- [ ] `pnpm -r test` at root runs every workspace's test suite; tests green.
- [ ] No new repo created — `apps/dashboard` carries `demo/`'s history.

## Technical notes
- TS strict + verbatimModuleSyntax everywhere (binding decision) — `verbatimModuleSyntax` means every type-only import must use `import type`.
- Package manager is pnpm (Spec §3.1) — no npm/yarn lockfiles.
- Keep `apps/dashboard`'s existing scripts (`dev`, `build`, `test`, `lint`) working unchanged from the workspace root via `pnpm --filter dashboard <script>`.
- `packages/engine` only needs a buildable stub here (e.g. `src/index.ts` placeholder, `name: "@incentives/engine"`) — BE-3 populates it.

## Interfaces
**Consumes:** the current repo state (`demo/` as-is); no upstream ticket.
**Produces:** the pnpm workspace root (`pnpm-workspace.yaml`, root `package.json`), `apps/api`, `apps/dashboard` (renamed from `demo/`), `apps/reference-store`, `packages/engine` directories, and `tsconfig.base.json`. INFRA-2, BE-1, BE-2, BE-3, FE-1 all build inside these paths.

## Out of scope
- Any real application code inside `apps/api` / `apps/reference-store` / `packages/engine` (BE-2, FE-6, BE-3).
- Wrangler/Cloudflare bindings (INFRA-2).
- CI pipeline (INFRA-3).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
