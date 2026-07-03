# FE-3 · Variables + Events screens on real API

## Context
Spec §8 — port the demo's screens to the real backend. Depends on FE-1 (client/auth) and BE-6 (variables/events API).

## Scope
- Variables screen and Events screen wired to BE-6's `/v1/variables` and `/v1/event-defs`, replacing the demo's mock `data/variables.ts` / `data/eventsStore.ts`.

## Acceptance criteria
- [ ] Variables list/create/edit works against `/v1/variables`.
- [ ] Events list/detail works against `/v1/event-defs`, including the `usedIn` count reflecting real program references.
- [ ] Existing demo tests for these screens pass against the real client.
- [ ] Tests green.

## Technical notes
- Same data-layer-swap pattern as FE-2; no UI redesign.
- Variable `origin` (`user`/`dynamic`/`system`) display must match `packages/engine` `types.ts`'s `Origin` union exactly (Spec §6).

## Interfaces
**Consumes:** FE-1 `api-client`; BE-6 `/v1/variables` + `/v1/event-defs`.
**Produces:** the real-data Variables/Events screens, keeping the dashboard's variable list in sync with what FE-2's condition builder offers.

## Out of scope
- Programs screens (FE-2).
- API-keys/billing screens (FE-4).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
