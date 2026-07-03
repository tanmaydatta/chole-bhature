# DOCS-1 · API reference site

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §9 (API docs). **Cut candidate if team = 2** (binding decision) — shrink to plain markdown instead of a generated docs site if cut. Depends on BE-10, BE-11, BE-12.

## Scope
- API reference covering the evaluate/redemptions/events/customers/wallet endpoints: request/response schemas, auth (publishable vs secret), idempotency notes, examples.

## Acceptance criteria
- [ ] Every endpoint from BE-10/BE-11/BE-12 (plus BE-13's customers/wallet) is documented with a request/response schema and at least one example.
- [ ] Idempotency behavior (order id / event id) is documented per endpoint.
- [ ] If cut to markdown: content still covers the same endpoints, just without a generated docs site.

## Technical notes
Scope-level for now; refresh endpoint schemas from BE-10/BE-11/BE-12's final implementations, not this ticket's assumptions.

## Interfaces
**Consumes:** BE-10/BE-11/BE-12 finalized endpoint contracts.
**Produces:** the API reference content — consumed by DOCS-2 (integration guide links into it).

## Out of scope
- SDK generation / client libraries (deferred, Spec §2).
- Marketing/positioning content (covered by the separate GTM brief).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
