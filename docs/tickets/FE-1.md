# FE-1 · Dashboard port: API client + auth screens

## Context
Spec §8 — port the existing demo SPA to the real backend. First FE ticket; everything else in the dashboard builds on it. Depends on BE-4 (dashboard auth).

## Scope
- `apps/dashboard/src/lib/api-client.ts`: typed fetch wrapper for the real API (env-scoped base URL, cookie/credential handling for session auth), replacing ad hoc calls into the in-memory `data/store.ts`.
- Login/signup pages wired to BE-4's better-auth session endpoints; an auth guard/layout that redirects unauthenticated users.
- Establish the loading/error-state and session-aware-routing pattern that FE-2, FE-3, FE-4, FE-5, FE-7 build on.

## Acceptance criteria
- [ ] Login/signup pages call BE-4's real endpoints and establish a session cookie; a protected route redirects to login when unauthenticated.
- [ ] `api-client` exposes a consistent request helper (auth headers/cookies, JSON parsing, error shape) reused by later screens.
- [ ] Auth-adjacent demo tests pass against the new client (network boundary mocked, not the store).
- [ ] Tests green (`pnpm --filter dashboard test`).

## Technical notes
- Dashboard stack is unchanged (React 19 + Vite + Tailwind + Zustand + React Router, Spec §3.1) — this ticket swaps the data layer, not the UI framework.
- `data/store.ts` and friends (in-memory mock) are what this and FE-2/FE-3 progressively replace — FE-1 only needs the client + auth wiring, not a full store rewrite.

## Interfaces
**Consumes:** BE-4 session/login/signup/logout routes.
**Produces:** the `api-client` fetch wrapper and the auth guard/layout pattern — consumed by FE-2, FE-3, FE-4, FE-5, FE-7 for every subsequent real-API screen.

## Out of scope
- Programs/variables/events/API-key/billing screens themselves (FE-2, FE-3, FE-4).
- API-key-based (publishable/secret) calls — this ticket is session-auth only.

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
