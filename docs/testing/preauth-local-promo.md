# Experimental local preauthenticated Promo check

The opt-in local Promo check proves one headless ordinary-Admin product flow without personal ROOT or passkey login, with protected run-owned cleanup.

## Current result — 2026-10-16

The opt-in command is:

```sh
CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local:preauth
```

It selects only the existing exact capped-Promo browser case. On 2026-10-16 it
passed on its first attempt: one test in 14.3s (15.126s command wall time).
Fixture startup took 11.741s, bootstrap 152ms, scenario 1.119s and disposal 73ms.
The ordinary Admin saved the 25% capped Promo, edited its GBP minor-unit cap
from 1600 to 1500, verified the persisted value after detail/reload, and
published active revision 1. Exact existing assertions were retained.

Managed-local fixture mode omits the ROOT CLI and virtual-authenticator
bootstrap and performs no ROOT/platform selection. The default
`pnpm e2e:local` command, its global setup, two workers, retries, timeouts and
business assertions remain unchanged.

## Readiness and authority

Fixture startup waits concurrently for real HTTP responses from Core, Identity
and Operator before its authenticated protocol-2 capability handshake. All
three share the existing 45-second readiness budget and 150ms polling interval.
The existing readiness condition accepts responses below 500; Core 404 and
Identity 400 establish responder availability, not business-health acceptance.
The capability response must separately validate the exact local runtime,
generation, target and lifecycle migrations.

Private independent run capabilities are durably recorded before bootstrap.
The real server-issued ordinary Admin session is verified in a fresh client
before browser state is published. Member state contains no setup authority.
The browser uses normal permission-checked product APIs; no application auth
guard was changed.

## Boundaries and retained evidence

The passing run used setup authority plus its exact run proof for disposal and
a fresh complete Product/Auth inventory. All four recorded resources were
cleaned; final status was disposed with every expected table count zero. Only
then were that run's capability/member files retired. Failed cleanup retains
the private recovery record and fails the test.

Earlier attempts failed before bootstrap: Node `fetch` added browser metadata,
and an Operator-only readiness wait was followed by a cross-Worker capability
failure with HTTP 400. The header issue was independently reproduced and the
machine client uses bounded Node HTTP without browser headers. With original
entrypoints and all-three readiness, a single capability experiment returned
200; the subsequent full Promo proof above passed. This supports the practical
readiness correction, not an exhaustive proof of every startup race.

Earlier failed records/logs remain private and unchanged, including inconclusive
wrapper observations. Those runs recorded no fixture resources but did not
obtain a successful protected zero-row readback; their cleanup is not relabelled
as acceptance. The existing owner lifecycle stopped the temporary stacks.
No staging, remote fixture operation, deployment or application-auth change
occurred. Full preauthenticated-suite conversion, concurrent-run acceptance,
recovery acceptance and staging readiness remain outside this local proof.

Code references:

- Readiness and owned lifecycle: [Managed local stack](../../tests/e2e/src/local-stack.ts).
- Member verification: [Member state](../../tests/e2e/src/member-state.ts).
- Run-owned cleanup: [Promo fixtures](../../tests/e2e/test/support/promo-fixtures.ts).
- Exact product assertions: [Promo browser case](../../tests/e2e/test/playwright/promo.browser.spec.ts).

## Related

- [End-to-end test workspace](../../tests/e2e/README.md)
- [Preauthenticated product E2E contract](../superpowers/specs/2026-10-12-preauthenticated-product-e2e-design.md)
- [Local PR E2E CI](local-pr-e2e-ci.md)
