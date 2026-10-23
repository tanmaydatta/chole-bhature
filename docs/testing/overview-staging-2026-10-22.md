# Overview staging rollout — 2026-10-22

The unavailable Overview is deployed through Operator Web/Dashboard; public verification passed, while authenticated staging product acceptance remains pending.

## Source and deployment

[PR #32](https://github.com/tanmaydatta/chole-bhature/pull/32) merged into `dev`
at `909de21fa82e1af7be809fbc51fed3321b52569d` on
`2026-10-22T08:49:36Z`, with tree `81767a5292c10a3e530b1bd7fbf2ac7b01b9b155`.
The approved release used that exact clean source; all nine reviewed file
hashes matched and all 574 tracked files remained unchanged through rollout.
[Pre-merge CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39667095606)
passed `verify` and `local-e2e` on head
`9f11d5cc51e10e4a7d10100b4a4a01de8ba9455b`.
[Post-merge CI](https://github.com/tanmaydatta/chole-bhature/actions/runs/39750665293)
passed `verify` on the merge; `local-e2e` was intentionally skipped on the
`dev` push, not a fresh post-merge browser pass.

Fresh staging preflight, build (15.177s) and Operator dry-run packaging
(0.605s) passed. One protected Operator deployment confirmed Product D1
identity and completed successfully in 30.401s, from
`2026-10-22T09:05:03.918Z` to `2026-10-22T09:05:34.321Z`.

**Staging Worker versions — each verified at 100% traffic**

| Worker | Previous version | Release version / deployment time (UTC) |
|---|---|---|
| `incentives-operator-web-staging` | `cf5e8d92-b159-48b0-b378-be065c883cfc` | `1ea858a5-e74c-43bd-b007-750356bc37ea` / `2026-10-22T09:05:24.473102Z` |
| `incentives-identity-staging` | `ac888e12-3685-49c0-a981-02a0aaea38c6` | Unchanged |
| `incentives-api-staging` | `e38ee573-5a56-444e-9707-ab6f73cb1490` | Unchanged |

Deployment provenance is the observed exact-source protected-runner command;
the provider version has no immutable commit tag. Core's immutable source
mapping remains unestablished.

## Configuration and public verification

Before/after resource configuration fingerprints were identical for all
three Workers: bindings, variables, D1/Secrets Store identities and secret
names, private service targets, routing and runtime settings were unchanged.
Identity remained private. Privacy checks covered account custom domains,
`wastd.dev` Worker routes, Workers.dev and preview settings; they do not
establish an exhaustive inventory across every other account zone.

Public checks at `2026-10-22T09:07:47.982Z` found API health HTTP 200 with
`status=ok` and Operator `/` HTTP 200. All four public assets returned HTTP
200 and matched the fresh build exactly.

**Served asset SHA-256 fingerprints**

| Asset | SHA-256 |
|---|---|
| `/assets/index-Bvu1JxbC.js` | `168a63e9bbdd715f7489a972b66eb4a86003890a9f71e014bd5e548617d9743b` |
| `/assets/index-CRpQjNwC.css` | `ee943791f90aaad903b41244f80de76c72eb09f9126c5fbbbf897959df223395` |
| `/favicon.svg` | `61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66` |
| `/icons.svg` | `b45fa506195cfcdef406ba9f0c77b36ddc1a7c224040926ec70abc2fdea7b93a` |

Raw HTML was not byte-identical. Removing only one known, structurally
validated Cloudflare JavaScript-detection script and one empty hidden
same-origin nofollow content anchor left application markup identical to the
build. Unauthenticated `/operator/v1/session` returned typed HTTP 401
`UNAUTHORIZED`, with no private session ID or application session cookie.
Independent read-only checks confirmed the three version pins, unchanged
configuration fingerprints, all four full asset hashes, health and privacy.

## Product behavior and acceptance limits

The deployed source replaces fabricated Overview metrics, browser-local
program rows and the four-type chooser with “Overview metrics aren’t available
yet.” Admitted readers have **View promos**; **New promo** uses the existing
`programs:manage` permission. The root route is live/non-demo, while existing
account/client, ROOT selection and read/session gates and other demo pages
remain intact. No analytics backend, data fetch or zero-program claim is added.

Authenticated staging acceptance was not verified; the documented automation
session was expired, and no new login/auth setup was performed. No state
export, fixture or business write was attempted. Public asset
and responder checks establish deployment, not authenticated product acceptance.

The [2026-10-21 local Overview proof](./preauth-local-promo.md#overview-unavailable-check--2026-10-21)
remains dated local evidence: 2,394 Vitest cases plus nine Node tests and the
existing one-case Admin preauth journey passed, with four owned resources
cleaned and zero Product/Auth rows. Its real theme-toggle/computed-color
contrast, reload, navigation and retained capped-Promo authoring/publication
assertions were not repeated on staging. The earlier separate passkey unit
timeout remains an unexplained historical observation.

No Identity/Core deployment, migration, database/secret change or E2E run was
part of this release. Auth `0007` and Product `0009` were not applied in this
release; v2 preauth was not activated. Full Task 10, Gate D, authenticated
staging product acceptance and the parked cloud/E2E rewrite remain open.

## Related

- [Staging Worker operations](../integration/staging-operations.md)
- [Product Current State and Roadmap](../product/current-state-and-roadmap.md)
- [Product Follow-up Register](../product/follow-up-register.md)
- [Experimental local preauthenticated Promo check](./preauth-local-promo.md)
