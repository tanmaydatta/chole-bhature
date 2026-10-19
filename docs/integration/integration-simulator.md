# Prove checkout acceptance, retry and exhaustion

The public-contract CLI validates a preseeded local/staging checkout, commits
its Promo bundle before fake capture, verifies an identical retry and reprices
a stale basket after capacity exhaustion.

## Before you begin

- Use an isolated temporary local stack/database or properly run-owned fixture
  on an API build exposing
  [runtime capabilities](runtime-api.md#simulator-runtime-capabilities).
  Only an actual matching local/staging marker permits the CLI. This source
  has local verification, not a CLI/capabilities staging deployment.
- An authorized operator must publish schema/Promo revisions and create the
  fixture customer. The CLI cannot configure programs or bootstrap tenancy.
- Obtain a merchant `sk_…` credential with `schema:read`, `customers:write`,
  `evaluations:write` and `redemptions:write`. Keep it in private process input,
  never JSON, argv, browser assets or source control.
- Use Node22.18/pnpm11.14 with the existing workspace installation. Start the
  normal local Workers and use their exact API origin; the CLI does not start
  Workers or log operators in. The [E2E workspace](../../tests/e2e/README.md)
  provides disposable automated local verification, not a persistent CLI server.

For fully disposable turnkey verification, run
`CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local`. It owns the temporary
stack, fixture provenance and cleanup. An ordinary manually created merchant
is not eligible for E2E disposal: it lacks that run's proof, provisioning ID and
recorded provenance. Manual CLI tests need an owner-managed isolated local
database/lifecycle, or separately owner-approved ordinary fixture handling.

## Steps

1. **Publish a fresh fixture through Operator in that isolated environment.** Publish schema
   version 1 with optional enum `customer.tier` (`gold`, `silver`), and create
   `sim-buyer` with `tier: gold`. Publish two stackable coded Promos with
   eligibility/reward conditions `cart.subtotal >= 0`:

   | Promo / code | Priority | Rule / reward | Usage cap / budget |
   | --- | --- | --- | --- |
   | `sim-capped` / `SIM-CAPPED` |20| `capped`:25% order discount, maximum 1500 GBP minor units |1 /5000 GBP minor units |
   | `sim-line` / `SIM-LINE` |10| `per-unit`:500 GBP minor units per `same-product` unit |1 /5000 GBP minor units |

   Copy actual published program/revision/rule identities from Operator and
   substitute them below. Counters must be fresh/unspent. There is no new
   public program-read/configuration API.

2. **Save owner-private scenario JSON.** Adjust schema/fixture identities to
   the published values; preserve opaque references exactly:

   ```json
   {
     "schemaVersion": 1,
     "fixture": [
       { "programRef": "sim-capped", "programRevision": 1, "rewardRuleRef": "capped" },
       { "programRef": "sim-line", "programRevision": 1, "rewardRuleRef": "per-unit" }
     ],
     "customer": { "shopper_id": "sim-buyer", "profile": { "tier": "gold" } },
     "updatedProfile": { "tier": "silver" },
     "cart": {
       "currency": "GBP", "total_pence": 10001,
       "items": [
         { "line_id": "a", "sku": "same-product", "count": 1, "unit_pence": 4001 },
         { "line_id": "b", "sku": "same-product", "count": 2, "unit_pence": 1500 },
         { "line_id": "c", "sku": "other-product", "count": 1, "unit_pence": 3000 }
       ]
     },
     "context": {}, "codes": ["SIM-CAPPED", "SIM-LINE"],
     "order": { "order_id": "sim-order-unique", "retry_key": "sim-attempt-unique" }
   }
   ```

   Profile writes replace the entire stored attribute object; evaluations
   contain only its reference. Native prices are integer minor units.

3. **Build and supply the key privately.** Enter it without echoing in an
   interactive shell; substitute the running API's exact origin and JSON path:

   ```sh
   pnpm --filter @incentives/integration-simulator... build
   read -r -s INCENTIVES_SECRET_KEY
   export INCENTIVES_SECRET_KEY
   pnpm --filter @incentives/integration-simulator start \
     --origin http://127.0.0.1:8787 --environment local \
     --scenario /absolute/private/scenario.json
   unset INCENTIVES_SECRET_KEY
   ```

   For a separately authorized staging run, use its HTTPS origin and
   `--environment staging`; the actual marker must also say staging. Hostnames
   and flags never attest environment safety.

4. **Verify completion and follow the fixture owner's lifecycle.** Exit 0 and
   `status: completed` prove acceptance/retry/exhaustion/repricing. Only properly
   run-owned E2E fixtures qualify for protected run disposal and zero-row checks.
   A manual local test ends with its owner's temporary stack/database teardown;
   it does not gain a general tenant/customer deletion API. On ordinary retained
   fixtures, retiring Promos and revoking credentials does not delete tenant or
   customer rows. Use a new unspent fixture for another run, not counter resets
   or stale order IDs.

## Verify it worked

The literal fixture contributes 1500+1500 GBP minor units, with line allocations
`a:500`, `b:1000`. The accepted merchandise subtotal is 7001; exhaustion
reprices to 10001. Exactly one fake capture uses 7001; neither the stale nor
automatically repriced basket is captured. A version 1 customer advances to 2/3.

Before updates, capabilities/schema/customer reads and an ordinary evaluation
prove the published Promo/revision/rule set. That preflight persists the normal
signed snapshot but spends no capacity. Core resolves stored customer
attributes; the CLI does not override them in evaluation. Effects, canonical
money and allocations are mapped without recalculating business discounts.
Foreign line/SKU allocations and mismatched selected/receipt identities stop.

Retry must preserve the same evaluation/order/idempotency tuple and exact
receipt. Repricing occurs only for HTTP 409 with existing `EXHAUSTED`,
`USAGE_CAP_EXHAUSTED`, `BUDGET_EXHAUSTED` or `PER_CUSTOMER_CAP_EXHAUSTED`;
diagnostics preserve the observed code. Other conflicts stop. Missing/malformed/
inconsistent markers, production, CI and unknown environments stop before
business requests. Redirects never forward credentials; origin userinfo,
path/query/fragment ambiguities are refused.

Output includes only allowlisted phase/status/code/our correlation UUID and
merchandise-money summary, never credentials, raw errors, attributes, carts or
condition/reward payloads. Merchandise pricing is not a final tax/shipping/
payment total; free shipping saves zero merchandise money. Actual production
integrations retain their existing redemption API. The marker is configuration
safety, not signed server attestation.

```sh
pnpm --filter @incentives/integration-simulator test
pnpm --filter @incentives/connector-kit test
CI=true E2E_BROWSER_CHANNEL=chromium pnpm e2e:local
```

The automated real D1 case pre-seeds through existing run-owned ROOT/operator
recipes, then uses only public merchant credentials in CLI runtime. Its protected
disposal checks final owned Product/Auth rows at zero; this cleanup guarantee
does not apply to arbitrary manual merchants. This is not member-login, staging
or production acceptance.

## Related

- [Integration Runtime API](runtime-api.md)
- [Commerce Connector Conformance](connector-conformance.md)
- [Evaluate a basket in the Playground](evaluation-playground.md)
