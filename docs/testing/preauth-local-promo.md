# Experimental local preauthenticated Promo check

The opt-in local Promo check proves one headless ordinary-Admin product flow without personal ROOT or passkey login, with protected run-owned cleanup.

## Overview unavailable check — 2026-10-21

Run the same opt-in command below to verify Overview after the real run-owned
capped Promo is created. The browser checks the exact account/client region,
the accessible “Overview metrics aren’t available yet” heading and explanation,
no Demo data badge, fabricated metrics, table or four-type chooser, and the
**View promos** and permission-authorized **New promo** links. Reload preserves
the unavailable state. The actual theme toggle selects light and dark; the
browser verifies each theme and computes **View promos** text contrast from
its rendered foreground/background colors, requiring at least 4.5:1 without
rounding. Both themes render white on `#4f46e5`, measuring
6.287528596095884:1. The theme is returned to light through the same UI.
Clicking **View promos** opens the live list and shows
the exact run-owned capped Promo; unavailable analytics does not imply an
empty client inventory. All existing demo badge/scroll/hit checks and
percentage/cap/editor/save/reload/persisted/publication assertions still run.

On 2026-10-21 the corrected existing case passed first attempt: one test using
one worker in 15.2s (16.004s command wall). Fixture startup took 11.729s,
bootstrap 190ms and disposal 105ms. Protected disposal and fresh inventory verified all four
owned resources cleaned and zero Product/Auth rows before capability/member
retirement. No retry, skip, timeout, fixture, login or configuration change was
added. Build/lint and the full root suite also passed: 2,394 Vitest cases
(306 dashboard cases) plus nine Node tests in 79.869s on the corrected executable
snapshot. The previous unchanged passkey-bootstrap
timeout remains an unexplained historical observation, despite passing in
this execution.

Earlier on 2026-10-21 the initial unavailable-state journey passed in 14.5s
(15.395s wall), with a full root pass in 80.475s after a sandbox loopback
permission failure. Final review then identified insufficient dark-mode link
contrast. The added browser regression failed at the actual 3.2073128953732977:1
dark contrast before the component-local background fix; the existing CI retry
reproduced that failure. Both failed scenarios still disposed all four owned
resources with zero Product/Auth rows. Those earlier results remain historical
evidence; the corrected 15.2s run above proves the final color pairing.

The Overview slice is uncommitted and locally verified, not merged, deployed
or accepted in staging. It adds no analytics service or data fetch and keeps
the existing ROOT/client/read/session gates. This is still one preauthenticated
Promo browser flow, not full-suite preauth conversion or full local/staging
Playwright acceptance. Deployed versions and earlier dated results are
unchanged.

## Account and client context check — 2026-10-19

Run the existing opt-in command below to check account/scope display alongside
every existing percentage, cap, save, reload and publication assertion. The
accessible Account context region checks the exact fixture Admin's seeded
name, returned own-account email, Admin role, Test fixture method and
Identity-owned client name on list, create/edit pages and reloads. Expected
values come from setup intent/bootstrap metadata, never the session response
under test. Local Promo fixture is the descriptive control request label;
persisted organization name is `${runId}_merchant` and user name `${runId}_admin`.

The same Promo spec in the full local or staging ROOT path checks ROOT,
Passkey and the known newly created `${runId}_merchant Browser authoring shop`.
The existing merchant recipe adds this run prefix. It does not invent
the real owner's email or use a session-response oracle for it. Exact ordinary
Admin identity proof belongs to the opt-in preauth path. Real scroll checks
exercise header title/actions, bottom navigation and the separate demo badge.
On 2026-10-19 the final opt-in case passed first attempt in 14.1s, with all four
owned resources cleaned and fresh zero Product/Auth inventory before private
capability/member retirement. The full local suite passed all ten cases in
23.4s, including the paired Admin display/isolation case. Account and demo rows
remain visible while their content scrolls independently; real hit tests prove
uncovered header/title/actions and reachable bottom navigation, while normal
editor saves/publication remain functional. This is local verification only,
with no deployment or staging acceptance for the account-display slice.

## Earlier accepted result — 2026-10-16

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

## Additional managed-local stack isolation

The existing paired-stack case now starts two independent fixture-mode stacks
and verifies ordinary Admin sessions without ROOT/passkey setup in that case.
Fresh browser contexts prove exact user, organization, merchant and membership
identity, the `e2e-fixture` authentication method, no platform ROOT role or
merchant-selection step, signed-in UI and private 0600 state. Exact own seeded
name/email, Admin role and client IDs/name are also checked in the strict
public display, with no private session ID. The two stacks
have distinct origins, private directories and principals; each stack rejects
the other's state with typed HTTP 401 `UNAUTHORIZED`, rather than a ROOT-only
client rejecting otherwise valid members.

Each independent control record is durable before bootstrap. Finally cleanup
attempts protected disposal and fresh complete zero-row Product/Auth inventories
for every attempted bootstrap, including partial setup and assertion failure;
both runs are checked when both bootstraps were attempted. Capability/member
files are retired only after successful inventory proof; incomplete cleanup
retains private recovery records and fails the test. Only nonsecret outcome
booleans/counts are retained for review.

The earlier PR #27 CI failure occurred in the paired ROOT/passkey activation
path; its underlying cause remains unknown. This test-only migration preserves
isolation checks while removing that repeated authentication setup. The
default full suite still has one global ROOT/passkey bootstrap for legacy
business recipes. Neither this isolation check nor the single Promo flow is a
full preauthenticated-suite conversion, staging acceptance, shared-target
concurrency proof or recovery acceptance. Original timeout/retry policy and
application authentication guards are unchanged.

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
