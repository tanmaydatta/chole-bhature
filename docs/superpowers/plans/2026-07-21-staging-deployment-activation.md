# Staging Deployment Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** In progress

**Notion mirror:** https://app.notion.com/p/3a4e5c7c2b8e8110863ccf7895cabebd

**Goal:** Activate the production operator platform as three isolated Cloudflare staging Workers on `wastd.dev`, preserve the static demo, and replace the obsolete monorepo-root deployment check with non-deploying repository CI.

**Architecture:** Core API and Operator Web receive separate custom domains, while Identity remains private behind service bindings. Product and Auth use distinct D1 databases. Repository CI performs no Cloudflare writes; every staging migration, secret update, route attachment, and Worker deployment is run manually by the user one command at a time.

**Tech Stack:** TypeScript 6, Node.js 22, pnpm 11, Vitest 4, GitHub Actions, Cloudflare Workers, Wrangler 4.112, D1, Resend, Better Auth.

## Global Constraints

- Preserve the existing `vanshit-lakshay` Worker and its `tanmaydatta.workers.dev` demo URL unchanged.
- Deploy exactly `incentives-api-staging`, `incentives-identity-staging`, and `incentives-operator-web-staging`.
- Publish only `api.staging.wastd.dev` and `operator.staging.wastd.dev`; Identity has no public route.
- Use distinct Product and Auth D1 databases and never check their real UUIDs into Git.
- Never commit or print `AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, or `OPERATOR_SELECTION_SECRET`.
- The assistant must not execute a Cloudflare mutation. It gives the user one mutating command, waits for its result, and only then gives the next.
- GitHub CI must not contain Wrangler deployment commands or Cloudflare credentials.
- D1 migrations are forward-only; a failed migration stops activation.
- The written design is `docs/superpowers/specs/2026-07-21-staging-deployment-activation-design.md`.

---

### Task 1: Replace the obsolete deployment check with write-free repository CI

**Files:**
- Create: `apps/identity/test-node/repository-deployment-policy.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `build`, `lint`, and `test` from `package.json`.
- Produces: a `CI` GitHub check for pull requests and pushes to `dev`; it has read-only repository permissions and no Cloudflare deployment capability.

- [x] **Step 1: Write the failing repository-policy test**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

describe('repository deployment policy', () => {
  test('runs repository verification without granting or invoking Cloudflare writes', async () => {
    const workflow = await readFile(
      path.join(repositoryRoot, '.github/workflows/ci.yml'),
      'utf8',
    );

    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('branches: [dev]');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).toContain('pnpm build');
    expect(workflow).toContain('pnpm lint');
    expect(workflow).toContain('pnpm test');
    expect(workflow).not.toMatch(/wrangler|deploy:staging|CLOUDFLARE_/iu);
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @incentives/identity exec vitest run \
  --config vitest.node.config.ts test-node/repository-deployment-policy.test.ts
```

Expected: FAIL with `ENOENT` for `.github/workflows/ci.yml`.

- [x] **Step 3: Add the minimal non-deploying workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [dev]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.14.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint
      - run: pnpm test
```

- [x] **Step 4: Run the targeted test and verify GREEN**

Run the Step 2 command again.

Expected: PASS, with no Cloudflare API calls.

- [x] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml apps/identity/test-node/repository-deployment-policy.test.ts
git commit -m "ci: verify repository without staging writes"
```

---

### Task 2: Add a secret-redacting staging preflight

**Files:**
- Create: `scripts/staging-preflight.mjs`
- Create: `apps/identity/test-node/staging-preflight.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadStagingConfiguration(environment)` from `scripts/staging-wrangler-config.mjs`.
- Produces: `stagingPreflightSummary(environment)` and root command `pnpm staging:preflight`.
- Security boundary: output contains Worker/database names, public origins, RP ID, and recipient count, but no D1 UUID, email address, or secret.

- [x] **Step 1: Write the failing preflight test**

```ts
import { describe, expect, test } from 'vitest';

import { stagingPreflightSummary } from '../../../scripts/staging-preflight.mjs';

describe('staging deployment preflight', () => {
  test('validates the fixed topology and redacts identifiers and recipients', () => {
    const productId = 'd918b5cc-7ce4-4bf6-a33e-90c8335f2ef1';
    const authId = '6a65017f-df57-474e-bebb-e676e09377e5';
    const recipient = 'operator@wastd.dev';
    const summary = stagingPreflightSummary({
      STAGING_ENVIRONMENT: 'staging',
      STAGING_PRODUCT_D1_ID: productId,
      STAGING_AUTH_D1_ID: authId,
      STAGING_OPERATOR_ORIGIN: 'https://operator.staging.wastd.dev',
      STAGING_API_ORIGIN: 'https://api.staging.wastd.dev',
      STAGING_PASSKEY_RP_ID: 'operator.staging.wastd.dev',
      STAGING_ALLOWED_RECIPIENTS: JSON.stringify([recipient]),
    });

    expect(summary).toEqual({
      environment: 'staging',
      workers: {
        api: 'incentives-api-staging',
        identity: 'incentives-identity-staging (private)',
        operatorWeb: 'incentives-operator-web-staging',
      },
      databases: {
        product: 'incentives-staging',
        auth: 'incentives-auth-staging',
      },
      apiOrigin: 'https://api.staging.wastd.dev',
      operatorOrigin: 'https://operator.staging.wastd.dev',
      passkeyRpId: 'operator.staging.wastd.dev',
      allowedRecipientCount: 1,
      cloudflareWrites: false,
    });
    expect(JSON.stringify(summary)).not.toMatch(new RegExp(`${productId}|${authId}|${recipient}`));
  });
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @incentives/identity exec vitest run \
  --config vitest.node.config.ts test-node/staging-preflight.test.ts
```

Expected: FAIL because `scripts/staging-preflight.mjs` does not exist.

- [x] **Step 3: Implement the minimal preflight**

Create `scripts/staging-preflight.mjs`:

```js
import { pathToFileURL } from 'node:url';

import { loadStagingConfiguration } from './staging-wrangler-config.mjs';

export function stagingPreflightSummary(environment) {
  const configuration = loadStagingConfiguration(environment);
  return Object.freeze({
    environment: 'staging',
    workers: Object.freeze({
      api: 'incentives-api-staging',
      identity: 'incentives-identity-staging (private)',
      operatorWeb: 'incentives-operator-web-staging',
    }),
    databases: Object.freeze({
      product: 'incentives-staging',
      auth: 'incentives-auth-staging',
    }),
    apiOrigin: configuration.apiOrigin,
    operatorOrigin: configuration.operatorOrigin,
    passkeyRpId: configuration.passkeyRpId,
    allowedRecipientCount: JSON.parse(configuration.allowedRecipients).length,
    cloudflareWrites: false,
  });
}

export function main(environment = process.env) {
  try {
    process.stdout.write(`${JSON.stringify(stagingPreflightSummary(environment), null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown staging configuration error.';
    process.stderr.write(`Staging preflight failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main();
}
```

Add to root `package.json` scripts:

```json
"staging:preflight": "node scripts/staging-preflight.mjs"
```

- [x] **Step 4: Run the test and verify GREEN**

Run the Step 2 command again.

Expected: PASS and no Cloudflare call.

- [x] **Step 5: Verify invalid configuration fails before Wrangler**

Run:

```bash
env -u STAGING_ENVIRONMENT pnpm staging:preflight
```

Expected: exit 1 with `Staging preflight failed: STAGING_ENVIRONMENT is required.`

- [x] **Step 6: Commit**

```bash
git add package.json scripts/staging-preflight.mjs apps/identity/test-node/staging-preflight.test.ts
git commit -m "feat: add redacted staging preflight"
```

---

### Task 3: Pin the owned staging domains and document the user-run activation

**Files:**
- Modify: `apps/identity/test-node/repository-deployment-policy.test.ts`
- Modify: `.env.staging.example`
- Modify: `docs/integration/staging-operations.md`

**Interfaces:**
- Consumes: the preflight and existing app-specific migrate/deploy commands.
- Produces: a repeatable operator procedure using the two owned custom domains, explicit secret commands, and no checked-in resource IDs or secrets.

- [x] **Step 1: Extend the policy test for the environment template and operations guide**

Append inside the existing `describe` block:

```ts
test('pins owned domains while keeping deploy-specific values out of Git', async () => {
  const template = await readFile(path.join(repositoryRoot, '.env.staging.example'), 'utf8');
  const operations = await readFile(
    path.join(repositoryRoot, 'docs/integration/staging-operations.md'),
    'utf8',
  );

  expect(template).toContain(
    'STAGING_OPERATOR_ORIGIN=https://operator.staging.wastd.dev',
  );
  expect(template).toContain('STAGING_API_ORIGIN=https://api.staging.wastd.dev');
  expect(template).toContain('STAGING_PASSKEY_RP_ID=operator.staging.wastd.dev');
  expect(template).not.toMatch(
    /STAGING_(?:PRODUCT|AUTH)_D1_ID=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/iu,
  );
  expect(operations).toContain('pnpm staging:preflight');
  expect(operations).toContain('pnpm --filter @incentives/api db:migrate:staging');
  expect(operations).toContain('pnpm --filter @incentives/identity db:migrate:staging');
  expect(operations).toContain('--name incentives-identity-staging');
  expect(operations).toContain('--name incentives-operator-web-staging');
  expect(operations).toContain('The assistant must not run these Cloudflare-changing commands');
});
```

- [x] **Step 2: Run the test and verify RED**

Run the Task 1 targeted test command.

Expected: FAIL because the example still contains generic host placeholders and the operations guide does not yet state the manual-control policy.

- [x] **Step 3: Pin only the non-sensitive domain values in the example**

Set these lines in `.env.staging.example`:

```dotenv
STAGING_OPERATOR_ORIGIN=https://operator.staging.wastd.dev
STAGING_API_ORIGIN=https://api.staging.wastd.dev
STAGING_PASSKEY_RP_ID=operator.staging.wastd.dev
```

Keep both D1 IDs, allowed recipients, and all four secrets as non-deployable instructional values.

- [x] **Step 4: Rewrite the staging activation section as an exact ordered procedure**

The guide must state:

1. The static demo remains untouched.
2. `.env.staging` is git-ignored and must contain the two already-created D1 UUIDs, exact owned origins, exact RP ID, and the user-approved recipient list.
3. `pnpm staging:preflight`, `pnpm build`, `pnpm lint`, and `pnpm test` are read-only preconditions.
4. The user runs each of these Cloudflare writes separately and waits for verification:

```bash
pnpm --filter @incentives/api db:migrate:staging
pnpm --filter @incentives/identity db:migrate:staging
pnpm --filter @incentives/api deploy:staging
pnpm --filter @incentives/identity deploy:staging
pnpm --filter @incentives/identity exec wrangler secret put AUTH_SECRET \
  --name incentives-identity-staging
pnpm --filter @incentives/identity exec wrangler secret put RESEND_API_KEY \
  --name incentives-identity-staging
pnpm --filter @incentives/identity exec wrangler secret put RESEND_FROM \
  --name incentives-identity-staging
pnpm --filter @incentives/operator-web deploy:staging
pnpm --filter @incentives/operator-web exec wrangler secret put OPERATOR_SELECTION_SECRET \
  --name incentives-operator-web-staging
```

The guide must explicitly say: `The assistant must not run these Cloudflare-changing commands.`
It must also state that migration failure stops activation, database migrations are never rolled
back destructively, Worker rollback is a separate user-run Wrangler mutation, Identity must remain
private, and the static demo is never a rollback target.

- [x] **Step 5: Run the policy test and verify GREEN**

Run the Task 1 targeted test command.

Expected: both policy tests PASS.

- [x] **Step 6: Commit**

```bash
git add .env.staging.example docs/integration/staging-operations.md \
  apps/identity/test-node/repository-deployment-policy.test.ts
git commit -m "docs: pin manual staging activation procedure"
```

---

### Task 4: Verify the implementation before any Cloudflare mutation

**Files:**
- Modify: `docs/superpowers/plans/2026-07-21-staging-deployment-activation.md` (check completed boxes)
- Modify: Notion mirrors for the design and plan

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidence that local code and CI policy are safe before the user performs staging writes.

- [x] **Step 1: Run targeted staging tests**

```bash
pnpm --filter @incentives/identity exec vitest run --config vitest.node.config.ts \
  test-node/repository-deployment-policy.test.ts \
  test-node/staging-preflight.test.ts \
  test-node/staging-wrangler-runner.test.ts \
  test-node/staging-wrangler-resolution.test.ts
```

Expected: PASS.

- [x] **Step 2: Run repository verification**

```bash
pnpm build
pnpm lint
CI=true pnpm test
pnpm verify:clean-tests
git diff --check
```

Expected: every command exits 0. If any fails, use systematic debugging and do not ask the user to mutate Cloudflare.

- [x] **Step 3: Mirror the checked plan and design status to Notion**

Update the plan page under `Plans` to `In progress`, and edit the design mirror under `Specs` from the checked-in Markdown. Ensure the Plans index contains a status row and link for this plan.

- [x] **Step 4: Restrict the legacy demo repository build to `demo/*`**

Give only the dashboard instructions for setting the `vanshit-lakshay` Workers Builds include path
to `demo/*`, with empty exclude paths. The user performs and confirms the change. This preserves
demo builds while preventing platform-only changes from targeting the demo Worker. The assistant
does not perform the Cloudflare configuration change.

- [ ] **Step 5: Push the branch and verify the replacement CI**

```bash
git push origin feat/production-operator-platform
gh pr checks 6 --watch
```

Expected: the repository `CI` check passes and no new Cloudflare deployment is attempted by the workflow.

---

### Task 5: Activate staging one user-run Cloudflare command at a time

**Files:**
- Local-only: `.env.staging` (git-ignored; never stage or print)
- No tracked file changes until results are documented

**Interfaces:**
- Consumes: the already-created `incentives-staging` and `incentives-auth-staging` D1 databases, the owned domains, a user-approved staging email, and Resend credentials.
- Produces: two migrated D1 databases and three deployed Workers with the fixed bindings and routes.

- [ ] **Step 1: Collect the staging recipient without putting it in chat or Git**

Ask the user to edit `.env.staging` locally from `.env.staging.example`, using the two D1 UUIDs returned by their create commands and their chosen test email. Confirm only that the file exists and has mode `0600`; do not print its contents.

```bash
umask 077
cp -n .env.staging.example .env.staging
chmod 600 .env.staging
${EDITOR:-vi} .env.staging
```

Expected: `.env.staging` exists with mode `0600`, remains ignored by Git, and contains no instructional values.

- [ ] **Step 2: Generate local application secrets without printing them**

The user stores two independent random 32-byte hex values as `AUTH_SECRET` and `OPERATOR_SELECTION_SECRET` in `.env.staging`, then adds their Resend key and verified From identity. No value is pasted into chat.

- [ ] **Step 3: Load and validate the ignored file locally**

```bash
set -a
. ./.env.staging
set +a
pnpm staging:preflight
```

Expected: sanitized JSON lists the three Worker names, two database names, exact domains, recipient count, and `cloudflareWrites: false`; it contains no UUID, email, or secret.

- [ ] **Step 4: Apply Product migrations**

Ask the user to run only:

```bash
pnpm --filter @incentives/api db:migrate:staging
```

Wait. Expected: Wrangler reports all Product migrations applied to `incentives-staging` remotely.

- [ ] **Step 5: Apply Auth migrations**

Only after Step 4 succeeds, ask the user to run:

```bash
pnpm --filter @incentives/identity db:migrate:staging
```

Wait. Expected: Wrangler reports all Identity migrations applied to `incentives-auth-staging` remotely.

- [ ] **Step 6: Deploy Core API**

Ask the user to run:

```bash
pnpm --filter @incentives/api deploy:staging
```

Wait. Expected: `incentives-api-staging` is deployed and `https://api.staging.wastd.dev` is attached.

- [ ] **Step 7: Deploy private Identity**

Ask the user to run:

```bash
pnpm --filter @incentives/identity deploy:staging
```

Wait. Expected: `incentives-identity-staging` is deployed with no public route and a service binding to Core.

- [ ] **Step 8: Configure Identity secrets individually**

Ask the user to run the three Identity `wrangler secret put` commands from Task 3, one at a time. Wrangler prompts for each value; the user does not paste the values into chat. Wait for success after each command.

- [ ] **Step 9: Deploy Operator Web**

Ask the user to run:

```bash
pnpm --filter @incentives/operator-web deploy:staging
```

Wait. Expected: `incentives-operator-web-staging` is deployed, both private service bindings resolve, and `https://operator.staging.wastd.dev` is attached.

- [ ] **Step 10: Configure the Operator selection secret**

Ask the user to run the Operator `wrangler secret put` command from Task 3. Wait for success.

- [ ] **Step 11: Perform read-only resource verification**

Use read-only Wrangler deployment and D1 migration listings to verify names, current versions, and applied migrations. Fetch both public HTTPS health surfaces without credentials. Confirm there is no Identity public hostname and the demo URL is unchanged.

---

### Task 6: Bootstrap, smoke test, document, and integrate

**Files:**
- Modify: `docs/integration/staging-operations.md` only if verified behavior differs from the written procedure
- Create: `docs/testing/staging-activation-run-2026-07-21.md`
- Modify: `docs/superpowers/plans/2026-07-21-staging-deployment-activation.md`
- Modify: Notion design, plan, operations, and run-report mirrors

**Interfaces:**
- Consumes: an activated staging environment.
- Produces: a verified root session, staging smoke evidence, documented deviations, a mergeable PR, and latest-`dev` manual testing instructions.

- [ ] **Step 1: Bootstrap the root as a user-run D1 mutation**

The user runs the existing bootstrap runner with their root email while `AUTH_SECRET` is loaded from `.env.staging`:

```zsh
read -r "STAGING_ROOT_EMAIL?Root email: "
(
  set -a
  . ./.env.staging
  set +a
  pnpm --filter @incentives/identity exec node src/cli/bootstrap-root-runner.mjs \
    --environment staging --email "$STAGING_ROOT_EMAIL"
)
unset STAGING_ROOT_EMAIL
```

Expected: one pending root and one short-lived activation grant are created. The user does not paste the activation grant into chat. They immediately exchange it in `https://operator.staging.wastd.dev`, register a passkey, store recovery codes securely, and clear the terminal output.

- [ ] **Step 2: Execute the staging smoke flow**

Follow the existing non-technical manual guide against the staging origin and record Pass/Fail/Blocked for root access, client provisioning, invitation, role enforcement, schema publication, customer update, conditional Promo evaluation, redemption, idempotent retry, and exhaustion. Record deviations before fixing anything.

- [ ] **Step 3: Write the sanitized activation report**

The report includes commit SHA, Worker/database names, domains, migration counts, test cases, safe status/error codes, correlation IDs, expected versus actual behavior, and final verdict. It excludes D1 UUIDs, email addresses, activation grants, recovery codes, magic links, cookies, credentials, complete customer attributes, condition trees, and reward payloads.

- [ ] **Step 4: Re-run verification after any approved fixes**

```bash
pnpm build
pnpm lint
CI=true pnpm test
pnpm verify:clean-tests
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit documentation and update Notion status**

```bash
git add docs/integration/staging-operations.md \
  docs/testing/staging-activation-run-2026-07-21.md \
  docs/superpowers/plans/2026-07-21-staging-deployment-activation.md
git commit -m "docs: record staging activation evidence"
```

Set this plan to `Done` only when every completion criterion in the design is met; otherwise keep it `In progress` and list blockers.

- [ ] **Step 6: Push, review, and merge PR #6 into `dev`**

Push the final branch, verify all GitHub checks, request code review, and merge through the PR. Do not push directly to `dev`.

- [ ] **Step 7: Refresh manual instructions from merged `dev`**

Create a new documentation branch from the latest remote `dev`, update the developer and non-technical testing guides so their source selection and staging instructions match merged reality, mirror them to Notion, open a separate PR, verify it, and merge it into `dev`.
