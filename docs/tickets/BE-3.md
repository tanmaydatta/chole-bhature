# BE-3 · packages/engine port

## Context
Spec §6 (condition & rewards engine) — "reuse and server-port the demo's tested logic." The spec's "builds on" note names the exact source files: `demo/src/lib/{conditions,interpolate,rewards,codes,types}.ts`. Depends on INFRA-1's `packages/engine` stub.

## Scope
- Lift `demo/src/lib/{types,conditions,interpolate,rewards,codes,format}.ts` into `packages/engine/src/`, keeping the same exported names and their existing unit tests.
- Add the one piece the demo's UI-only code lacks: a pure **condition evaluator** (e.g. `evaluateConditionGroup(group, context)`) that runs a `ConditionGroup` against a variable-value context and returns pass/fail plus the first-failing condition (Spec §6: "first-failing-condition drives the message"). The demo only ships display-time helpers (`resolveMessage`, `operatorLabel`) — no runtime predicate evaluator exists yet; this is new logic grounded directly in Spec §6.
- zod schemas mirroring every exported type in `types.ts` (`Variable`, `Condition`, `ConditionGroup`, `Program`, `Reward`, `EventDef`, …) as the single source of request/response validation shared by API and dashboard.

## Acceptance criteria
- [ ] `packages/engine` exports `conditions`, `interpolate`, `rewards`, `codes`, `types`, `format` with the same public names as `demo/src/lib`.
- [ ] All ported unit tests pass unchanged inside `packages/engine`.
- [ ] The new evaluator has unit tests covering ALL/ANY match, one level of nested groups, and first-failing-condition selection.
- [ ] zod schemas exist for every exported type and round-trip-validate a sample `Program`/`ConditionGroup`.
- [ ] `packages/engine` builds standalone (`tsc -b`, strict + verbatimModuleSyntax); tests green (`pnpm test`).

## Technical notes
- Condition-engine scope creep is a named risk (Spec §13) — cap the evaluator to exactly what the demo's builder models (ALL/ANY, one level of nested groups, `OPERATORS_BY_TYPE`'s operators); do not expand the expression language.
- `codes.ts`'s `downloadCSV` is browser-only (guarded on `document`) — server code (BE-14) uses `generateCodes`/`buildCodeRows`/`toCSV` only.
- Keep `packages/engine` free of Cloudflare/Workers-specific globals — it must import cleanly into both `apps/api` (Workers runtime) and `apps/dashboard` (Vite/browser).

## Interfaces
**Consumes:** `demo/src/lib/*` source (to be ported) via INFRA-1's `packages/engine` location.
**Produces:** the `@incentives/engine` package exporting `types`, `conditions` (incl. the new evaluator), `interpolate` (`renderMessage`), `rewards` (`rewardSummaryFor`), `codes` (`generateCodes`, `buildCodeRows`, `toCSV`), `format` (`money`), and zod schemas — consumed by BE-6 (validation), BE-10 (evaluate pipeline), BE-14 (code generation), FE-2 (condition builder types).

## Out of scope
- KV compilation/caching of conditions (BE-6/BE-10 own caching; this ticket only produces the pure functions being cached).
- Wiring the evaluator into an HTTP route (BE-10).

## On completion
- [ ] Update the description of every ticket this one **Blocks** (see the Blocks property): add the concrete interfaces/decisions produced here and refresh anything stale.
