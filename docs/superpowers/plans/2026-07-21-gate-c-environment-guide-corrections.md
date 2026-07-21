# Gate C Environment Guide Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** In progress

**Notion mirror:** https://app.notion.com/p/3a4e5c7c2b8e818db4a4d406509448bc

**Goal:** Make the Gate C developer setup guide select the intended source ref explicitly and work reliably across independently opened terminal shells.

**Architecture:** Resolve an explicit Git ref to one immutable commit and validate required application files before and after creating the disposable worktree. Treat the disposable repository path as the only cross-shell value: print a complete shell-safe export command, require it in each new terminal, and keep generated secrets confined to `.dev.vars` or a bootstrap-only subshell.

**Tech Stack:** Markdown, Git worktrees, zsh/bash shell commands, Wrangler, `ntn` CLI

## Global Constraints

- While Plan 3 remains unmerged, the documented source ref is exactly `feat/production-operator-platform`.
- The source ref must contain `apps/identity/package.json` and `apps/operator-web/package.json` before any disposable state is created.
- Every new terminal must set and validate `GATE_C_REPO_PATH`; it must not rely on `GATE_C_RUN_ROOT` inherited from another shell.
- Generated authentication and Operator-selection secrets must never be printed, copied between terminals, committed, or mirrored to Notion.
- Wrangler Workers load their own `.dev.vars`; only the root bootstrap command may load `AUTH_SECRET`, inside a subshell.
- The guide and its Notion mirror must remain content-equivalent.

---

### Task 1: Correct and verify the local environment guide

**Files:**
- Modify: `docs/testing/gate-c-local-environment-setup.md`
- Modify: `docs/superpowers/specs/2026-07-21-gate-c-source-selection-guide-design.md`

**Interfaces:**
- Consumes: the explicit Git ref stored in `GATE_C_SOURCE_REF` and the generated worktree path stored in the preparation shell's `GATE_C_RUN_ROOT`.
- Produces: immutable `GATE_C_SOURCE_COMMIT` selection and a shell-safe `export GATE_C_REPO_PATH=...` command that can be copied into every independent terminal.

- [ ] **Step 1: Reproduce the source-selection defect at the Git-object boundary**

Run from the feature worktree:

```sh
if git cat-file -e "dev:apps/identity/package.json" 2>/dev/null; then
  printf 'FAIL: dev unexpectedly contains Identity\n'
  exit 1
else
  printf 'PASS: dev cannot prepare the required environment\n'
fi
git cat-file -e "feat/production-operator-platform:apps/identity/package.json"
git cat-file -e "feat/production-operator-platform:apps/operator-web/package.json"
```

Expected: the first check prints `PASS`; both feature-ref checks exit 0 with no output.

- [ ] **Step 2: Replace implicit `HEAD` selection with explicit, prevalidated ref selection**

In `docs/testing/gate-c-local-environment-setup.md`, replace the beginning of Step 1 with commands equivalent to:

```sh
export GATE_C_SOURCE_REPO="$(git rev-parse --show-toplevel)"
export GATE_C_SOURCE_REF="feat/production-operator-platform"

git -C "$GATE_C_SOURCE_REPO" rev-parse --verify "${GATE_C_SOURCE_REF}^{commit}"
git -C "$GATE_C_SOURCE_REPO" cat-file -e "${GATE_C_SOURCE_REF}:apps/identity/package.json"
git -C "$GATE_C_SOURCE_REPO" cat-file -e "${GATE_C_SOURCE_REF}:apps/operator-web/package.json"

export GATE_C_SOURCE_COMMIT="$(git -C "$GATE_C_SOURCE_REPO" rev-parse "${GATE_C_SOURCE_REF}^{commit}")"
export GATE_C_RUN_ROOT="$(mktemp -d)"
git -C "$GATE_C_SOURCE_REPO" worktree add --detach "$GATE_C_RUN_ROOT/repo" "$GATE_C_SOURCE_COMMIT"
cd "$GATE_C_RUN_ROOT/repo"
```

State that developers must stop if any `rev-parse` or `cat-file` command fails, and must change `GATE_C_SOURCE_REF` intentionally when testing another branch, tag, or commit.

- [ ] **Step 3: Add post-checkout validation and generate the cross-shell command**

Replace the existing freshness block with:

```sh
test "$(git rev-parse HEAD)" = "$GATE_C_SOURCE_COMMIT"
test -f apps/identity/package.json
test -f apps/operator-web/package.json
test ! -e apps/api/.wrangler
test ! -e apps/identity/.wrangler

export GATE_C_REPO_PATH="$(pwd -P)"
printf 'Copy this complete command into every new terminal:\n'
printf 'export GATE_C_REPO_PATH=%q\n' "$GATE_C_REPO_PATH"
```

Tell the developer to keep the preparation terminal open for cleanup and not to continue if any `test` command fails.

- [ ] **Step 4: Make all multi-terminal commands self-contained**

Update Terminal 1, Terminal 2, Terminal 3, root bootstrap, and local-email retrieval so each starts by telling the developer to paste the complete `export GATE_C_REPO_PATH=...` command printed in Step 1.

Each Worker command must guard its directory and start the Worker only when validation succeeds. Identity's preferred command must use this exact structure:

```sh
test -f "${GATE_C_REPO_PATH:?Paste the export command printed in Step 1}/apps/identity/package.json" &&
  cd "$GATE_C_REPO_PATH/apps/identity" &&
  pnpm exec wrangler dev --config wrangler.toml --port 8788 --inspector-port 9332
```

Use the same structure with `apps/api` for Core and `apps/operator-web` for Operator Web. Preserve the documented ports and Identity fallback.

Run root bootstrap in a subshell so `AUTH_SECRET` cannot remain in the terminal:

```sh
(
  test -f "${GATE_C_REPO_PATH:?Paste the export command printed in Step 1}/apps/identity/.dev.vars" &&
    cd "$GATE_C_REPO_PATH" &&
    set -a &&
    . apps/identity/.dev.vars &&
    set +a &&
    pnpm --filter @incentives/identity exec node src/cli/bootstrap-root-runner.mjs --environment local --email root@gate-c.example
)
```

Replace local-email retrieval's `GATE_C_RUN_ROOT` path with the independently supplied `GATE_C_REPO_PATH`. Explicitly explain that Worker shells do not need either secret because Wrangler loads `.dev.vars` from each Worker directory.

- [ ] **Step 5: Verify both corrected behaviors using an isolated worktree and clean shell**

Run:

```sh
export GATE_C_VERIFY_ROOT="$(mktemp -d)"
git worktree add --detach "$GATE_C_VERIFY_ROOT/repo" feat/production-operator-platform
test -f "$GATE_C_VERIFY_ROOT/repo/apps/identity/package.json"
test -f "$GATE_C_VERIFY_ROOT/repo/apps/operator-web/package.json"
env -i PATH="$PATH" HOME="$HOME" zsh -f -c 'export GATE_C_REPO_PATH="$1"; test -f "$GATE_C_REPO_PATH/apps/identity/package.json"; test -f "$GATE_C_REPO_PATH/apps/operator-web/package.json"' _ "$GATE_C_VERIFY_ROOT/repo"
git worktree remove "$GATE_C_VERIFY_ROOT/repo"
rmdir "$GATE_C_VERIFY_ROOT"
```

Expected: every command exits 0. The `env -i` shell proves the Worker-shell path does not depend on any preparation-shell export or secret.

- [ ] **Step 6: Run documentation checks and commit the local correction**

```sh
rg -n "GATE_C_SOURCE_REF|cat-file -e|GATE_C_REPO_PATH|Wrangler loads|preparation terminal" docs/testing/gate-c-local-environment-setup.md
rg -n '\$GATE_C_RUN_ROOT/repo/apps|cd "\$GATE_C_RUN_ROOT/repo"' docs/testing/gate-c-local-environment-setup.md
git diff --check
```

Expected: the first scan shows source/path validation and shell-boundary guidance; the second scan returns no matches; `git diff --check` exits 0.

Commit:

```sh
git add docs/testing/gate-c-local-environment-setup.md docs/superpowers/specs/2026-07-21-gate-c-source-selection-guide-design.md
git commit -m "docs: fix gate c environment setup"
```

---

### Task 2: Sync and verify Notion documentation state

**Files:**
- Modify: `docs/superpowers/plans/2026-07-21-gate-c-environment-guide-corrections.md`
- Modify (ignored sync source): `.superpowers/sdd/notion-plans-index.md`

**Interfaces:**
- Consumes: the verified local guide and existing Notion guide page `3a4e5c7c2b8e8197b2daf950431552b3`.
- Produces: content-equivalent Notion guide, a Plan page under `390e5c7c2b8e8165b7f7d77392eab088`, and final `Done` plan status.

- [x] **Step 1: Mark this plan In progress in the Notion Plans page**

Change this plan and its row in `.superpowers/sdd/notion-plans-index.md` from `Todo` to `In progress`, then sync both existing pages. This plan already lives under parent page `390e5c7c2b8e8165b7f7d77392eab088` at page `3a4e5c7c2b8e818db4a4d406509448bc`.

- [ ] **Step 2: Sync the corrected developer guide**

```sh
ntn pages edit 3a4e5c7c2b8e8197b2daf950431552b3 < docs/testing/gate-c-local-environment-setup.md
```

Expected: the CLI returns page ID `3a4e5c7c-2b8e-8197-b2da-f950431552b3`.

- [ ] **Step 3: Read back and compare the Notion guide**

```sh
ntn pages get 3a4e5c7c2b8e8197b2daf950431552b3 --json | jq '{truncated: .markdown.truncated, unknown_block_ids: .markdown.unknown_block_ids}'
```

Expected:

```json
{
  "truncated": false,
  "unknown_block_ids": []
}
```

Confirm the read-back Markdown contains `GATE_C_SOURCE_REF`, `GATE_C_REPO_PATH`, and the instruction to paste the printed export command into every new terminal.

- [ ] **Step 4: Mark the plan Done locally and in Notion**

Set this plan's status to `Done`, check every completed step, update its Plans-index row to `Done`, then sync and read back both the plan page and Plans page without truncation or unknown blocks.

- [ ] **Step 5: Commit final plan evidence**

```sh
git add docs/superpowers/plans/2026-07-21-gate-c-environment-guide-corrections.md
git commit -m "docs: record gate c guide correction"
git status --short --branch
```

Expected: the plan commit succeeds and the feature worktree is clean.
