# Gate C source-selection guide correction

**Status:** Approved design

**Date:** 2026-07-21

## Problem

The local Gate C setup guide derives its source commit from `git rev-parse HEAD`. A developer following the guide from the `dev` worktree therefore creates a fresh checkout of `dev`, even though that commit does not yet contain `apps/identity` or `apps/operator-web`. The error is discovered only later, when the guide tries to create those applications' `.dev.vars` files.

## Decision

The guide will require the developer to select an explicit Git source ref. While Plan 3 remains unmerged, the documented ref is `feat/production-operator-platform`. After the work merges, the developer may replace it with the branch, tag, or commit being verified.

Before creating a disposable worktree, the procedure will resolve that ref to an immutable commit and verify that both of these files exist in it:

- `apps/identity/package.json`
- `apps/operator-web/package.json`

After entering the disposable checkout, the procedure will verify the resolved commit and both application directories again. The developer must stop before dependency installation, migrations, or secret creation if any check fails.

## Alternatives considered

1. **Hard-code the feature branch permanently.** This fixes today's error but becomes wrong after the feature is merged or tested from another ref.
2. **Auto-detect a worktree containing both applications.** This is convenient but can silently choose the wrong branch when several suitable worktrees exist.
3. **Require an explicit ref and validate it.** This is the selected option because it makes the tested code intentional, supports future refs, and fails before environment state is created.

## Documentation changes

Only the developer setup guide and its existing Notion mirror will change. The correction will:

1. replace implicit `HEAD` selection with `GATE_C_SOURCE_REF`;
2. show the current feature branch value explicitly;
3. add pre-checkout file validation;
4. add post-checkout commit and directory validation;
5. explain the expected result and tell the developer not to continue on failure.

The non-technical tester guide, product code, database schema, and runtime behavior are out of scope.

## Verification

The corrected command sequence will be checked against both relevant cases:

- `dev` (`d8b3cac` at the time of the report) must fail the application-presence validation before secrets are created.
- `feat/production-operator-platform` must resolve successfully and expose both required application paths in a fresh detached worktree.

The local Markdown will pass `git diff --check`. The Notion page will be read back with `truncated: false` and no unknown block IDs.
