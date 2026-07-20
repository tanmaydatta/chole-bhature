# Integration-Ready Core Operator UI and Simulator Implementation Plan

**Status:** Killed — superseded; do not execute.

**Notion parent:** [Plans](https://app.notion.com/p/Plans-390e5c7c2b8e8165b7f7d77392eab088)

> The approved 2026-07-19 design expands Plan 3 to authenticated multi-tenancy, separate Operator/Identity/Core Workers, separate Auth/Product D1 databases, merchant credentials, immutable program revisions, a dashboard Playground, deployment, and operations. Read `docs/superpowers/specs/2026-07-19-production-operator-platform-design.md` and execute the replacement `docs/superpowers/plans/2026-07-19-production-operator-platform.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing dashboard's schema and conditional-reward Promo surfaces to the real runtime API and add a non-visual integration simulator that proves how unknown future commerce platforms use the canonical contract.

**Architecture:** A typed fetch client owns the dashboard network boundary; focused query hooks replace only the Variables and Promo in-memory stores. The simulator is a separate Node/TypeScript CLI implementing the connector lifecycle with canonical fixtures—no new storefront or platform-specific UI.

**Tech Stack:** React 19, Vite 8, React Router 7, Zustand 5 where still appropriate for local UI state, TypeScript 6, Vitest/RTL, Node CLI, canonical workspace packages.

**Approved designs:**

- `docs/superpowers/specs/2026-07-18-integration-ready-incentives-core-design.md`
- `docs/superpowers/specs/2026-07-19-conditional-reward-rules-design.md`

**Sequence:** Plan 3 of 3; requires Foundation, Runtime, and the Conditional Reward Rules Runtime plan.

**Notion mirror:** https://app.notion.com/p/Integration-Ready-Core-Operator-UI-and-Simulator-Implementation-Plan-3a1e5c7c2b8e816097afe6f2eb594f59

## Global Constraints

- Execute after Runtime Plan completion in the same `feat/integration-ready-core` worktree/branch.
- Do not redesign the approved static demo; change only data-loading, save/publish states, schema safety messages, and Promo API wiring.
- Do not add login/signup, billing, analytics, platform connectors, or a reference storefront.
- Never persist or log a secret token in browser storage; inject the Phase-0 token at build/runtime configuration for the controlled first-client environment.
- The dashboard imports canonical types from workspace packages; no duplicate request/response interfaces.
- Promo must author ordered `rewardRules` and optional `fallbackReward`; it must never emit or accept the removed top-level `reward` field.
- The shared reward-rule editor accepts a module-specific reward renderer, but only Promo is connected to a production API in this plan.
- The simulator must not import `apps/api` internals—only public contracts and HTTP.
- Use TDD, run full workspace checks per task, and sync repository/Notion docs when behaviour changes.

---

## File Structure

```text
apps/dashboard/src/lib/api-client.ts               typed fetch/error boundary
apps/dashboard/src/lib/runtime-config.ts            API URL/token injection
apps/dashboard/src/hooks/useAsyncResource.ts        request state helper
apps/dashboard/src/data/schemaApi.ts                schema endpoint functions
apps/dashboard/src/data/programApi.ts               Promo endpoint functions
apps/dashboard/src/pages/setup/Variables.tsx        live schema list/publish flow
apps/dashboard/src/components/setup/VariablePanel.tsx live create/edit safety UI
apps/dashboard/src/components/rewards/RewardRulesEditor.tsx shared ordered rule/fallback editor
apps/dashboard/src/components/rewards/PromoRewardEditor.tsx canonical commerce reward adapter
apps/dashboard/src/pages/promo/*.tsx                 live Promo list/detail/create/edit
apps/integration-simulator/
  src/client.ts                                      canonical HTTP client
  src/fake-connector.ts                              fake native↔canonical mapping
  src/scenario.ts                                    define/customer/evaluate/redeem flow
  src/index.ts                                       CLI entrypoint
  src/scenario.test.ts                               API-boundary scenario test
docs/integration/operator-quickstart.md              client-visible walkthrough
```

### Task 1: Establish the typed dashboard API boundary

**Files:**
- Create: `apps/dashboard/src/lib/runtime-config.ts`
- Create: `apps/dashboard/src/lib/api-client.ts`
- Create: `apps/dashboard/src/hooks/useAsyncResource.ts`
- Test: `apps/dashboard/src/lib/api-client.test.ts`
- Test: `apps/dashboard/src/hooks/useAsyncResource.test.tsx`
- Modify: `apps/dashboard/package.json`

**Interfaces:**
- Consumes: runtime OpenAPI behaviour and `ApiError` canonical type.
- Produces: `apiRequest<TResponse, TBody>()`, `ApiClientError`, `useAsyncResource<T>()`, and environment keys `VITE_API_BASE_URL`, `VITE_DASHBOARD_SECRET_TOKEN`.

- [ ] **Step 1: Write failing client/hook tests**

```ts
test('parses a canonical API error and keeps the correlation id', async () => {
  mockFetchJson(409, {
    error: { code: 'VERSION_CONFLICT', message: 'stale version', correlationId: 'corr-1', retryable: false },
  });
  await expect(apiRequest('/v1/customers/c-1')).rejects.toMatchObject({
    code: 'VERSION_CONFLICT', correlationId: 'corr-1', retryable: false,
  });
});

test('useAsyncResource ignores a stale earlier response', async () => {
  const { result } = renderHook(() => useAsyncResource(loader, ['new-key']));
  resolveOlderRequest(oldValue);
  resolveNewestRequest(newValue);
  await waitFor(() => expect(result.current.data).toEqual(newValue));
});
```

- [ ] **Step 2: Run tests and confirm missing imports**

Run `pnpm --filter @incentives/dashboard test -- api-client.test.ts useAsyncResource.test.tsx`.

Expected: FAIL because client/hook files are absent.

- [ ] **Step 3: Implement client and request state**

```ts
export async function apiRequest<TResponse, TBody = never>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: TBody; signal?: AbortSignal } = {},
): Promise<TResponse> {
  const response = await fetch(new URL(path, runtimeConfig.apiBaseUrl), {
    method: init.method ?? 'GET',
    signal: init.signal,
    headers: {
      authorization: `Bearer ${runtimeConfig.secretToken}`,
      'content-type': 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw ApiClientError.fromUnknown(payload, response.status);
  return payload as TResponse;
}
```

`runtime-config.ts` validates both environment values at startup and never writes them to `localStorage`, Zustand persistence, logs, or error messages. `useAsyncResource` uses `AbortController`, exposes `{ data, error, loading, reload }`, and prevents stale responses after key changes/unmount.

- [ ] **Step 4: Verify dashboard and workspace**

Run focused tests, full dashboard tests/build/lint, then all workspace checks.

- [ ] **Step 5: Commit the network boundary**

```bash
git add apps/dashboard
git commit -m "feat: add typed dashboard API client"
```

### Task 2: Wire the schema registry UI to published runtime data

**Files:**
- Create: `apps/dashboard/src/data/schemaApi.ts`
- Modify: `apps/dashboard/src/pages/setup/Variables.tsx`
- Modify: `apps/dashboard/src/components/setup/VariablePanel.tsx`
- Modify: `apps/dashboard/src/components/builder/VariablePicker.tsx`
- Test: `apps/dashboard/src/pages/setup/Variables.api.test.tsx`
- Test: `apps/dashboard/src/components/setup/VariablePanel.api.test.tsx`

**Interfaces:**
- Consumes: schema CRUD/publish endpoints and canonical `VariableDefinition`.
- Produces: `listDefinitions()`, `createDefinition()`, `updateDefinition()`, `publishSchema()`, live Variables page, and condition-builder definition input.

- [ ] **Step 1: Write failing UI boundary tests with mocked HTTP only**

Test loading/error/retry, sources `customer/context/cart/line_item/event/system`, create/edit, enum values, required flag, canonical/system read-only state, referenced-field lock message, publish confirmation showing version/sample, and unknown-field API errors.

```tsx
test('publishes definitions and renders the generated sample', async () => {
  renderVariablesWithApi();
  await user.click(await screen.findByRole('button', { name: /publish schema/i }));
  expect(await screen.findByText(/schema version 2 published/i)).toBeInTheDocument();
  expect(screen.getByText(/"channel": "web"/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Confirm current in-memory screen fails API expectations**

Run focused tests; expected failure because the page reads `variablesStore` and has no publish action.

- [ ] **Step 3: Implement schema API functions and focused UI changes**

Keep the existing table/panel styling. Replace store reads/writes only on this screen with typed HTTP calls. Add source options for cart and line item, required/description inputs, publish status, sample/JSON Schema view, and immutable-field explanations. System/canonical rows remain view-only.

Pass API-loaded definitions into the condition builder; remove static `VARIABLES` fallback from real Promo screens, but retain fixtures in tests/story data where explicit.

- [ ] **Step 4: Verify refresh persistence and builder propagation**

In tests, remount after create/publish and return API data; assert definitions persist and appear in `VariablePicker`. Run all checks.

- [ ] **Step 5: Commit live schema UI**

```bash
git add apps/dashboard
git commit -m "feat: wire dashboard schema registry"
```

### Task 3: Wire Promo configuration screens to the runtime API

**Files:**
- Create: `apps/dashboard/src/data/programApi.ts`
- Create: `apps/dashboard/src/components/rewards/RewardRulesEditor.tsx`
- Create: `apps/dashboard/src/components/rewards/RewardRulesEditor.test.tsx`
- Create: `apps/dashboard/src/components/rewards/PromoRewardEditor.tsx`
- Create: `apps/dashboard/src/components/rewards/PromoRewardEditor.test.tsx`
- Modify: `apps/dashboard/src/pages/promo/PromoList.tsx`
- Modify: `apps/dashboard/src/pages/promo/PromoCreate.tsx`
- Modify: `apps/dashboard/src/pages/ProgramDetail.tsx`
- Modify: `apps/dashboard/src/pages/_ProgramListPage.tsx` only where necessary to accept async rows
- Test: `apps/dashboard/src/pages/promo/PromoApiFlow.test.tsx`

**Interfaces:**
- Consumes: canonical Promo program and program endpoints; live definitions from Task 2.
- Produces: `listPromos()`, `getPromo()`, `createPromo()`, `updatePromo()`, reusable `RewardRulesEditor<TReward>`, canonical Promo reward adapter, and real Promo list/detail/create/edit screens.

- [ ] **Step 1: Write failing shared-editor tests**

Test add, duplicate, delete, move up/down, stable IDs, names, per-rule typed conditions, module-specific reward rendering, optional fallback, keyboard-accessible labels, and the persistent “first matching rule wins” explanation. Verify array order is the emitted order and deleting the final rule without a fallback is blocked.

```tsx
test('moves a rule and emits authoritative array order', async () => {
  renderRewardRulesEditor({ value: [under100, over100] });
  await user.click(screen.getByRole('button', { name: /move over 100 up/i }));
  expect(onChange).toHaveBeenLastCalledWith({
    rewardRules: [over100, under100],
  });
});
```

- [ ] **Step 2: Run shared-editor tests and confirm missing components**

Run `pnpm --filter @incentives/dashboard test -- RewardRulesEditor.test.tsx PromoRewardEditor.test.tsx`.

Expected: FAIL because the shared editor and canonical Promo adapter do not exist.

- [ ] **Step 3: Implement the generic ordered editor and Promo adapter**

```ts
interface RewardRulesEditorProps<TReward> {
  value: ConditionalRewards<TReward>;
  definitions: readonly VariableDefinition[];
  renderReward: (props: {
    value: TReward;
    onChange: (reward: TReward) => void;
    fieldPath: string;
  }) => ReactNode;
  onChange: (value: ConditionalRewards<TReward>) => void;
  issues?: readonly FieldIssue[];
}
```

The editor owns ordering and rule identity controls, delegates reward payloads through `renderReward`, reuses `ConditionBuilder`, and maps server issue paths such as `rewardRules.1.conditions.conditions.0.value` to the relevant rule. `PromoRewardEditor` edits only canonical order discount, line-item discount, and free-shipping effects with currencies in minor units and basis points; it does not reuse the loose demo `Reward` shape.

- [ ] **Step 4: Write the failing API-backed Promo flow**

```tsx
test('creates and reloads a promo through the API boundary', async () => {
  renderPromoRoutesWithApi();
  await user.type(screen.getByLabelText(/name/i), 'Gold Web Welcome');
  await completeEligibilityAndTwoRewardRules(user);
  await user.click(screen.getByRole('button', { name: /create/i }));
  expect(await screen.findByText('Gold Web Welcome')).toBeInTheDocument();
  expect(mockProgramApi.create).toHaveBeenCalledWith(expect.objectContaining({
    type: 'promo',
    rewardRules: [
      expect.objectContaining({ id: 'over-100' }),
      expect.objectContaining({ id: 'under-100' }),
    ],
  }));
});
```

Also test fallback creation, reorder persistence, `rewardRuleRef` display in an evaluation sample, API validation errors remaining on the relevant rule/step, draft edit, non-draft edit blocking, refresh, clean rejection of top-level `reward`, and no Promo screen falling back to the in-memory program store.

- [ ] **Step 5: Run and confirm store-backed behaviour fails**

Run focused flow test; expected failure at network expectations.

- [ ] **Step 6: Implement typed program API and async pages**

Keep the existing create/detail/list presentation. Retain global **Eligibility**, replace **Discount** with **Reward rules**, and submit canonical `rewardRules` plus optional `fallbackReward`. Convert loose `[k: string]: unknown` handling at the API boundary into canonical `PromoProgram` parsing. Surface field issues beside the relevant rule and preserve the server correlation id in a collapsible support detail. Invalidate/reload list/detail data after successful creates/updates. List/detail summaries show the ordered conditional reward count or concise ordered summary, never a fabricated single discount.

Other program-type pages remain demo-only and must show a small “Demo data” marker so a client cannot mistake them for live functionality.

- [ ] **Step 7: Verify no live/demo ambiguity**

Run focused component and route tests proving Promo is API-backed and conditional while Affiliate/Referral/Loyalty stay explicitly marked demo-only. Run all workspace checks.

- [ ] **Step 8: Commit live conditional Promo UI**

```bash
git add apps/dashboard
git commit -m "feat: wire conditional promo configuration to runtime API"
```

### Task 4: Build the non-visual integration simulator

**Files:**
- Create: `apps/integration-simulator/package.json`
- Create: `apps/integration-simulator/tsconfig.json`
- Create: `apps/integration-simulator/src/client.ts`
- Create: `apps/integration-simulator/src/fake-connector.ts`
- Create: `apps/integration-simulator/src/scenario.ts`
- Create: `apps/integration-simulator/src/index.ts`
- Test: `apps/integration-simulator/src/scenario.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: public HTTP API and `@incentives/contracts`/`@incentives/connector-kit` only.
- Produces: `runScenario(config)`, CLI command `pnpm --filter @incentives/integration-simulator start`, and reusable fake native commerce fixtures.

- [ ] **Step 1: Write failing scenario tests against an HTTP mock server**

```ts
test('normalizes native cart, evaluates, maps, and commits before capture', async () => {
  const trace = await runScenario(testConfig);
  expect(trace.map(step => step.name)).toEqual([
    'customer-upsert',
    'evaluation',
    'decision-mapped',
    'redemption-committed',
    'payment-captured',
  ]);
});

test('does not capture payment after exhausted redemption', async () => {
  server.respondToRedemption({ status: 'exhausted' });
  const trace = await runScenario(testConfig);
  expect(trace.some(step => step.name === 'payment-captured')).toBe(false);
  expect(trace.at(-1)).toMatchObject({ name: 'cart-repriced' });
});
```

- [ ] **Step 2: Run and confirm the simulator is absent**

Run `pnpm --filter @incentives/integration-simulator test` after adding the workspace manifest; expected compile failure for missing scenario code.

- [ ] **Step 3: Implement the connector and scenario**

The fake native models deliberately use different names (`shopper_id`, `total_pence`, `sku`) and normalize them through `CommerceConnector`. The HTTP client sets publishable credentials for schema/evaluate reads and secret credentials for customer/redemption writes. `runScenario()` records sanitized trace entries without tokens or full customer attributes.

CLI configuration comes from `INCENTIVES_API_URL`, `INCENTIVES_PUBLISHABLE_TOKEN`, and `INCENTIVES_SECRET_TOKEN`. Validate required environment at startup. Provide `--dry-run` to print the canonical request/decision mapping without calling redemption.

- [ ] **Step 4: Run connector conformance and scenario tests**

Run the connector-kit conformance suite against `fake-connector.ts`, simulator tests, then all workspace checks. Expected: both qualified/accepted and exhausted/reprice sequences pass.

- [ ] **Step 5: Commit simulator**

```bash
git add apps/integration-simulator pnpm-lock.yaml
git commit -m "feat: add canonical integration simulator"
```

### Task 5: Verify the client-visible journey and publish the quickstart

**Files:**
- Create: `docs/integration/operator-quickstart.md`
- Modify: `README.md` if present, otherwise create a concise root `README.md`
- Modify: `apps/dashboard/README.md`
- Update: corresponding Notion docs
- Test: `apps/dashboard/src/pages/ClientJourney.test.tsx`

**Interfaces:**
- Consumes: live schema UI, Promo UI, runtime API, simulator.
- Produces: a reproducible first-client walkthrough and final implementation acceptance evidence.

- [ ] **Step 1: Add a cross-surface client journey test**

Use mocked network only at the dashboard fetch boundary and assert the operator can define `customer.tier` and `context.channel`, publish, configure an ordered two-tier Promo, and copy a generated evaluation sample that exposes the selected `rewardRuleRef`. Runtime full-flow correctness remains the Conditional Reward Rules Runtime plan's real-D1 test.

- [ ] **Step 2: Write the operator/integrator quickstart**

Document:

1. define/publish typed fields in the UI;
2. PATCH a customer separately;
3. configure ordered Promo reward rules and an optional fallback;
4. send `customerRef` plus live cart/context;
5. interpret decisions/outcomes/reasons and `rewardRuleRef`;
6. map the effect;
7. redeem before capture;
8. retry with the same order/idempotency key;
9. run the simulator and connector conformance;
10. understand explicitly deferred modules/connectors.

Every JSON example must be imported into a test fixture or validated with canonical schemas in a docs-example test.

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm -r build
pnpm -r lint
git diff --check
```

Expected: all commands exit `0`; dashboard tests distinguish live Promo/schema data from demo-only modules; simulator order is redeem-before-capture.

- [ ] **Step 4: Perform manual acceptance**

Start local API/dashboard, publish two definitions, refresh, create a Promo, PATCH a customer, execute simulator, repeat redemption, and exhaust a one-use Promo. Record exact request ids and outcomes in implementation notes; never record tokens or customer attribute values.

- [ ] **Step 5: Sync Notion and commit docs**

Read back every changed Notion page and verify no truncation/unknown blocks, then:

```bash
git add README.md apps/dashboard/README.md docs/integration apps/dashboard/src/pages/ClientJourney.test.tsx
git commit -m "docs: add first-client integration quickstart"
```

## Plan 3 completion gate

The implementation-ready-core branch is complete only when the schema and conditional Promo UI persist through refresh, the full client journey passes at both UI and real-D1 API layers, selected `rewardRuleRef` is visible through simulation/redemption, the simulator proves accepted/retry/exhausted paths, all workspaces are green, and repository/Notion documentation is synchronized.

## Self-Review

- **Spec coverage:** focused schema UI, typed context shapes, ordered conditional Promo config, selected-rule samples, client-visible flow, fake connector/simulator, demo-only labelling, and documentation map to Tasks 1–5.
- **Deferred intentionally:** Shopify/other production adapters, checkout UI, authentication, billing, analytics, affiliate/referral/loyalty/wallet runtimes.
- **Instruction-quality scan:** no deferred-detail markers or vague test instructions; exact files, tests, code boundaries, commands, and expected states are present.
- **Type consistency:** dashboard/simulator consume Foundation canonical types and Runtime endpoints without local duplicates; `customerRef`, `evaluationId`, `externalOrderRef`, and idempotency naming remain stable.
