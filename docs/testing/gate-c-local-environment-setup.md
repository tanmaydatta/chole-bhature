# Local environment setup for manual end-to-end testing

**Status:** Ready for developer use

**Audience:** The developer preparing a fresh test environment for a non-technical tester.

**Notion mirror:** https://app.notion.com/p/3a4e5c7c2b8e8197b2daf950431552b3

**Tester guide:** [Non-technical end-to-end testing guide](gate-c-non-technical-manual-guide.md)

**Tester guide in Notion:** https://app.notion.com/p/3a4e5c7c2b8e81a8949cff0b321b04fc

This guide prepares the real local Operator Web, Identity, and Core Workers with separate fresh Auth and Product D1 databases. The tester should never need Terminal, Wrangler, D1, activation grants, or raw one-time links.

## Current readiness note — 2026-07-21

Two known blocker areas affect the current branch:

1. The documented `pnpm dev:local` command does not build every workspace dependency and its concurrent Workers compete for a default inspector port. This guide uses separate build/start commands as a temporary setup workaround.
2. A valid Team invitation currently returns `400 INVALID_REQUEST`, so Admin/Operator/Viewer onboarding cannot complete until `GATE-C-ISSUE-003` in the stopped run report is fixed.

The workaround changes no product source. It only lets root-capable journeys run. Do not report a successful full end-to-end test while either blocker remains open.

## What the developer needs

- macOS or Linux.
- Git, Node.js 22, pnpm, and OpenSSL.
- Chromium, Chrome, or another passkey-capable browser. Chromium is preferred for consistency.
- The repository and the feature commit that will be tested.
- Ports `5173` and `8787` free. Port `8788` is preferred for Identity; `18788` is the documented fallback.
- Access to the local machine while the tester is working, because local email is captured in Auth D1 rather than sent to a real inbox.

Check the main tools:

```sh
node --version
pnpm --version
git --version
openssl version
```

## 1. Create a fresh disposable checkout

Use a new checkout for every test run. This prevents a previous run's users, clients, schema, customers, Promos, cookies, or D1 records from affecting the result.

From the repository you want to test:

```sh
export GATE_C_SOURCE_REPO="$(git rev-parse --show-toplevel)"
export GATE_C_SOURCE_COMMIT="$(git rev-parse HEAD)"
export GATE_C_RUN_ROOT="$(mktemp -d)"
git worktree add --detach "$GATE_C_RUN_ROOT/repo" "$GATE_C_SOURCE_COMMIT"
cd "$GATE_C_RUN_ROOT/repo"
```

Confirm it is fresh:

```sh
test "$(git rev-parse HEAD)" = "$GATE_C_SOURCE_COMMIT"
test ! -e apps/api/.wrangler
test ! -e apps/identity/.wrangler
```

If either `.wrangler` check fails, stop. Do not reuse that checkout.

## 2. Install the locked dependencies

```sh
pnpm install --frozen-lockfile
```

Expected: installation succeeds and `git status --short` shows no tracked package or lockfile change.

## 3. Create separate local secrets

Generate two different secrets and write private `.dev.vars` files:

```sh
umask 077
export GATE_C_AUTH_SECRET="$(openssl rand -hex 32)"
export GATE_C_OPERATOR_SECRET="$(openssl rand -hex 32)"
printf 'AUTH_SECRET=%s\n' "$GATE_C_AUTH_SECRET" > apps/identity/.dev.vars
printf 'OPERATOR_SELECTION_SECRET=%s\n' "$GATE_C_OPERATOR_SECRET" > apps/operator-web/.dev.vars
```

Do not print, message, commit, screenshot, or save these values anywhere else. They are disposable and must be removed with the worktree.

## 4. Create fresh Product and Auth databases

From the disposable repository root:

```sh
pnpm --filter @incentives/api db:migrate:local
pnpm --filter @incentives/identity db:migrate:local
```

Expected: every Product and Auth migration is marked successful. These are different D1 databases in different Worker directories.

## 5. Build the currently required workspace packages

Until the local runner issue is fixed, run both commands explicitly:

```sh
pnpm --filter @incentives/api build:dependencies
pnpm --filter @incentives/dashboard build
```

Expected: contracts, engine, module kit, Promo, and dashboard assets build successfully.

## 6. Check the local ports

On macOS:

```sh
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:8787 -sTCP:LISTEN
lsof -nP -iTCP:8788 -sTCP:LISTEN
```

No output means the port is free. Never stop an unrelated process without its owner's approval. If only `8788` is occupied, use Identity port `18788` below; service bindings still connect by Worker name.

## 7. Start the three Workers

Open three terminals. Keep all three running for the whole test.

### Terminal 1 — Identity

Preferred command:

```sh
cd "$GATE_C_RUN_ROOT/repo/apps/identity"
pnpm exec wrangler dev --config wrangler.toml --port 8788 --inspector-port 9332
```

If `8788` was already occupied, use:

```sh
cd "$GATE_C_RUN_ROOT/repo/apps/identity"
pnpm exec wrangler dev --config wrangler.toml --port 18788 --inspector-port 9332
```

Expected: `Ready on http://localhost:8788` or `Ready on http://localhost:18788`.

### Terminal 2 — Core

```sh
cd "$GATE_C_RUN_ROOT/repo/apps/api"
pnpm exec wrangler dev --config wrangler.toml --port 8787 --inspector-port 9331
```

Expected: `Ready on http://localhost:8787`, with Identity eventually shown as connected.

### Terminal 3 — Operator Web

```sh
cd "$GATE_C_RUN_ROOT/repo/apps/operator-web"
pnpm exec wrangler dev --config wrangler.toml --port 5173 --inspector-port 9333
```

Expected: `Ready on http://localhost:5173`, with Identity and Core shown as connected.

Only `http://localhost:5173` is given to the tester. Ports `8787`, `8788`, and `18788` are private implementation services, not browser entrypoints.

## 8. Bootstrap the one root user

In a fourth terminal:

```sh
cd "$GATE_C_RUN_ROOT/repo"
set -a
. apps/identity/.dev.vars
set +a
pnpm --filter @incentives/identity exec node src/cli/bootstrap-root-runner.mjs --environment local --email root@gate-c.example
unset AUTH_SECRET
```

The command prints a one-time activation grant. Treat it like a password:

1. Open `http://localhost:5173` in the root browser profile.
2. Expand **Root setup or recovery**.
3. Paste the grant into **Activation grant**.
4. Select **Set up root passkey** and complete the browser passkey prompt.
5. Confirm recovery codes appear. Store them only for the duration of the test if needed; never add them to the test report.
6. Tick **I have stored these recovery codes securely**, then select **Finish setup**.
7. Select **Sign in with passkey**.
8. Clear the terminal containing the grant.

The tester can now use the root browser profile without seeing the grant or recovery codes.

## 9. Prepare browser profiles and test identities

Prepare four separate browser profiles or clearly labelled private windows:

| Profile | Identity | Prepared by |
| --- | --- | --- |
| Root | `root@gate-c.example` | Developer, with passkey |
| Admin | `admin@gate-c.example` | Created through invitation when the blocker is fixed |
| Operator | `operator@gate-c.example` | Invited by Admin |
| Viewer | `viewer@gate-c.example` | Invited by Admin |

Do not share cookies or copy storage between profiles. Each role must sign in through its own real invitation and magic-link flow.

## 10. Retrieve a local invitation or sign-in email

Local mode captures messages in Auth D1. When the tester requests an invitation or magic link, run this from the Identity directory, replacing the recipient:

```sh
cd "$GATE_C_RUN_ROOT/repo/apps/identity"
pnpm exec wrangler d1 execute incentives-auth-local --local --config wrangler.toml \
  --command "SELECT subject, text_body FROM local_email_capture WHERE recipient='admin@gate-c.example' ORDER BY created_at DESC, id DESC LIMIT 1" \
  --json
```

Use `operator@gate-c.example` or `viewer@gate-c.example` for those profiles.

The output contains a one-time link. Open it directly in the correct browser profile or pass it securely to the tester. Never paste it into Slack, Notion, Git, screenshots, or the result report.

In staging, the tester should use the real allowed test mailbox instead; the developer must not query local D1.

## 11. Give the tester this handoff

Fill in only non-sensitive values:

| Handoff item | Value |
| --- | --- |
| Test URL | `http://localhost:5173` |
| Commit under test | Record the commit hash |
| Root profile | Browser/profile name, not credentials |
| Test client names | `Gate C Alpha`, `Gate C Beta` |
| Tester guide | [Non-technical end-to-end testing guide](gate-c-non-technical-manual-guide.md) |
| Developer contact | Name/contact for one-time local email links |
| Known blockers | `GATE-C-ISSUE-001`, `002`, and `003` until fixed |

Do not put activation grants, recovery codes, cookies, `.dev.vars`, or one-time links in the handoff.

## 12. Support the tester without changing the result

- Help only with environment availability, browser profile selection, and opening the correct local-capture email.
- Do not click product controls for the tester unless the guide explicitly assigns the action to the developer.
- Do not repair or seed product data after a failure. Record the failure and restart later from a fresh worktree after the fix.
- Do not explain away confusing UI. Confusion encountered by a non-technical tester is itself useful product feedback.

## 13. Stop and clean up

After the tester finishes:

1. Save the non-sensitive result sheet.
2. Stop Operator Web, Core, and Identity with `Ctrl-C` in their terminals.
3. Close the test browser profiles.
4. From the source repository, confirm the disposable path before removing it:

   ```sh
   cd "$GATE_C_SOURCE_REPO"
   test -n "$GATE_C_RUN_ROOT"
   test "$GATE_C_RUN_ROOT" != "/"
   test -d "$GATE_C_RUN_ROOT/repo"
   git worktree remove --force "$GATE_C_RUN_ROOT/repo"
   rm -rf "$GATE_C_RUN_ROOT"
   ```

5. Confirm `git worktree list` no longer shows the disposable checkout.
6. Confirm no run-owned process is listening on `5173`, `8787`, or the Identity port used for this run.

The temporary directory is not recoverable after removal; verify the exact path first.

## Environment-ready checklist

- [ ] Fresh detached checkout at the intended commit.
- [ ] Locked install completed with no tracked dependency changes.
- [ ] Separate private Identity and Operator secrets created.
- [ ] Fresh Product and Auth migrations completed.
- [ ] Required workspace packages and dashboard built.
- [ ] Identity, Core, and Operator Web are running and connected.
- [ ] Root passkey setup completed; grant/recovery values are not in evidence.
- [ ] Four isolated browser profiles are planned.
- [ ] Developer is ready to open local captured emails securely.
- [ ] Tester received only the URL, profile names, guide, and known blockers.
