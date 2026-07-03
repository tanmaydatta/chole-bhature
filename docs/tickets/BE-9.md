# BE-9 · CustomerWalletDO + ledger

> ⚠️ Detailed from the spec — refresh from the outputs of its dependencies before starting (see "Depends on").

## Context
Spec §5 (DO list) and §3 (data-ownership rule: DO owns the live balance, D1 owns the ledger). Depends on BE-1 (`wallet_transactions`).

## Scope
- `CustomerWalletDO` class (per merchant+customer, namespaced `wallet:{merchantId}:{customerId}`) holding the live balance.
- Idempotent `credit`/`debit` RPCs (each call carries a dedupe key) — safe against retries.
- Every credit/debit mirrors a row into BE-1's `wallet_transactions` table so D1 has the queryable ledger while the DO holds the authoritative live balance.

## Acceptance criteria
- [ ] Concurrent credits/debits against the same wallet never lose an update (DO single-writer serialization).
- [ ] Repeating a credit/debit call with the same idempotency key is a no-op the second time (balance unchanged, no duplicate ledger row).
- [ ] Every successful credit/debit writes exactly one `wallet_transactions` row in D1 matching the DO's applied delta.
- [ ] A debit that would take the balance negative is rejected.
- [ ] A vitest-pool-workers concurrency test proves no double-spend/lost-update; tests green.

## Technical notes
- DO holds the live balance, D1 holds the transaction ledger written alongside (Spec §3) — never derive balance by summing D1 rows in the hot path.
- Binding name `CUSTOMER_WALLET_DO` (INFRA-2); DO id derived from `wallet:{merchantId}:{customerId}`.
- Idempotency dedupe-key storage lives in the DO itself (Spec §5: "dedupe keys stored in the relevant DO").

## Interfaces
**Consumes:** BE-1 `wallet_transactions` table + `db`/`batch()` helper; INFRA-2 `CUSTOMER_WALLET_DO` binding.
**Produces:** the `CustomerWalletDO` idempotent `credit`/`debit` RPC and live-balance read — consumed by BE-10 (available-wallet-credit read in evaluate), BE-12 (loyalty/referral credit on qualifying events), BE-13 (balance/transactions read endpoint), BE-15 (referrer credit).

## Out of scope
- Program budget/usage counters (BE-8, a separate DO).
- The `/v1/customers/{ref}/wallet` HTTP endpoint itself (BE-13).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
