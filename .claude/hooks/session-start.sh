#!/bin/bash
# SessionStart brief: auto-catches a fresh session up on recent work so we don't
# have to re-read the project from scratch every day. Read-only — it only prints
# git history and the worklog; it never changes, commits, or deletes anything.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

echo "=== Session brief (auto-generated) ==="
echo
echo "--- Recent commits (last 15) ---"
git log --oneline -15 2>/dev/null
echo
echo "--- Active branches (recent) ---"
git for-each-ref --sort=-committerdate --count=8 \
  --format='%(refname:short)  (%(committerdate:relative))' refs/heads refs/remotes/origin 2>/dev/null
echo
if [ -f WORKLOG.md ]; then
  echo "--- WORKLOG.md (top) ---"
  head -50 WORKLOG.md
else
  echo "(no WORKLOG.md yet)"
fi
echo
echo "=== end brief ==="
exit 0
