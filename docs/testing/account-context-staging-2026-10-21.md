# Account and client context staging rollout — 2026-10-21

Account/client context is deployed to staging Identity and Operator Web; public health and asset checks passed, while authenticated product acceptance remains pending.

## Source and release scope

[PR #29](https://github.com/tanmaydatta/chole-bhature/pull/29) merged the
account/client indicator at `57370166bf5975861e29c8248ed922556721b83c`
from feature source `84c2fe7`. [PR #30](https://github.com/tanmaydatta/chole-bhature/pull/30)
merged the Identity schema-compatibility correction at
`a5d260cd7cf6574951bf081385c1f22fc84dc944`. Deployment used clean source
`1852a13c1adf9d49971300a927a93fa4e54fc52e`, whose tree
`efd0762bbd67d0c00d9a06e7108aca26638a6d11` exactly matches that merge.
[Exact-tree CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39581835724)
passed; its local verification is not a staging browser result.

The separately approved release built fresh Dashboard assets, then deployed
only Identity followed by matching Operator Web/Dashboard. The fresh build
passed in 15.344 seconds. All 573 tracked source files remained unchanged.
The existing protected runner confirmed Product D1 identity before both
deployments. No Core deployment, migration, secret update, database write,
login, fixture operation, E2E run, production/demo or per-PR resource change
was part of this release.

**Staging Worker versions — each verified at 100% traffic**

| Worker | Previous version | Deployed version / deployment time (UTC) |
|---|---|---|
| `incentives-identity-staging` | `dc29e3a1-d462-4838-9ded-fd1513c6ddfc` | `ac888e12-3685-49c0-a981-02a0aaea38c6` / `2026-10-21T12:11:45.254633Z` |
| `incentives-operator-web-staging` | `21227fa1-725f-4f97-9286-58a092c5526e` | `cf5e8d92-b159-48b0-b378-be065c883cfc` / `2026-10-21T12:12:58.372826Z` |

Core remained `e38ee573-5a56-444e-9707-ab6f73cb1490` at 100% traffic.
Its immutable source mapping remains unestablished; the older documented
Core version is not evidence of current source equality. The new Identity
and Operator versions have observed source-to-upload command provenance,
not immutable provider commit tags.

## Configuration and public runtime checks

Before/after staging variables, D1 and Secrets Store identities, secret names,
private service targets/entrypoints, compatibility settings and binding
names/types matched the expected configuration. Existing legacy per-Worker
secret names were retained. Workers.dev and preview URLs were disabled on
all three Workers. Relevant account custom domains were only
`api.staging.wastd.dev` and `operator.staging.wastd.dev`; Identity had no
account custom domain, and the `wastd.dev` Worker-route inventory had no
target routes. This does not establish route coverage across every other
account zone.

Public checks at `2026-10-21T12:16:20.943Z` found API `/v1/health` returning
HTTP 200 with `status=ok` and Operator `/` returning HTTP 200 with the fresh
build references. All four public assets returned HTTP 200 and matched the
fresh build exactly.

**Served asset SHA-256 fingerprints**

| Asset | SHA-256 |
|---|---|
| `/assets/index-DFfTi9O5.js` | `353f7c25dbc1693c23afb5dfcdd0731b1b69fb129736d63a0569a60b7ce963e5` |
| `/assets/index-Cma22QaB.css` | `3cc1b729b77835c2b4d0dae6586177ad74457419c5cc8c9e459dd479cf3f136c` |
| `/favicon.svg` | `61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66` |
| `/icons.svg` | `b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a` |

Raw HTML was not byte-identical. Removing only one structurally validated
Cloudflare JavaScript-detection script and one empty hidden same-origin
`/cdn-cgi/content` nofollow anchor left application markup identical to the
build (`1756426611025ac16650bf1dc7786ffbc5ee382c4b1718802c5b23cbfb3fea6f`).
These are the same two additions recorded in the
[2026-10-14 staging verification](./evaluation-playground-staging-2026-10-14.md).
No product/configuration or test assertion changed for this observation.

Unauthenticated `/operator/v1/session` returned HTTP 401 with typed
`UNAUTHORIZED`, no private session ID and no application session cookie.
Final checks at `2026-10-21T12:16:40.606Z` confirmed the unchanged Core pin,
source hashes and binding shapes. Independent read-only verification also
confirmed version pins, public health/session responses and all four full
asset hashes.

## Acceptance boundaries and next work

GAP-003 account/client metadata and display code is deployed. The same
Operator source includes the merged GAP-023 percentage editor and Task 11
BFF changes; this does not establish full simulator/capabilities acceptance
with the unchanged Core. Authenticated account/client display, owner sign-in,
the authenticated Core RPC/capability handshake, invitation/email behavior
and Promo authoring/publication were not executed. No staging product browser
acceptance or fresh ROOT state is claimed.

Identity's ordinary enabled paths remain compatible with Auth through
`0006` after PR #30. The absent Auth `0007` and Product `0009` were not
required for this two-Worker release and were not applied. V2 preauthenticated
control settings/setup secrets/CI bindings remain absent; its proof remains
local-only. Full Task 10, Gate D, per-PR cloud execution and production
acceptance remain open. GAP-004, live tenant-scoped Overview or an unambiguous
empty state, is the next product planning candidate; implementation is not
approved by this release.

## Related

- [Staging Worker operations](../integration/staging-operations.md)
- [Product Current State and Roadmap](../product/current-state-and-roadmap.md)
- [Product Follow-up Register](../product/follow-up-register.md)
- [Integration-Ready Core Contracts](../integration/core-contracts.md#operator-account-and-client-display)
