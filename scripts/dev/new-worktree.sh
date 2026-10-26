#!/bin/bash
# Create an isolated worktree for one agent or task, ready to run.
#   scripts/dev/new-worktree.sh <name> [base-branch]
# Creates ../worktrees/<name> (relative to the repo) on branch work/<name>,
# copies the gitignored apps/web/.env.local, and installs dependencies from the
# shared pnpm store. Prints the worktree path on the last line.
set -euo pipefail
NAME="$1"; BASE="${2:-rebuild-20261025}"
REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
DEST="$(dirname "$REPO")/worktrees/$NAME"
if [ ! -d "$DEST" ]; then
  git -C "$REPO" worktree add -q -b "work/$NAME" "$DEST" "$BASE"
fi
cp "$REPO/apps/web/.env.local" "$DEST/apps/web/.env.local"
(cd "$DEST" && pnpm install --frozen-lockfile --prefer-offline --reporter=silent)
echo "$DEST"
