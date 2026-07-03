# INFRA-2 · Cloudflare environments

## Context
Spec §3 architecture table (Workers/D1/DO/KV/Queues) plus the binding decision that staging and prod Cloudflare environments are strictly separated. Depends on INFRA-1's app skeletons.

## Scope
- Wrangler config for `apps/api` with `dev` / `staging` / `production` environments, each with distinct D1 database ids, DO namespaces, KV namespace ids, and Queue ids.
- Declare the bindings every later ticket depends on by name: D1 `DB`, KV `CONFIG_KV`, Durable Objects `PROGRAM_COUNTERS_DO` (class `ProgramCountersDO`) and `CUSTOMER_WALLET_DO` (class `CustomerWalletDO`), Queue `EVENTS_QUEUE`.
- Secrets management convention (`wrangler secret put` per env) for Stripe keys, Sentry DSN, better-auth secret — documented, never committed; `.dev.vars.example` for local dev.
- `apps/dashboard` Workers-static-assets config with its own staging/production split.

## Acceptance criteria
- [ ] `apps/api`'s wrangler config defines `dev`, `staging`, `production` with distinct resource ids for D1/KV/DO/Queues (no shared ids across environments).
- [ ] `wrangler deploy --env staging` and `--env production` target genuinely separate Cloudflare resources.
- [ ] No secret values committed; `.dev.vars.example` documents required local secret names.
- [ ] `apps/dashboard` has its own staging/production static-assets config.
- [ ] A short doc describes the 3-environment model and how to add a new binding.

## Technical notes
- D1 has no interactive transactions — downstream tickets use `batch()`; nothing to configure here beyond the binding (flagged for BE-1).
- The DO classes referenced in bindings (`ProgramCountersDO`, `CustomerWalletDO`) don't exist yet — wrangler allows declaring a binding ahead of its class; BE-8/BE-9 must implement classes matching these exact binding/class names.
- Binding names are fixed here and must stay stable: `DB`, `CONFIG_KV`, `PROGRAM_COUNTERS_DO`, `CUSTOMER_WALLET_DO`, `EVENTS_QUEUE`.

## Interfaces
**Consumes:** `apps/api`, `apps/dashboard`, `apps/reference-store` skeletons (INFRA-1).
**Produces:** environment-scoped wrangler config; binding names `DB` (D1), `CONFIG_KV` (KV), `PROGRAM_COUNTERS_DO` / `CUSTOMER_WALLET_DO` (DO), `EVENTS_QUEUE` (Queue); the secrets convention. Consumed by INFRA-3 (deploy pipeline), BE-1 (`DB`), BE-6/BE-8/BE-10/BE-16 (`CONFIG_KV`), BE-8/BE-9 (DO bindings), BE-12 (`EVENTS_QUEUE`), INFRA-4 (env-scoped observability), QA-3 (staging load-test target).

## Out of scope
- Actual DO class implementations (BE-8, BE-9).
- CI wiring (INFRA-3).
- Per-environment secret *values* (set by whoever deploys, not this ticket).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
