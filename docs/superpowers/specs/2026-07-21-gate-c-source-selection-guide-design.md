# Gate C environment-guide corrections

**Status:** Approved design

**Date:** 2026-07-21

## Problem

The local Gate C setup guide has two shell-context defects:

1. It derives its source commit from `git rev-parse HEAD`. A developer following the guide from the `dev` worktree therefore creates a fresh checkout of `dev`, even though that commit does not yet contain `apps/identity` or `apps/operator-web`. The error is discovered only later, when the guide tries to create those applications' `.dev.vars` files.
2. It exports `GATE_C_RUN_ROOT` in the preparation shell, then tells the developer to open new terminals and use that variable. A separately opened shell does not reliably inherit exports from an existing interactive shell, so its `cd "$GATE_C_RUN_ROOT/..."` commands can resolve to nonexistent paths.

## Decision

The guide will require the developer to select an explicit Git source ref. While Plan 3 remains unmerged, the documented ref is `feat/production-operator-platform`. After the work merges, the developer may replace it with the branch, tag, or commit being verified.

Before creating a disposable worktree, the procedure will resolve that ref to an immutable commit and verify that both of these files exist in it:

- `apps/identity/package.json`
- `apps/operator-web/package.json`

After entering the disposable checkout, the procedure will verify the resolved commit and both application directories again. The developer must stop before dependency installation, migrations, or secret creation if any check fails.

The procedure will then print the disposable checkout's absolute, non-sensitive path. Before starting Workers, the developer will copy that value into `GATE_C_REPO_PATH` separately in every new terminal and validate the component directory before changing into it. The Worker terminals do not receive either generated secret: Wrangler reads each Worker's `.dev.vars` from its application directory. The root-bootstrap terminal continues to load `AUTH_SECRET` directly from Identity's `.dev.vars` only for the bootstrap command.

## Alternatives considered

1. **Hard-code the feature branch permanently.** This fixes today's error but becomes wrong after the feature is merged or tested from another ref.
2. **Auto-detect a worktree containing both applications.** This is convenient but can silently choose the wrong branch when several suitable worktrees exist.
3. **Require an explicit ref and validate it.** This is the selected option because it makes the tested code intentional, supports future refs, and fails before environment state is created.

For new-terminal path handling:

1. **Assume new tabs inherit the preparation shell's exports.** Terminal behavior varies, so this is not reproducible.
2. **Write and source a shared environment file.** This avoids copying but creates another stateful file containing shell configuration that must be located and cleaned up.
3. **Copy the printed non-sensitive repository path into each new shell.** This is the selected option because it is explicit, portable, easy to validate, and does not propagate secrets.

## Documentation changes

Only the developer setup guide and its existing Notion mirror will change. The corrections will:

1. replace implicit `HEAD` selection with `GATE_C_SOURCE_REF`;
2. show the current feature branch value explicitly;
3. add pre-checkout file validation;
4. add post-checkout commit and directory validation;
5. print the disposable repository's absolute path before the multi-terminal steps;
6. initialize and validate `GATE_C_REPO_PATH` independently in every new terminal;
7. explain which values are intentionally not shared between shells; and
8. explain the expected result and tell the developer not to continue on failure.

The non-technical tester guide, product code, database schema, and runtime behavior are out of scope.

## Verification

The corrected command sequence will be checked against both relevant cases:

- `dev` (`d8b3cac` at the time of the report) must fail the application-presence validation before secrets are created.
- `feat/production-operator-platform` must resolve successfully and expose both required application paths in a fresh detached worktree.
- A clean shell with no `GATE_C_RUN_ROOT`, authentication secret, or Operator-selection secret must reach each Worker directory after setting only the copied `GATE_C_REPO_PATH`.

The local Markdown will pass `git diff --check`. The Notion page will be read back with `truncated: false` and no unknown block IDs.
