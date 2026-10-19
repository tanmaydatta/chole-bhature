# Public-contract checkout simulator

The CLI proves an operator-preseeded local/staging checkout through public
HTTP contracts and authoritative merchandise pricing.

- [Prove checkout acceptance, retry and exhaustion](../../docs/integration/integration-simulator.md)
- [Integration Runtime API](../../docs/integration/runtime-api.md)
- [Commerce Connector Conformance](../../docs/integration/connector-conformance.md)

From the repository root:

```sh
pnpm --filter @incentives/integration-simulator... build
pnpm --filter @incentives/integration-simulator start --help
pnpm --filter @incentives/integration-simulator test
```

Runtime imports only contracts, connector-kit and Node, never Core/engine/
Identity/E2E internals. The real D1 case uses the existing
[E2E workspace](../../tests/e2e/README.md). No real payment capture,
configuration seeding, production bypass or automatic merchant cleanup exists.
